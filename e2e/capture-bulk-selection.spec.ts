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

test('capture bulk selection toolbar and batch delete modal screenshots', async ({ context, page }) => {
  await context.addCookies([
    { name: 'admin_auth', value: generateAdminCookieValue(), url: 'http://127.0.0.1:3000' },
    { name: 'guest_auth', value: generateGuestCookieValue(), url: 'http://127.0.0.1:3000' },
    { name: 'admin_auth', value: generateAdminCookieValue(), url: 'http://localhost:3000' },
    { name: 'guest_auth', value: generateGuestCookieValue(), url: 'http://localhost:3000' },
  ]);

  // Go to invitation codes dashboard
  try {
    await page.goto('/admin/dashboard/invitation-codes', { waitUntil: 'domcontentloaded' });
  } catch {
    await page.waitForTimeout(1000);
    await page.goto('/admin/dashboard/invitation-codes', { waitUntil: 'domcontentloaded' });
  }

  // Wait for page to finish loading data
  await expect(page.getByRole('heading', { name: 'Pre-Authorized Guest Invitation Codes' })).toBeVisible({ timeout: 15000 });

  // Check if there are codes. If none, click Generate New Code first to create a couple.
  const generateBtn = page.getByRole('button', { name: 'Generate New Code' });
  const countBtn = page.getByRole('tab', { name: /^All \(\d+\)$/ });
  await countBtn.waitFor({ state: 'visible', timeout: 15000 });
  const countText = await countBtn.innerText();
  if (countText.includes('All (0)')) {
    // Generate code 1
    await generateBtn.click();
    await expect(page.getByRole('heading', { name: 'Generate Invitation Code' })).toBeVisible({ timeout: 15000 });
    await page.getByPlaceholder('e.g. John Doe').fill('Alex Johnson');
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await expect(page.getByText('Alex Johnson')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'Generate Invitation Code' })).toBeHidden({ timeout: 15000 });

    // Generate code 2
    await generateBtn.click();
    await expect(page.getByRole('heading', { name: 'Generate Invitation Code' })).toBeVisible({ timeout: 15000 });
    await page.getByPlaceholder('e.g. John Doe').fill('Sam Taylor');
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await expect(page.getByText('Sam Taylor')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'Generate Invitation Code' })).toBeHidden({ timeout: 15000 });
  }

  // Select all filtered items
  const selectAll = page.getByRole('checkbox', { name: 'Select all filtered invitation codes' });
  await expect(selectAll).toBeVisible({ timeout: 15000 });
  await selectAll.check();

  const toolbar = page.getByRole('region', { name: 'Batch actions toolbar' });
  await expect(toolbar).toBeVisible({ timeout: 15000 });

  await page.screenshot({ path: '/tmp/bulk-selection-toolbar.png', fullPage: true });

  // Open Batch Delete Modal
  const deleteBtn = page.getByRole('button', { name: 'Delete Selected' });
  await expect(deleteBtn).toBeVisible({ timeout: 15000 });
  await deleteBtn.click();

  const modal = page.getByRole('dialog', { name: 'Confirm Batch Deletion' });
  await expect(modal).toBeVisible({ timeout: 15000 });

  await page.screenshot({ path: '/tmp/batch-delete-modal.png', fullPage: true });
});
