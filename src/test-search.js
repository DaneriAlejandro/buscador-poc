import { MeiliSearch } from 'meilisearch';
import { loadConfig } from './config.js';
import { buildTestQueries, failureHint } from './test-queries.js';
import { ensureIndex } from './meilisearch.js';

function loadClient(config) {
  return new MeiliSearch({
    host: config.meilisearch.host,
    apiKey: config.meilisearch.apiKey,
    defaultWaitOptions: { timeout: 600_000, interval: 1000 },
  });
}

async function applySettings(client, config) {
  await ensureIndex(client, config.meilisearch);
}

async function runSearchTests(index, queries) {
  const results = [];

  for (const { q, expect, meta, source } of queries) {
    const response = await index.search(q, {
      limit: 3,
      sort: [`${config.meilisearch.sortField}:asc`],
      attributesToRetrieve: ['post_title', 'categoria_principal_name', 'orden_web', 'marca', 'es_accesorio'],
      showRankingScore: true,
    });

    const top = response.hits[0];
    const ok = top ? expect(top.post_title ?? '', top.categoria_principal_name ?? '', top) : false;

    results.push({
      query: q,
      source,
      ok,
      total: response.estimatedTotalHits ?? response.hits.length,
      meta,
      top: top
        ? {
            title: top.post_title?.slice(0, 80),
            category: top.categoria_principal_name,
            marca: top.marca,
            orden_web: top.orden_web,
            score: top._rankingScore?.toFixed?.(4),
          }
        : null,
    });
  }

  return results;
}

async function main() {
  const config = loadConfig();
  const client = loadClient(config);
  const index = client.index(config.meilisearch.indexName);
  const apply = process.env.SKIP_SETTINGS !== 'true';
  const verbose = process.env.VERBOSE === 'true';

  const querySets = await buildTestQueries(config.bigQuery);
  const queries = querySets.all;
  console.log(
    `[test] Loaded ${queries.length} queries (${querySets.manual.length} manual + ${querySets.generated.length} generated)`,
  );

  if (apply) {
    console.log('[test] Applying index settings...');
    await applySettings(client, config);
  }

  const results = await runSearchTests(index, queries);
  const passed = results.filter((result) => result.ok);
  const failed = results.filter((result) => !result.ok);
  const manualPassed = passed.filter((result) => result.source === 'manual').length;
  const generatedPassed = passed.filter((result) => result.source === 'generated').length;
  const manualTotal = results.filter((result) => result.source === 'manual').length;
  const generatedTotal = results.filter((result) => result.source === 'generated').length;

  console.log(
    `\n[test] ${passed.length}/${results.length} passed (${failed.length} failed)`,
  );
  console.log(`[test] manual: ${manualPassed}/${manualTotal} | generated: ${generatedPassed}/${generatedTotal}\n`);

  if (verbose) {
    for (const result of results) {
      const status = result.ok ? 'OK' : 'FAIL';
      console.log(`[test] "${result.query}" — ${status} (${result.total} hits)`);
      if (result.top) {
        console.log(`  → ${result.top.title}`);
        console.log(`    cat: ${result.top.category} | marca: ${result.top.marca} | ow: ${result.top.orden_web}`);
      }
    }
  } else {
    for (const result of passed) {
      console.log(`  OK  [${result.source}] "${result.query}" → ${result.top?.title?.slice(0, 55)}`);
    }
  }

  if (failed.length > 0) {
    console.log('\n[test] Failures:');
    for (const result of failed) {
      console.log(`  FAIL [${result.source}] "${result.query}" (${result.total} hits) [${failureHint(result)}]`);
      if (result.top) {
        console.log(`    got: ${result.top.title}`);
        console.log(`    cat: ${result.top.category} | marca: ${result.top.marca}`);
        if (result.meta?.category) {
          console.log(`    expected category: ${result.meta.category}`);
        }
      } else {
        console.log('    got: (no results)');
      }
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[test] Failed:', error.message);
  process.exitCode = 1;
});
