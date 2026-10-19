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

    const guestContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3000', reducedMotion: 'reduce' });
    try {
      await guestContext.addCookies([
        {
          name: 'guest_auth',
          value: guestCookieValue,
          url: 'http://127.0.0.1:3000',
        }
      ]);

      for (const route of PROTECTED_UI_ROUTES) {
        console.log(`[Unauthenticated] Navigating to: ${route}`);
        const page = await guestContext.newPage();
        try {
          try {
            await page.goto(route, { waitUntil: 'domcontentloaded' });
          } catch (gotoError: any) {
            if (
              gotoError?.message?.includes('net::ERR_ABORTED') ||
              gotoError?.message?.includes('Page crashed') ||
              gotoError?.message?.includes('Target closed')
            ) {
              await page.waitForURL('**/admin/login', { timeout: 10000 }).catch(() => {});
            } else {
              throw gotoError;
            }
          }
          const url = new URL(page.url());
          expect(url.pathname).toBe('/admin/login');
        } finally {
          await page.close().catch(() => {});
        }
      }
    } finally {
      await guestContext.close();
    }
  });

  const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const validJpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
  const baseURL = 'http://127.0.0.1:3000';

  for (const route of START_ROUTES) {
    test(`Authenticated admin render & link check: ${route}`, async ({ browser }) => {
      test.setTimeout(60000);
      const cookieValue = generateAdminCookieValue();
      const guestCookieValue = generateGuestCookieValue();

      const ctx = await browser.newContext({ baseURL, reducedMotion: 'reduce' });
      try {
        await ctx.addCookies([
          { name: 'admin_auth', value: cookieValue, url: baseURL },
          { name: 'guest_auth', value: guestCookieValue, url: baseURL },
        ]);

        await ctx.route((url: any) => {
          const host = url.host;
          return host !== '127.0.0.1:3000' && host !== 'localhost:3000' && host !== '127.0.0.1' && host !== 'localhost';
        }, (route: any) => route.fulfill({ status: 200, contentType: 'text/plain', body: '' }));

        await ctx.route(/cdn\.jsdelivr\.net/, (route: any) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
        await ctx.route(/googleusercontent\.com/, (route: any) => route.abort());
        await ctx.route(/openstreetmap\.org/, (route: any) => route.fulfill({ status: 200, contentType: 'image/png', body: transparentPng }));
        await ctx.route(/open-meteo\.com/, (route: any) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

        await ctx.route('**/api/weather', async (route: any) => {
          await route.fulfill({
            status: 200,
            json: {
              daily: {
                time: ['2025-10-10'], weathercode: [0], temperature_2m_max: [75],
                temperature_2m_min: [55], apparent_temperature_max: [75],
                precipitation_probability_max: [0], wind_speed_10m_max: [5],
              },
            },
          });
        });

        await ctx.route('**/api/registry/items/*', async (route: any) => {
          await route.fulfill({
            status: 200,
            json: { id: '1', name: 'Sample Item', description: 'Sample description', category: 'Home', price: 100, quantity: 1, purchased: false, isGroupGift: false, amountContributed: 0, contributors: [] },
          });
        });

        await ctx.route('**/api/registry/items', async (route: any) => {
          await route.fulfill({
            status: 200,
            json: [{ id: '1', name: 'Sample Item', description: 'Sample description', category: 'Home', price: 100, quantity: 1, purchased: false, isGroupGift: false, amountContributed: 0, contributors: [] }],
          });
        });

        const targetUrl = new URL(route, baseURL).toString();
        console.log(`[Authenticated] Navigating to: ${targetUrl}`);
        const page = await ctx.newPage();

        try {
          const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
          expect(response).not.toBeNull();
          expect(response!.status()).toBe(200);

          if (route !== '/admin/login') {
            const currentUrl = new URL(page.url());
            expect(currentUrl.pathname).not.toBe('/admin/login');
          }

          const content = await page.content();
          expect(content).not.toContain('Internal Server Error');
          expect(content).not.toContain('500 Error');
          expect(content).not.toContain('An unhandled error occurred');

          const hrefs = await page.evaluate(() =>
            Array.from(document.querySelectorAll('a')).map(a => a.getAttribute('href'))
          );
          console.log(`Found ${hrefs.length} anchor elements on ${route}`);

          const linksToCheck: string[] = [];
          for (const href of hrefs) {
            if (!href) continue;
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
            try { resolvedUrl = new URL(href, targetUrl); } catch { continue; }
            if (resolvedUrl.origin !== new URL(baseURL).origin) continue;
            if (resolvedUrl.pathname.includes('/_next/')) continue;

            let normalizedPath = resolvedUrl.pathname;
            if (normalizedPath.length > 1 && normalizedPath.endsWith('/')) {
              normalizedPath = normalizedPath.slice(0, -1);
            }
            linksToCheck.push(`${resolvedUrl.origin}${normalizedPath}${resolvedUrl.search}`);
          }

          for (const checkUrl of linksToCheck) {
            const linkResponse = await fetch(checkUrl, {
              headers: { Cookie: `admin_auth=${cookieValue}; guest_auth=${guestCookieValue}` },
              signal: AbortSignal.timeout(10000),
            }).catch(() => null);

            if (linkResponse) {
              expect(linkResponse.status, `Expected internal link (${checkUrl}) on ${route} to be valid but got status ${linkResponse.status}`).toBeLessThan(400);
            }
          }
        } finally {
          await page.goto('about:blank').catch(() => {});
          await page.close().catch(() => {});
        }
      } finally {
        await ctx.close().catch(() => {});
      }
    });
  }

});
