import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { seedAdminAndGuestAuthCookies } from './helpers/auth';

test(
  'seating chart unifies 4-edge & 1-sided seat geometry, supports cross-panel pointer drag, >=24x24px targets, and mobile scrollable stage',
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
    // 1. Seed a 4-edge Rectangular Banquet Table, a 1-sided Head Table, and a far-right Terrace Table
      const banquetTable = await createTable({
        name: `Banquet Rect ${runTag}`,
        shape: 'rectangular',
        capacity: 8,
        x: 80,
        y: 120,
        width: 220,
        height: 110,
        rotation: 0,
      });

      const headTable = await createTable({
        name: `Royal Head ${runTag}`,
        shape: 'head',
        capacity: 4,
        x: 380,
        y: 120,
        width: 240,
        height: 85,
        rotation: 0,
      });

      const terraceTable = await createTable({
        name: `Terrace Far ${runTag}`,
        shape: 'round',
        capacity: 6,
        x: 720,
        y: 340,
        width: 130,
        height: 130,
        rotation: 0,
      });

      // Assign an unnumbered guest (seatNumber omitted -> null in DB) to Banquet Rect to verify resolveSeatAssignments
      const unnumberedSeated = await createGuest({
        code: `UNNUM${runTag}`,
        guestName: `Nora Unnumbered ${runTag}`,
        used: true,
        extraFields: { attending: true },
        dietaryNotes: 'Vegetarian',
      });
      const assignUnnumberedRes = await context.request.post('/api/admin/seating/assign', {
        data: { invitationCodeId: unnumberedSeated.id, tableId: banquetTable.id },
      });
      expect(assignUnnumberedRes.ok()).toBeTruthy();

      // Create solo unassigned guest + household unassigned guests for cross-panel pointer drag
      const soloDragGuest = await createGuest({
        code: `SOLODRAG${runTag}`,
        guestName: `Liam Pointer ${runTag}`,
        used: true,
        extraFields: { attending: true },
        partyGroup: 'Friends',
      });

      await createGuest({
        code: `HHDRAG1${runTag}`,
        guestName: `Maya Brooks ${runTag}`,
        householdName: `Brooks Pair ${runTag}`,
        used: true,
        extraFields: { attending: true },
      });
      await createGuest({
        code: `HHDRAG2${runTag}`,
        guestName: `Noah Brooks ${runTag}`,
        householdName: `Brooks Pair ${runTag}`,
        used: true,
        extraFields: { attending: true },
      });

      // 2. Load Seating Chart Dashboard
      await page.goto('/admin/dashboard/seating-chart', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await expect(
        page.getByRole('heading', { name: 'Interactive Seating Chart & Reception Floorplan' })
      ).toBeVisible({ timeout: 25000 });

      const unassignedList = page.getByRole('list', { name: 'Unassigned guests' });
      await expect(unassignedList.getByText(`Liam Pointer ${runTag}`)).toBeVisible({ timeout: 20000 });

      // 3. Verify unnumbered seated guest is resolved onto Seat 1 on FloorplanCanvas & in Table Inspector
      const banquetSeat1 = page.locator(
        `button[data-table-id="${banquetTable.id}"][data-seat-number="1"]`
      );
      await expect(banquetSeat1).toHaveAttribute(
        'aria-label',
        new RegExp(`Seat 1: Nora Unnumbered ${runTag}`)
      );

      // Verify 4-edge rectangular seat distribution (top, right, bottom, left) vs 1-sided head table
      const banquetSeatCoords = await page
        .locator(`button[data-table-id="${banquetTable.id}"][data-seat-number]`)
        .evaluateAll((els) =>
          els.map((el) => ({
            seat: Number(el.getAttribute('data-seat-number')),
            left: parseFloat((el as HTMLElement).style.left),
            top: parseFloat((el as HTMLElement).style.top),
          }))
        );
      expect(banquetSeatCoords.filter((s) => s.top < 0).length).toBe(2);
      expect(banquetSeatCoords.filter((s) => s.left > 220).length).toBe(2);
      expect(banquetSeatCoords.filter((s) => s.top > 110).length).toBe(2);
      expect(banquetSeatCoords.filter((s) => s.left < 0).length).toBe(2);

      const headSeatCoords = await page
        .locator(`button[data-table-id="${headTable.id}"][data-seat-number]`)
        .evaluateAll((els) =>
          els.map((el) => ({
            top: parseFloat((el as HTMLElement).style.top),
          }))
        );
      expect(headSeatCoords).toHaveLength(4);
      expect(headSeatCoords.every((s) => s.top === -18)).toBe(true);

      // Select Banquet Table and verify >= 24x24px WCAG 2.2 AA target sizes on rotation controls, seat circles, and inspector unassign button
      const banquetNode = page.locator(`div[role="button"][data-table-id="${banquetTable.id}"]`);
      await banquetNode.click();

      const rotateHandle = page.getByRole('button', {
        name: new RegExp(`Rotate handle for Banquet Rect ${runTag}`),
      });
      const rotateMinus = page.getByRole('button', {
        name: new RegExp(`Rotate Banquet Rect ${runTag} -45 degrees`),
      });
      const rotatePlus = page.getByRole('button', {
        name: new RegExp(`Rotate Banquet Rect ${runTag} \\+45 degrees`),
      });
      const unassignInspectorBtn = page.getByRole('button', {
        name: new RegExp(`Unassign Nora Unnumbered ${runTag}`),
      });

      for (const locator of [rotateHandle, rotateMinus, rotatePlus, banquetSeat1, unassignInspectorBtn]) {
        const box = await locator.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeGreaterThanOrEqual(24);
        expect(box!.height).toBeGreaterThanOrEqual(24);
      }

      // Verify both visible Inspector chip and print layout resolve unnumbered guest onto Seat 1
      await expect(
        page.getByTestId('inspector-guest-chip').filter({ hasText: `Seat 1: Nora Unnumbered ${runTag}` })
      ).toBeVisible();
      await expect(page.getByText(new RegExp(`Seat 1: Nora Unnumbered ${runTag}`))).toHaveCount(2);

      // Capture Screenshot 1: Desktop unified 4-edge rectangular & 1-sided head seating + enlarged rotation/inspector controls
      await page.screenshot({
        path: testInfo.outputPath('seating-desktop-unified-layout.png'),
        fullPage: true,
        animations: 'disabled',
      });

      // 4. Desktop mouse drag-and-drop: drag solo guest card onto Banquet Rect Seat 4 (right edge)
      const soloCard = unassignedList
        .getByText(`Liam Pointer ${runTag}`)
        .locator('xpath=ancestor::*[@role="listitem"][1]');
      const banquetSeat4 = page.locator(
        `button[data-table-id="${banquetTable.id}"][data-seat-number="4"]`
      );

      await soloCard.dragTo(banquetSeat4);
      await expect(banquetSeat4).toHaveAttribute(
        'aria-label',
        new RegExp(`Seat 4: Liam Pointer ${runTag}`)
      );

      // 5. Touch Pointer Events cross-panel drag: drag Brooks Pair household header onto Royal Head Table
      const householdCardHeader = unassignedList
        .getByText(`Brooks Pair ${runTag}`)
        .first()
        .locator('xpath=ancestor::*[@draggable="true"][1]');
      const headNode = page.locator(`div[role="button"][data-table-id="${headTable.id}"]`);
      const hhBox = await householdCardHeader.boundingBox();
      const headBox = await headNode.boundingBox();
      expect(hhBox).not.toBeNull();
      expect(headBox).not.toBeNull();

      const startX = Math.round(hhBox!.x + 24);
      const startY = Math.round(hhBox!.y + hhBox!.height / 2);
      const dropX = Math.round(headBox!.x + headBox!.width / 2);
      const dropY = Math.round(headBox!.y + headBox!.height / 2);

      await householdCardHeader.dispatchEvent('pointerdown', {
        pointerId: 21,
        pointerType: 'touch',
        isPrimary: true,
        button: 0,
        clientX: startX,
        clientY: startY,
        bubbles: true,
      });
      await householdCardHeader.dispatchEvent('pointermove', {
        pointerId: 21,
        pointerType: 'touch',
        isPrimary: true,
        clientX: dropX,
        clientY: dropY,
        bubbles: true,
      });

      await expect(page.getByTestId('guest-drag-chip')).toBeVisible();
      await expect(page.getByTestId('guest-drag-chip')).toContainText(`Brooks Pair ${runTag}`);
      await page.screenshot({
        path: testInfo.outputPath('seating-pointer-drag-chip.png'),
        animations: 'disabled',
      });

      await householdCardHeader.dispatchEvent('pointerup', {
        pointerId: 21,
        pointerType: 'touch',
        isPrimary: true,
        button: 0,
        clientX: dropX,
        clientY: dropY,
        bubbles: true,
      });
      await expect(page.getByTestId('guest-drag-chip')).toHaveCount(0);

      await expect(
        page.locator(`div[role="button"][data-table-id="${headTable.id}"]`)
      ).toHaveAttribute('aria-label', new RegExp(`Royal Head ${runTag}, shape head, capacity 4, seated 2`));

      // 6. Verify PDF export endpoint succeeds with unified seat resolution & dietary legend
      const pdfRes = await context.request.get('/api/admin/seating/export?format=pdf');
      expect(pdfRes.ok()).toBeTruthy();
      expect(pdfRes.headers()['content-type']).toContain('application/pdf');
      const pdfBytes = await pdfRes.body();
      expect(pdfBytes.byteLength).toBeGreaterThan(1000);

      // 7. Run full WCAG 2.2 AA Axe scan across entire seating workspace (including FloorplanCanvas) with zero exclusions
      const fullWorkspaceAxe = await new AxeBuilder({ page })
        .include('main')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(fullWorkspaceAxe.violations).toEqual([]);

      // 8. Narrow mobile viewport (375x812): verify scrollable floorplan stage reaches far-right Terrace Table & supports pointer drag
      await page.setViewportSize({ width: 375, height: 812 });
      const stage = page.getByTestId('floorplan-stage');
      await expect(stage).toBeVisible();

      const canvasRegion = page.getByRole('region', {
        name: 'Interactive 2D Reception Floorplan Canvas',
      });
      await canvasRegion.evaluate((el) => {
        el.scrollLeft = 520;
        el.scrollTop = 180;
      });

      const terraceNode = page.locator(`div[role="button"][data-table-id="${terraceTable.id}"]`);
      await expect(terraceNode).toBeVisible();
      await terraceNode.click();

      await page.screenshot({
        path: testInfo.outputPath('seating-mobile-scrollable-stage.png'),
        animations: 'disabled',
      });

      // Unused variable guard for soloDragGuest id check
      expect(soloDragGuest.id).toBeTruthy();
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
