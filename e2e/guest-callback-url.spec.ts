import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, expect } from '@playwright/test';

const DEFAULT_E2E_GUEST_PASSCODE = 'playwright-e2e-guest-passcode';

test.describe('Guest callbackUrl same-origin enforcement', { tag: '@smoke' }, () => {
  let canaryServer: http.Server;
  let canaryPort = 0;
  let canaryHits: string[] = [];

  test.beforeAll(async () => {
    canaryServer = http.createServer((req, res) => {
      canaryHits.push(req.url || '/');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('canary-hit');
    });

    await new Promise<void>((resolve, reject) => {
      canaryServer.once('error', reject);
      canaryServer.listen(0, '127.0.0.1', () => {
        const address = canaryServer.address() as AddressInfo;
        canaryPort = address.port;
        resolve();
      });
    });
  });

  test.beforeEach(() => {
    canaryHits = [];
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve) => {
      canaryServer.close(() => resolve());
    });
  });

  test('blocks ASCII tab callbackUrl open redirect on auto-submitted code login', async ({
    page,
    baseURL,
  }) => {
    const appOrigin = new URL(baseURL || 'http://localhost:3000').origin;
    const guestPasscode = process.env.GUEST_PASSCODE || DEFAULT_E2E_GUEST_PASSCODE;
    const entryUrl = `${appOrigin}/guest/login?code=${encodeURIComponent(guestPasscode)}&callbackUrl=/%09/127.0.0.1:${canaryPort}/canary-target`;

    await page.goto(entryUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(
      (url) => url.origin === appOrigin && url.pathname === '/',
      { timeout: 15000 }
    );

    const finalUrl = new URL(page.url());
    expect(finalUrl.origin).toBe(appOrigin);
    expect(finalUrl.pathname).toBe('/');
    expect(canaryHits).toHaveLength(0);
  });

  test('preserves query strings and hash fragments on valid same-origin callbackUrl', async ({
    page,
    baseURL,
  }) => {
    const appOrigin = new URL(baseURL || 'http://localhost:3000').origin;
    const guestPasscode = process.env.GUEST_PASSCODE || DEFAULT_E2E_GUEST_PASSCODE;
    const validCallback = '/photos?tab=gallery#highlights';
    const entryUrl = `${appOrigin}/guest/login?code=${encodeURIComponent(guestPasscode)}&callbackUrl=${encodeURIComponent(validCallback)}`;

    await page.goto(entryUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(
      (url) => url.origin === appOrigin && url.pathname === '/photos',
      { timeout: 15000 }
    );

    const finalUrl = new URL(page.url());
    expect(finalUrl.origin).toBe(appOrigin);
    expect(finalUrl.pathname).toBe('/photos');
    expect(finalUrl.search).toBe('?tab=gallery');
    expect(finalUrl.hash).toBe('#highlights');
    expect(canaryHits).toHaveLength(0);
  });
});
