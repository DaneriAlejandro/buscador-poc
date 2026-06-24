import { fetchRows } from './bigquery.js';
import {
  createMeilisearchClient,
  deleteStaleDocuments,
  ensureIndex,
  upsertDocuments,
} from './meilisearch.js';

function serializeValue(value) {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'object' && typeof value.toFixed === 'function') {
    return value.toFixed(0);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

function extractImageFromFields(fieldsRaw) {
  if (!fieldsRaw || typeof fieldsRaw !== 'string') {
    return null;
  }

  const urls =
    fieldsRaw.match(
      /https?:\/\/www\.bidcom\.com\.ar\/publicacionesML\/productos\/[^"\\]+?\.(?:jpg|jpeg|png|webp)/gi,
    ) ?? [];

  if (urls.length === 0) {
    return null;
  }

  return urls.find((url) => /1000x1000/i.test(url)) ?? urls[0];
}

function isRefUsaSku(codigoAguila) {
  if (!codigoAguila) {
    return false;
  }

  const normalized = String(codigoAguila).trim().toLowerCase();
  return normalized.startsWith('ref-') || normalized.startsWith('usa-');
}

function isAccessoryTitle(title) {
  if (!title) {
    return false;
  }

  const normalized = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (
    /^(kit|funda|soporte|porta|accesorio|repuesto|herramienta|set|adaptador|cubierta|dispenser|protector)\b/.test(
      normalized,
    )
  ) {
    return true;
  }

  if (/\b(porta|para)\s+(notebook|tablet|celular|laptop|tv|monitor|heladera|lavarropas)\b/.test(normalized)) {
    return true;
  }

  if (/\binstalacion de\b/.test(normalized)) {
    return true;
  }

  return false;
}

function normalizeDocument(row, primaryKey, sortField) {
  const document = {};

  for (const [key, value] of Object.entries(row)) {
    document[key] = serializeValue(value);
  }

  if (document[primaryKey] === undefined || document[primaryKey] === null) {
    throw new Error(`Row is missing primary key field "${primaryKey}"`);
  }

  document[primaryKey] = String(document[primaryKey]);

  if (sortField) {
    const priority = document[sortField];
    document[sortField] = priority == null || priority === '' ? 9999 : Number(priority);
  }

  if (!document.imagen_calada) {
    const imageUrl = extractImageFromFields(document.fields);
    if (imageUrl) {
      document.imagen_calada = imageUrl;
    }
  }

  document.es_accesorio = isAccessoryTitle(document.post_title) ? 1 : 0;
  document.es_ref_usa = isRefUsaSku(document.codigo_aguila) ? 1 : 0;

  return document;
}

export async function syncIndex(config) {
  const startedAt = Date.now();
  console.log('[sync] Fetching rows from BigQuery...');

  const rows = await fetchRows(config.bigQuery);
  console.log(`[sync] BigQuery returned ${rows.length} rows`);

  const documents = rows.map((row) =>
    normalizeDocument(row, config.meilisearch.primaryKey, config.meilisearch.sortField),
  );
  const client = createMeilisearchClient(config.meilisearch);
  const index = await ensureIndex(client, config.meilisearch);

  console.log(`[sync] Upserting documents into index "${config.meilisearch.indexName}"...`);
  const upserted = await upsertDocuments(
    index,
    documents,
    config.meilisearch.primaryKey,
    config.sync.batchSize,
  );
  console.log(`[sync] Upserted ${upserted} documents`);

  let deleted = 0;
  if (config.sync.deleteStale) {
    console.log('[sync] Deleting stale documents...');
    deleted = await deleteStaleDocuments(
      index,
      documents.map((document) => document[config.meilisearch.primaryKey]),
      config.meilisearch.primaryKey,
      config.sync.batchSize,
    );
    console.log(`[sync] Deleted ${deleted} stale documents`);
  }

  const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(2);
  console.log(`[sync] Done in ${elapsedSeconds}s`);

  return {
    fetched: rows.length,
    upserted,
    deleted,
    elapsedSeconds: Number(elapsedSeconds),
  };
}
