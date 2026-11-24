import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { a11yConfig } from '../../src/a11y-config';

type AxeViolation = Awaited<ReturnType<AxeBuilder['analyze']>>['violations'][number];
type ColorTheme = 'light' | 'dark';

const STATIC_THEMES: readonly ColorTheme[] = ['light', 'dark'];
const DEMO_STORAGE_KEY = 'wedding_showcase_demo_v1';
const RESULTS_DIR = path.join(process.cwd(), 'test-results');
const STATIC_A11Y_REPORT_FILE = path.join(RESULTS_DIR, 'static-a11y-violations.json');

function writeShardAndMergeReport(
  shardId: string,
  shardViolations: Record<string, AxeViolation[]>
) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const shardPath = path.join(RESULTS_DIR, `.static-a11y-shard-${shardId}.json`);
  fs.writeFileSync(shardPath, `${JSON.stringify(shardViolations, null, 2)}\n`, 'utf8');

  const merged: Record<string, AxeViolation[]> = {};
  const shardFiles = fs
    .readdirSync(RESULTS_DIR)
    .filter((f) => f.startsWith('.static-a11y-shard-') && f.endsWith('.json'))
    .sort();
  for (const file of shardFiles) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, file), 'utf8')) as Record<
        string,
        AxeViolation[]
      >;
      for (const [k, v] of Object.entries(parsed)) {
        merged[k] = v;
      }
    } catch {
      // Ignore transient partial shard read if another worker is mid-write
    }
  }

  const tempOut = path.join(
    RESULTS_DIR,
    `.static-a11y-violations.${process.pid}.${Date.now()}.tmp`
  );
  fs.writeFileSync(tempOut, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  fs.renameSync(tempOut, STATIC_A11Y_REPORT_FILE);
}

function normalizeBasePath(rawBasePath: string | undefined): string {
  const trimmed = (rawBasePath ?? '/wedding_website/demo').trim().replace(/\/+$/, '');
  if (!trimmed || trimmed === '/') {
    return '';
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function discoverExportedRoutes(outDir: string): string[] {
  if (!fs.existsSync(outDir)) {
    throw new Error(
      `Static export directory not found at ${outDir}. Run "NEXT_PUBLIC_BASE_PATH=/wedding_website/demo npm run build:export" before running the static showcase audit.`
    );
  }

  const routes = new Set<string>();
  const editItemCandidates: string[] = [];

  function walk(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '_next' || entry.name === '_not-found' || entry.name === '404') {
          continue;
        }
        walk(fullPath);
      } else if (entry.isFile() && entry.name === 'index.html') {
        const relDir = path.relative(outDir, currentDir).split(path.sep).join('/');
        const routePath = relDir ? `/${relDir}` : '/';
        if (routePath.startsWith('/registry/edit-item/')) {
          editItemCandidates.push(routePath);
        } else {
          routes.add(routePath);
        }
      }
    }
  }

  walk(outDir);

  if (editItemCandidates.length > 0) {
    const preferred =
      editItemCandidates.find((r) => r === '/registry/edit-item/sample-registry-classic-1') ??
      editItemCandidates.sort()[0];
    routes.add(preferred);
  }

  return Array.from(routes).sort((a, b) => {
    if (a === '/') return -1;
    if (b === '/') return 1;
    return a.localeCompare(b);
  });
}

function buildDemoSeedForRoute(routePath: string): Record<string, unknown> {
  if (routePath === '/admin/login') {
    return {
      persona: 'guest',
      archetype: 'classic',
      themePreset: 'classic',
      isToolbarCollapsed: true,
      setupAuthenticated: false,
      guestSession: null,
    };
  }

  if (routePath === '/admin/setup') {
    return {
      persona: 'setup',
      archetype: 'classic',
      themePreset: 'classic',
      isToolbarCollapsed: true,
      setupAuthenticated: true,
      guestSession: null,
    };
  }

  if (
    routePath.startsWith('/admin/dashboard') ||
    routePath === '/registry/add-item' ||
    routePath.startsWith('/registry/edit-item/')
  ) {
    return {
      persona: 'admin',
      archetype: 'classic',
      themePreset: 'classic',
      isToolbarCollapsed: true,
      setupAuthenticated: true,
      guestSession: {
        invitationCode: 'SMITH2026',
        guestName: 'Mr. & Mrs. Robert Smith',
      },
    };
  }

  if (
    routePath === '/guest/login' ||
    routePath === '/guest/claim' ||
    routePath === '/guest/collect'
  ) {
    return {
      persona: 'guest',
      archetype: 'classic',
      themePreset: 'classic',
      isToolbarCollapsed: true,
      setupAuthenticated: false,
      guestSession: null,
    };
  }

  return {
    persona: 'guest',
    archetype: 'classic',
    themePreset: 'classic',
    isToolbarCollapsed: routePath !== '/',
    setupAuthenticated: false,
    guestSession: {
      invitationCode: 'SMITH2026',
      guestName: 'Mr. & Mrs. Robert Smith',
    },
  };
}

