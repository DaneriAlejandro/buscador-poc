import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MeiliSearch } from 'meilisearch';
import { loadConfig } from '../config.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(__dirname, '../../public');
const port = Number(process.env.SEARCH_WEB_PORT || 3000);

const config = loadConfig();
const client = new MeiliSearch({
  host: config.meilisearch.host,
  apiKey: config.meilisearch.apiKey,
});
const index = client.index(config.meilisearch.indexName);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

async function serveStatic(pathname) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    return null;
  }

  try {
    const body = await readFile(filePath);
    return { body, contentType: mimeTypes[extname(filePath)] ?? 'application/octet-stream' };
  } catch {
    return null;
  }
}

async function handleSearch(url) {
  const q = url.searchParams.get('q')?.trim() ?? '';
  const limit = Math.min(Number(url.searchParams.get('limit') || 20), 50);
  const offset = Math.max(Number(url.searchParams.get('offset') || 0), 0);
  const showScores = url.searchParams.get('scores') === '1';

  const response = await index.search(q, {
    limit,
    offset,
    sort: [`${config.meilisearch.sortField}:asc`],
    showRankingScore: showScores,
  });

  return {
    query: q,
    limit,
    offset,
    sort: [`${config.meilisearch.sortField}:asc`],
    processingTimeMs: response.processingTimeMs,
    estimatedTotalHits: response.estimatedTotalHits ?? response.hits.length,
    hits: response.hits,
  };
}

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/api/search') {
      const result = await handleSearch(url);
      return json(res, 200, result);
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return json(res, 200, {
        index: config.meilisearch.indexName,
        host: config.meilisearch.host,
      });
    }

    const asset = await serveStatic(url.pathname);
    if (asset) {
      res.writeHead(200, { 'Content-Type': asset.contentType });
      res.end(asset.body);
      return;
    }

    json(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error('[web]', error.message);
    json(res, 500, { error: error.message });
  }
});

server.listen(port, () => {
  console.log(`[web] http://localhost:${port}`);
  console.log(`[web] Index: ${config.meilisearch.indexName}`);
});
