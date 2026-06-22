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
