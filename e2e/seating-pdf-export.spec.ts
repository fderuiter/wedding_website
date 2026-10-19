import { test, expect } from '@playwright/test';

test('seating chart admin dashboard has Export Visual PDF button', async ({ page }) => {
  // Guest login if required
  await page.goto('/guest/login', { waitUntil: 'domcontentloaded' });
  const guestInput = page.locator('input[type="password"]');
  if (await guestInput.isVisible()) {
    await guestInput.fill('wedding2026');
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(500);
  }

  // Admin login
  await page.goto('/admin/login', { waitUntil: 'domcontentloaded' });
  const adminInput = page.locator('#password');
  if (await adminInput.isVisible()) {
    await adminInput.fill('wedding123');
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(1000);
  }

  // Navigate to Seating Chart Dashboard
  await page.goto('/admin/dashboard/seating-chart', { waitUntil: 'domcontentloaded' });

  // Verify dashboard header and PDF export button
  const pdfExportBtn = page.getByRole('link', { name: 'Export Visual PDF' });
  await expect(pdfExportBtn).toBeVisible({ timeout: 15000 });
  await expect(pdfExportBtn).toHaveAttribute('href', '/api/admin/seating/export?format=pdf');

  // Take screenshot for PR verification
  await page.screenshot({ path: '/tmp/seating-dashboard-pdf-export.png', fullPage: true });
});
