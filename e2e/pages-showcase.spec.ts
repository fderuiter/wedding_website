import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { a11yConfig } from '../src/a11y-config';

const SUBPATH_PREFIX = '/wedding_website';
const BUNDLE_DIR = path.resolve(
  process.cwd(),
  process.env.PAGES_BUNDLE_DIR || 'docs-portal/.vitepress/dist'
);

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

function resolveBundleFile(bundleRoot: string, relativeUrlPath: string): string | null {
  const cleanRel = relativeUrlPath.replace(/^\/+/, '');
  const candidate = path.resolve(bundleRoot, cleanRel);
  if (!candidate.startsWith(bundleRoot)) {
    return null;
  }

  if (fs.existsSync(candidate)) {
    const stat = fs.statSync(candidate);
    if (stat.isFile()) {
      return candidate;
    }
    if (stat.isDirectory()) {
      const indexHtml = path.join(candidate, 'index.html');
      if (fs.existsSync(indexHtml) && fs.statSync(indexHtml).isFile()) {
        return indexHtml;
      }
    }
  }

  const htmlSibling = `${candidate}.html`;
  if (fs.existsSync(htmlSibling) && fs.statSync(htmlSibling).isFile()) {
    return htmlSibling;
  }

  const nestedIndex = path.join(candidate, 'index.html');
  if (fs.existsSync(nestedIndex) && fs.statSync(nestedIndex).isFile()) {
    return nestedIndex;
  }

  return null;
}

function attachStrictRuntimeMonitors(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];

  page.on('pageerror', (err) => {
    pageErrors.push(`${page.url()} :: ${err.message}`);
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(`${page.url()} :: ${msg.text()}`);
    }
  });

  page.on('response', (res) => {
    if (res.status() >= 400) {
      failedResponses.push(`${res.status()} ${res.request().method()} ${res.url()}`);
    }
  });

  return { pageErrors, consoleErrors, failedResponses };
}

async function expectZeroAxeViolations(page: Page) {
  const builder = new AxeBuilder({ page }).withTags(a11yConfig.runOnly.values);
  if (a11yConfig.rules) {
    builder.options({ rules: a11yConfig.rules });
  }
  const results = await builder.analyze();
  expect(results.violations).toEqual([]);
}

const hasBuiltPagesBundle =
  fs.existsSync(path.join(BUNDLE_DIR, 'index.html')) &&
  fs.existsSync(path.join(BUNDLE_DIR, 'demo', 'index.html')) &&
  fs.existsSync(path.join(BUNDLE_DIR, 'storybook', 'index.html'));

