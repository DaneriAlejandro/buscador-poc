import 'dotenv/config';
import { loadConfig } from './config.js';
import { createMeilisearchClient, ensureIndex } from './meilisearch.js';

const config = loadConfig();
const client = createMeilisearchClient(config.meilisearch);
await ensureIndex(client, config.meilisearch);
console.log('[settings] Index settings applied');
