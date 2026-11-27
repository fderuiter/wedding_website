import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { a11yConfig } from '../src/a11y-config';
import { getPortalBaseUrl, resolveShowcasePath, withBasePath } from '../src/lib/basePath';

const BUNDLE_DIR = path.resolve(
  process.cwd(),
  process.env.PAGES_BUNDLE_DIR || 'docs-portal/.vitepress/dist'
);

function normalizePortalBasePath(rawBase?: string | null): string {
  const cleaned = String(rawBase ?? '')
    .trim()
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '');
  return cleaned ? `/${cleaned}/` : '/';
}

function detectBuiltPortalBasePath(bundleDir: string): string {
  const indexHtmlPath = path.join(bundleDir, 'index.html');
  if (fs.existsSync(indexHtmlPath)) {
    try {
      const html = fs.readFileSync(indexHtmlPath, 'utf8');
      const demoNavMatch = html.match(/href="([^"]*?)\/demo\/"/);
      if (demoNavMatch) {
        return normalizePortalBasePath(demoNavMatch[1]);
      }
    } catch {
      // Fall back to root '/' if unreadable
    }
  }
  return '/';
}

const PORTAL_BASE_PATH =
  process.env.PAGES_BASE_PATH !== undefined
    ? normalizePortalBasePath(process.env.PAGES_BASE_PATH)
    : process.env.VITEPRESS_BASE !== undefined
      ? normalizePortalBasePath(process.env.VITEPRESS_BASE)
      : detectBuiltPortalBasePath(BUNDLE_DIR);

const SUBPATH_PREFIX = PORTAL_BASE_PATH === '/' ? '' : PORTAL_BASE_PATH.slice(0, -1);
const DEMO_BASE_PATH = `${SUBPATH_PREFIX}/demo`;
const STORYBOOK_BASE_PATH = `${SUBPATH_PREFIX}/storybook`;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
  await page.waitForFunction(() => {
    const heroNav = document.querySelector('nav[aria-label="Primary navigation"]');
    return !heroNav || window.getComputedStyle(heroNav).opacity === '1';
  });
  const builder = new AxeBuilder({ page }).withTags(a11yConfig.runOnly.values);
  if (a11yConfig.rules) {
    builder.options({ rules: a11yConfig.rules });
  }
  const results = await builder.analyze();
  expect(results.violations).toEqual([]);
}

async function waitForDemoHydration(page: Page) {
  await expect(page.locator('html')).toHaveAttribute('data-static-demo', 'true', {
    timeout: 15000,
  });
  await expect(page.getByTestId('demo-toolbar')).toBeVisible({ timeout: 15000 });
}

const hasBuiltPagesBundle =
  fs.existsSync(path.join(BUNDLE_DIR, 'index.html')) &&
  fs.existsSync(path.join(BUNDLE_DIR, 'demo', 'index.html')) &&
  fs.existsSync(path.join(BUNDLE_DIR, 'storybook', 'index.html'));

async function stubExternalRequests(context: BrowserContext) {
  await context.route(/^https?:\/\/(?!127\.0\.0\.1(?::|\/|$)|localhost(?::|\/|$))/i, async (route) => {
    await route.fulfill({
      status: 204,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: '',
    });
  });
}

