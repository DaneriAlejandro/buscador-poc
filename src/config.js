import 'dotenv/config';

const DEFAULT_SEARCHABLE_ATTRIBUTES = [
  'post_title',
  'categoria_principal_name',
  'categoria_principal_slug',
  'codigo_aguila',
  'ean',
  'id_producto',
  'subtitulo',
  'descripcion_producto',
  'marca',
  'tags',
  'linea',
  'post_name',
  'titulo_texto_plano_ml',
];

const DEFAULT_DISPLAYED_ATTRIBUTES = [
  'post_title',
  'imagen_calada',
  'precio',
  'precio_tachado',
  'descuento',
  'marca',
  'codigo_aguila',
  'ean',
  'subtitulo',
  'descripcion_producto',
  'categoria_principal_name',
  'categoria_principal_slug',
  'categoria_facet',
  'linea',
  'tags',
  'orden_web',
  'envio_gratis',
  'mas_vendido',
  'recomendado',
  'post_name',
  'post_status',
  'ID',
  'id_producto',
  'precio_3_cuotas',
  'precio_6_cuotas',
  'precio_12_cuotas',
  'post_modified',
  'es_accesorio',
  'es_ref_usa',
];

const DEFAULT_FILTERABLE_ATTRIBUTES = ['marca', 'categoria_facet'];

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseCredentials() {
  const raw = required('BIGQUERY_CREDENTIALS_JSON');
  const credentials = JSON.parse(raw);

  if (!credentials.project_id || !credentials.client_email || !credentials.private_key) {
    throw new Error('BIGQUERY_CREDENTIALS_JSON must include project_id, client_email and private_key');
  }

  return credentials;
}

function assertSqlIdentifier(name, label) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`${label} must be a valid SQL identifier`);
  }
  return name;
}

function parseSearchableAttributes() {
  const raw = process.env.MEILISEARCH_SEARCHABLE_ATTRIBUTES?.trim();
  if (!raw) {
    return DEFAULT_SEARCHABLE_ATTRIBUTES;
  }

  return raw
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean);
}

function parseDisplayedAttributes() {
  const raw = process.env.MEILISEARCH_DISPLAYED_ATTRIBUTES?.trim();
  if (!raw) {
    return DEFAULT_DISPLAYED_ATTRIBUTES;
  }

  return raw
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean);
}

function parseFilterableAttributes() {
  const raw = process.env.MEILISEARCH_FILTERABLE_ATTRIBUTES?.trim();
  if (!raw) {
    return DEFAULT_FILTERABLE_ATTRIBUTES;
  }

  return raw
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean);
}

function buildRankingRules(sortField) {
  return [
    'es_ref_usa:asc',
    'words',
    'typo',
    'proximity',
    'attributeRank',
    'wordPosition',
    'sort',
    'exactness',
    'es_accesorio:asc',
  ];
}

const DEFAULT_SYNONYMS = {
  lavarropas: ['lavarropa'],
  notebooks: ['notebook', 'laptop', 'portatil', 'portátil'],
  tablets: ['tablet'],
  pendrive: ['pen drive', 'memoria usb'],
  drones: ['drone'],
  parlantes: ['parlante'],
  auriculares: ['auricular'],
  celulares: ['celular', 'smartphone'],
  impresoras: ['impresora'],
  heladeras: ['heladera'],
  microondas: ['microonda'],
  cafeteras: ['cafetera'],
  aspiradoras: ['aspiradora'],
  masajeadores: ['masajeador'],
  smartwatch: ['smart watch'],
  'tabla grafica': ['tableta grafica'],
  griferias: ['griferia', 'canilla'],
  anafes: ['anafe'],
  trapeadores: ['trapeador', 'mopa'],
};

export function loadConfig() {
  const credentials = parseCredentials();
  const dataset = required('BIGQUERY_DATASET');
  const table = required('BIGQUERY_TABLE');
  const primaryKey = process.env.MEILISEARCH_PRIMARY_KEY?.trim() || 'ID';
  const sortField = assertSqlIdentifier(
    process.env.MEILISEARCH_SORT_FIELD?.trim() || 'orden_web',
    'MEILISEARCH_SORT_FIELD',
  );
  const batchSize = Number(process.env.SYNC_BATCH_SIZE || 1000);
  const deleteStale = process.env.SYNC_DELETE_STALE !== 'false';

  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error('SYNC_BATCH_SIZE must be a positive integer');
  }

  const customQuery = process.env.BIGQUERY_QUERY?.trim();
  const tableRef = `\`${credentials.project_id}.${dataset}.${table}\``;
  const query =
    customQuery ||
    `SELECT * FROM ${tableRef} WHERE post_status = 'publish' ORDER BY ${sortField} ASC`;

  return {
    bigQuery: {
      projectId: credentials.project_id,
      credentials: {
        client_email: credentials.client_email,
        private_key: credentials.private_key,
      },
      location: process.env.BIGQUERY_LOCATION?.trim() || 'US',
      query,
    },
    meilisearch: {
      host: required('MEILISEARCH_HOST'),
      apiKey: required('MEILISEARCH_API_KEY_SYNC'),
      indexName: required('MEILISEARCH_INDEX'),
      primaryKey,
      sortField,
      searchableAttributes: parseSearchableAttributes(),
      displayedAttributes: parseDisplayedAttributes(),
      filterableAttributes: parseFilterableAttributes(),
      rankingRules: buildRankingRules(sortField),
      synonyms: DEFAULT_SYNONYMS,
    },
    sync: {
      batchSize,
      deleteStale,
    },
  };
}
