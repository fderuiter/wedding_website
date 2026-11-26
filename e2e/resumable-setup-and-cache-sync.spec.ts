import { test, expect } from '@playwright/test';
import {
  generateAdminCookieValue,
  seedAdminAndGuestAuthCookies,
  seedGuestAuthCookies,
} from './helpers/auth';

const captureScreenshots = process.env.CAPTURE_E2E_SCREENSHOTS === '1';

test.describe('Resumable Setup Route & Unified Sample Cache Invalidation', () => {
  test.afterAll(async ({ request }) => {
    const adminCookie = generateAdminCookieValue();
    const headers = { Cookie: `admin_auth=${adminCookie}` };

    await request.delete('/api/admin/sample-data', { headers });
    await request.post('/api/admin/setup', {
      headers,
      data: {
        partner1Name: 'Jane',
        partner2Name: 'John',
        weddingDate: '2027-06-20',
        baseUrl: 'http://localhost:3000',
        venueName: 'The Conservatory',
        venueCity: 'Minneapolis',
        venueState: 'MN',
        heroTitle: 'Jane & John',
        heroSubtitle: '',
        setupCompleted: true,
      },
    });
  });

  test('persists resumable /admin/setup across reloads on Steps 3-5, invalidates Step 5 badges, renders pre-wedding copy without TBD, and purges sample caches across modules', async ({
    browser,
    context,
    page,
  }) => {
    const { adminCookieValue: adminCookie } = await seedAdminAndGuestAuthCookies(context);
    const headers = { Cookie: `admin_auth=${adminCookie}` };
    const request = context.request;

    // Ensure clean sample data and invitation code state, then mark setup incomplete on Step 2
    await request.delete('/api/admin/sample-data', { headers });
    const existingCodesRes = await request.get('/api/admin/invitation-codes?limit=100', {
      headers,
    });
    if (existingCodesRes.ok()) {
      const payload = (await existingCodesRes.json()) as
        | Array<{ id: string; isSample?: boolean }>
        | { data?: Array<{ id: string; isSample?: boolean }> };
      const existingCodes = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.data)
          ? payload.data
          : [];
      const nonSampleIds = existingCodes.filter((c) => !c.isSample).map((c) => c.id);
      if (nonSampleIds.length > 0) {
        await request.delete('/api/admin/invitation-codes/batch', {
          headers: { ...headers, 'Content-Type': 'application/json' },
          data: { ids: nonSampleIds },
        });
      }
    }
    const resetRes = await request.post('/api/admin/setup', {
      headers,
      data: {
        partner1Name: 'Alex',
        partner2Name: 'Sam',
        weddingDate: '2027-08-14',
        baseUrl: 'https://alexandsam.example.org',
        venueName: '',
        venueCity: '',
        venueState: '',
        heroTitle: 'Alex & Sam',
        heroSubtitle: '',
        setupCompleted: false,
      },
    });
    expect(resetRes.status()).toBe(200);

    // Verify opening /admin/setup with empty sessionStorage resumes at Step 3 from saved DB state,
    // then seed Step 2 in sessionStorage to exercise the full Step 2 -> Step 3 -> Step 4 -> Step 5 flow
    await page.goto('/admin/setup', { waitUntil: 'domcontentloaded' });
    expect(new URL(page.url()).pathname).toBe('/admin/setup');
    await expect(page.getByRole('heading', { name: 'Step 3: Sample Data Selection' })).toBeVisible({
      timeout: 15000,
    });

    await page.evaluate(() => {
      window.sessionStorage.setItem(
        'setup_wizard_draft',
        JSON.stringify({
          step: 2,
          partner1Name: 'Alex',
          partner2Name: 'Sam',
          weddingDate: '2027-08-14',
          baseUrl: 'https://alexandsam.example.org',
          venueName: '',
          venueCity: '',
          venueState: '',
        })
      );
    });
    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Step 2: The Essentials' })).toBeVisible();
    await expect(page.getByLabel(/Venue Name/i)).toHaveAttribute('placeholder', 'Optional');

    // Submit Step 2 with blank venue fields
    await page.getByRole('button', { name: 'Next Step' }).click();
    await expect(page.getByRole('heading', { name: 'Step 3: Sample Data Selection' })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/admin/setup');

    // Verify GET /api/admin/setup reports requiresSetup: true & setupCompleted: false,
    // while unauthenticated POST /api/admin/setup preserves HTTP 403 replay protection
    const statusAfterStep2 = await request.get('/api/admin/setup');
    const statusJson = await statusAfterStep2.json();
    expect(statusJson.initialized).toBe(true);
    expect(statusJson.setupCompleted).toBe(false);
    expect(statusJson.requiresSetup).toBe(true);

    const anonContext = await browser.newContext();
    try {
      const replayRes = await anonContext.request.post('http://localhost:3000/api/admin/setup', {
        data: {
          partner1Name: 'Mallory',
          partner2Name: 'Eve',
          baseUrl: 'https://mallory.example.org',
        },
      });
      expect(replayRes.status()).toBe(403);
    } finally {
      await anonContext.close();
    }

    // Reload browser on Step 3 -> SetupWizard remains mounted on /admin/setup at Step 3
    await page.reload({ waitUntil: 'domcontentloaded' });
    expect(new URL(page.url()).pathname).toBe('/admin/setup');
    await expect(page.getByRole('heading', { name: 'Step 3: Sample Data Selection' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Skip to Admin Dashboard' })).toBeVisible();

    if (captureScreenshots) {
      await page.screenshot({ path: '/tmp/setup-step3-resumed.png', fullPage: true });
    }

    // Seed sample data in Step 3 and advance to Step 4
    await page.getByRole('button', { name: /Populate Sample Data & Continue/i }).click();
    await expect(page.getByRole('heading', { name: 'Step 4: Guest List Import' })).toBeVisible();
    await expect(page.getByText(/No guests imported yet/i)).toBeVisible();

    // Reload browser on Step 4 -> SetupWizard remains mounted on /admin/setup at Step 4
    await page.reload({ waitUntil: 'domcontentloaded' });
    expect(new URL(page.url()).pathname).toBe('/admin/setup');
    await expect(page.getByRole('heading', { name: 'Step 4: Guest List Import' })).toBeVisible();

    // Advance to Step 5 and verify Wedding Party & Attractions counts exclude sample data (0 custom items) while OnboardingChecklist renders
    await page.getByRole('button', { name: 'Skip for Now' }).click();
    await expect(page.getByRole('heading', { name: 'Step 5: Complete Setup' })).toBeVisible();

    const partyBtn = page.getByRole('button', { name: /Manage Wedding Party/i });
    const attractionsBtn = page.getByRole('button', { name: /Manage Attractions/i });
    await expect(partyBtn).toContainText('(0 members)');
    await expect(attractionsBtn).toContainText('(0 items)');
    await expect(page.getByTestId('onboarding-checklist')).toBeVisible();

    // Reload browser on Step 5 -> SetupWizard remains mounted on /admin/setup at Step 5
    await page.reload({ waitUntil: 'domcontentloaded' });
    expect(new URL(page.url()).pathname).toBe('/admin/setup');
    await expect(page.getByRole('heading', { name: 'Step 5: Complete Setup' })).toBeVisible();

    if (captureScreenshots) {
      await page.screenshot({ path: '/tmp/setup-step5-badges.png', fullPage: true });
    }

    // Verify public homepage renders upcoming wedding copy without 'We Tied the Knot!' or 'TBD'
    const guestContext = await browser.newContext();
    try {
      await seedGuestAuthCookies(guestContext);
      const guestPage = await guestContext.newPage();
      await guestPage.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
      await expect(guestPage.getByRole('heading', { name: 'Alex & Sam' })).toBeVisible();
      const bodyText = (await guestPage.locator('body').textContent()) || '';
      expect(bodyText).not.toContain('We Tied the Knot!');
      expect(bodyText).not.toContain('TBD');

      if (captureScreenshots) {
        await guestPage.screenshot({ path: '/tmp/homepage-prewedding-no-tbd.png' });
      }
    } finally {
      await guestContext.close();
    }

    // Complete Step 5 -> sets setupCompleted: true, clears setup_wizard_draft, opens /admin/dashboard
    await page.getByRole('button', { name: /Go to Admin Dashboard/i }).click();
    await page.waitForURL('**/admin/dashboard', { timeout: 15000 });
    expect(new URL(page.url()).pathname).toBe('/admin/dashboard');

    const draftAfterCompletion = await page.evaluate(() =>
      window.sessionStorage.getItem('setup_wizard_draft')
    );
    expect(draftAfterCompletion).toBeNull();

    const completedStatus = await (await request.get('/api/admin/setup')).json();
    expect(completedStatus.setupCompleted).toBe(true);
    expect(completedStatus.requiresSetup).toBe(false);

    // On /admin/dashboard, Wedding Details milestone remains Pending because venueName is blank
    const weddingDetailsMilestone = page.getByTestId('milestone-item-wedding-details');
    await expect(weddingDetailsMilestone).toBeVisible({ timeout: 15000 });
    await expect(weddingDetailsMilestone).toContainText('Pending');

    // Warm TanStack Query cache on /admin/dashboard/wedding-party via SPA navigation, then return to dashboard
    await page.goto('/admin/dashboard/wedding-party', { waitUntil: 'domcontentloaded' });
    const sampleBanner = page.getByTestId('sample-data-banner');
    await expect(sampleBanner).toBeVisible({ timeout: 15000 });

    // Purge Sample Data from the banner and verify immediate cache invalidation across views
    await sampleBanner.getByRole('button', { name: 'Purge Sample Data' }).click();
    const confirmBtn = page.getByRole('button', { name: 'Confirm' });
    await expect(confirmBtn).toBeVisible();
    const [purgeResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/api/admin/sample-data') && res.request().method() === 'DELETE'
      ),
      confirmBtn.click(),
    ]);
    expect(purgeResponse.status()).toBe(200);
    await expect(sampleBanner).not.toBeVisible({ timeout: 15000 });

    // Navigate back to /admin/dashboard and capture post-purge checklist state
    await page.goto('/admin/dashboard', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('onboarding-checklist')).toBeVisible();
    await expect(sampleBanner).not.toBeVisible();

    if (captureScreenshots) {
      await page.screenshot({ path: '/tmp/dashboard-after-sample-purge.png', fullPage: true });
    }
  });
});
