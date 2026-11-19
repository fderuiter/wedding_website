import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { seedGuestAuthCookies, seedAdminAndGuestAuthCookies } from './helpers/auth';

const VALID_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64'
);

async function gotoWithRetry(
  context: BrowserContext,
  page: Page,
  path: string,
  reseedCookies?: (_ctx: BrowserContext) => Promise<unknown>,
  waitForReady?: (_page: Page) => Promise<void>
): Promise<Page> {
  let activePage = page;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await activePage.goto(path, { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (waitForReady) {
        await waitForReady(activePage);
      }
      return activePage;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        attempt < 3 &&
        (msg.includes('crashed') ||
          msg.includes('closed') ||
          msg.includes('Timeout') ||
          msg.includes('timeout') ||
          msg.includes('net::ERR_ABORTED'))
      ) {
        await activePage.close().catch(() => {});
        if (reseedCookies) {
          await reseedCookies(context).catch(() => {});
        }
        activePage = await context.newPage();
      } else {
        throw err;
      }
    }
  }
  return activePage;
}

test.describe('Modal Focus Containment and Inert Background Isolation', () => {
  test('contains focus and marks background inert in /guest/login help drawer', async ({
    context,
    page,
  }) => {
    page = await gotoWithRetry(context, page, '/guest/login');

    const skipLink = page.locator('a.skip-link');
    const loginForm = page.locator('form');
    const helpTrigger = page.getByRole('button', { name: /need help finding your code\?/i });

    await expect(helpTrigger).toBeVisible({ timeout: 15000 });
    await expect(skipLink).not.toHaveAttribute('inert', '');

    const drawer = page.getByRole('dialog', { name: /sign-in help/i });
    await expect(async () => {
      if (!(await drawer.isVisible())) {
        await helpTrigger.click();
      }
      await expect(drawer).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });
    await expect(skipLink).toHaveAttribute('inert', '');
    await expect(loginForm).toHaveAttribute('inert', '');

    const closeBtn = page.getByRole('button', { name: /close help drawer/i });
    const gotItBtn = page.getByRole('button', { name: /got it, thanks/i });
    await expect(closeBtn).toBeFocused();

    // Blur to document.body and verify real keyboard Tab recovers focus into the active modal
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    });
    const activeTagAfterBlur = await page.evaluate(() => document.activeElement?.tagName);
    expect(activeTagAfterBlur).toBe('BODY');

    await page.keyboard.press('Tab');
    await expect(closeBtn).toBeFocused();

    // Shift+Tab wraps inside the drawer without escaping to skip-link or background form
    await page.keyboard.press('Shift+Tab');
    await expect(gotItBtn).toBeFocused();

    await page.screenshot({ path: '/tmp/guest-help-drawer-focus.png', animations: 'disabled' });

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(skipLink).not.toHaveAttribute('inert', '');
    await expect(loginForm).not.toHaveAttribute('inert', '');
    await expect(helpTrigger).toBeFocused();
  });

  test('recovers focus on Tab after clicking photo preview in /photos lightbox and preserves Arrow keys', async ({
    context,
    page,
  }) => {
    await context.route(/cdn\.jsdelivr\.net/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
    );
    await context.route(/googleusercontent\.com/, (route) =>
      route.fulfill({ status: 200, contentType: 'image/jpeg', body: VALID_JPEG })
    );
    await seedGuestAuthCookies(context);

    page = await gotoWithRetry(
      context,
      page,
      '/photos',
      seedGuestAuthCookies,
      async (activePage) => {
        expect(new URL(activePage.url()).pathname).toBe('/photos');
        await activePage.locator('[data-hydrated="true"]').waitFor({ timeout: 15000 });
        await expect(activePage.getByTestId('photo-thumbnail-0')).toBeVisible({ timeout: 15000 });
      }
    );

    const firstThumb = page.getByTestId('photo-thumbnail-0');
    await firstThumb.click();

    const dialog = page.getByRole('dialog', { name: 'Photo Preview' });
    await expect(dialog).toBeVisible();
    await expect(page.locator('a.skip-link')).toHaveAttribute('inert', '');
    await expect(page.getByTestId('photo-gallery-tabs')).toHaveAttribute('inert', '');

    const closeBtn = page.getByTestId('lightbox-close-btn');
    await expect(closeBtn).toBeFocused();

    // Click the non-interactive photo preview and press Tab -> focus stays inside the lightbox
    await page.getByTestId('lightbox-image').click();
    await page.keyboard.press('Tab');
    await expect(closeBtn).toBeFocused();

    // Verify ArrowRight / ArrowLeft keyboard navigation still works
    await expect(page.getByTestId('lightbox-counter')).toContainText('1 /');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('lightbox-counter')).toContainText('2 /');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('lightbox-counter')).toContainText('1 /');

    await page.screenshot({ path: '/tmp/lightbox-focus-containment.png', animations: 'disabled' });

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.locator('a.skip-link')).not.toHaveAttribute('inert', '');
    await expect(firstThumb).toBeFocused();
  });

  test('maintains focus inside /registry contribution modal across Verify, Clear, and Submit transitions', async ({
    context,
    page,
  }) => {
    await seedGuestAuthCookies(context);

    const mockGiftItem = {
      id: 'focus-test-gift-1',
      name: 'Espresso Machine Group Gift',
      description: 'Barista-grade espresso machine for morning coffee together.',
      price: 300,
      amountContributed: 50,
      quantity: 1,
      purchased: false,
      isGroupGift: true,
      isSample: false,
      itemType: 'PHYSICAL',
      category: 'Kitchen',
      vendorUrl: 'https://example.com/espresso',
      contributors: [],
      image: {
        id: 'media-espresso-1',
        url: '/images/placeholder.png',
        altText: 'Espresso machine',
        isDecorative: false,
      },
    };

    await context.route('**/api/registry/session**', (route) => {
      if (route.request().method() === 'DELETE') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ isVerified: false }),
      });
    });

    await context.route('**/api/registry/validate-code**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ valid: true, guestName: 'Jordan Taylor', code: 'GOOD12' }),
      })
    );

    await context.route('**/api/registry/contribute**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          item: { ...mockGiftItem, amountContributed: 100 },
        }),
      })
    );

    await context.route('**/api/registry/items**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [mockGiftItem],
          total: 1,
          page: 1,
          limit: 1000,
          totalPages: 1,
        }),
      })
    );

    page = await gotoWithRetry(
      context,
      page,
      '/registry',
      seedGuestAuthCookies,
      async (activePage) => {
        expect(new URL(activePage.url()).pathname).toBe('/registry');
        await expect(activePage.getByText('Espresso Machine Group Gift').first()).toBeVisible({
          timeout: 20000,
        });
      }
    );

    const cardHeading = page.getByText('Espresso Machine Group Gift').first();
    await cardHeading.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page.locator('a.skip-link')).toHaveAttribute('inert', '');

    const codeInput = dialog.getByPlaceholder('ABCDEF12');
    await codeInput.fill('GOOD12');
    await dialog.getByRole('button', { name: 'Verify' }).click();

    const clearBtn = dialog.getByRole('button', { name: 'Clear' });
    await expect(clearBtn).toBeFocused();

    await clearBtn.click();
    await expect(codeInput).toBeFocused();

    await dialog.getByPlaceholder('Jane Doe').fill('Jordan Taylor');
    await dialog.getByRole('button', { name: '$50' }).click();
    await dialog.getByRole('button', { name: 'Submit Contribution' }).click();

    const doneBtn = dialog.getByRole('button', { name: 'Done' });
    await expect(doneBtn).toBeFocused();

    await page.screenshot({ path: '/tmp/registry-modal-focus.png', animations: 'disabled' });

    await doneBtn.click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('a.skip-link')).not.toHaveAttribute('inert', '');
  });

  test('moves focus cleanly across all 4 steps of CsvImportWizardModal on /admin/dashboard/invitation-codes', async ({
    context,
    page,
  }) => {
    test.setTimeout(90000);
    await seedAdminAndGuestAuthCookies(context);

    await context.route('**/api/admin/invitation-codes/validate', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          summary: {
            total: 1,
            validCount: 1,
            invalidCount: 0,
            duplicateCount: 0,
            updatedCount: 0,
            skippedCount: 0,
            createdCount: 1,
          },
          rows: [
            {
              rowIndex: 1,
              guestName: 'Morgan Avery',
              code: 'MORG2026',
              isValid: true,
              errors: [],
              warnings: [],
              isDuplicate: false,
              actionOutcome: 'create',
            },
          ],
        }),
      })
    );

    await context.route('**/api/admin/invitation-codes/batch', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          count: 1,
          imported: 1,
          skipped: 0,
          updated: 0,
        }),
      })
    );

    page = await gotoWithRetry(
      context,
      page,
      '/admin/dashboard/invitation-codes',
      seedAdminAndGuestAuthCookies,
      async (activePage) => {
        expect(new URL(activePage.url()).pathname).toBe('/admin/dashboard/invitation-codes');
        await activePage.setViewportSize({ width: 1280, height: 1000 });
        await expect(activePage.getByRole('button', { name: 'Import CSV' })).toBeVisible({
          timeout: 25000,
        });
      }
    );

    const importBtn = page.getByRole('button', { name: 'Import CSV' });
    await importBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page.locator('a.skip-link')).toHaveAttribute('inert', '');

    // Step 1 initial focus lands on visible upload control (skipping hidden file input)
    const uploadControl = dialog.getByRole('button', { name: /Click to select CSV file/i });
    await expect(uploadControl).toBeFocused();

    // Step 1 -> Step 2
    await dialog.locator('#csv-file-input').setInputFiles({
      name: 'guests.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('Guest Name,Invitation Code\nMorgan Avery,MORG2026\n', 'utf-8'),
    });

    const mapGuestNameSelect = dialog.locator('#map-guest-name');
    await expect(mapGuestNameSelect).toBeFocused();

    // Step 2 -> Step 3
    await dialog.getByRole('button', { name: /Continue to Review/i }).click();
    const statusFilterSelect = dialog.locator('#status-filter-select');
    await expect(statusFilterSelect).toBeFocused();

    // Step 3 -> Step 4
    const commitBtn = dialog.getByRole('button', { name: /Commit Import/i });
    await expect(commitBtn).toBeEnabled();
    await commitBtn.click();

    const closeWizardBtn = dialog.getByRole('button', { name: 'Close Wizard' });
    await expect(closeWizardBtn).toBeFocused();

    await page.screenshot({ path: '/tmp/csv-wizard-focus.png', animations: 'disabled' });

    await closeWizardBtn.click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('a.skip-link')).not.toHaveAttribute('inert', '');
  });
});