async function applyDeterministicThemeAndSeed(
  page: Page,
  theme: ColorTheme,
  seed: Record<string, unknown>
) {
  await page.evaluate(
    ({ storageKey, nextSeed, nextTheme }) => {
      window.localStorage.setItem(storageKey, JSON.stringify(nextSeed));
      window.localStorage.setItem('theme_mode', nextTheme);
      document.cookie = `theme_mode=${nextTheme}; path=/; SameSite=Lax`;
    },
    {
      storageKey: DEMO_STORAGE_KEY,
      nextSeed: seed,
      nextTheme: theme,
    }
  );
}

function buildExternalUrlPattern(origin: string): RegExp {
  const hostPort = new URL(origin).host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^https?://(?!${hostPort}(?:/|$))`, 'i');
}

async function waitForStaticRouteSettled(page: Page, theme: ColorTheme) {
  await page
    .locator('main, [role="main"]')
    .first()
    .waitFor({ state: 'attached', timeout: 15_000 });
  await page
    .locator('h1, [role="heading"][aria-level="1"]')
    .first()
    .waitFor({ state: 'attached', timeout: 15_000 });
  await page.waitForFunction(
    () => {
      if (document.readyState !== 'complete') return false;
      if (document.documentElement.dataset.staticDemo !== 'true') return false;
      const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
      if (links.length === 0 || !links.every((link) => Boolean((link as HTMLLinkElement).sheet))) {
        return false;
      }
      if (
        window.getComputedStyle(document.documentElement).getPropertyValue('--text-2xl').trim() ===
        ''
      ) {
        return false;
      }
      const heroNav = document.querySelector('nav[aria-label="Primary navigation"]');
      return !heroNav || window.getComputedStyle(heroNav).opacity === '1';
    },
    undefined,
    { timeout: 15_000 }
  );
  await page.evaluate(async (expectedTheme) => {
    document.documentElement.classList.toggle('dark', expectedTheme === 'dark');
    document.documentElement.classList.toggle('light', expectedTheme === 'light');
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  }, theme);
  await page.waitForTimeout(100);
}

async function navigateAndSettleStaticRoute(
  page: Page,
  targetUrl: string,
  theme: ColorTheme,
  onBeforeRetry?: () => void
) {
  let docResponse: Awaited<ReturnType<Page['goto']>> = null;
  try {
    docResponse = await page.goto(targetUrl, {
      waitUntil: 'load',
      timeout: 30_000,
    });
    await waitForStaticRouteSettled(page, theme);
  } catch {
    onBeforeRetry?.();
    docResponse = await page.goto(targetUrl, {
      waitUntil: 'load',
      timeout: 30_000,
    });
    await waitForStaticRouteSettled(page, theme);
  }
  return docResponse;
}

async function runWcagAudit(page: Page): Promise<AxeViolation[]> {
  const builder = new AxeBuilder({ page }).exclude('iframe').options({
    runOnly: {
      type: a11yConfig.runOnly.type,
      values: [...a11yConfig.runOnly.values],
    },
    rules: {
      ...(a11yConfig.rules ?? {}),
      'label-content-name-mismatch': { enabled: true },
    },
  });
  const results = await builder.analyze();
  return results.violations;
}

function formatViolationSummary(routeKey: string, violations: AxeViolation[]): string {
  return violations
    .map((v) => {
      const sampleNodes = v.nodes
        .slice(0, 3)
        .map(
          (n) =>
            `${JSON.stringify(n.target)} (${n.failureSummary?.replace(/\s+/g, ' ').trim() ?? n.html.slice(0, 80)})`
        )
        .join('; ');
      return `[${routeKey}] ${v.id} (${v.impact}, ${v.nodes.length} nodes): ${sampleNodes}`;
    })
    .join('\n');
}