test.describe(`Unified GitHub Pages Showcase (${PORTAL_BASE_PATH})`, () => {
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

      if (SUBPATH_PREFIX && pathname === SUBPATH_PREFIX) {
        res.writeHead(301, { Location: `${SUBPATH_PREFIX}/` });
        res.end();
        return;
      }

      if (SUBPATH_PREFIX && !pathname.startsWith(`${SUBPATH_PREFIX}/`)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Not Found Outside Subpath: ${pathname}`);
        return;
      }

      const subRelPath = pathname.slice(PORTAL_BASE_PATH.length);
      const resolvedFile = resolveBundleFile(BUNDLE_DIR, subRelPath);
      if (!resolvedFile) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Asset Not Found: ${pathname}`);
        return;
      }

      const ext = path.extname(resolvedFile).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const isImmutableAsset = pathname.includes('/_next/static/') || pathname.includes('/assets/');
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': isImmutableAsset ? 'public, max-age=3600' : 'no-cache',
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
      server = null;
    }
  });

  test(`serves VitePress Documentation Portal and Storybook Component Showcase under ${PORTAL_BASE_PATH}`, async ({
    context,
    page,
  }) => {
    test.setTimeout(60_000);
    await stubExternalRequests(context);
    const monitors = attachStrictRuntimeMonitors(page);

    if (SUBPATH_PREFIX) {
      const escapedResponse = await page.request.get(`${origin}/demo/`);
      expect(escapedResponse.status()).toBe(404);
    }

    await page.goto(`${origin}${PORTAL_BASE_PATH}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('link', { name: 'Live Demo' }).first()).toHaveAttribute(
      'href',
      `${DEMO_BASE_PATH}/`
    );
    await expect(page.getByRole('link', { name: 'Storybook' }).first()).toHaveAttribute(
      'href',
      `${STORYBOOK_BASE_PATH}/`
    );
    await page.screenshot({ path: '/tmp/pages-portal.png', animations: 'disabled' });

    await page.goto(`${origin}${PORTAL_BASE_PATH}api/`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toContainText('API');

    await page.goto(`${origin}${STORYBOOK_BASE_PATH}/`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#root, #storybook-root, body').first()).toBeVisible();
    await page.screenshot({ path: '/tmp/pages-storybook.png', animations: 'disabled' });

    expect(monitors.pageErrors).toEqual([]);
    expect(monitors.failedResponses).toEqual([]);
    expect(monitors.consoleErrors).toEqual([]);
  });

  test('serves Guest Demo, archetype & theme switching, registry persistence, and Setup Wizard with zero Axe violations', async ({
    context,
    page,
  }) => {
    test.setTimeout(120_000);
    await stubExternalRequests(context);
    const monitors = attachStrictRuntimeMonitors(page);

    await page.goto(`${origin}${DEMO_BASE_PATH}/`, { waitUntil: 'domcontentloaded' });
    await waitForDemoHydration(page);
    await expect(page.getByTestId('demo-portal-link')).toHaveAttribute(
      'href',
      getPortalBaseUrl(DEMO_BASE_PATH)
    );
    await expect(page.getByTestId('demo-link-docs')).toHaveAttribute(
      'href',
      resolveShowcasePath('/', DEMO_BASE_PATH)
    );
    await expect(page.getByTestId('demo-link-api')).toHaveAttribute(
      'href',
      resolveShowcasePath('/api/', DEMO_BASE_PATH)
    );
    await expect(page.getByTestId('demo-link-storybook')).toHaveAttribute(
      'href',
      resolveShowcasePath('/storybook/', DEMO_BASE_PATH)
    );
    await expect(page.locator('main#main-content')).toBeVisible();
    await expectZeroAxeViolations(page);

    // Switch archetypes & theme presets live via DemoToolbar
    await page.getByTestId('demo-archetype-select').selectOption('destination');
    await expect(page.getByTestId('demo-sample-code-button')).toContainText('RODRIGUEZ2026');
    await page.getByTestId('demo-theme-preset-select').selectOption('romantic');
    await expectZeroAxeViolations(page);
    await page.getByTestId('demo-theme-preset-select').selectOption('classic');
    await page.getByTestId('demo-archetype-select').selectOption('classic');
    await page.screenshot({ path: '/tmp/pages-demo-guest.png', animations: 'disabled' });

    // Gift Registry Interactive Contribution + Storage Persistence + Reset Demo
    await page.goto(`${origin}${DEMO_BASE_PATH}/registry`, { waitUntil: 'domcontentloaded' });
    await waitForDemoHydration(page);
    await expect(page.locator('body')).toContainText('KitchenAid Stand Mixer');

    const contributeEndpoint = withBasePath('/api/registry/contribute', DEMO_BASE_PATH);
    const itemEndpoint = withBasePath('/api/registry/items/demo-classic-item-3', DEMO_BASE_PATH);

    const contributedAmount = await page.evaluate(async (endpoint) => {
      const res = await window.fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: 'demo-classic-item-3',
          purchaserName: 'Playwright Showcase Guest',
          email: 'showcase@example.com',
          amount: 125,
          message: 'Excited for your espresso mornings!',
        }),
      });
      const json = (await res.json()) as { amountContributed?: number };
      return json.amountContributed ?? -1;
    }, contributeEndpoint);
    expect(contributedAmount).toBe(125);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForDemoHydration(page);
    const persistedAmount = await page.evaluate(async (endpoint) => {
      const res = await window.fetch(endpoint);
      const json = (await res.json()) as { amountContributed?: number };
      return json.amountContributed ?? -1;
    }, itemEndpoint);
    expect(persistedAmount).toBe(125);
    await page.screenshot({ path: '/tmp/pages-demo-registry.png', animations: 'disabled' });

    await page.getByTestId('demo-reset-button').click();
    const resetAmount = await page.evaluate(async (endpoint) => {
      const res = await window.fetch(endpoint);
      const json = (await res.json()) as { amountContributed?: number };
      return json.amountContributed ?? -1;
    }, itemEndpoint);
    expect(resetAmount).toBe(0);

    // First-Run Setup Wizard Persona & Accessibility
    await page.getByTestId('demo-persona-setup').click();
    await expect(page.locator('main#main-content')).toHaveCount(1);
    await expectZeroAxeViolations(page);
    await page.screenshot({ path: '/tmp/pages-demo-wizard.png', animations: 'disabled' });
    await page.getByTestId('demo-persona-guest').click();

    expect(monitors.pageErrors).toEqual([]);
    expect(monitors.failedResponses).toEqual([]);
    expect(monitors.consoleErrors).toEqual([]);
  });

  test(`serves Guest sub-routes and 3D Heart physics cleanly under ${DEMO_BASE_PATH}`, async ({
    context,
    page,
  }) => {
    test.setTimeout(120_000);
    await stubExternalRequests(context);
    const monitors = attachStrictRuntimeMonitors(page);

    for (const guestRoute of [
      '/wedding-party',
      '/things-to-do',
      '/photos',
      '/weather',
      '/guest/collect',
      '/photos/slideshow',
    ]) {
      const routePage = guestRoute === '/photos' ? await context.newPage() : page;
      const routeMonitors =
        routePage === page ? null : attachStrictRuntimeMonitors(routePage);
      await routePage.goto(`${origin}${DEMO_BASE_PATH}${guestRoute}`, {
        waitUntil: 'domcontentloaded',
      });
      await waitForDemoHydration(routePage);
      if (routeMonitors && routePage !== page) {
        expect(routeMonitors.pageErrors).toEqual([]);
        expect(routeMonitors.failedResponses).toEqual([]);
        expect(routeMonitors.consoleErrors).toEqual([]);
        await routePage.close();
      }
    }

    const heartPage = await context.newPage();
    const heartMonitors = attachStrictRuntimeMonitors(heartPage);
    await heartPage.goto(`${origin}${DEMO_BASE_PATH}/heart`, {
      waitUntil: 'domcontentloaded',
    });
    await waitForDemoHydration(heartPage);
    expect(heartMonitors.pageErrors).toEqual([]);
    expect(heartMonitors.failedResponses).toEqual([]);
    expect(heartMonitors.consoleErrors).toEqual([]);
    await heartPage.close();

    expect(monitors.pageErrors).toEqual([]);
    expect(monitors.failedResponses).toEqual([]);
    expect(monitors.consoleErrors).toEqual([]);
  });

  test(`serves Admin Control Panel and all 14 dashboard modules cleanly under ${PORTAL_BASE_PATH}`, async ({
    context,
    page,
  }) => {
    test.setTimeout(120_000);
    await stubExternalRequests(context);
    const monitors = attachStrictRuntimeMonitors(page);

    await page.goto(`${origin}${DEMO_BASE_PATH}/`, { waitUntil: 'load' });
    await waitForDemoHydration(page);
    await page.getByTestId('demo-persona-admin').click();
    await page.goto(`${origin}${DEMO_BASE_PATH}/admin/dashboard`, {
      waitUntil: 'load',
    });
    await waitForDemoHydration(page);
    await expect(page.locator('body')).toContainText('Dashboard');
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

    const adminNav = page.getByRole('navigation', { name: 'Admin Navigation' });
    for (const adminRoute of adminSubRoutes) {
      await test.step(`Admin route ${adminRoute}`, async () => {
        const navLink = adminNav
          .locator(
            `a[href="${DEMO_BASE_PATH}${adminRoute}/"], a[href="${DEMO_BASE_PATH}${adminRoute}"]`,
          )
          .first();
        await expect(navLink).toBeVisible();
        await navLink.click();
        await expect(page).toHaveURL(
          new RegExp(`${escapeRegExp(DEMO_BASE_PATH)}${escapeRegExp(adminRoute)}/?$`)
        );
        await expect(navLink).toHaveAttribute('aria-current', 'page');
        await waitForDemoHydration(page);
      });
    }

    await page.reload({ waitUntil: 'load' });
    await waitForDemoHydration(page);

    expect(monitors.pageErrors).toEqual([]);
    expect(monitors.failedResponses).toEqual([]);
    expect(monitors.consoleErrors).toEqual([]);
  });
});
