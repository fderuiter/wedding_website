import { test, expect } from '@playwright/test';
import crypto from 'crypto';

function generateAdminCookieValue() {
  const secret = process.env.ADMIN_PASSWORD || 'scrypt:c2FsdA==:aGFzaA==';
  const payload = {
    isAdmin: true,
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

test('seating chart admin dashboard has Export Visual PDF button', async ({ context, page }) => {
  const origins = ['http://127.0.0.1:3000', 'http://localhost:3000'];
  const cookies = origins.flatMap((url) => [
    {
      name: 'admin_auth',
      value: generateAdminCookieValue(),
      url,
    },
    {
      name: 'guest_auth',
      value: generateGuestCookieValue(),
      url,
    },
  ]);
  await context.addCookies(cookies);

  // Navigate to Seating Chart Dashboard
  await page.goto('/admin/dashboard/seating-chart', { waitUntil: 'domcontentloaded' });

  // Verify dashboard header and PDF export button
  const pdfExportBtn = page.getByRole('link', { name: 'Export Visual PDF' });
  await expect(pdfExportBtn).toBeVisible({ timeout: 15000 });
  await expect(pdfExportBtn).toHaveAttribute('href', '/api/admin/seating/export?format=pdf');

  // Take screenshot for PR verification
  await page.screenshot({ path: '/tmp/seating-dashboard-pdf-export.png', fullPage: true });
});
