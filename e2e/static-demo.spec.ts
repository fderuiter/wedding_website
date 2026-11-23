import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'fs';
import path from 'path';
import { a11yConfig } from '../src/a11y-config';
import { getRegistryEditStaticParams } from '../src/lib/sampleData/builder';

const PORTAL_BASE_PATH = '/wedding_website';
const DEMO_BASE_PATH = '/wedding_website/demo';
const STATIC_VIOLATIONS_PATH = path.join(
  process.cwd(),
  'test-results',
  'static-demo-a11y-violations.json'
);

const STATIC_DEMO_ROUTES = [
  '/',
  '/admin/dashboard',
  '/admin/dashboard/attractions',
  '/admin/dashboard/content',
  '/admin/dashboard/history',
  '/admin/dashboard/invitation-codes',
  '/admin/dashboard/maintenance',
  '/admin/dashboard/media',
  '/admin/dashboard/registry',
  '/admin/dashboard/seating-chart',
  '/admin/dashboard/settings',
  '/admin/dashboard/site-manager',
  '/admin/dashboard/sub-events',
  '/admin/dashboard/thank-you-notes',
  '/admin/dashboard/wedding-party',
  '/admin/login',
  '/admin/setup',
  '/archive',
  '/guest',
  '/guest/claim',
  '/guest/collect',
  '/guest/login',
  '/heart',
  '/photos',
  '/photos/slideshow',
  '/project-info',
  '/registry',
  '/registry/add-item',
  '/registry/edit-item/1',
  '/things-to-do',
  '/weather',
  '/wedding-party',
] as const;

interface RecordedViolation {
  id: string;
  description: string;
  impact?: string | null;
  route: string;
}

function readPersistedViolations(): Record<string, RecordedViolation[]> {
  if (!fs.existsSync(STATIC_VIOLATIONS_PATH)) {
    return {};
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(STATIC_VIOLATIONS_PATH, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, RecordedViolation[]>;
    }
  } catch {
    // Ignore malformed artifact and overwrite cleanly
  }
  return {};
}

function persistViolationsArtifact(updates: Record<string, RecordedViolation[]>) {
  const merged = {
    ...readPersistedViolations(),
    ...updates,
  };
  fs.mkdirSync(path.dirname(STATIC_VIOLATIONS_PATH), { recursive: true });
  fs.writeFileSync(
    STATIC_VIOLATIONS_PATH,
    `${JSON.stringify(merged, null, 2)}\n`,
    'utf8'
  );
}

function collectExportedDemoHtmlRoutes(demoDir: string): string[] {
  const discovered: string[] = [];

  function walk(currentDir: string) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '_next' || entry.name === 'docs') {
          continue;
        }
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.html')) {
        const rel = path.relative(demoDir, fullPath).split(path.sep).join('/');
        if (
          rel === '404.html' ||
          rel === '404/index.html' ||
          rel === '_not-found.html' ||
          rel === '_not-found/index.html' ||
          rel === 'docs.html' ||
          rel === 'docs/index.html'
        ) {
          continue;
        }
        if (rel === 'index.html') {
          discovered.push('/');
        } else if (rel.endsWith('/index.html')) {
          discovered.push(`/${rel.slice(0, -'/index.html'.length)}`);
        } else {
          discovered.push(`/${rel.slice(0, -'.html'.length)}`);
        }
      }
    }
  }

  walk(demoDir);
  return Array.from(new Set(discovered)).sort();
}

function createAxeBuilder(page: Page): AxeBuilder {
  const enabledRules = [
    ...Object.entries(a11yConfig.rules)
      .filter(([, ruleConfig]) => ruleConfig.enabled)
      .map(([ruleId]) => ruleId),
    'label-content-name-mismatch',
  ];

  return new AxeBuilder({ page })
    .withTags([...a11yConfig.runOnly.values])
    .options({
      rules: Object.fromEntries(enabledRules.map((id) => [id, { enabled: true }])),
    });
}

async function setPageTheme(page: Page, theme: 'light' | 'dark') {
  await page.emulateMedia({
    colorScheme: theme,
    reducedMotion: 'reduce',
  });
  await page.evaluate(async (mode) => {
    const stylesheetLinks = Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')
    );
    await Promise.all(
      stylesheetLinks.map((link) =>
        link.sheet
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
            link.addEventListener('load', () => resolve(), { once: true });
            link.addEventListener('error', () => resolve(), { once: true });
          })
      )
    );
    document.documentElement.classList.toggle('dark', mode === 'dark');
    document.documentElement.classList.toggle('light', mode === 'light');
    try {
      window.localStorage.setItem('theme_mode', mode);
    } catch {
      // Ignore storage access errors
    }
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  }, theme);
}

function recordRouteViolations(
  key: string,
  violations: Array<{ id: string; description: string; impact?: string | null }>
) {
  persistViolationsArtifact({
    [key]: violations.map((v) => ({
      id: v.id,
      description: v.description,
      impact: v.impact ?? 'moderate',
      route: key,
    })),
  });
}

