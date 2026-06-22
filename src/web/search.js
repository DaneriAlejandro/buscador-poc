import { MeiliSearch } from 'meilisearch';
import { loadWebConfig } from './config.js';

let cachedIndex;

function getIndex() {
  if (!cachedIndex) {
    const config = loadWebConfig();
    const client = new MeiliSearch({
      host: config.host,
      apiKey: config.apiKey,
    });
    cachedIndex = { index: client.index(config.indexName), config };
  }
  return cachedIndex;
}

export async function searchProducts(params) {
  const q = params.q?.trim() ?? '';
  const limit = Math.min(Number(params.limit) || 20, 50);
  const offset = Math.max(Number(params.offset) || 0, 0);
  const showScores = params.scores === '1' || params.scores === true;

  const { index, config } = getIndex();
  const sort = [`${config.sortField}:asc`];

  const response = await index.search(q, {
    limit,
    offset,
    sort,
    showRankingScore: showScores,
  });

  return {
    query: q,
    limit,
    offset,
    sort,
    processingTimeMs: response.processingTimeMs,
    estimatedTotalHits: response.estimatedTotalHits ?? response.hits.length,
    hits: response.hits,
  };
}

export function getHealthInfo() {
  const config = loadWebConfig();
  return {
    index: config.indexName,
    host: config.host,
  };
}
