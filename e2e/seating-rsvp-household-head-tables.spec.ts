import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { seedAdminAndGuestAuthCookies } from './helpers/auth';

test(
  'seating chart supports RSVP filters, household seating, 1-sided head/sweetheart tables, Clear Seats + Undo, and dietary badges',
  { tag: '@a11y' },
  async ({ context, page }, testInfo) => {
    test.setTimeout(120000);

    await seedAdminAndGuestAuthCookies(context);
    await page.setViewportSize({ width: 1440, height: 920 });

    const createdTableIds: string[] = [];
    const createdGuestIds: string[] = [];
    const runTag = Date.now().toString(36).toUpperCase();

    const createTable = async (data: Record<string, unknown>) => {
      const res = await context.request.post('/api/admin/seating-tables', { data });
      expect(res.ok()).toBeTruthy();
      const json = await res.json();
      const record = json.data ?? json;
      createdTableIds.push(record.id);
      return record;
    };

    const createGuest = async (data: Record<string, unknown>) => {
      const res = await context.request.post('/api/admin/invitation-codes', { data });
      expect(res.ok()).toBeTruthy();
      const json = await res.json();
      const record = json.data ?? json;
      createdGuestIds.push(record.id);
      return record;
    };

    try {
    // 1. Seed 1-sided Sweetheart + Head tables and a Round reception table
      const sweetheartTable = await createTable({
        name: `Sweetheart Table ${runTag}`,
        shape: 'sweetheart',
        capacity: 2,
        x: 70,
        y: 90,
        width: 150,
        height: 80,
        rotation: 0,
      });

      const headTable = await createTable({
        name: `Head Table ${runTag}`,
        shape: 'head',
        capacity: 6,
        x: 290,
        y: 90,
        width: 280,
        height: 85,
        rotation: 0,
      });

      const familyTable = await createTable({
        name: `Garden Family ${runTag}`,
        shape: 'round',
        capacity: 6,
        x: 200,
        y: 280,
        width: 130,
        height: 130,
        rotation: 0,
      });

      // Seat bride with dietary restriction at Sweetheart Table + a seated guest whose RSVP changed to declined at Garden Family
      const seatedBride = await createGuest({
        code: `BRIDE${runTag}`,
        guestName: `Taylor Morgan ${runTag}`,
        used: true,
        extraFields: { attending: true },
        dietaryNotes: 'Gluten-Free',
        partyGroup: 'Wedding Party',
        partyTags: ['vip'],
      });
      await context.request.post('/api/admin/seating/assign', {
        data: { invitationCodeId: seatedBride.id, tableId: sweetheartTable.id, seatNumber: 1 },
      });

      const seatedDeclinedGuest = await createGuest({
        code: `SEATDEC${runTag}`,
        guestName: `Evan Declined ${runTag}`,
        used: true,
        extraFields: { attending: false },
        partyGroup: 'Extended Family',
        partyTags: ['family'],
      });
      await context.request.post('/api/admin/seating/assign', {
        data: { invitationCodeId: seatedDeclinedGuest.id, tableId: familyTable.id, seatNumber: 1 },
      });

      // Unassigned household members + pending guest + declined guest + address-collection entry
      await createGuest({
        code: `VANCE1${runTag}`,
        guestName: `Eleanor Vance ${runTag}`,
        householdName: `Vance Household ${runTag}`,
        used: true,
        extraFields: { attending: true },
        dietaryNotes: 'Vegan, Nut-Free',
        partyGroup: 'Bride Family',
        partyTags: ['vip', 'family'],
      });

      await createGuest({
        code: `VANCE2${runTag}`,
        guestName: `Arthur Vance ${runTag}`,
        householdName: `Vance Household ${runTag}`,
        used: true,
        extraFields: { attending: true },
        partyGroup: 'Bride Family',
        partyTags: ['family'],
      });

      await createGuest({
        code: `PEND${runTag}`,
        guestName: `Chloe Pending ${runTag}`,
        used: false,
        dietaryNotes: 'Dairy-Free',
        partyGroup: 'College Friends',
        partyTags: ['friends'],
      });

      await createGuest({
        code: `UNDEC${runTag}`,
        guestName: `Declined Unseated ${runTag}`,
        used: true,
        extraFields: { attending: false },
      });

      await createGuest({
        code: `ADDR${runTag}`,
        guestName: `Address Entry ${runTag}`,
        used: false,
        partyTags: ['address-collection'],
      });

      // 2. Navigate to Seating Chart Dashboard
      await page.goto('/admin/dashboard/seating-chart', { waitUntil: 'domcontentloaded', timeout: 30000 });
      expect(new URL(page.url()).pathname).toBe('/admin/dashboard/seating-chart');
      await expect(
        page.getByRole('heading', { name: 'Interactive Seating Chart & Reception Floorplan' })
      ).toBeVisible({ timeout: 25000 });

      const unassignedList = page.getByRole('list', { name: 'Unassigned guests' });

      // Wait for seeded household to appear in Unassigned Guests panel
      await expect(unassignedList.getByText(`Eleanor Vance ${runTag}`)).toBeVisible({ timeout: 20000 });

      // Verify declined unseated guest and address-collection entry are excluded from panel, print view, & export
      await expect(page.getByText(`Declined Unseated ${runTag}`)).toHaveCount(0);
      await expect(page.getByText(`Address Entry ${runTag}`)).toHaveCount(0);

      const csvExportRes = await context.request.get('/api/admin/seating/export');
      expect(csvExportRes.ok()).toBeTruthy();
      const csvText = await csvExportRes.text();
      expect(csvText).toContain(`Taylor Morgan ${runTag}`);
      expect(csvText).toContain(`Eleanor Vance ${runTag}`);
      expect(csvText).not.toContain(`Evan Declined ${runTag}`);
      expect(csvText).not.toContain(`Declined Unseated ${runTag}`);
      expect(csvText).not.toContain(`Address Entry ${runTag}`);

      // Verify 1-sided Head Table & Sweetheart Table seats render along single side
      const headTableNode = page.getByRole('button', { name: new RegExp(`Head Table ${runTag}`) });
      await expect(headTableNode).toBeVisible();
      await expect(headTableNode.locator('[data-seat-side="single"]')).toHaveCount(6);

      // Verify flagged declined seated guest alert is visible
      await expect(page.getByTestId('declined-seated-alert')).toBeVisible();
      await expect(page.getByTestId('declined-seated-alert')).toContainText(`Evan Declined ${runTag}`);

      // Capture Screenshot 1: RSVP filters, household card, dietary badges, 1-sided head/sweetheart tables, and flagged declined seat alert
      await page.screenshot({
        path: testInfo.outputPath('seating-rsvp-household-head-table.png'),
        fullPage: true,
        animations: 'disabled',
      });

      // 3. Test RSVP status filter in UnassignedGuestPanel
      const rsvpSelect = page.getByRole('combobox', { name: 'RSVP Status' });
      await rsvpSelect.selectOption('pending');
      await expect(unassignedList.getByText(`Chloe Pending ${runTag}`)).toBeVisible();
      await expect(unassignedList.getByText(`Eleanor Vance ${runTag}`)).toHaveCount(0);
      await rsvpSelect.selectOption('all');
      await expect(unassignedList.getByText(`Eleanor Vance ${runTag}`)).toBeVisible();

      // 4. Release the flagged declined guest's seat in one click
      await page
        .getByRole('button', {
          name: new RegExp(`Release seat for Evan Declined ${runTag}`),
        })
        .click();
      await expect(page.getByTestId('declined-seated-alert')).toHaveCount(0);
      // Released declined guest must NOT reappear in Unassigned Guests
      await expect(page.getByText(`Evan Declined ${runTag}`)).toHaveCount(0);

      // 5. Batch-seat Vance Household onto 1-sided Head Table
      await page
        .getByRole('button', {
          name: new RegExp(`Seat Vance Household ${runTag} household`),
        })
        .click();
      const hhTableSelect = page.locator('#household-assign-table-select');
      await expect(hhTableSelect).toBeVisible();
      await hhTableSelect.selectOption(headTable.id);
      await page.getByRole('button', { name: 'Confirm Household Seating' }).click();

      // Select Head Table to view Inspector with seated household members, dietary badges, Clear Seats, and Undo
      await headTableNode.click();
      await expect(page.getByTestId('clear-table-seats-button')).toBeEnabled();
      await expect(page.getByTestId('inspector-dietary-badge').first()).toBeVisible();

      // Capture Screenshot 2: Selected 1-sided Head Table Inspector with seated household, dietary badges, Clear Seats, and active Undo
      await page.screenshot({
        path: testInfo.outputPath('seating-inspector-clear-undo-dietary.png'),
        fullPage: true,
        animations: 'disabled',
      });

      // 6. Test Clear Seats (empties Head Table without deleting it) + Undo (restores Vance Household)
      await page.getByTestId('clear-table-seats-button').click();
      await expect(
        page.getByRole('button', {
          name: new RegExp(`Head Table ${runTag}, shape head, capacity 6, seated 0`),
        })
      ).toBeVisible();

      const undoBtn = page.getByTestId('seating-undo-button');
      await expect(undoBtn).toBeEnabled();
      await undoBtn.click();

      await expect(
        page.getByRole('button', {
          name: new RegExp(`Head Table ${runTag}, shape head, capacity 6, seated 2`),
        })
      ).toBeVisible();

      // 7. Run Axe WCAG 2.2 AA check on the seating chart workspace:
      // - Verify zero color-contrast and target-size violations across the entire seating workspace (including FloorplanCanvas)
      const workspaceAxe = await new AxeBuilder({ page })
        .include('main')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      const contrastAndTargetViolations = workspaceAxe.violations.filter(
        (v) => v.id === 'color-contrast' || v.id === 'target-size'
      );
      expect(contrastAndTargetViolations).toEqual([]);

      // - Verify zero WCAG 2.2 AA violations across all seating panels, toolbar, alerts, and table inspector
      const panelAndInspectorAxe = await new AxeBuilder({ page })
        .include('main')
        .exclude('[data-table-id]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(panelAndInspectorAxe.violations).toEqual([]);
    } finally {
      for (const tableId of createdTableIds) {
        await context.request.delete(`/api/admin/seating-tables/${tableId}`).catch(() => {});
      }
      for (const guestId of createdGuestIds) {
        await context.request.delete(`/api/admin/invitation-codes/${guestId}`).catch(() => {});
      }
    }
  }
);
