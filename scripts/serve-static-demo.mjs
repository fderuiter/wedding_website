import http from 'http';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream';
import childProcess from 'child_process';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = path.join(REPO_ROOT, 'docs-portal', '.vitepress', 'dist');
const DEMO_DIR = path.join(DIST_DIR, 'demo');
const OUT_DIR = path.join(REPO_ROOT, 'out');
const BASE_PREFIX = '/wedding_website';
const PORT = Number.parseInt(process.env.STATIC_DEMO_PORT || '4173', 10);

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.hdr': 'application/octet-stream',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
};

function runCommand(command, args, envOverrides = {}) {
  const result = childProcess.spawnSync(command, args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      ...envOverrides,
    },
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with code ${result.status}`);
  }
}

function buildStaticBundle() {
  console.log('Building VitePress documentation portal under /wedding_website/ ...');
  runCommand('npm', ['run', 'docs:build'], {
    VITEPRESS_BASE: `${BASE_PREFIX}/`,
  });

  console.log('Building Next.js static export showcase under /wedding_website/demo ...');
  runCommand('npm', ['run', 'build:export'], {
    NEXT_PUBLIC_BASE_PATH: `${BASE_PREFIX}/demo`,
  });

  fs.rmSync(DEMO_DIR, { recursive: true, force: true });
  fs.cpSync(OUT_DIR, DEMO_DIR, { recursive: true });
  fs.writeFileSync(path.join(DIST_DIR, '.nojekyll'), '', 'utf8');
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.rmSync(path.join(REPO_ROOT, '.next', 'export-stage'), { recursive: true, force: true });
  console.log('Assembled GitHub Pages artifact in docs-portal/.vitepress/dist (+ demo/).');
}

function resolveCandidateFile(requestPathname) {
  if (requestPathname === BASE_PREFIX) {
    return { status: 308, redirectTo: `${BASE_PREFIX}/`, filePath: null };
  }
  if (!requestPathname.startsWith(`${BASE_PREFIX}/`)) {
    return { status: 404, filePath: null };
  }

  const relativeUrlPath = decodeURIComponent(requestPathname.slice(BASE_PREFIX.length));
  const normalizedRel = relativeUrlPath.replace(/^\/+/, '');
  const resolvedBase = path.resolve(DIST_DIR, normalizedRel);

  if (resolvedBase !== DIST_DIR && !resolvedBase.startsWith(`${DIST_DIR}${path.sep}`)) {
    return { status: 403, filePath: null };
  }

  if (!normalizedRel) {
    const rootIndex = path.join(DIST_DIR, 'index.html');
    if (fs.existsSync(rootIndex) && fs.statSync(rootIndex).isFile()) {
      return { status: 200, filePath: rootIndex };
    }
  } else {
    if (fs.existsSync(resolvedBase) && fs.statSync(resolvedBase).isFile()) {
      return { status: 200, filePath: resolvedBase };
    }
    const trimmed = resolvedBase.replace(/[\\/]+$/, '');
    const htmlCandidate = `${trimmed}.html`;
    if (fs.existsSync(htmlCandidate) && fs.statSync(htmlCandidate).isFile()) {
      return { status: 200, filePath: htmlCandidate };
    }
    const dirIndexCandidate = path.join(trimmed, 'index.html');
    if (fs.existsSync(dirIndexCandidate) && fs.statSync(dirIndexCandidate).isFile()) {
      if (!requestPathname.endsWith('/')) {
        return { status: 308, redirectTo: `${requestPathname}/`, filePath: null };
      }
      return { status: 200, filePath: dirIndexCandidate };
    }
  }

  const fallback404 = normalizedRel.startsWith('demo')
    ? path.join(DEMO_DIR, '404.html')
    : path.join(DIST_DIR, '404.html');
  return {
    status: 404,
    filePath: fs.existsSync(fallback404) ? fallback404 : null,
  };
}

function main() {
  const argv = process.argv.slice(2);
  const buildOnly = argv.includes('--build-only');
  const forceBuild = buildOnly || argv.includes('--force-build');
  const hasAssembledDemo =
    fs.existsSync(path.join(DIST_DIR, 'index.html')) &&
    fs.existsSync(path.join(DEMO_DIR, 'index.html')) &&
    (fs.existsSync(path.join(DEMO_DIR, 'weather.html')) ||
      fs.existsSync(path.join(DEMO_DIR, 'weather', 'index.html')));

  if (forceBuild || !hasAssembledDemo) {
    buildStaticBundle();
  }

  if (buildOnly) {
    return;
  }

  const memoryCache = new Map();

  const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url || '/', `http://localhost:${PORT}`);
    const { status, filePath, redirectTo } = resolveCandidateFile(reqUrl.pathname);

    if (redirectTo) {
      res.writeHead(status, {
        Location: `${redirectTo}${reqUrl.search}`,
        'Cache-Control': 'no-cache',
      });
      res.end();
      return;
    }

    if (!filePath) {
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(status === 403 ? 'Forbidden' : 'Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    let cachedBuf = memoryCache.get(filePath);
    if (!cachedBuf) {
      const stat = fs.statSync(filePath);
      if (stat.size <= 10 * 1024 * 1024) {
        cachedBuf = fs.readFileSync(filePath);
        memoryCache.set(filePath, cachedBuf);
      } else {
        if (req.method === 'HEAD') {
          res.writeHead(status, {
            'Content-Type': contentType,
            'Content-Length': stat.size,
            'Cache-Control': 'no-cache',
          });
          res.end();
          return;
        }
        res.writeHead(status, {
          'Content-Type': contentType,
          'Content-Length': stat.size,
          'Cache-Control': 'no-cache',
        });
        pipeline(fs.createReadStream(filePath), res, () => {});
        return;
      }
    }

    res.writeHead(status, {
      'Content-Type': contentType,
      'Content-Length': cachedBuf.length,
      'Cache-Control': 'no-cache',
    });

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    res.end(cachedBuf);
  });

  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  server.listen(PORT, () => {
    console.log(`Static GitHub Pages server listening at http://localhost:${PORT}${BASE_PREFIX}/demo`);
  });

  const shutdown = () => {
    server.close(() => {
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
