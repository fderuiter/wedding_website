import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { seedAdminAndGuestAuthCookies } from './helpers/auth';

function decodePdfBuffer(buf: Buffer): string {
  const raw = buf.toString('latin1');
  const hexDecoded = Array.from(raw.matchAll(/<([0-9a-fA-F]+)>/g))
    .map((m) => Buffer.from(m[1], 'hex').toString('latin1'))
    .join('');
  return `${raw}\n${hexDecoded}`;
}

test('seating chart loads >100 invitations without truncation, renders inline plus-one chairs & zero-capacity landmarks, and exports caterer-safe CSVs/PDFs/Avery cards', {
  tag: '@a11y',
}, async ({
  context,
  page,
}, testInfo) => {
  test.setTimeout(180000);

  await seedAdminAndGuestAuthCookies(context);
  await page.setViewportSize({ width: 1440, height: 940 });

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
    // 1. Seed reception guest table + zero-capacity landmarks (Dance Floor & Champagne Bar)
    const orchardTable = await createTable({
      name: `Orchard Reception ${runTag}`,
      shape: 'round',
      capacity: 6,
      x: 90,
      y: 95,
      width: 140,
      height: 140,
      rotation: 0,
    });

    const danceFloor = await createTable({
      name: `Grand Dance Floor ${runTag}`,
      shape: 'dance-floor',
      capacity: 0,
      x: 310,
      y: 95,
      width: 210,
      height: 170,
      rotation: 0,
    });

    await createTable({
      name: `Champagne Bar ${runTag}`,
      shape: 'bar',
      capacity: 0,
      x: 575,
      y: 110,
      width: 165,
      height: 80,
      rotation: 0,
    });

    // 2. Seed an invitation with 2 attending plus-ones & entrée selections, seated at Orchard Reception (claims 3 chairs)
    const secretPartyCode = `SECRETPARTY${runTag}`;
    const partyHost = await createGuest({
      code: secretPartyCode,
      guestName: `Evelyn Harper ${runTag}`,
      householdName: `Harper Party ${runTag}`,
      partyGroup: 'Bride Friends',
      partyTags: ['vip'],
      dietaryNotes: 'Gluten-Free',
      used: true,
      extraFields: {
        attending: true,
        plusOneNames: [`Marcus Harper ${runTag}`, `Nora Harper ${runTag}`],
        mealSelections: [
          {
            attendeeName: `Evelyn Harper ${runTag}`,
            mealOptionLabel: 'Herb Crusted Salmon',
            dietaryTags: ['gluten-free'],
          },
          {
            attendeeName: `Marcus Harper ${runTag}`,
            mealOptionLabel: 'Braised Short Rib',
          },
          {
            attendeeName: `Nora Harper ${runTag}`,
            mealOptionLabel: 'Wild Mushroom Risotto',
            dietaryTags: ['vegetarian'],
          },
        ],
      },
    });

    const assignRes = await context.request.post('/api/admin/seating/assign', {
      data: {
        invitationCodeId: partyHost.id,
        tableId: orchardTable.id,
        seatNumber: 1,
      },
    });
    expect(assignRes.ok()).toBeTruthy();

    // 3. Bulk-seed 104 unassigned eligible invitations in a single batch call so total invitations > 100 (105 seeded here)
    const totalUnassignedToSeed = 104;
    const batchRecords = Array.from({ length: totalUnassignedToSeed }, (_, idx) => {
      const n = idx + 1;
      const padded = String(n).padStart(3, '0');
      return {
        code: `POOL${runTag}${padded}`,
        guestName: `Pool Guest ${padded} ${runTag}`,
        partyGroup: n % 2 === 0 ? 'College Friends' : 'Extended Family',
        partyTags: n % 3 === 0 ? ['alumni'] : ['family'],
        extraFields:
          n === 1
            ? {
              attending: true,
              plusOneNames: [`Companion One ${runTag}`],
              mealSummary: `Pool Guest 001 ${runTag}: Herb Crusted Salmon; Companion One ${runTag}: Braised Short Rib`,
            }
            : { attending: true },
      };
    });

    const batchCreateRes = await context.request.post('/api/admin/invitation-codes/batch', {
      data: {
        records: batchRecords,
        collisionStrategy: 'skip',
      },
    });
    expect(batchCreateRes.ok()).toBeTruthy();

    // 4. Open Seating Chart Dashboard and verify >100 unassigned invitations loaded without truncation at 50
    await page.goto('/admin/dashboard/seating-chart', {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    expect(new URL(page.url()).pathname).toBe('/admin/dashboard/seating-chart');
    await expect(
      page.getByRole('heading', { name: 'Interactive Seating Chart & Reception Floorplan' })
    ).toBeVisible({ timeout: 25000 });

    const unassignedList = page.getByRole('list', { name: 'Unassigned guests' });
    await expect(unassignedList.getByText(`Pool Guest 001 ${runTag}`)).toBeVisible({
      timeout: 25000,
    });
    // Guest #104 (well past row 50 & row 100) must be loaded in the pool!
    await expect(unassignedList.getByText(`Pool Guest 104 ${runTag}`)).toBeVisible({
      timeout: 15000,
    });
    await expect(unassignedList.getByText(`+1: Companion One ${runTag}`)).toBeVisible();

    // 5. Verify Orchard Reception claims 3 distinct inline chairs (1 primary + 2 plus-ones) and landmarks have 0 chairs
    const orchardNode = page.getByRole('button', {
      name: new RegExp(`Orchard Reception ${runTag}, shape round, capacity 6, seated 3`),
    });
    await expect(orchardNode).toBeVisible();
    await expect(
      page.locator(`[data-table-id="${orchardTable.id}"][data-is-plus-one="true"]`)
    ).toHaveCount(2);

    const danceFloorNode = page.getByRole('button', {
      name: new RegExp(`Grand Dance Floor ${runTag}, landmark Dance Floor, 0 seats`),
    });
    await expect(danceFloorNode).toBeVisible();
    await expect(
      page.locator(`[data-table-id="${danceFloor.id}"][data-seat-number]`)
    ).toHaveCount(0);

    // Screenshot 1: Floorplan with inline plus-one chairs (+1 badges), zero-capacity landmarks, and >100 guest pool
    await page.screenshot({
      path: testInfo.outputPath('seating-floorplan-landmarks-plusones.png'),
      fullPage: true,
      animations: 'disabled',
    });

    // 6. Select Orchard Reception table -> verify Selected Table Inspector shows plus-one seats & meal summary
    await orchardNode.click();
    await expect(page.getByTestId('inspector-meal-summary')).toContainText('Herb Crusted Salmon: 1');
    await expect(page.getByTestId('inspector-meal-summary')).toContainText('Braised Short Rib: 1');
    await expect(page.getByTestId('inspector-meal-summary')).toContainText('Wild Mushroom Risotto: 1');
    await expect(page.getByTestId('inspector-plus-one-seat')).toHaveCount(2);

    // Screenshot 2: Selected Table Inspector with inline plus-one seats, entrée counts, and caterer/Avery export links
    await page.screenshot({
      path: testInfo.outputPath('seating-inspector-caterer-exports.png'),
      fullPage: true,
      animations: 'disabled',
    });

    // 7. Verify Browser Print DOM (PrintableFloorplan) & all CSV/PDF/Avery exports strip secret guest.code values
    const pageHtml = await page.content();
    expect(pageHtml).not.toContain(secretPartyCode);

    const rosterCsvRes = await context.request.get('/api/admin/seating/export');
    expect(rosterCsvRes.ok()).toBeTruthy();
    const rosterCsv = await rosterCsvRes.text();
    expect(rosterCsv).toContain(`Evelyn Harper ${runTag}`);
    expect(rosterCsv).toContain(`Marcus Harper ${runTag}`);
    expect(rosterCsv).not.toContain(secretPartyCode);
    expect(rosterCsv).not.toContain('Invitation Code');

    const mealsCsvRes = await context.request.get('/api/admin/seating/export?format=meals');
    expect(mealsCsvRes.ok()).toBeTruthy();
    const mealsCsv = await mealsCsvRes.text();
    expect(mealsCsv).toContain(`Orchard Reception ${runTag}`);
    expect(mealsCsv).toContain('Herb Crusted Salmon: 1');
    expect(mealsCsv).not.toContain(`Grand Dance Floor ${runTag}`);
    expect(mealsCsv).not.toContain(secretPartyCode);

    for (const pdfFormat of ['pdf', 'place-cards', 'escort-cards'] as const) {
      const pdfRes = await context.request.get(`/api/admin/seating/export?format=${pdfFormat}`);
      expect(pdfRes.ok()).toBeTruthy();
      expect(pdfRes.headers()['content-type']).toBe('application/pdf');
      const decodedPdf = decodePdfBuffer(await pdfRes.body());
      expect(decodedPdf).toContain(`Evelyn Harper ${runTag}`);
      expect(decodedPdf).toContain(`Marcus Harper ${runTag}`);
      expect(decodedPdf).not.toContain(secretPartyCode);
    }

    // 8. Verify WCAG 2.2 AA contrast and target-size rules on the seating workspace
    const workspaceAxe = await new AxeBuilder({ page })
      .include('main')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const contrastAndTargetViolations = workspaceAxe.violations.filter(
      (v) => v.id === 'color-contrast' || v.id === 'target-size'
    );
    expect(contrastAndTargetViolations).toEqual([]);
  } finally {
    for (const tableId of createdTableIds) {
      await context.request.delete(`/api/admin/seating-tables/${tableId}`).catch(() => {});
    }
    const idsToDelete = new Set<string>(createdGuestIds);
    for (let skip = 0; skip < 400; skip += 100) {
      const listRes = await context.request
        .get(`/api/admin/invitation-codes?skip=${skip}&limit=100`)
        .catch(() => null);
      if (!listRes || !listRes.ok()) break;
      const payload = await listRes.json().catch(() => []);
      const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
      for (const row of rows) {
        if (typeof row?.guestName === 'string' && row.guestName.includes(runTag) && typeof row.id === 'string') {
          idsToDelete.add(row.id);
        }
      }
      if (rows.length < 100) break;
    }
    if (idsToDelete.size > 0) {
      await context.request
        .delete('/api/admin/invitation-codes/batch', {
          data: { ids: Array.from(idsToDelete) },
        })
        .catch(() => {});
    }
  }
});
