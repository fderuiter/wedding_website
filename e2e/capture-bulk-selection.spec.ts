import { test, expect } from '@playwright/test';
import { seedAdminAndGuestAuthCookies } from './helpers/auth';

test('capture bulk selection toolbar and batch delete modal screenshots', async ({ context, page }, testInfo) => {
  test.setTimeout(90000);

  const { adminCookieValue } = await seedAdminAndGuestAuthCookies(context);
  const createdIds: string[] = [];
  let createdTemporaryCodes = false;

  try {
    // Go to invitation codes dashboard
    await page.goto('/admin/dashboard/invitation-codes', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Pre-Authorized Guest Invitation Codes' })).toBeVisible({ timeout: 30000 });

    // Check if there are codes. If none, click Generate New Code first to create a couple.
    const generateBtn = page.getByRole('button', { name: 'Generate New Code' });
    const countBtn = page.getByRole('tab', { name: /^All \(\d+\)$/ }).or(page.getByRole('button', { name: /^All \(\d+\)$/ })).first();
    await expect(countBtn).toBeVisible({ timeout: 30000 });
    const countText = await countBtn.innerText();
    if (countText.includes('All (0)')) {
      createdTemporaryCodes = true;
      for (const guestName of ['Alex Johnson', 'Sam Taylor']) {
        await generateBtn.click();
        await expect(page.getByRole('heading', { name: 'Generate Invitation Code' })).toBeVisible({ timeout: 30000 });
        await page.getByPlaceholder('e.g. John Doe').fill(guestName);
        const [createRes] = await Promise.all([
          page.waitForResponse(
            (res) =>
              res.url().includes('/api/admin/invitation-codes') &&
              res.request().method() === 'POST'
          ),
          page.getByRole('button', { name: 'Generate', exact: true }).click(),
        ]);
        const createJson = await createRes.json().catch(() => null);
        const createdId = createJson?.data?.id ?? createJson?.id;
        if (typeof createdId === 'string' && createdId.length > 0) {
          createdIds.push(createdId);
        }
        await expect(page.getByRole('heading', { name: 'Generate Invitation Code' })).toBeHidden({ timeout: 30000 });
        await expect(page.getByText(guestName)).toBeVisible({ timeout: 30000 });
      }
    }

    // Select all filtered items
    const selectAll = page.getByRole('checkbox', { name: 'Select all filtered invitation codes' });
    await expect(selectAll).toBeVisible({ timeout: 15000 });
    await selectAll.check();

    const toolbar = page.getByRole('region', { name: 'Batch actions toolbar' });
    await expect(toolbar).toBeVisible({ timeout: 15000 });

    await page.screenshot({
      path: testInfo.outputPath('bulk-selection-toolbar.png'),
      fullPage: true,
      animations: 'disabled',
    });

    // Open Batch Delete Modal
    const deleteBtn = page.getByRole('button', { name: 'Delete Selected' });
    await expect(deleteBtn).toBeVisible({ timeout: 15000 });
    await deleteBtn.click();

    const modal = page.getByRole('alertdialog', { name: 'Confirm Batch Deletion' });
    await expect(modal).toBeVisible({ timeout: 15000 });

    await page.screenshot({
      path: testInfo.outputPath('batch-delete-modal.png'),
      fullPage: true,
      animations: 'disabled',
    });
  } finally {
    if (createdTemporaryCodes) {
      const headers = { Cookie: `admin_auth=${adminCookieValue}` };
      const idsToDelete = new Set<string>(createdIds);
      const listRes = await context.request.get('/api/admin/invitation-codes?limit=100', { headers });
      if (listRes.ok()) {
        const payload = (await listRes.json()) as
          | Array<{ id: string; guestName?: string; isSample?: boolean }>
          | { data?: Array<{ id: string; guestName?: string; isSample?: boolean }> };
        const records = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.data)
            ? payload.data
            : [];
        for (const r of records) {
          if (!r.isSample && (r.guestName === 'Alex Johnson' || r.guestName === 'Sam Taylor')) {
            idsToDelete.add(r.id);
          }
        }
      }
      if (idsToDelete.size > 0) {
        await context.request.delete('/api/admin/invitation-codes/batch', {
          headers: { ...headers, 'Content-Type': 'application/json' },
          data: { ids: Array.from(idsToDelete) },
        });
      }
    }
  }
});
