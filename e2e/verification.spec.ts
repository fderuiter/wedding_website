import { test, expect } from '@playwright/test';

test.describe('UI Verification', () => {
  test('should show the main content on visit', async ({ page }) => {
    await page.goto('/');

    // The main content should be visible
    const mainContent = page.locator('main#main');
    await expect(mainContent).toBeVisible();
  });
});
