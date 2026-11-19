import { test, expect } from '@playwright/test';
import { seedAdminAndGuestAuthCookies } from './helpers/auth';

test('capture bulk selection toolbar and batch delete modal screenshots', async ({ context, page }) => {
  test.setTimeout(90000);

  await seedAdminAndGuestAuthCookies(context);

  // Go to invitation codes dashboard
  let attempt = 0;
  while (attempt < 4) {
    attempt++;
    try {
      await page.goto('/admin/dashboard/invitation-codes', { waitUntil: 'domcontentloaded', timeout: 25000 });
      await expect(page.getByRole('heading', { name: 'Pre-Authorized Guest Invitation Codes' })).toBeVisible({ timeout: 30000 });
      break;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        attempt < 4 &&
        (msg.includes('crashed') ||
         msg.includes('closed') ||
         msg.includes('Timeout') ||
         msg.includes('timeout') ||
         msg.includes('net::ERR_ABORTED'))
      ) {
        console.log(`[capture-bulk-selection] Retry attempt ${attempt} due to: ${msg.slice(0, 80)}`);
        await page.close().catch(() => {});
        await seedAdminAndGuestAuthCookies(context).catch(() => {});
        page = await context.newPage();
      } else {
        throw err;
      }
    }
  }

  // Wait for page to finish loading data
  await page.waitForResponse(resp => resp.url().includes('/api/admin/invitation-codes') && resp.status() === 200, { timeout: 15000 }).catch(() => {});
  // Check if there are codes. If none, click Generate New Code first to create a couple.
  const generateBtn = page.getByRole('button', { name: 'Generate New Code' });
  const countBtn = page.getByRole('tab', { name: /^All \(\d+\)$/ }).or(page.getByRole('button', { name: /^All \(\d+\)$/ })).first();
  await countBtn.waitFor({ state: 'visible', timeout: 30000 });
  const countText = await countBtn.innerText();
  if (countText.includes('All (0)')) {
    // Generate code 1
    await generateBtn.click();
    await expect(page.getByRole('heading', { name: 'Generate Invitation Code' })).toBeVisible({ timeout: 30000 });
    await page.getByPlaceholder('e.g. John Doe').fill('Alex Johnson');
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Generate Invitation Code' })).toBeHidden({ timeout: 30000 });
    await expect(page.getByText('Alex Johnson')).toBeVisible({ timeout: 30000 });

    // Generate code 2
    await generateBtn.click();
    await expect(page.getByRole('heading', { name: 'Generate Invitation Code' })).toBeVisible({ timeout: 30000 });
    await page.getByPlaceholder('e.g. John Doe').fill('Sam Taylor');
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Generate Invitation Code' })).toBeHidden({ timeout: 30000 });
    await expect(page.getByText('Sam Taylor')).toBeVisible({ timeout: 30000 });
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
