import { test, expect } from '@playwright/test';
import crypto from 'crypto';

function generateAdminCookieValue() {
  const secret = process.env.ADMIN_PASSWORD || 'scrypt:c2FsdA==:aGFzaA==';
  const payload = {
    isAdmin: true,
    iat: Date.now(),
    exp: Date.now() + 8 * 60 * 60 * 1000, // 8 hours
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64url');
  return `${data}.${signature}`;
}

const PUBLIC_UI_ROUTES = [
  '/',
  '/photos',
  '/wedding-party',
  '/things-to-do',
  '/weather',
  '/archive',
  '/admin/login'
];

const PROTECTED_UI_ROUTES = [
  '/admin/dashboard',
  '/registry/add-item',
  '/registry/edit-item/1'
];

const START_ROUTES = [...PUBLIC_UI_ROUTES, ...PROTECTED_UI_ROUTES];

test.describe('Dynamic Route Crawler & Link Audit', () => {

  test('Unauthenticated guest should be redirected to login screen on protected routes', async ({ page }) => {
    for (const route of PROTECTED_UI_ROUTES) {
      console.log(`[Unauthenticated] Navigating to: ${route}`);
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      const url = new URL(page.url());
      expect(url.pathname).toBe('/admin/login');
    }
  });

  test('Authenticated admin should successfully render all routes and find no broken internal links', async ({ context, page }) => {
    const cookieValue = generateAdminCookieValue();

    // Inject programmatically signed admin auth cookie
    await context.addCookies([
      {
        name: 'admin_auth',
        value: cookieValue,
        url: 'http://127.0.0.1:3000',
      }
    ]);

    const visitedUrls = new Set<string>();
    const checkedLinks = new Set<string>();
    const baseURL = 'http://127.0.0.1:3000';

    for (const route of START_ROUTES) {
      const targetUrl = new URL(route, baseURL).toString();
      if (visitedUrls.has(targetUrl)) continue;

      console.log(`[Authenticated] Navigating to: ${targetUrl}`);
      // Navigate to the target route and wait for DOM content loaded (much faster and avoids hanging)
      const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
      expect(response).not.toBeNull();
      expect(response!.status()).toBe(200);

      // Verify that the page loaded successfully as authenticated (i.e. did not redirect to login)
      if (route !== '/admin/login') {
        const currentUrl = new URL(page.url());
        expect(currentUrl.pathname).not.toBe('/admin/login');
      }

      // Check for generic application server or DB errors in page content
      const content = await page.content();
      expect(content).not.toContain('Internal Server Error');
      expect(content).not.toContain('500 Error');
      expect(content).not.toContain('An unhandled error occurred');

      visitedUrls.add(targetUrl);

      // Parse and extract all anchor links from the navigated page
      const anchors = await page.locator('a').all();
      console.log(`Found ${anchors.length} anchor elements on ${route}`);
      for (const anchor of anchors) {
        const href = await anchor.getAttribute('href');
        if (!href) continue;

        // Skip non-navigational links or fragments
        if (
          href.startsWith('#') ||
          href.startsWith('mailto:') ||
          href.startsWith('tel:') ||
          href.startsWith('javascript:')
        ) {
          continue;
        }

        let resolvedUrl: URL;
        try {
          resolvedUrl = new URL(href, targetUrl);
        } catch {
          // Invalid URL pattern, skip
          continue;
        }

        // Only check local internal links (no external path hits)
        if (resolvedUrl.origin !== new URL(baseURL).origin) {
          continue;
        }

        // Skip internal next-dev hot reload or webpack endpoints
        if (resolvedUrl.pathname.includes('/_next/')) {
          continue;
        }

        // Normalize url by stripping hash and trailing slash to avoid duplicate checks
        let normalizedPath = resolvedUrl.pathname;
        if (normalizedPath.length > 1 && normalizedPath.endsWith('/')) {
          normalizedPath = normalizedPath.slice(0, -1);
        }

        const absoluteCheckUrl = `${resolvedUrl.origin}${normalizedPath}${resolvedUrl.search}`;

        if (checkedLinks.has(absoluteCheckUrl)) {
          continue;
        }

        checkedLinks.add(absoluteCheckUrl);

        // Fetch internal link and assert it does not return an error status code (4xx, 5xx)
        console.log(`Checking link: ${absoluteCheckUrl}`);
        const linkResponse = await page.request.get(absoluteCheckUrl);
        const status = linkResponse.status();
        expect(status, `Expected link "${href}" (${absoluteCheckUrl}) to be valid but got status ${status}`).toBeLessThan(400);
      }
    }
  });

});
