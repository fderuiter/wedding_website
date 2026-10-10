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

  test('Unauthenticated guest should be redirected to login screen on protected routes', async ({ context }) => {
    test.setTimeout(120000);
    const guestCookieValue = generateGuestCookieValue();

    await context.addCookies([
      {
        name: 'guest_auth',
        value: guestCookieValue,
        url: 'http://127.0.0.1:3000',
      }
    ]);

    for (const route of PROTECTED_UI_ROUTES) {
      console.log(`[Unauthenticated] Navigating to: ${route}`);
      const page = await context.newPage();
      try {
        await page.goto(route, { waitUntil: 'domcontentloaded' });
        const url = new URL(page.url());
        expect(url.pathname).toBe('/admin/login');
      } finally {
        await page.close();
      }
    }
  });

  test('Authenticated admin should successfully render all routes and find no broken internal links', async ({ context }) => {
    test.setTimeout(180000);
    const cookieValue = generateAdminCookieValue();
    const guestCookieValue = generateGuestCookieValue();
    const expires = Math.floor(Date.now() / 1000) + 3600;

    const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const validJpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

    const visitedUrls = new Set<string>();
    const checkedLinks = new Set<string>();
    const baseURL = 'http://127.0.0.1:3000';

    await context.addCookies([
      {
        name: 'admin_auth',
        value: cookieValue,
        domain: '127.0.0.1',
        path: '/',
        expires,
      },
      {
        name: 'guest_auth',
        value: guestCookieValue,
        domain: '127.0.0.1',
        path: '/',
        expires,
      }
    ]);

    await context.route(/cdn\.jsdelivr\.net/, (route: any) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    await context.route(/googleusercontent\.com/, (route: any) => route.fulfill({ status: 200, contentType: 'image/jpeg', body: validJpeg }));
    await context.route(/openstreetmap\.org/, (route: any) => route.fulfill({ status: 200, contentType: 'image/png', body: transparentPng }));
    await context.route(/open-meteo\.com/, (route: any) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

    await context.route('**/api/weather', async (route: any) => {
      await route.fulfill({
        status: 200,
        json: {
          daily: {
            time: ['2025-10-10'],
            weathercode: [0],
            temperature_2m_max: [75],
            temperature_2m_min: [55],
            apparent_temperature_max: [75],
            precipitation_probability_max: [0],
            wind_speed_10m_max: [5],
          },
        },
      });
    });

    await context.route('**/api/registry/items/*', async (route: any) => {
      await route.fulfill({
        status: 200,
        json: {
          id: '1',
          name: 'Sample Item',
          description: 'Sample description',
          category: 'Home',
          price: 100,
          quantity: 1,
          purchased: false,
          isGroupGift: false,
          amountContributed: 0,
          contributors: [],
        },
      });
    });

    await context.route('**/api/registry/items', async (route: any) => {
      await route.fulfill({
        status: 200,
        json: [
          {
            id: '1',
            name: 'Sample Item',
            description: 'Sample description',
            category: 'Home',
            price: 100,
            quantity: 1,
            purchased: false,
            isGroupGift: false,
            amountContributed: 0,
            contributors: [],
          }
        ],
      });
    });

    for (const route of START_ROUTES) {
      const targetUrl = new URL(route, baseURL).toString();
      if (visitedUrls.has(targetUrl)) continue;

      console.log(`[Authenticated] Navigating to: ${targetUrl}`);
      const page = await context.newPage();
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

        // Parse and extract all anchor links from the navigated page
        const hrefs = await page.evaluate(() => 
          Array.from(document.querySelectorAll('a')).map(a => a.getAttribute('href'))
        );
        console.log(`Found ${hrefs.length} anchor elements on ${route}`);

        for (const href of hrefs) {
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
      } finally {
        await page.close();
      }
    }

    console.log(`Checking ${checkedLinks.size} unique internal links...`);
    const linksArray = Array.from(checkedLinks);
    const batchSize = 5;
    for (let i = 0; i < linksArray.length; i += batchSize) {
      const batch = linksArray.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (absoluteCheckUrl) => {
          console.log(`Checking link: ${absoluteCheckUrl}`);
          const linkResponse = await fetch(absoluteCheckUrl, {
            headers: {
              Cookie: `admin_auth=${cookieValue}; guest_auth=${guestCookieValue}`,
            },
          });
          return { absoluteCheckUrl, status: linkResponse.status };
        })
      );

      for (const { absoluteCheckUrl, status } of batchResults) {
        expect(status, `Expected link (${absoluteCheckUrl}) to be valid but got status ${status}`).toBeLessThan(400);
      }
    }
  });

});
