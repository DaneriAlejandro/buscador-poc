import 'dotenv/config';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchProducts, getHealthInfo } from './search.js';
import { loadWebConfig } from './config.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(__dirname, '../../public');
const port = Number(process.env.SEARCH_WEB_PORT || 3000);

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

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/api/search') {
      const result = await searchProducts({
        q: url.searchParams.get('q'),
        limit: url.searchParams.get('limit'),
        offset: url.searchParams.get('offset'),
        scores: url.searchParams.get('scores'),
      });
      return json(res, 200, result);
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return json(res, 200, getHealthInfo());
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
  const config = loadWebConfig();
  console.log(`[web] http://localhost:${port}`);
  console.log(`[web] Index: ${config.indexName}`);
});
