import 'dotenv/config';
import { loadConfig } from './config.js';
import { createMeilisearchClient, ensureIndex } from './meilisearch.js';
import { Logger } from './logger.js';

const config = loadConfig();
const client = createMeilisearchClient(config.meilisearch);
await ensureIndex(client, config.meilisearch);
Logger.info({ message: 'Index settings applied', operation: 'settings' });
