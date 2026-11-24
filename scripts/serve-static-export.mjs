import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
};

export function normalizeStaticBasePath(rawBasePath = '/wedding_website/demo') {
  const trimmed = String(rawBasePath || '').trim().replace(/\/+$/, '');
  if (!trimmed || trimmed === '/') {
    return '';
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function resolveCandidateFile(outRoot, relativeRequestPath) {
  const safeRelative = relativeRequestPath.replace(/^\/+/, '');
  const candidates = [];

  if (!safeRelative || relativeRequestPath.endsWith('/')) {
    candidates.push(path.join(outRoot, safeRelative, 'index.html'));
  } else {
    candidates.push(path.join(outRoot, safeRelative));
    candidates.push(path.join(outRoot, safeRelative, 'index.html'));
    candidates.push(path.join(outRoot, `${safeRelative}.html`));
  }

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (resolved !== outRoot && !resolved.startsWith(`${outRoot}${path.sep}`)) {
      continue;
    }
    try {
      const stat = fs.statSync(resolved);
      if (stat.isFile()) {
        return { filePath: resolved, size: stat.size };
      }
    } catch {
      // Try next candidate
    }
  }

  return null;
}

export function createStaticExportServer(options = {}) {
  const outRoot = path.resolve(
    options.outDir || process.env.STATIC_EXPORT_DIR || path.join(process.cwd(), 'out')
  );
  const basePath = normalizeStaticBasePath(
    options.basePath ?? process.env.NEXT_PUBLIC_BASE_PATH ?? '/wedding_website/demo'
  );

  const fileBufferCache = new Map();

  function readCachedFileBuffer(filePath) {
    let cached = fileBufferCache.get(filePath);
    if (!cached) {
      cached = fs.readFileSync(filePath);
      fileBufferCache.set(filePath, cached);
    }
    return cached;
  }

  return http.createServer((req, res) => {
    const method = (req.method || 'GET').toUpperCase();
    const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
    let pathname = '/';
    try {
      pathname = decodeURIComponent(requestUrl.pathname);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad Request');
      return;
    }

    if (pathname === '/__health') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(method === 'HEAD' ? undefined : JSON.stringify({ status: 'ok', basePath }));
      return;
    }

    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method Not Allowed');
      return;
    }

    if (basePath && pathname !== basePath && !pathname.startsWith(`${basePath}/`)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(method === 'HEAD' ? undefined : `Outside configured base path (${basePath}): ${pathname}`);
      return;
    }

    const relativePath = basePath ? pathname.slice(basePath.length) || '/' : pathname;
    const resolvedEntry = resolveCandidateFile(outRoot, relativePath);

    if (!resolvedEntry) {
      const notFoundHtml = path.join(outRoot, '404.html');
      if (fs.existsSync(notFoundHtml)) {
        const notFoundBuf = readCachedFileBuffer(notFoundHtml);
        res.writeHead(404, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': notFoundBuf.byteLength,
          'Cache-Control': 'no-cache',
        });
        res.end(method === 'HEAD' ? undefined : notFoundBuf);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(method === 'HEAD' ? undefined : `Not Found: ${pathname}`);
      return;
    }

    const { filePath: resolvedFile } = resolvedEntry;
    const bodyBuffer = readCachedFileBuffer(resolvedFile);
    const ext = path.extname(resolvedFile).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': bodyBuffer.byteLength,
      'Cache-Control': 'no-cache',
    });

    res.end(method === 'HEAD' ? undefined : bodyBuffer);
  });
}

function startCliServer() {
  const outDir = path.resolve(
    process.env.STATIC_EXPORT_DIR || path.join(process.cwd(), 'out')
  );
  const indexHtmlPath = path.join(outDir, 'index.html');
  if (!fs.existsSync(indexHtmlPath)) {
    console.error(
      `Static export bundle not found at ${indexHtmlPath}. Run "NEXT_PUBLIC_BASE_PATH=/wedding_website/demo npm run build:export" first.`
    );
    process.exit(1);
  }

  const host = process.env.STATIC_AUDIT_HOST || '127.0.0.1';
  const port = Number.parseInt(process.env.STATIC_AUDIT_PORT || '4173', 10);
  const basePath = normalizeStaticBasePath(
    process.env.NEXT_PUBLIC_BASE_PATH ?? '/wedding_website/demo'
  );
  const server = createStaticExportServer({ outDir, basePath });

  server.listen(port, host, () => {
    console.log(
      `Static showcase server listening at http://${host}:${port}${basePath || '/'} (root: ${outDir})`
    );
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const isDirectExecution =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  startCliServer();
}
