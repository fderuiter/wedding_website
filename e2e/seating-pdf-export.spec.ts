import { test, expect } from '@playwright/test';
import { seedAdminAndGuestAuthCookies } from './helpers/auth';

test('seating chart admin dashboard has Export Visual PDF button', async ({ context, page }) => {
  await seedAdminAndGuestAuthCookies(context);

  // Navigate to Seating Chart Dashboard
  try {
    await page.goto('/admin/dashboard/seating-chart', { waitUntil: 'domcontentloaded' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('crashed') || msg.includes('closed') || msg.includes('net::ERR_ABORTED')) {
      await seedAdminAndGuestAuthCookies(context).catch(() => {});
      page = await context.newPage();
      await page.goto('/admin/dashboard/seating-chart', { waitUntil: 'domcontentloaded', timeout: 30000 });
    } else {
      throw err;
    }
  }

  // Verify dashboard header and PDF export button
  const pdfExportBtn = page.getByRole('link', { name: 'Export Visual PDF' });
  await expect(pdfExportBtn).toBeVisible({ timeout: 15000 });
  await expect(pdfExportBtn).toHaveAttribute('href', '/api/admin/seating/export?format=pdf');

  // Take screenshot for PR verification
  await page.screenshot({ path: '/tmp/seating-dashboard-pdf-export.png', fullPage: true });
});
