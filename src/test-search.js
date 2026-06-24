import { MeiliSearch } from 'meilisearch';
import { loadConfig } from './config.js';
import { buildTestQueries, failureHint } from './test-queries.js';
import { REF_USA_QUERIES } from './ref-usa-queries.js';
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

async function runSearchTests(index, queries, sortField) {
  const results = [];

  for (const { q, expect, meta, source } of queries) {
    const response = await index.search(q, {
      limit: 3,
      sort: [`${sortField}:asc`],
      attributesToRetrieve: [
        'post_title',
        'categoria_principal_name',
        'orden_web',
        'marca',
        'codigo_aguila',
        'es_accesorio',
        'es_ref_usa',
      ],
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

function refUsaOrderingOk(hits) {
  if (hits.length === 0) {
    return { ok: true, reason: null };
  }

  const hasNormalSku = hits.some((hit) => hit.es_ref_usa !== 1);
  if (hasNormalSku && hits[0].es_ref_usa === 1) {
    return {
      ok: false,
      reason: 'top_is_ref_usa',
      topSku: hits[0].codigo_aguila,
    };
  }

  let sawRefUsa = false;
  for (const hit of hits) {
    if (hit.es_ref_usa === 1) {
      sawRefUsa = true;
    } else if (sawRefUsa) {
      return {
        ok: false,
        reason: 'ref_usa_before_normal',
        sku: hit.codigo_aguila,
      };
    }
  }

  return { ok: true, reason: null };
}

async function runRefUsaTests(index, sortField) {
  const results = [];

  for (const entry of REF_USA_QUERIES) {
    const response = await index.search(entry.q, {
      limit: 50,
      sort: [`${sortField}:asc`],
      attributesToRetrieve: ['post_title', 'codigo_aguila', 'es_ref_usa', 'orden_web'],
    });

    const hits = response.hits;
    const check = refUsaOrderingOk(hits);
    const normalCount = hits.filter((hit) => hit.es_ref_usa !== 1).length;
    const refCount = hits.filter((hit) => hit.es_ref_usa === 1).length;

    results.push({
      query: entry.q,
      source: 'ref_usa',
      ok: check.ok,
      total: response.estimatedTotalHits ?? hits.length,
      meta: entry,
      reason: check.reason,
      counts: { normal: normalCount, ref: refCount },
      top: hits[0]
        ? {
            title: hits[0].post_title?.slice(0, 80),
            sku: hits[0].codigo_aguila,
            es_ref_usa: hits[0].es_ref_usa,
            orden_web: hits[0].orden_web,
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
    `[test] Loaded ${queries.length} queries (${querySets.manual.length} manual + ${querySets.generated.length} generated) + ${REF_USA_QUERIES.length} ref_usa`,
  );

  if (apply) {
    console.log('[test] Applying index settings...');
    await applySettings(client, config);
  }

  const results = await runSearchTests(index, queries, config.meilisearch.sortField);
  const refUsaResults = await runRefUsaTests(index, config.meilisearch.sortField);
  const allResults = [...results, ...refUsaResults];

  const passed = allResults.filter((result) => result.ok);
  const failed = allResults.filter((result) => !result.ok);
  const manualPassed = passed.filter((result) => result.source === 'manual').length;
  const generatedPassed = passed.filter((result) => result.source === 'generated').length;
  const refUsaPassed = passed.filter((result) => result.source === 'ref_usa').length;
  const manualTotal = allResults.filter((result) => result.source === 'manual').length;
  const generatedTotal = allResults.filter((result) => result.source === 'generated').length;
  const refUsaTotal = refUsaResults.length;

  console.log(
    `\n[test] ${passed.length}/${allResults.length} passed (${failed.length} failed)`,
  );
  console.log(
    `[test] manual: ${manualPassed}/${manualTotal} | generated: ${generatedPassed}/${generatedTotal} | ref_usa: ${refUsaPassed}/${refUsaTotal}\n`,
  );

  if (verbose) {
    for (const result of allResults) {
      const status = result.ok ? 'OK' : 'FAIL';
      console.log(`[test] "${result.query}" — ${status} (${result.total} hits)`);
      if (result.top) {
        console.log(`  → ${result.top.title}`);
        console.log(`    cat: ${result.top.category} | marca: ${result.top.marca} | ow: ${result.top.orden_web}`);
      }
    }
  } else {
    for (const result of passed) {
      if (result.source === 'ref_usa') {
        console.log(
          `  OK  [ref_usa] "${result.query}" → ${result.top?.sku} (normal ${result.counts.normal}, ref ${result.counts.ref})`,
        );
        continue;
      }
      console.log(`  OK  [${result.source}] "${result.query}" → ${result.top?.title?.slice(0, 55)}`);
    }
  }

  if (failed.length > 0) {
    console.log('\n[test] Failures:');
    for (const result of failed) {
      if (result.source === 'ref_usa') {
        console.log(
          `  FAIL [ref_usa] "${result.query}" (${result.total} hits) [${result.reason}] — ${result.meta?.note ?? ''}`,
        );
        if (result.top) {
          console.log(`    top: ${result.top.sku} es_ref_usa=${result.top.es_ref_usa} ow=${result.top.orden_web}`);
          console.log(`    title: ${result.top.title}`);
          console.log(`    in page: normal=${result.counts.normal} ref=${result.counts.ref}`);
        }
        continue;
      }
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
