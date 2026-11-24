/**
 * @jest-environment node
 */
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { http as mswHttp, passthrough } from 'msw';
import { server as mswServer } from '../src/mocks/server';
import { createStaticExportServer, normalizeStaticBasePath } from './serve-static-export.mjs';

interface RawHttpResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function requestRaw(
  port: number,
  requestPath: string,
  method = 'GET'
): Promise<RawHttpResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: requestPath,
        method,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('serve-static-export', () => {
  let tempOutDir: string;
  let server: http.Server | null = null;

  beforeEach(() => {
    mswServer.use(mswHttp.all(/^http:\/\/127\.0\.0\.1:\d+\//, () => passthrough()));
    tempOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'static-export-server-'));
    fs.mkdirSync(path.join(tempOutDir, 'weather'), { recursive: true });
    fs.mkdirSync(path.join(tempOutDir, '_next', 'static'), { recursive: true });
    fs.writeFileSync(path.join(tempOutDir, 'index.html'), '<h1>Showcase Home</h1>', 'utf8');
    fs.writeFileSync(
      path.join(tempOutDir, 'weather', 'index.html'),
      '<h1>Weather Forecast</h1>',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tempOutDir, '_next', 'static', 'app.css'),
      'body { margin: 0; }',
      'utf8'
    );
    fs.writeFileSync(path.join(tempOutDir, '404.html'), '<h1>Custom Not Found</h1>', 'utf8');
  });

  afterEach(async () => {
    if (server) {
      const activeServer = server;
      server = null;
      await new Promise<void>((resolve) => activeServer.close(() => resolve()));
    }
    fs.rmSync(tempOutDir, { recursive: true, force: true });
  });

  it('normalizes base paths consistently across empty, root, relative, and trailing-slash inputs', () => {
    expect(normalizeStaticBasePath('')).toBe('');
    expect(normalizeStaticBasePath('/')).toBe('');
    expect(normalizeStaticBasePath('///')).toBe('');
    expect(normalizeStaticBasePath('wedding_website/demo/')).toBe('/wedding_website/demo');
    expect(normalizeStaticBasePath('/wedding_website/demo///')).toBe('/wedding_website/demo');
  });

  it('serves subpath static assets with Content-Length, no-store headers, HEAD parity, keep-alive tuning, and base-path isolation', async () => {
    server = createStaticExportServer({
      outDir: tempOutDir,
      basePath: '/wedding_website/demo',
    });
    expect(server.keepAliveTimeout).toBe(65_000);
    expect(server.headersTimeout).toBe(66_000);

    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
    const { port } = server.address() as AddressInfo;

    const health = await requestRaw(port, '/__health');
    expect(health.statusCode).toBe(200);
    expect(health.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(health.body)).toEqual({
      status: 'ok',
      basePath: '/wedding_website/demo',
    });

    const home = await requestRaw(port, '/wedding_website/demo/');
    expect(home.statusCode).toBe(200);
    expect(home.body).toBe('<h1>Showcase Home</h1>');
    expect(home.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(home.headers['cache-control']).toBe('no-store');
    expect(home.headers['content-length']).toBe(String(Buffer.byteLength('<h1>Showcase Home</h1>')));

    const headWeather = await requestRaw(port, '/wedding_website/demo/weather/', 'HEAD');
    expect(headWeather.statusCode).toBe(200);
    expect(headWeather.body).toBe('');
    expect(headWeather.headers['content-length']).toBe(
      String(Buffer.byteLength('<h1>Weather Forecast</h1>'))
    );

    const cssAsset = await requestRaw(port, '/wedding_website/demo/_next/static/app.css');
    expect(cssAsset.statusCode).toBe(200);
    expect(cssAsset.headers['content-type']).toBe('text/css; charset=utf-8');
    expect(cssAsset.headers['cache-control']).toBe('no-store');
    expect(cssAsset.body).toBe('body { margin: 0; }');

    // Requests escaping basePath (such as root /_next/static/*) must 404
    const rootEscaped = await requestRaw(port, '/_next/static/app.css');
    expect(rootEscaped.statusCode).toBe(404);
    expect(rootEscaped.body).toContain('Outside configured base path');

    // Missing route inside basePath serves exported 404.html with Content-Length
    const missingInSubpath = await requestRaw(port, '/wedding_website/demo/nonexistent/');
    expect(missingInSubpath.statusCode).toBe(404);
    expect(missingInSubpath.body).toBe('<h1>Custom Not Found</h1>');
    expect(missingInSubpath.headers['content-length']).toBe(
      String(Buffer.byteLength('<h1>Custom Not Found</h1>'))
    );

    // Malformed percent-encoding and unsupported HTTP methods fail safely
    const malformed = await requestRaw(port, '/wedding_website/demo/%E0%A4%A');
    expect(malformed.statusCode).toBe(400);

    const postResp = await requestRaw(port, '/wedding_website/demo/', 'POST');
    expect(postResp.statusCode).toBe(405);
  });
});
