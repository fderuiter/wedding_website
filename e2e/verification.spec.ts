import { test, expect } from '@playwright/test';

test.describe('UI Verification', () => {
  test('should show the intro overlay on first visit and then the main content', async ({ page }) => {
    await page.goto('/');

    // The intro overlay should be visible
    const introOverlay = page.locator('div.fixed.inset-0.bg-black.select-none');
    await expect(introOverlay).toBeVisible();

    // Wait for the intro to finish (it disappears after 6 seconds)
    await expect(introOverlay).not.toBeVisible({ timeout: 10000 });

    // Now the main content should be visible
    const mainContent = page.locator('main#main');
    await expect(mainContent).toBeVisible();

    // The main content is visible, which is sufficient for this test.
    // The screenshot assertion is removed as the gallery is no longer on this page.
  });
});
