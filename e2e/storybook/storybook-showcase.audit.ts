import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { a11yConfig } from '../../src/a11y-config';

type AxeViolation = Awaited<ReturnType<AxeBuilder['analyze']>>['violations'][number];
type ColorTheme = 'light' | 'dark';

interface StorybookIndexEntry {
  id: string;
  title: string;
  name: string;
  type: string;
}

interface StorybookIndexJson {
  v?: number;
  entries?: Record<string, StorybookIndexEntry>;
}

const STORYBOOK_THEMES: readonly ColorTheme[] = ['light', 'dark'];
const RESULTS_DIR = path.join(process.cwd(), 'test-results');
const STORYBOOK_A11Y_REPORT_FILE = path.join(RESULTS_DIR, 'storybook-a11y-violations.json');
const TRANSPARENT_PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

function writeShardAndMergeReport(
  shardId: string,
  shardViolations: Record<string, AxeViolation[]>
) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const shardPath = path.join(RESULTS_DIR, `.storybook-a11y-shard-${shardId}.json`);
  fs.writeFileSync(shardPath, `${JSON.stringify(shardViolations, null, 2)}\n`, 'utf8');

  const merged: Record<string, AxeViolation[]> = {};
  const shardFiles = fs
    .readdirSync(RESULTS_DIR)
    .filter((f) => f.startsWith('.storybook-a11y-shard-') && f.endsWith('.json'))
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
    `.storybook-a11y-violations.${process.pid}.${Date.now()}.tmp`
  );
  fs.writeFileSync(tempOut, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  fs.renameSync(tempOut, STORYBOOK_A11Y_REPORT_FILE);
}