test.describe('Static GitHub Pages Showcase', () => {
  test.skip(
    ({ baseURL }) => !baseURL || baseURL.includes(':3000'),
    'Static showcase suite runs exclusively via playwright.static.config.ts'
  );
  test.setTimeout(120000);

  test.beforeAll(() => {
    const existing = readPersistedViolations();
    const defaults: Record<string, RecordedViolation[]> = {};
    for (const route of STATIC_DEMO_ROUTES) {
      if (!(route in existing)) {
        defaults[route] = [];
      }
    }
    if (Object.keys(defaults).length > 0) {
      persistViolationsArtifact(defaults);
    }
  });

  test('exports all 32 showcase routes and serves the VitePress portal root cleanly', async ({
    page,
  }) => {
    expect(STATIC_DEMO_ROUTES).toHaveLength(32);

    const demoDistDir = path.join(
      process.cwd(),
      'docs-portal',
      '.vitepress',
      'dist',
      'demo'
    );
    const expectedExportedRoutes = Array.from(
      new Set([
        ...STATIC_DEMO_ROUTES,
        ...getRegistryEditStaticParams().map(({ id }) => `/registry/edit-item/${id}`),
      ])
    ).sort();
    const exportedRoutes = collectExportedDemoHtmlRoutes(demoDistDir);
    expect(exportedRoutes).toEqual(expectedExportedRoutes);

    const pageErrors: string[] = [];
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });

    const response = await page.goto(`${PORTAL_BASE_PATH}/`, {
      waitUntil: 'domcontentloaded',
    });
    expect(response?.status()).toBe(200);
    expect(pageErrors).toEqual([]);
  });

  test('returns HTTP 200, triggers 0 pageerror exceptions, keeps assets under subpath, and passes WCAG 2.2 AA across all 32 routes', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });

    const routeFailures: string[] = [];

    for (const route of STATIC_DEMO_ROUTES) {
      const targetPath = route === '/' ? DEMO_BASE_PATH : `${DEMO_BASE_PATH}${route}`;
      const pageErrors: string[] = [];
      const escapedRootNextRequests: string[] = [];
      const failedStaticAssetUrls: string[] = [];

      const onPageError = (err: Error) => {
        pageErrors.push(`${err.name}: ${err.message}`);
      };
      const onRequest = (req: { url: () => string }) => {
        const reqPathname = new URL(req.url()).pathname;
        if (reqPathname.startsWith('/_next/')) {
          escapedRootNextRequests.push(reqPathname);
        }
      };
      const onResponse = (res: { url: () => string; status: () => number }) => {
        const resPathname = new URL(res.url()).pathname;
        if (
          resPathname.startsWith(`${DEMO_BASE_PATH}/_next/static/`) &&
          res.status() >= 400
        ) {
          failedStaticAssetUrls.push(`${res.status()} ${resPathname}`);
        }
      };

      page.on('pageerror', onPageError);
      page.on('request', onRequest);
      page.on('response', onResponse);

      try {
        const response = await page.goto(targetPath, { waitUntil: 'load' });
        if (response?.status() !== 200) {
          routeFailures.push(`Route ${route} returned HTTP ${response?.status()}`);
        }

        // Allow client hydration, static 404 fetch fallbacks, and Suspense boundaries to settle
        await page.waitForTimeout(route === '/heart' ? 600 : 250);
        await setPageTheme(page, 'light');

        if (route === '/heart') {
          const resetBtn = page.getByRole('button', { name: 'Reset heart' });
          await expect(resetBtn).toBeVisible();
          await resetBtn.click();
          await page.waitForTimeout(250);
        }

        const axeResults = await createAxeBuilder(page).analyze();
        recordRouteViolations(route, axeResults.violations);

        if (escapedRootNextRequests.length > 0) {
          routeFailures.push(
            `Route ${route} requested root /_next/* assets: ${escapedRootNextRequests.join(', ')}`
          );
        }
        if (failedStaticAssetUrls.length > 0) {
          routeFailures.push(
            `Route ${route} failed to load subpath static chunks: ${failedStaticAssetUrls.join(', ')}`
          );
        }
        if (pageErrors.length > 0) {
          routeFailures.push(
            `Route ${route} threw uncaught pageerror exceptions: ${pageErrors.join(' | ')}`
          );
        }
        if (axeResults.violations.length > 0) {
          routeFailures.push(
            `Route ${route} reported Axe violations: ${axeResults.violations
              .map(
                (v) =>
                  `${v.id} (${v.nodes.length} nodes: ${v.nodes
                    .slice(0, 4)
                    .map((n) => n.html)
                    .join(' ;; ')})`
              )
              .join(', ')}`
          );
        }
      } finally {
        page.off('pageerror', onPageError);
        page.off('request', onRequest);
        page.off('response', onResponse);
      }
    }

    expect(routeFailures).toEqual([]);
  });

  test('verifies slideshow speed controls, registry add-item tabs, and fallback error alerts across light and dark themes', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => {
      pageErrors.push(`${err.name}: ${err.message}`);
    });

    // 1. /photos/slideshow speed controls (WCAG 2.5.3 label-content-name-mismatch + aria-pressed + contrast)
    await page.goto(`${DEMO_BASE_PATH}/photos/slideshow`, { waitUntil: 'load' });
    const speed5Btn = page.getByTestId('slideshow-duration-5s-btn');
    const speed8Btn = page.getByTestId('slideshow-duration-8s-btn');
    const speed10Btn = page.getByTestId('slideshow-duration-10s-btn');

    await expect(speed5Btn).toBeVisible();
    await expect(speed5Btn).toHaveAccessibleName(/^5s\b/i);
    await expect(speed8Btn).toHaveAccessibleName(/^8s\b/i);
    await expect(speed10Btn).toHaveAccessibleName(/^10s\b/i);
    await expect(speed8Btn).toHaveAttribute('aria-pressed', 'true');

    await expect(async () => {
      await speed5Btn.click();
      await expect(speed5Btn).toHaveAttribute('aria-pressed', 'true', { timeout: 500 });
    }).toPass({ timeout: 5000 });
    await expect(speed8Btn).toHaveAttribute('aria-pressed', 'false');

    await speed10Btn.click();
    await expect(speed10Btn).toHaveAttribute('aria-pressed', 'true');
    await expect(speed5Btn).toHaveAttribute('aria-pressed', 'false');

    for (const theme of ['light', 'dark'] as const) {
      await setPageTheme(page, theme);
      const results = await createAxeBuilder(page).analyze();
      recordRouteViolations(`/photos/slideshow (${theme})`, results.violations);
      expect(results.violations).toEqual([]);
    }

    // 2. /registry/add-item tabs (#tab-single, #tab-batch, #tab-csv) in light & dark themes
    await page.goto(`${DEMO_BASE_PATH}/registry/add-item`, { waitUntil: 'load' });
    for (const theme of ['light', 'dark'] as const) {
      await setPageTheme(page, theme);
      for (const [tabSelector, panelSelector] of [
        ['#tab-single', '#panel-single'],
        ['#tab-batch', '#panel-batch'],
        ['#tab-csv', '#panel-csv'],
      ] as const) {
        await page.locator(tabSelector).click();
        await expect(page.locator(tabSelector)).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator(panelSelector)).toBeVisible();

        const results = await createAxeBuilder(page).analyze();
        recordRouteViolations(
          `/registry/add-item ${tabSelector} (${theme})`,
          results.violations
        );
        expect(results.violations).toEqual([]);
      }
    }

    // 3. /weather fetch error alert + Retry button in light & dark themes
    await page.goto(`${DEMO_BASE_PATH}/weather`, { waitUntil: 'load' });
    await expect(
      page.getByText('Failed to load forecast. Please try again later.')
    ).toBeVisible();
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(
      page.getByText('Failed to load forecast. Please try again later.')
    ).toBeVisible();

    for (const theme of ['light', 'dark'] as const) {
      await setPageTheme(page, theme);
      const results = await createAxeBuilder(page).analyze();
      recordRouteViolations(`/weather (${theme})`, results.violations);
      expect(results.violations).toEqual([]);
    }

    // 4. /admin/dashboard/thank-you-notes view (populated via demoApiHandler) in light & dark themes
    await page.goto(`${DEMO_BASE_PATH}/admin/dashboard/thank-you-notes`, {
      waitUntil: 'load',
    });
    await expect(
      page.getByRole('heading', { level: 1, name: 'Thank-You Note Manager' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Thank-You Progress Summary' })
    ).toBeVisible();
    await expect(
      page.getByRole('tablist', { name: 'Filter contributors by thank-you status' })
    ).toBeVisible();

    for (const theme of ['light', 'dark'] as const) {
      await setPageTheme(page, theme);
      const results = await createAxeBuilder(page).analyze();
      recordRouteViolations(
        `/admin/dashboard/thank-you-notes (${theme})`,
        results.violations
      );
      expect(results.violations).toEqual([]);
    }

    // 5. /wedding-party, /admin/setup, /registry, /admin/dashboard/invitation-codes, and /registry/edit-item/fallback in light & dark themes
    for (const extraRoute of [
      '/wedding-party',
      '/admin/setup',
      '/registry',
      '/admin/dashboard/invitation-codes',
      '/registry/edit-item/fallback',
    ] as const) {
      await page.goto(`${DEMO_BASE_PATH}${extraRoute}`, { waitUntil: 'load' });
      await page.waitForTimeout(250);
      for (const theme of ['light', 'dark'] as const) {
        await setPageTheme(page, theme);
        const results = await createAxeBuilder(page).analyze();
        recordRouteViolations(`${extraRoute} (${theme})`, results.violations);
        expect(results.violations).toEqual([]);
      }
    }

    expect(pageErrors).toEqual([]);
  });
});
