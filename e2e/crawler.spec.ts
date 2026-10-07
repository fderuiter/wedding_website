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

function generateGuestCookieValue() {
  const secret = process.env.GUEST_PASSCODE || 'wedding2026';
  const payload = {
    guest: true,
    iat: Date.now(),
    exp: Date.now() + 8 * 60 * 60 * 1000,
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

  test('Unauthenticated guest should be redirected to login screen on protected routes', async ({ browser }) => {
    test.setTimeout(120000);
    const guestCookieValue = generateGuestCookieValue();

    for (const route of PROTECTED_UI_ROUTES) {
      const testContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3000', reducedMotion: 'reduce' });
      try {
        await testContext.addCookies([
          {
            name: 'guest_auth',
            value: guestCookieValue,
            url: 'http://127.0.0.1:3000',
          }
        ]);
        console.log(`[Unauthenticated] Navigating to: ${route}`);
        const page = await testContext.newPage();
        try {
          await page.goto(route, { waitUntil: 'domcontentloaded' });
          const url = new URL(page.url());
          expect(url.pathname).toBe('/admin/login');
        } finally {
          await page.close();
        }
      } finally {
        await testContext.close();
      }
    }
  });

  test('Authenticated admin should successfully render all routes and find no broken internal links', async ({ browser }) => {
    test.setTimeout(180000);
    const cookieValue = generateAdminCookieValue();
    const guestCookieValue = generateGuestCookieValue();

    const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const validJpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

    const visitedUrls = new Set<string>();
    const checkedLinks = new Set<string>();
    const baseURL = 'http://127.0.0.1:3000';

    const routeContext = await browser.newContext({
      baseURL,
      reducedMotion: 'reduce',
    });

    try {
      // Inject programmatically signed admin auth cookie
      await routeContext.addCookies([
        {
          name: 'admin_auth',
          value: cookieValue,
          url: 'http://127.0.0.1:3000',
        },
        {
          name: 'guest_auth',
          value: guestCookieValue,
          url: 'http://127.0.0.1:3000',
        }
      ]);

      // Fulfill external CDN/third-party image/script requests with dummy response to prevent script load errors in headless Chromium
      await routeContext.route(/cdn\.jsdelivr\.net/, route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
      await routeContext.route(/googleusercontent\.com/, route => route.fulfill({ status: 200, contentType: 'image/png', body: transparentPng }));
      await routeContext.route(/openstreetmap\.org/, route => route.fulfill({ status: 200, contentType: 'image/png', body: transparentPng }));

      // Mock weather API endpoint to avoid external network dependency in e2e tests
      await routeContext.route('**/api/weather', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            daily: {
              time: ['2025-10-10'],
              weathercode: [0],
              temperature_2m_max: [75],
              temperature_2m_min: [55],
              apparent_temperature_max: [75],
              precipitation_probability_max: [0],
              wind_speed_10m_max: [5],
            },
          }),
        });
      });

      // Mock registry items API endpoint to prevent database connection retries on admin dashboard
      await routeContext.route('**/api/registry/items', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
      });

      for (const route of START_ROUTES) {
        const targetUrl = new URL(route, baseURL).toString();
        if (visitedUrls.has(targetUrl)) continue;

        console.log(`[Authenticated] Navigating to: ${targetUrl}`);
        const page = await routeContext.newPage();
        let anchors: (string | null)[] = [];

        try {
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

          // Parse and extract all anchor links from the navigated page in a single CDP call
          const hrefs = await page.evaluate(() => 
            Array.from(document.querySelectorAll('a')).map(a => a.getAttribute('href'))
          );
          console.log(`Found ${hrefs.length} anchor elements on ${route}`);
          anchors = hrefs;
        } finally {
          await page.close();
        }

        for (const href of anchors) {
          if (!href) continue;

          // Skip non-navigational links or fragments
          if (
            href.startsWith('#') ||
            href.startsWith('mailto:') ||
            href.startsWith('tel:') ||
            href.startsWith('javascript:') ||
            href.startsWith('data:') ||
            href.startsWith('vbscript:')
          ) {
            continue;
          }

          let resolvedUrl: URL;
          try {
            resolvedUrl = new URL(href, targetUrl);
          } catch {
            continue;
          }

          if (resolvedUrl.origin !== new URL(baseURL).origin) {
            continue;
          }

          if (resolvedUrl.pathname.includes('/_next/')) {
            continue;
          }

          let normalizedPath = resolvedUrl.pathname;
          if (normalizedPath.length > 1 && normalizedPath.endsWith('/')) {
            normalizedPath = normalizedPath.slice(0, -1);
          }

          const absoluteCheckUrl = `${resolvedUrl.origin}${normalizedPath}${resolvedUrl.search}`;
          checkedLinks.add(absoluteCheckUrl);
        }
      }

      console.log(`Checking ${checkedLinks.size} unique internal links...`);
      for (const absoluteCheckUrl of checkedLinks) {
        console.log(`Checking link: ${absoluteCheckUrl}`);
        const linkResponse = await fetch(absoluteCheckUrl, {
          headers: {
            Cookie: `admin_auth=${cookieValue}; guest_auth=${guestCookieValue}`,
          },
        });
        const status = linkResponse.status;
        expect(status, `Expected link (${absoluteCheckUrl}) to be valid but got status ${status}`).toBeLessThan(400);
      }
    } finally {
      await routeContext.close();
    }
  });

});
