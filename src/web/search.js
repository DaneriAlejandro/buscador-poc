import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MeiliSearch } from 'meilisearch';
import {
  CATEGORY_FACET,
  buildSearchFilter,
  loadWebConfig,
  parseFacetCategories,
} from './config.js';

const categoryLabelsPath = join(dirname(fileURLToPath(import.meta.url)), '../../public/categories.json');

let cachedIndex;
let categoryLabelsPromise;

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

async function loadCategoryLabels() {
  if (!categoryLabelsPromise) {
    categoryLabelsPromise = readFile(categoryLabelsPath, 'utf8')
      .then((raw) => JSON.parse(raw))
      .catch(() => ({}));
  }

  return categoryLabelsPromise;
}

export async function searchProducts(params) {
  const q = params.q?.trim() ?? '';
  const limit = Math.min(Number(params.limit) || 20, 50);
  const offset = Math.max(Number(params.offset) || 0, 0);
  const showScores = params.scores === '1' || params.scores === true;
  const scope = params.scope?.trim() || 'bidcom';
  const category = params.category?.trim() || '';

  const { index, config } = getIndex();
  const sort = [`${config.sortField}:asc`];
  const filter = buildSearchFilter({
    scope,
    category,
  });

  const searchParams = {
    limit,
    offset,
    sort,
    showRankingScore: showScores,
    facets: [CATEGORY_FACET],
  };

  if (filter) {
    searchParams.filter = filter;
  }

  const [response, categoryLabels] = await Promise.all([
    index.search(q, searchParams),
    loadCategoryLabels(),
  ]);

  return {
    query: q,
    scope,
    category: category || null,
    filter: filter ?? null,
    limit,
    offset,
    sort,
    processingTimeMs: response.processingTimeMs,
    estimatedTotalHits: response.estimatedTotalHits ?? response.hits.length,
    categories: parseFacetCategories(response.facetDistribution, categoryLabels),
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
