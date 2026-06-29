import { MeiliSearch } from 'meilisearch';
import { Logger, shouldLogProgress } from './logger.js';

export function createMeilisearchClient(config) {
  return new MeiliSearch({
    host: config.host,
    apiKey: config.apiKey,
    defaultWaitOptions: {
      timeout: 300_000,
      interval: 500,
    },
  });
}

export async function ensureIndex(client, config) {
  await client.createIndex(config.indexName, { primaryKey: config.primaryKey }).catch((error) => {
    if (error.code !== 'index_already_exists') {
      throw error;
    }
  });

  const index = client.index(config.indexName);

  const settings = {};

  if (config.searchableAttributes?.length) {
    settings.searchableAttributes = config.searchableAttributes;
  }

  if (config.displayedAttributes?.length) {
    settings.displayedAttributes = config.displayedAttributes;
  }

  if (config.sortField) {
    settings.sortableAttributes = [config.sortField, 'es_ref_usa', 'es_accesorio'];
  }

  if (config.filterableAttributes?.length) {
    settings.filterableAttributes = config.filterableAttributes;
  }

  if (config.rankingRules?.length) {
    settings.rankingRules = config.rankingRules;
  }

  if (config.synonyms && Object.keys(config.synonyms).length > 0) {
    settings.synonyms = config.synonyms;
  }

  if (Object.keys(settings).length > 0) {
    await index.updateSettings(settings).waitTask();
    Logger.debug({
      message: 'Index settings applied',
      operation: 'sync',
      indexName: config.indexName,
    });
  }

  return index;
}

export async function upsertDocuments(index, documents, primaryKey, batchSize) {
  let total = 0;
  const batches = Math.ceil(documents.length / batchSize);

  for (let offset = 0; offset < documents.length; offset += batchSize) {
    const batch = documents.slice(offset, offset + batchSize);
    const batchNumber = Math.floor(offset / batchSize) + 1;
    await index.addDocuments(batch, { primaryKey }).waitTask();
    total += batch.length;

    if (shouldLogProgress(batchNumber, batches)) {
      Logger.info({
        message: 'Upsert progress',
        operation: 'sync',
        processed: total,
        total: documents.length,
        batchNumber,
        batchCount: batches,
      });
    }
  }

  return total;
}

export async function deleteStaleDocuments(index, sourceIds, primaryKey, batchSize) {
  const sourceIdSet = new Set(sourceIds.map(String));
  const staleIds = [];

  let offset = 0;

  while (true) {
    const result = await index.getDocuments({
      limit: batchSize,
      offset,
      fields: [primaryKey],
    });

    if (result.results.length === 0) {
      break;
    }

    for (const document of result.results) {
      const documentId = String(document[primaryKey]);
      if (!sourceIdSet.has(documentId)) {
        staleIds.push(documentId);
      }
    }

    offset += result.results.length;

    if (result.results.length < batchSize) {
      break;
    }
  }

  if (staleIds.length === 0) {
    return 0;
  }

  for (let deleteOffset = 0; deleteOffset < staleIds.length; deleteOffset += batchSize) {
    const batch = staleIds.slice(deleteOffset, deleteOffset + batchSize);
    await index.deleteDocuments(batch).waitTask();
  }

  return staleIds.length;
}
