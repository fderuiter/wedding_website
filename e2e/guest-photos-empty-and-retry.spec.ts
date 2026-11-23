import { test, expect } from '@playwright/test';
import { seedGuestAuthCookies } from './helpers/auth';

test.describe('Guest Photos Empty State', { tag: '@smoke' }, () => {
  test('displays guest photos empty state container when no guest photos exist', async ({ context, page }, testInfo) => {
    const validJpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
    await context.route(/cdn\.jsdelivr\.net/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    await context.route(/googleusercontent\.com/, (route) => route.fulfill({ status: 200, contentType: 'image/jpeg', body: validJpeg }));
    await seedGuestAuthCookies(context);

    await page.goto('/photos', { waitUntil: 'domcontentloaded' });
    expect(new URL(page.url()).pathname).toBe('/photos');

    // Wait for client-side hydration
    await expect(page.locator('[data-hydrated="true"]')).toBeAttached({ timeout: 15000 });

    // Switch to Guest tab to view guest empty state
    await page.locator('[data-testid="tab-guest"]').click();

    // Verify empty state container is rendered
    const emptyState = page.locator('[data-testid="guest-photos-empty-state"]');
    await expect(emptyState).toBeVisible();
    await emptyState.screenshot({
      path: testInfo.outputPath('photos_empty_state.png'),
      animations: 'disabled',
    });
  });

  test('opens Guest Uploads tab directly via /photos?tab=guest, stages files before upload, and resets caption after confirming', async ({ context, page }) => {
    const validJpeg = Buffer.from('/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABykX//Z', 'base64');
    await context.route(/cdn\.jsdelivr\.net/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    await context.route(/googleusercontent\.com/, (route) => route.fulfill({ status: 200, contentType: 'image/jpeg', body: validJpeg }));
    await seedGuestAuthCookies(context);

    let uploadRequests = 0;
    await page.route('**/api/guest/photos/upload', async (route) => {
      uploadRequests += 1;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            {
              id: 'e2e-media-1',
              nodeId: 'e2e-node-1',
              url: '/uploads/photos/e2e-staged.jpg',
              title: 'Cheers from Table 2!',
              caption: 'Cheers from Table 2!',
              uploaderName: 'Elena Rivera',
              status: 'PENDING',
              isVisible: false,
            },
          ],
        }),
      });
    });

    await page.goto('/photos?tab=guest', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-hydrated="true"]')).toBeAttached({ timeout: 15000 });

    // Guest tab and dropzone are immediately visible without manual tab switching
    await expect(page.getByTestId('tab-guest')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('guest-photo-dropzone')).toBeVisible();

    // Select file first -> staged without network transfer
    await page.getByTestId('guest-photo-file-input').setInputFiles({
      name: 'table-toast.jpg',
      mimeType: 'image/jpeg',
      buffer: validJpeg,
    });
    await expect(page.getByTestId('staged-uploads-bar')).toBeVisible();
    expect(uploadRequests).toBe(0);

    // Fill attribution after selecting file, then confirm upload
    await page.getByTestId('guest-photo-uploader-name').fill('Elena Rivera');
    await page.getByTestId('guest-photo-caption').fill('Cheers from Table 2!');
    await page.getByTestId('confirm-upload-btn').click();

    await expect(page.getByTestId('upload-pending-notice')).toBeVisible();
    expect(uploadRequests).toBe(1);
    await expect(page.getByTestId('guest-photo-uploader-name')).toHaveValue('Elena Rivera');
    await expect(page.getByTestId('guest-photo-caption')).toHaveValue('');
  });
});
