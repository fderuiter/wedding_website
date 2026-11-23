import { test, expect } from '@playwright/test';
import { seedAdminAndGuestAuthCookies } from './helpers/auth';

test(
  'seating chart admin dashboard has Export Visual PDF button',
  { tag: '@smoke' },
  async ({ context, page }, testInfo) => {
    await seedAdminAndGuestAuthCookies(context);

    // Navigate to Seating Chart Dashboard
    await page.goto('/admin/dashboard/seating-chart', { waitUntil: 'domcontentloaded' });
    expect(new URL(page.url()).pathname).toBe('/admin/dashboard/seating-chart');

    // Verify dashboard header and PDF export button
    const pdfExportBtn = page.getByRole('link', { name: 'Export Visual PDF' });
    await expect(pdfExportBtn).toBeVisible({ timeout: 15000 });
    await expect(pdfExportBtn).toHaveAttribute('href', '/api/admin/seating/export?format=pdf');

    // Take screenshot for PR verification
    await page.screenshot({
      path: testInfo.outputPath('seating-dashboard-pdf-export.png'),
      fullPage: true,
      animations: 'disabled',
    });
  }
);
