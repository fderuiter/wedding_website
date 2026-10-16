import { test, expect } from '@playwright/test';

test('capture bulk selection toolbar and batch delete modal screenshots', async ({ page }) => {
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

  // Go to invitation codes dashboard
  await page.goto('/admin/dashboard/invitation-codes', { waitUntil: 'domcontentloaded' });

  // Wait for page to finish loading data
  await expect(page.getByRole('heading', { name: 'Pre-Authorized Guest Invitation Codes' })).toBeVisible({ timeout: 15000 });

  // Check if there are codes. If none, click Generate New Code first to create a couple.
  const generateBtn = page.getByRole('button', { name: 'Generate New Code' });
  const countBtn = page.getByRole('button', { name: /^All \(\d+\)$/ });
  const countText = await countBtn.innerText();
  if (countText.includes('All (0)')) {
    // Generate code 1
    await generateBtn.click();
    await page.getByPlaceholder('e.g. John Doe').fill('Alex Johnson');
    await page.getByRole('button', { name: 'Generate' }).click();
    await page.waitForTimeout(500);

    // Generate code 2
    await generateBtn.click();
    await page.getByPlaceholder('e.g. John Doe').fill('Sam Taylor');
    await page.getByRole('button', { name: 'Generate' }).click();
    await page.waitForTimeout(500);
  }

  // Select all filtered items
  const selectAll = page.getByRole('checkbox', { name: 'Select all filtered invitation codes' });
  await expect(selectAll).toBeVisible({ timeout: 10000 });
  await selectAll.check();

  const toolbar = page.getByRole('region', { name: 'Batch actions toolbar' });
  await expect(toolbar).toBeVisible();

  await page.screenshot({ path: '/tmp/bulk-selection-toolbar.png', fullPage: true });

  // Open Batch Delete Modal
  const deleteBtn = page.getByRole('button', { name: 'Delete Selected' });
  await expect(deleteBtn).toBeVisible();
  await deleteBtn.click();

  const modal = page.getByRole('dialog', { name: 'Confirm Batch Deletion' });
  await expect(modal).toBeVisible();

  await page.screenshot({ path: '/tmp/batch-delete-modal.png', fullPage: true });
});
