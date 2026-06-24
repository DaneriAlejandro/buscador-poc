function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function assertSqlIdentifier(name, label) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`${label} must be a valid SQL identifier`);
  }
  return name;
}

export const GADNIC_MARCA = 'Gadnic';

export function loadWebConfig() {
  const sortField = assertSqlIdentifier(
    process.env.MEILISEARCH_SORT_FIELD?.trim() || 'orden_web',
    'MEILISEARCH_SORT_FIELD',
  );

  return {
    host: required('MEILISEARCH_HOST'),
    apiKey: required('MEILISEARCH_API_KEY'),
    indexName: required('MEILISEARCH_INDEX'),
    sortField,
  };
}

export const CATEGORY_FACET = 'categoria_principal_name';

export function buildScopeFilter(scope) {
  if (scope === 'bidcom' || scope === 'all' || !scope) {
    return undefined;
  }

  if (scope === 'gadnic') {
    return `marca = "${GADNIC_MARCA}"`;
  }

  return undefined;
}

export function buildSearchFilter({ scope, category }) {
  const parts = [];

  const scopeFilter = buildScopeFilter(scope);
  if (scopeFilter) {
    parts.push(scopeFilter);
  }

  if (category) {
    const safeCategory = category.replace(/"/g, '\\"');
    parts.push(`${CATEGORY_FACET} = "${safeCategory}"`);
  }

  if (parts.length === 0) {
    return undefined;
  }

  return parts.join(' AND ');
}

export function parseFacetCategories(facetDistribution, limit = 12) {
  const buckets = facetDistribution?.[CATEGORY_FACET];
  if (!buckets) {
    return [];
  }

  return Object.entries(buckets)
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}