test.describe('Standalone Static Showcase Runtime & WCAG 2.2 AA Audit @a11y-static', () => {
  const outDir = path.resolve(process.env.STATIC_EXPORT_DIR || path.join(process.cwd(), 'out'));
  const basePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);

  for (const theme of STATIC_THEMES) {
    test(`scans all exported subpath routes in ${theme} theme with zero HTTP/runtime errors and zero WCAG 2.2 A/AA violations`, async ({
      browser,
      baseURL,
    }) => {
      const origin = baseURL || 'http://127.0.0.1:4173';
      const routes = discoverExportedRoutes(outDir);
      expect(routes.length).toBeGreaterThanOrEqual(31);

      const shardViolations: Record<string, AxeViolation[]> = {};
      const routeFailures: string[] = [];
      const contrastOrA11yFailures: string[] = [];
      let completedScans = 0;

      const context = await browser.newContext({
        colorScheme: theme,
        reducedMotion: 'reduce',
      });

      await context.addCookies([
        {
          name: 'theme_mode',
          value: theme,
          url: origin,
        },
      ]);

      const externalUrlPattern = buildExternalUrlPattern(origin);
      const blockedExternalUrls: string[] = [];
      await context.route(externalUrlPattern, (route) => {
        blockedExternalUrls.push(route.request().url());
        return route.abort();
      });

      const createPrimedPage = async () => {
        const nextPage = await context.newPage();
        await nextPage.goto(`${origin}/__health`, { waitUntil: 'commit' });
        return nextPage;
      };

      let page = await createPrimedPage();

      try {
        for (let idx = 0; idx < routes.length; idx += 1) {
          const routePath = routes[idx];
          const scanKey = `[${theme}] ${basePath}${routePath}`;
          const seed = buildDemoSeedForRoute(routePath);
          await applyDeterministicThemeAndSeed(page, theme, seed);

          const failedResponses: string[] = [];
          const pageErrors: string[] = [];
          blockedExternalUrls.length = 0;

          const onRequest = (req: { url: () => string }) => {
            if (!basePath || !req.url().startsWith(origin)) return;
            const reqPathname = new URL(req.url()).pathname;
            if (reqPathname.startsWith('/_next/')) {
              failedResponses.push(`root-escaped ${reqPathname}`);
            }
          };
          const onResponse = (resp: { url: () => string; status: () => number }) => {
            if (resp.url().startsWith(origin) && resp.status() >= 400) {
              failedResponses.push(`${resp.status()} ${resp.url().slice(origin.length)}`);
            }
          };
          const onPageError = (err: Error) => {
            pageErrors.push(err.message);
          };

          page.on('request', onRequest);
          page.on('response', onResponse);
          page.on('pageerror', onPageError);

          let shouldRecyclePage = routePath === '/heart' || (idx + 1) % 8 === 0;
          try {
            const targetUrl = `${origin}${basePath}${routePath === '/' ? '/' : `${routePath}/`}`;
            const clearAttemptDiagnostics = () => {
              failedResponses.length = 0;
              pageErrors.length = 0;
              blockedExternalUrls.length = 0;
            };
            let docResponse = await navigateAndSettleStaticRoute(
              page,
              targetUrl,
              theme,
              clearAttemptDiagnostics
            );
            if (pageErrors.some((msg) => msg.includes('Failed to load chunk'))) {
              clearAttemptDiagnostics();
              await page.goto('about:blank').catch(() => {});
              await page.waitForTimeout(100);
              docResponse = await navigateAndSettleStaticRoute(
                page,
                targetUrl,
                theme,
                clearAttemptDiagnostics
              );
            }

            const status = docResponse?.status() ?? 0;
            if (status !== 200) {
              routeFailures.push(`${scanKey}: expected HTTP 200, received ${status}`);
            }
            if ((await page.getByRole('heading', { name: /Something went wrong/i }).count()) > 0) {
              routeFailures.push(`${scanKey}: rendered an ErrorBoundary fallback`);
            }
            if (failedResponses.length > 0) {
              routeFailures.push(`${scanKey}: failed responses -> ${failedResponses.join(', ')}`);
            }
            if (pageErrors.length > 0) {
              routeFailures.push(`${scanKey}: uncaught page errors -> ${pageErrors.join(' | ')}`);
            }
            if (blockedExternalUrls.length > 0) {
              // External embed/tile URLs on map pages are intentionally aborted offline; verify only app API/assets never leak
              const nonMapTileLeaks = blockedExternalUrls.filter(
                (u) =>
                  !u.includes('openstreetmap.org') &&
                  !u.includes('google.com/maps') &&
                  !u.includes('basemaps.cartocdn.com')
              );
              if (nonMapTileLeaks.length > 0) {
                routeFailures.push(
                  `${scanKey}: unexpected external requests -> ${nonMapTileLeaks.join(', ')}`
                );
              }
            }

            if (routePath === '/weather') {
              await expect(page.getByText(/Seasonal Climate Averages/i)).toBeVisible();
              await expect(page.getByTestId('temperature')).toBeVisible();
            } else if (routePath === '/admin/dashboard/invitation-codes') {
              await expect(
                page.getByRole('heading', { name: /Pre-Authorized Guest Invitation Codes/i })
              ).toBeVisible();
              await expect(page.locator('code', { hasText: 'SMITH2026' })).toBeVisible();
            } else if (routePath === '/admin/dashboard/site-manager') {
              await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
            } else if (routePath === '/admin/dashboard/thank-you-notes') {
              await expect(
                page.getByRole('heading', { level: 1, name: 'Thank-You Note Manager' })
              ).toBeVisible();
              await expect(
                page.getByRole('tablist', { name: 'Filter contributors by thank-you status' })
              ).toBeVisible();
            }

            const hasLivePreviewIframe =
              (await page.locator('iframe[title="Live Preview"]').count()) > 0;
            if (hasLivePreviewIframe) {
              const previewSrc = await page
                .locator('iframe[title="Live Preview"]')
                .first()
                .getAttribute('src');
              expect(previewSrc).toContain('preview=true');
              shouldRecyclePage = true;
            }

            const violations = await runWcagAudit(page);
            shardViolations[scanKey] = violations;
            if (violations.length > 0) {
              contrastOrA11yFailures.push(formatViolationSummary(scanKey, violations));
            }
            completedScans += 1;
          } finally {
            page.off('request', onRequest);
            page.off('response', onResponse);
            page.off('pageerror', onPageError);
          }

          if (idx < routes.length - 1 && shouldRecyclePage) {
            await page.close();
            page = await createPrimedPage();
          }
        }
      } finally {
        writeShardAndMergeReport(theme, shardViolations);
        await context.close();
      }

      expect(completedScans).toBe(routes.length);
      expect(completedScans).toBeGreaterThanOrEqual(31);
      expect(routeFailures, routeFailures.join('\n')).toEqual([]);
      expect(contrastOrA11yFailures, contrastOrA11yFailures.join('\n')).toEqual([]);
    });
  }

  test('verifies WCAG 2.2 AA contrast on weather error alert and invitation manager empty/status states in light and dark themes', async ({
    browser,
    baseURL,
  }) => {
    const origin = baseURL || 'http://127.0.0.1:4173';
    const stateViolations: Record<string, AxeViolation[]> = {};

    try {
      for (const theme of STATIC_THEMES) {
        const context = await browser.newContext({
          colorScheme: theme,
          reducedMotion: 'reduce',
        });
        const externalUrlPattern = buildExternalUrlPattern(origin);
        await context.addCookies([{ name: 'theme_mode', value: theme, url: origin }]);
        await context.route(externalUrlPattern, (route) => route.abort());

        const page = await context.newPage();
        await page.goto(`${origin}/__health`, { waitUntil: 'commit' });

        // 1. Weather error alert state (simulated client API failure)
        const weatherSeed = buildDemoSeedForRoute('/weather');
        const errorPage = await context.newPage();
        await errorPage.addInitScript(
          ({ storageKey, seed, activeTheme }) => {
            window.localStorage.setItem(storageKey, JSON.stringify(seed));
            window.localStorage.setItem('theme_mode', activeTheme);
            document.cookie = `theme_mode=${activeTheme}; path=/; SameSite=Lax`;
            const wrapWeatherFailure = (
              delegate: typeof window.fetch
            ): typeof window.fetch => {
              return async (input: RequestInfo | URL, init?: RequestInit) => {
                const rawUrl =
                  typeof input === 'string'
                    ? input
                    : input instanceof URL
                      ? input.toString()
                      : input.url;
                if (rawUrl.includes('/api/weather')) {
                  return new Response(JSON.stringify({ error: 'Simulated forecast failure' }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' },
                  });
                }
                return delegate(input, init);
              };
            };
            let wrappedFetch = wrapWeatherFailure(window.fetch.bind(window));
            Object.defineProperty(window, 'fetch', {
              configurable: true,
              enumerable: true,
              get() {
                return wrappedFetch;
              },
              set(nextFn: typeof window.fetch) {
                wrappedFetch = wrapWeatherFailure(nextFn.bind(window));
              },
            });
          },
          {
            storageKey: DEMO_STORAGE_KEY,
            seed: weatherSeed,
            activeTheme: theme,
          }
        );

        await navigateAndSettleStaticRoute(errorPage, `${origin}${basePath}/weather/`, theme);
        await expect(
          errorPage.getByText('Failed to load forecast. Please try again later.')
        ).toBeVisible();

        const weatherErrKey = `[${theme}] ${basePath}/weather (error-alert)`;
        const weatherErrViolations = await runWcagAudit(errorPage);
        stateViolations[weatherErrKey] = weatherErrViolations;
        expect(
          weatherErrViolations,
          formatViolationSummary(weatherErrKey, weatherErrViolations)
        ).toEqual([]);
        await errorPage.close();

        // 2. Invitation Manager empty search state & mixed status badges
        await applyDeterministicThemeAndSeed(
          page,
          theme,
          buildDemoSeedForRoute('/admin/dashboard/invitation-codes')
        );
        await navigateAndSettleStaticRoute(
          page,
          `${origin}${basePath}/admin/dashboard/invitation-codes/`,
          theme
        );

        const searchInput = page.getByRole('textbox', { name: /Search invitation codes/i });
        await searchInput.fill('__NO_MATCHING_HOUSEHOLD_QUERY__');
        await expect(
          page.getByText('No invitation codes match your search or filter criteria.')
        ).toBeVisible();

        const emptyInvKey = `[${theme}] ${basePath}/admin/dashboard/invitation-codes (empty-filter)`;
        const emptyInvViolations = await runWcagAudit(page);
        stateViolations[emptyInvKey] = emptyInvViolations;
        expect(
          emptyInvViolations,
          formatViolationSummary(emptyInvKey, emptyInvViolations)
        ).toEqual([]);

        // 3. Reception Slideshow speed controls (WCAG 2.5.3 label-content-name-mismatch + aria-pressed)
        await applyDeterministicThemeAndSeed(
          page,
          theme,
          buildDemoSeedForRoute('/photos/slideshow')
        );
        await navigateAndSettleStaticRoute(
          page,
          `${origin}${basePath}/photos/slideshow/`,
          theme
        );

        const speed5Btn = page.getByTestId('slideshow-duration-5s-btn');
        const speed8Btn = page.getByTestId('slideshow-duration-8s-btn');
        const speed10Btn = page.getByTestId('slideshow-duration-10s-btn');
        await expect(speed5Btn).toBeVisible();
        await expect(speed5Btn).toHaveAccessibleName(/^5s\b/i);
        await expect(speed8Btn).toHaveAccessibleName(/^8s\b/i);
        await expect(speed10Btn).toHaveAccessibleName(/^10s\b/i);
        await expect(async () => {
          await speed5Btn.click();
          await expect(speed5Btn).toHaveAttribute('aria-pressed', 'true', { timeout: 1_000 });
        }).toPass({ timeout: 10_000 });
        await expect(speed8Btn).toHaveAttribute('aria-pressed', 'false');

        const slideshowSpeedKey = `[${theme}] ${basePath}/photos/slideshow (speed-5s)`;
        const slideshowSpeedViolations = await runWcagAudit(page);
        stateViolations[slideshowSpeedKey] = slideshowSpeedViolations;
        expect(
          slideshowSpeedViolations,
          formatViolationSummary(slideshowSpeedKey, slideshowSpeedViolations)
        ).toEqual([]);

        // 4. Registry Add Item interactive tabs (#tab-single, #tab-batch, #tab-csv + Dropzone)
        await applyDeterministicThemeAndSeed(
          page,
          theme,
          buildDemoSeedForRoute('/registry/add-item')
        );
        await navigateAndSettleStaticRoute(
          page,
          `${origin}${basePath}/registry/add-item/`,
          theme
        );

        for (const [tabSelector, panelSelector] of [
          ['#tab-single', '#panel-single'],
          ['#tab-batch', '#panel-batch'],
          ['#tab-csv', '#panel-csv'],
        ] as const) {
          await expect(async () => {
            await page.locator(tabSelector).click();
            await expect(page.locator(tabSelector)).toHaveAttribute('aria-selected', 'true', {
              timeout: 1_000,
            });
          }).toPass({ timeout: 10_000 });
          await expect(page.locator(panelSelector)).toBeVisible();

          const tabKey = `[${theme}] ${basePath}/registry/add-item (${tabSelector})`;
          const tabViolations = await runWcagAudit(page);
          stateViolations[tabKey] = tabViolations;
          expect(tabViolations, formatViolationSummary(tabKey, tabViolations)).toEqual([]);
        }

        await context.close();
      }
    } finally {
      writeShardAndMergeReport('states', stateViolations);
    }
  });
});
