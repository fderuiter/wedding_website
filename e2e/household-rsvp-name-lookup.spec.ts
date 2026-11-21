import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { seedAdminAndGuestAuthCookies } from './helpers/auth';

test('supports admin couple splitting, passcode-gated household name lookup, private sub-event RSVP scoping, and mailing address isolation', async ({
  browser,
  context,
  page,
}) => {
  test.setTimeout(120000);

  await seedAdminAndGuestAuthCookies(context);
  await page.setViewportSize({ width: 1440, height: 920 });

  const captureScreenshots = process.env.CAPTURE_PR_SCREENSHOTS === '1';
  const suffix = ['Alpha', 'Bravo', 'Clara', 'Delta', 'Elena'][Date.now() % 5];
  const lastName = `Kensington${suffix}`;
  const firstMemberFirst = 'Oliver';
  const secondMemberFirst = 'Claire';
  const combinedName = `${firstMemberFirst} & ${secondMemberFirst} ${lastName}`;
  const primaryCode = `KEN${String(Date.now()).slice(-4)}A`;

  const createdGuestIds: string[] = [];
  const createdSubEventIds: string[] = [];

  try {
    // Clean up any prior rows with the same surname if present
    const initialListRes = await context.request.get('/api/admin/invitation-codes?limit=100');
    if (initialListRes.ok()) {
      const existingRows = ((await initialListRes.json()).data ?? []) as Array<{
        id: string;
        guestName: string;
      }>;
      for (const row of existingRows) {
        if (row.guestName.includes(lastName)) {
          await context.request.delete(`/api/admin/invitation-codes/${row.id}`).catch(() => {});
        }
      }
    }

    // 1. Seed a combined couple invitation record and public + private sub-events
    const coupleRes = await context.request.post('/api/admin/invitation-codes', {
      data: {
        code: primaryCode,
        guestName: combinedName,
        email: `kensington.${suffix.toLowerCase()}@example.com`,
        addressLine1: '42 Harbor View Way',
        city: 'Newport',
        state: 'RI',
        zipCode: '02840',
        country: 'USA',
        partyGroup: 'Close Friends',
        plusOneAllocations: 1,
        used: false,
      },
    });
    expect(coupleRes.ok()).toBeTruthy();
    const coupleRecord = (await coupleRes.json()).data;
    createdGuestIds.push(coupleRecord.id);

    const existingEventsRes = await context.request.get('/api/admin/sub-events?limit=20');
    expect(existingEventsRes.ok()).toBeTruthy();
    const existingEvents = ((await existingEventsRes.json()).data ?? []) as Array<
      Record<string, unknown>
    >;
    const sampleEvent = existingEvents[0] ?? {};
    const buildSubEventPayload = (overrides: {
      title: string;
      location: string;
      description: string;
      isPrivate: boolean;
    }) => {
      const base: Record<string, unknown> = {};
      for (const key of ['date', 'time', 'startTime', 'endTime', 'order', 'sortOrder']) {
        if (sampleEvent[key] !== undefined && sampleEvent[key] !== null) {
          base[key] = sampleEvent[key];
        }
      }
      if (base.startTime === undefined && base.date === undefined) {
        base.startTime = '2027-06-19T16:00:00.000Z';
        base.endTime = '2027-06-19T18:00:00.000Z';
      }
      return {
        ...base,
        ...overrides,
      };
    };

    const ceremonyRes = await context.request.post('/api/admin/sub-events', {
      data: buildSubEventPayload({
        title: `Garden Ceremony ${suffix}`,
        location: 'Rose Lawn',
        description: 'Main ceremony for all household members.',
        isPrivate: false,
      }),
    });
    expect(ceremonyRes.ok()).toBeTruthy();
    const ceremony = (await ceremonyRes.json()).data;
    createdSubEventIds.push(ceremony.id);

    const rehearsalRes = await context.request.post('/api/admin/sub-events', {
      data: buildSubEventPayload({
        title: `VIP Rehearsal Toast ${suffix}`,
        location: 'Harbor Conservatory',
        description: 'Private rehearsal toast for select household members.',
        isPrivate: true,
      }),
    });
    expect(rehearsalRes.ok()).toBeTruthy();
    const rehearsal = (await rehearsalRes.json()).data;
    createdSubEventIds.push(rehearsal.id);

    // 2. Admin splits the combined couple into individual household members via the UI
    await page.goto('/admin/dashboard/invitation-codes', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await expect(
      page.getByRole('heading', { name: 'Pre-Authorized Guest Invitation Codes' })
    ).toBeVisible({ timeout: 30000 });
    const searchInput = page
      .getByPlaceholder('Search by name, code, email, household, tag...')
      .first();
    await expect(searchInput).toBeVisible({ timeout: 15000 });
    await searchInput.fill(lastName);

    const splitBtn = page.getByTestId(`split-couple-btn-${coupleRecord.id}`);
    await expect(splitBtn).toBeVisible();
    await splitBtn.click();

    const splitDialog = page.getByRole('dialog', {
      name: /Split Couple into Household Members/i,
    });
    await expect(splitDialog).toBeVisible();

    const splitAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(splitAxe.violations).toEqual([]);

    if (captureScreenshots) {
      await page.screenshot({ path: '/tmp/admin-split-couple.png' });
    }

    await splitDialog.getByTestId('confirm-split-couple-btn').click();
    await expect(splitDialog).toBeHidden();

    // Grant private sub-event access ONLY to Claire
    const listRes = await context.request.get('/api/admin/invitation-codes?limit=100');
    expect(listRes.ok()).toBeTruthy();
    const allCodes = ((await listRes.json()).data ?? []) as Array<{
      id: string;
      code: string;
      guestName: string;
    }>;
    const householdMembers = allCodes.filter((row) => row.guestName.includes(lastName));
    expect(householdMembers).toHaveLength(2);
    for (const member of householdMembers) {
      if (!createdGuestIds.includes(member.id)) {
        createdGuestIds.push(member.id);
      }
    }

    const claireRecord = householdMembers.find((row) =>
      row.guestName.startsWith(secondMemberFirst)
    );
    expect(claireRecord).toBeDefined();

    const accessRes = await context.request.put('/api/admin/sub-events/access', {
      data: {
        invitationCodeId: claireRecord!.id,
        allowedSubEventIds: [rehearsal.id],
      },
    });
    expect(accessRes.ok()).toBeTruthy();

    // 3. Fresh visitor signs in with shared passcode + First & Last Name lookup (no code)
    const guestContext = await browser.newContext({
      viewport: { width: 1440, height: 920 },
      reducedMotion: 'reduce',
    });
    const guestPage = await guestContext.newPage();

    try {
      await guestPage.goto('/guest/login?callbackUrl=%2Fguest');
      await expect(guestPage.locator('#passcode')).toBeVisible({ timeout: 20000 });
      await guestPage.locator('#passcode').fill('playwright-e2e-guest-passcode');

      const toggleNameUnlockBtn = guestPage.getByTestId('toggle-name-unlock-button');
      await expect(toggleNameUnlockBtn).toBeVisible();
      await toggleNameUnlockBtn.click();

      // Failed lookup displays spelling tips & host alert guidance
      await guestPage.getByLabel('First Name').fill('Nonexistent');
      await guestPage.getByLabel('Last Name').fill(lastName);
      await guestPage.getByRole('button', { name: /Unlock Household RSVP/i }).click();
      await expect(guestPage.getByTestId('guest-lookup-help-panel')).toBeVisible();
      await expect(
        guestPage.getByRole('heading', { name: /Spelling & Name Lookup Tips/i })
      ).toBeVisible();

      if (captureScreenshots) {
        await guestPage.screenshot({ path: '/tmp/guest-name-lookup.png' });
      }

      const loginAxe = await new AxeBuilder({ page: guestPage })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(loginAxe.violations).toEqual([]);

      // Unlock using Oliver's first + last name
      await guestPage.getByLabel('First Name').fill(firstMemberFirst);
      await guestPage.getByLabel('Last Name').fill(lastName);
      await guestPage.getByRole('button', { name: /Unlock Household RSVP/i }).click();

      await guestPage.waitForURL((url) => url.pathname === '/guest');

      // 4. Verify multi-person household RSVP controls & private sub-event member scoping
      const ceremonyHeading = guestPage.getByText(`Garden Ceremony ${suffix}`).first();
      await expect(ceremonyHeading).toBeVisible({ timeout: 20000 });
      await ceremonyHeading.scrollIntoViewIfNeeded();

      const oliverFullName = `${firstMemberFirst} ${lastName}`;
      const claireFullName = `${secondMemberFirst} ${lastName}`;
      const oliverGroups = guestPage.getByRole('radiogroup', {
        name: oliverFullName,
      });
      const claireGroups = guestPage.getByRole('radiogroup', {
        name: claireFullName,
      });

      await expect(oliverGroups.first()).toBeVisible();
      await expect(claireGroups.first()).toBeVisible();

      // Claire holds SubEventAccess to the private rehearsal toast whereas Oliver does not
      const oliverCount = await oliverGroups.count();
      const claireCount = await claireGroups.count();
      expect(claireCount).toBe(oliverCount + 1);

      await oliverGroups
        .first()
        .getByRole('radio', { name: /attending/i })
        .click();
      await claireGroups
        .first()
        .getByRole('radio', { name: /declined/i })
        .click();

      if (captureScreenshots) {
        await guestPage.screenshot({ path: '/tmp/household-rsvp-timeline.png' });
      }

      const saveAllBtn = guestPage.getByTestId('rsvp-save-all-button');
      await expect(saveAllBtn).toBeVisible();
      await saveAllBtn.click();
      await expect(saveAllBtn).toBeHidden();

      // 5. Verify /guest isolates street address & invitation code until ZIP verification
      const gateSection = guestPage.getByTestId('guest-address-verification-gate');
      await gateSection.scrollIntoViewIfNeeded();
      await expect(
        guestPage.getByRole('heading', { name: /Verify Access to Mailing Address/i })
      ).toBeVisible();
      await expect(guestPage.locator('body')).not.toContainText('42 Harbor View Way');
      await expect(guestPage.locator('body')).not.toContainText(primaryCode);

      if (captureScreenshots) {
        await guestPage.screenshot({ path: '/tmp/address-isolation-gate.png' });
      }

      const gateAxe = await new AxeBuilder({ page: guestPage })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(gateAxe.violations).toEqual([]);

      await guestPage.getByLabel(/Or Saved Postal ZIP Code/i).fill('02840');
      await guestPage.getByTestId('submit-address-verification').click();

      await expect(guestPage.locator('#address-line1')).toHaveValue('42 Harbor View Way');
      await expect(guestPage.locator('#address-city')).toHaveValue('Newport');
    } finally {
      await guestContext.close();
    }
  } finally {
    for (const subEventId of createdSubEventIds) {
      await context.request.delete(`/api/admin/sub-events/${subEventId}`).catch(() => {});
    }
    for (const guestId of createdGuestIds) {
      await context.request.delete(`/api/admin/invitation-codes/${guestId}`).catch(() => {});
    }
  }
});