function normalizeBasePath(rawBasePath: string | undefined): string {
  const trimmed = (rawBasePath ?? '/wedding_website/storybook').trim().replace(/\/+$/, '');
  if (!trimmed || trimmed === '/') {
    return '';
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function discoverStories(storybookDir: string): StorybookIndexEntry[] {
  const indexJsonPath = path.join(storybookDir, 'index.json');
  if (!fs.existsSync(indexJsonPath)) {
    throw new Error(
      `Storybook index.json not found at ${indexJsonPath}. Run "NEXT_PUBLIC_BASE_PATH=/wedding_website/storybook npm run build-storybook" before running the Storybook showcase audit.`
    );
  }

  const parsed = JSON.parse(fs.readFileSync(indexJsonPath, 'utf8')) as StorybookIndexJson;
  const entries = Object.values(parsed.entries ?? {}).filter((entry) => entry.type === 'story');
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

function countEmbeddedBasePathReferences(storybookDir: string, basePath: string): number {
  if (!basePath) {
    return 0;
  }

  const bundleFiles = fs
    .readdirSync(storybookDir)
    .filter((name) => name.endsWith('.iframe.bundle.js'));

  let count = 0;
  for (const file of bundleFiles) {
    const content = fs.readFileSync(path.join(storybookDir, file), 'utf8');
    let searchIdx = 0;
    while (true) {
      const found = content.indexOf(basePath, searchIdx);
      if (found === -1) break;
      count += 1;
      searchIdx = found + basePath.length;
    }
  }
  return count;
}

function buildExternalUrlPattern(origin: string): RegExp {
  const hostPort = new URL(origin).host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^https?://(?!${hostPort}(?:/|$))`, 'i');
}

async function applyDeterministicTheme(page: Page, theme: ColorTheme) {
  await page.evaluate((nextTheme) => {
    window.localStorage.setItem('theme_mode', nextTheme);
    document.cookie = `theme_mode=${nextTheme}; path=/; SameSite=Lax`;
  }, theme);
}

async function waitForStorySettled(page: Page, theme: ColorTheme) {
  await page.locator('#storybook-root').waitFor({ state: 'attached', timeout: 15_000 });
  await page.waitForFunction(
    (expectedTheme) => {
      if (document.readyState !== 'complete') return false;
      if (document.body.classList.contains('sb-show-errordisplay')) {
        return true;
      }
      if (!document.body.classList.contains('sb-show-main')) {
        return false;
      }
      const root = document.getElementById('storybook-root');
      if (!root || root.children.length === 0) {
        return false;
      }
      const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
      if (!links.every((link) => Boolean((link as HTMLLinkElement).sheet))) {
        return false;
      }
      if (!document.getElementById('dynamic-theme-style')) {
        return false;
      }
      if (!document.documentElement.classList.contains(expectedTheme)) {
        return false;
      }
      const storyDecoratorWrapper = root.querySelector('div.min-h-\\[200px\\]');
      const hasInlineStoryChild = storyDecoratorWrapper
        ? storyDecoratorWrapper.children.length > 0 ||
          (storyDecoratorWrapper.textContent?.trim().length ?? 0) > 0
        : root.children.length > 0;
      const hasOpenDialogPortal = Boolean(
        document.querySelector('[role="dialog"], [role="alertdialog"]')
      );
      return hasInlineStoryChild || hasOpenDialogPortal;
    },
    theme,
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
  await page.waitForTimeout(80);
}

async function navigateAndSettleStory(
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
    await waitForStorySettled(page, theme);
  } catch {
    onBeforeRetry?.();
    docResponse = await page.goto(targetUrl, {
      waitUntil: 'load',
      timeout: 30_000,
    });
    await waitForStorySettled(page, theme);
  }
  return docResponse;
}

async function runWcagAudit(page: Page): Promise<AxeViolation[]> {
  const hasPortalDialog = await page.evaluate(() => {
    const root = document.getElementById('storybook-root');
    return Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]')).some(
      (el) => !root?.contains(el)
    );
  });

  const builder = new AxeBuilder({ page }).include('#storybook-root').exclude('iframe');
  if (hasPortalDialog) {
    builder.include('[role="dialog"]').include('[role="alertdialog"]');
  }

  builder.options({
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

function formatViolationSummary(storyKey: string, violations: AxeViolation[]): string {
  return violations
    .map((v) => {
      const sampleNodes = v.nodes
        .slice(0, 4)
        .map(
          (n) =>
            `${JSON.stringify(n.target)} (${n.failureSummary?.replace(/\s+/g, ' ').trim() ?? n.html.slice(0, 80)})`
        )
        .join('; ');
      return `[${storyKey}] ${v.id} (${v.impact}, ${v.nodes.length} nodes): ${sampleNodes}`;
    })
    .join('\n');
}

test.describe('Standalone Storybook Showcase Runtime & WCAG 2.2 AA Audit @a11y-storybook', () => {
  const storybookDir = path.resolve(
    process.env.STORYBOOK_STATIC_DIR || path.join(process.cwd(), 'storybook-static')
  );
  const basePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);

  for (const theme of STORYBOOK_THEMES) {
    test(`scans all Storybook stories in ${theme} theme with zero HTTP/console/runtime errors and zero WCAG 2.2 A/AA violations`, async ({
      browser,
      baseURL,
    }) => {
      const origin = baseURL || 'http://127.0.0.1:4174';
      const stories = discoverStories(storybookDir);
      expect(stories.length).toBeGreaterThanOrEqual(43);

      if (basePath) {
        const embeddedRefs = countEmbeddedBasePathReferences(storybookDir, basePath);
        expect(embeddedRefs).toBeGreaterThanOrEqual(5);
      }

      const shardViolations: Record<string, AxeViolation[]> = {};
      const storyFailures: string[] = [];
      const a11yFailures: string[] = [];
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
      await context.route(externalUrlPattern, async (route) => {
        const resourceType = route.request().resourceType();
        if (resourceType === 'image') {
          await route.fulfill({
            status: 200,
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Content-Type': 'image/png',
            },
            body: TRANSPARENT_PNG_BUFFER,
          });
          return;
        }
        await route.fulfill({
          status: 204,
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: '',
        });
      });

      const createPrimedPage = async () => {
        const nextPage = await context.newPage();
        await nextPage.goto(`${origin}/__health`, { waitUntil: 'commit' });
        return nextPage;
      };

      let page = await createPrimedPage();

      try {
        for (let idx = 0; idx < stories.length; idx += 1) {
          const story = stories[idx];
          const scanKey = `[${theme}] ${story.id}`;
          await applyDeterministicTheme(page, theme);

          const failedResponses: string[] = [];
          const consoleErrors: string[] = [];
          const pageErrors: string[] = [];

          const onResponse = (resp: { url: () => string; status: () => number }) => {
            if (resp.url().startsWith(origin) && resp.status() >= 400) {
              failedResponses.push(`${resp.status()} ${resp.url().slice(origin.length)}`);
            }
          };
          const onConsole = (msg: { type: () => string; text: () => string }) => {
            if (msg.type() === 'error') {
              consoleErrors.push(msg.text());
            }
          };
          const onPageError = (err: Error) => {
            pageErrors.push(err.message);
          };

          page.on('response', onResponse);
          page.on('console', onConsole);
          page.on('pageerror', onPageError);

          const isWebGlStory = story.id.startsWith('visual-graphical-heart3d--');
          const shouldRecyclePage = isWebGlStory || (idx + 1) % 12 === 0;

          try {
            const iframePrefix = basePath ? `${basePath}/iframe.html` : '/iframe.html';
            const targetUrl = `${origin}${iframePrefix}?id=${encodeURIComponent(story.id)}&viewMode=story&globals=themeMode:${theme}`;
            const clearAttemptDiagnostics = () => {
              failedResponses.length = 0;
              consoleErrors.length = 0;
              pageErrors.length = 0;
            };

            let docResponse = await navigateAndSettleStory(
              page,
              targetUrl,
              theme,
              clearAttemptDiagnostics
            );
            if (pageErrors.some((msg) => msg.includes('Failed to load chunk'))) {
              clearAttemptDiagnostics();
              await page.goto('about:blank').catch(() => {});
              await page.waitForTimeout(100);
              docResponse = await navigateAndSettleStory(
                page,
                targetUrl,
                theme,
                clearAttemptDiagnostics
              );
            }

            const status = docResponse?.status() ?? 0;
            if (status !== 200) {
              storyFailures.push(`${scanKey}: expected HTTP 200, received ${status}`);
            }

            const hasErrorDisplay = await page.evaluate(() =>
              document.body.classList.contains('sb-show-errordisplay')
            );
            if (hasErrorDisplay) {
              const errMsg = await page
                .locator('#error-message')
                .textContent()
                .catch(() => 'Storybook error display shown');
              storyFailures.push(`${scanKey}: Storybook error display -> ${errMsg?.trim()}`);
            }

            if (failedResponses.length > 0) {
              storyFailures.push(`${scanKey}: failed HTTP responses -> ${failedResponses.join(', ')}`);
            }
            if (consoleErrors.length > 0) {
              storyFailures.push(`${scanKey}: console errors -> ${consoleErrors.join(' | ')}`);
            }
            if (pageErrors.length > 0) {
              storyFailures.push(`${scanKey}: uncaught page errors -> ${pageErrors.join(' | ')}`);
            }

            const violations = await runWcagAudit(page);
            shardViolations[scanKey] = violations;
            if (violations.length > 0) {
              a11yFailures.push(formatViolationSummary(scanKey, violations));
            }
            completedScans += 1;
          } finally {
            page.off('response', onResponse);
            page.off('console', onConsole);
            page.off('pageerror', onPageError);
          }

          if (idx < stories.length - 1 && shouldRecyclePage) {
            await page.close();
            page = await createPrimedPage();
          }
        }
      } finally {
        writeShardAndMergeReport(theme, shardViolations);
        await context.close();
      }

      expect(completedScans).toBe(stories.length);
      expect(completedScans).toBeGreaterThanOrEqual(43);
      expect(storyFailures, storyFailures.join('\n')).toEqual([]);
      expect(a11yFailures, a11yFailures.join('\n')).toEqual([]);
    });
  }
});