test.describe('Unified GitHub Pages Showcase (/wedding_website/)', () => {
  test.skip(
    !hasBuiltPagesBundle,
    'Unified GitHub Pages bundle not present in docs-portal/.vitepress/dist; run npm run pages:build first.'
  );

  let server: http.Server | null = null;
  let origin = '';

  test.beforeAll(async () => {
    server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
      const pathname = decodeURIComponent(reqUrl.pathname);

      if (pathname === '/favicon.ico') {
        const favicon = resolveBundleFile(BUNDLE_DIR, 'demo/assets/favicon.png');
        if (favicon) {
          res.writeHead(200, { 'Content-Type': 'image/png' });
          res.end(fs.readFileSync(favicon));
          return;
        }
      }

      if (pathname === SUBPATH_PREFIX) {
        res.writeHead(301, { Location: `${SUBPATH_PREFIX}/` });
        res.end();
        return;
      }

      if (!pathname.startsWith(`${SUBPATH_PREFIX}/`)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Not Found Outside Subpath: ${pathname}`);
        return;
      }

      const subRelPath = pathname.slice(`${SUBPATH_PREFIX}/`.length);
      const resolvedFile = resolveBundleFile(BUNDLE_DIR, subRelPath);
      if (!resolvedFile) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Asset Not Found: ${pathname}`);
        return;
      }

      const ext = path.extname(resolvedFile).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
      });
      res.end(fs.readFileSync(resolvedFile));
    });

    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address() as AddressInfo;
    origin = `http://127.0.0.1:${addr.port}`;
  });

  test.afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => {
        server!.close(() => resolve());
      });
    }
  });

  test('serves VitePress Portal, Storybook, and full interactive Next.js Demo with zero errors or 404s', async ({
    context,
    page,
  }) => {
    test.setTimeout(180000);

    // Stub any external third-party URLs so verification is 100% offline-deterministic
    await context.route(/^https?:\/\/(?!127\.0\.0\.1(?::|\/|$)|localhost(?::|\/|$))/i, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/plain',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: '',
      });
    });

    const monitors = attachStrictRuntimeMonitors(page);

    // 1. VitePress Documentation & OpenAPI Portal (/wedding_website/)
    await page.goto(`${origin}${SUBPATH_PREFIX}/`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('link', { name: 'Live Interactive Demo' }).first()).toHaveAttribute(
      'href',
      `${SUBPATH_PREFIX}/demo/`
    );
    await expect(page.getByRole('link', { name: 'Component Storybook' }).first()).toHaveAttribute(
      'href',
      `${SUBPATH_PREFIX}/storybook/`
    );
    await page.screenshot({ path: '/tmp/pages-portal.png', animations: 'disabled' });

    await page.goto(`${origin}${SUBPATH_PREFIX}/api/`, { waitUntil: 'networkidle' });
    await expect(page.locator('body')).toContainText('API');

    // 2. Storybook Component Showcase (/wedding_website/storybook/)
    await page.goto(`${origin}${SUBPATH_PREFIX}/storybook/`, { waitUntil: 'networkidle' });
    await expect(page.locator('#root, #storybook-root, body').first()).toBeVisible();
    await page.screenshot({ path: '/tmp/pages-storybook.png', animations: 'disabled' });

    // 3. Guest Experience & Demo Toolbar (/wedding_website/demo/)
    await page.goto(`${origin}${SUBPATH_PREFIX}/demo/`, { waitUntil: 'networkidle' });
    const toolbar = page.getByTestId('demo-toolbar');
    await expect(toolbar).toBeVisible();
    await expect(page.locator('main#main-content')).toBeVisible();
    await expectZeroAxeViolations(page);

    // Switch archetypes & dark mode live via DemoToolbar
    await page.getByTestId('demo-archetype-destination').click();
    await expect(page.locator('body')).toContainText('Carmel');
    await page.getByTestId('demo-theme-toggle').click();
    await expectZeroAxeViolations(page);
    await page.getByTestId('demo-theme-toggle').click();
    await page.getByTestId('demo-archetype-classic').click();
    await page.screenshot({ path: '/tmp/pages-demo-guest.png', animations: 'disabled' });

    // Guest sub-pages
    for (const guestRoute of [
      '/wedding-party',
      '/things-to-do',
      '/photos',
      '/photos/slideshow',
      '/weather',
      '/heart',
    ]) {
      await page.goto(`${origin}${SUBPATH_PREFIX}/demo${guestRoute}`, {
        waitUntil: 'networkidle',
      });
      await expect(page.getByTestId('demo-toolbar')).toBeVisible({ timeout: 15000 });
    }

    // 4. Gift Registry Interactive Contribution + Session Persistence + Reset Demo Data
    await page.goto(`${origin}${SUBPATH_PREFIX}/demo/registry`, { waitUntil: 'networkidle' });
    await expect(page.locator('body')).toContainText('Artisan Stand Mixer');

    // Perform stateful contribution via browser fetch (exercising window.fetch + sessionStorage runtime)
    const contributedAmount = await page.evaluate(async () => {
      const res = await window.fetch('/wedding_website/demo/api/registry/contribute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: 'demo-reg-2',
          name: 'Playwright Showcase Guest',
          email: 'showcase@example.com',
          amount: 125,
          message: 'Excited for your Amalfi adventure!',
          isReservation: false,
        }),
      });
      const json = (await res.json()) as { amountContributed?: number };
      return json.amountContributed ?? 0;
    });
    expect(contributedAmount).toBe(775);

    // Reload page and confirm sessionStorage persisted the $775 contribution
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByTestId('demo-toolbar')).toBeVisible({ timeout: 15000 });
    const persistedAmount = await page.evaluate(async () => {
      const res = await window.fetch('/wedding_website/demo/api/registry/items/demo-reg-2');
      const json = (await res.json()) as { amountContributed?: number };
      return json.amountContributed ?? 0;
    });
    expect(persistedAmount).toBe(775);
    await page.screenshot({ path: '/tmp/pages-demo-registry.png', animations: 'disabled' });

    // Click Reset Demo Data on DemoToolbar and confirm baseline $650 is restored
    await page.getByTestId('demo-reset-button').click();
    const resetAmount = await page.evaluate(async () => {
      const res = await window.fetch('/wedding_website/demo/api/registry/items/demo-reg-2');
      const json = (await res.json()) as { amountContributed?: number };
      return json.amountContributed ?? 0;
    });
    expect(resetAmount).toBe(650);

    // 5. First-Run Setup Wizard Preview & Accessibility
    await page.getByTestId('demo-persona-wizard').click();
    await expect(page.getByTestId('demo-setup-wizard-preview')).toBeVisible();
    await expect(page.locator('main#main-content')).toHaveCount(1);
    await expectZeroAxeViolations(page);
    await page.screenshot({ path: '/tmp/pages-demo-wizard.png', animations: 'disabled' });
    await page.getByTestId('demo-exit-wizard-preview').click();
    await expect(page.getByTestId('demo-setup-wizard-preview')).toHaveCount(0);

    // 6. Admin Control Panel & All 14 Modules
    await page.getByTestId('demo-persona-admin').click();
    await page.waitForURL(`**${SUBPATH_PREFIX}/demo/admin/dashboard**`);
    await expect(page.locator('body')).toContainText('Dashboard');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: '/tmp/pages-demo-admin.png', animations: 'disabled' });

    const adminSubRoutes = [
      '/admin/dashboard/registry',
      '/admin/dashboard/thank-you-notes',
      '/admin/dashboard/invitation-codes',
      '/admin/dashboard/sub-events',
      '/admin/dashboard/seating-chart',
      '/admin/dashboard/site-manager',
      '/admin/dashboard/wedding-party',
      '/admin/dashboard/media',
      '/admin/dashboard/attractions',
      '/admin/dashboard/content',
      '/admin/dashboard/settings',
      '/admin/dashboard/history',
      '/admin/dashboard/maintenance',
    ];

    for (const adminRoute of adminSubRoutes) {
      await page.goto(`${origin}${SUBPATH_PREFIX}/demo${adminRoute}`, {
        waitUntil: 'networkidle',
      });
      await expect(page.getByTestId('demo-toolbar')).toBeVisible({ timeout: 15000 });
    }

    // Verify lazy-loaded broadcast detail API endpoint in static demo runtime
    const broadcastRecipientsCount = await page.evaluate(async () => {
      const historyRes = await window.fetch('/wedding_website/demo/api/admin/broadcast/history?page=1&limit=10');
      const history = (await historyRes.json()) as Array<{ id: string }>;
      if (!Array.isArray(history) || history.length === 0) return -1;
      const detailRes = await window.fetch(
        `/wedding_website/demo/api/admin/broadcast/${encodeURIComponent(history[0].id)}`
      );
      const detail = (await detailRes.json()) as { id?: string; recipients?: unknown[] };
      return detail.id === history[0].id && Array.isArray(detail.recipients)
        ? detail.recipients.length
        : -1;
    });
    expect(broadcastRecipientsCount).toBeGreaterThan(0);

    expect(monitors.pageErrors).toEqual([]);
    expect(monitors.failedResponses).toEqual([]);
    expect(monitors.consoleErrors).toEqual([]);
  });
});
