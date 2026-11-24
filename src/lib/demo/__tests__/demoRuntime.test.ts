import { buildArchetypeDataset, DEMO_SHIPPING_ADDRESS } from '../demoSeed';
import { createDemoStore } from '@/lib/staticDemo/store';
import {
  getBasePath,
  getPortalBaseUrl,
  stripBasePath,
  withBasePath,
} from '@/lib/basePath';
import {
  applyDemoSampleSelection,
  findDemoGuestByCode,
  getActiveArchetypeDataset,
  getDemoState,
  hydrateDemoStateFromStorage,
  isDemoAdminSession,
  isDemoRuntimeActive,
  mutateActiveDataset,
  processDemoClaimToken,
  purgeDemoSampleData,
  recordDemoContribution,
  resetDemoState,
  setDemoArchetype,
  setDemoGuestSession,
  setDemoPersona,
  setDemoRuntimeActive,
  setDemoSetupAuthenticated,
  setDemoThemePreset,
  setDemoToolbarCollapsed,
  subscribeDemoState,
  updateDemoConfigOverrides,
  updateDemoGuestAddress,
} from '../demoStore';
import { dispatchDemoApiRequest, installDemoFetchInterceptor } from '../demoApiHandler';
import {
  dispatchDemoApiRequest as noopDispatchDemoApiRequest,
  installDemoFetchInterceptor as noopInstallDemoFetchInterceptor,
} from '../demoApiHandler.noop';

describe('demoSeed, demoStore, and demoApiHandler runtime', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetDemoState();
    setDemoRuntimeActive(true);
  });

  afterEach(() => {
    setDemoRuntimeActive(false);
    resetDemoState();
    window.localStorage.clear();
  });

  it('builds deterministic datasets across all three archetypes with escaped SVG data URLs', () => {
    const classic = buildArchetypeDataset('classic');
    const destination = buildArchetypeDataset('destination');
    const romantic = buildArchetypeDataset('romantic');

    expect(classic.registryItems.length).toBeGreaterThan(0);
    expect(classic.registryItems[0].image?.url).toMatch(/^data:image\/svg\+xml,/);
    expect(destination.guests[0].city).toBe('Miami');
    expect(romantic.guests[0].city).toBe('Napa');
    expect(classic.guests[0].city).toBe('Chicago');
    expect(DEMO_SHIPPING_ADDRESS.recipientName).toBe('Alex & Taylor');
  });

  it('hydrates persisted state, handles malformed JSON safely, and notifies subscribers', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeDemoState(listener);

    // Malformed storage payload should not throw
    window.localStorage.setItem('wedding_showcase_demo_v1', '{not-valid-json');
    expect(() => hydrateDemoStateFromStorage()).not.toThrow();

    // Valid persisted payload revives dates and normalizes fields
    const savedDataset = buildArchetypeDataset('destination');
    window.localStorage.setItem(
      'wedding_showcase_demo_v1',
      JSON.stringify({
        persona: 'setup',
        archetype: 'destination',
        themePreset: 'modern',
        isToolbarCollapsed: true,
        setupAuthenticated: true,
        configOverrides: {
          partner1Name: 'Sam',
          weddingDate: '2026-10-12T16:00:00.000Z',
        },
        activeModules: ['registry', 'guests'],
        datasets: { destination: savedDataset },
        guestSession: { invitationCode: 'RODRIGUEZ2026', guestName: 'Carlos & Maria Rodriguez' },
        claimTokens: {},
      })
    );

    hydrateDemoStateFromStorage();

    const state = getDemoState();
    expect(isDemoRuntimeActive()).toBe(true);
    expect(state.persona).toBe('setup');
    expect(isDemoAdminSession()).toBe(true);
    expect(state.archetype).toBe('destination');
    expect(state.themePreset).toBe('modern');
    expect(state.isToolbarCollapsed).toBe(true);
    expect(state.configOverrides.weddingDate).toBeInstanceOf(Date);
    expect(state.datasets.destination.weddingParty[0].createdAt).toBeInstanceOf(Date);
    expect(listener).toHaveBeenCalled();

    // Subset activeModules filters sample items from disabled modules
    const active = getActiveArchetypeDataset();
    expect(active.registryItems.length).toBeGreaterThan(0);
    expect(active.weddingParty).toEqual([]);
    expect(active.attractions).toEqual([]);
    expect(active.faqs).toEqual([]);

    // Re-hydrating when staticDemo store already has matching activeArchetype preserves its snapshot
    const prevInstalled = window.__STATIC_DEMO_INSTALLED__;
    try {
      const matchingStore = createDemoStore({ storage: null, initialArchetype: 'destination' });
      const matchingSwitchSpy = jest.spyOn(matchingStore, 'switchArchetype');
      window.__STATIC_DEMO_INSTALLED__ = {
        store: matchingStore,
        routeRequest: jest.fn(),
        uninstall: jest.fn(),
      };
      hydrateDemoStateFromStorage();
      expect(matchingSwitchSpy).not.toHaveBeenCalled();

      const differentStore = createDemoStore({ storage: null, initialArchetype: 'classic' });
      const differentSwitchSpy = jest.spyOn(differentStore, 'switchArchetype');
      window.__STATIC_DEMO_INSTALLED__ = {
        store: differentStore,
        routeRequest: jest.fn(),
        uninstall: jest.fn(),
      };
      hydrateDemoStateFromStorage();
      expect(differentSwitchSpy).toHaveBeenCalledWith('destination');
    } finally {
      window.__STATIC_DEMO_INSTALLED__ = prevInstalled;
    }

    unsubscribe();
  });

  it('manages archetype session transitions, theme overrides, contributions, claims, and sample purge', () => {
    setDemoGuestSession({ invitationCode: 'SMITH2026', guestName: 'John & Jane Smith' });
    // Switching to same archetype preserves matching guest session
    setDemoArchetype('classic');
    expect(getDemoState().guestSession?.invitationCode).toBe('SMITH2026');

    // Switching to archetype without SMITH2026 clears stale session
    setDemoArchetype('destination');
    expect(getDemoState().guestSession).toBeNull();

    // Theme preset clears custom color overrides while configOverrides updates preset
    updateDemoConfigOverrides({
      themePreset: 'romantic',
      colorPrimary: '#112233',
      colorSecondary: '#445566',
    });
    expect(getDemoState().themePreset).toBe('romantic');
    setDemoThemePreset('minimal');
    expect(getDemoState().themePreset).toBe('minimal');
    expect(getDemoState().configOverrides.colorPrimary).toBeUndefined();

    setDemoToolbarCollapsed(true);
    expect(getDemoState().isToolbarCollapsed).toBe(true);

    setDemoPersona('guest');
    setDemoSetupAuthenticated(false);
    expect(isDemoAdminSession()).toBe(false);

    // Physical item reservation + confirm + cancel claim tokens
    setDemoArchetype('classic');
    const physicalItem = getActiveArchetypeDataset().registryItems.find((i) => !i.isGroupGift)!;
    expect(recordDemoContribution({ itemId: 'missing-id', purchaserName: 'A', amount: 10 })).toBeNull();

    const reserved = recordDemoContribution({
      itemId: physicalItem.id,
      purchaserName: 'Taylor Friend',
      amount: physicalItem.price,
      retailerOrderNumber: 'ORD-100',
      carrier: 'UPS',
      trackingNumber: '1Z999',
    });
    expect(reserved?.purchased).toBe(true);
    expect(reserved?.claimActions?.status).toBe('RESERVED');

    const confirmToken = reserved!.claimActions!.confirmToken;
    const cancelToken = reserved!.claimActions!.cancelToken;

    expect(processDemoClaimToken('unknown-token')).toBeNull();
    const confirmed = processDemoClaimToken(confirmToken);
    expect(confirmed?.status).toBe('CONFIRMED');
    expect(confirmed?.changed).toBe(true);
    // Idempotent repeat confirm
    expect(processDemoClaimToken(confirmToken)?.changed).toBe(false);

    const cancelled = processDemoClaimToken(cancelToken);
    expect(cancelled?.status).toBe('CANCELLED');
    expect(cancelled?.item?.purchased).toBe(false);

    // Update guest address and purge sample data, then fallback lookup via preset
    const updatedGuest = updateDemoGuestAddress('SMITH2026', {
      addressLine1: '900 Lake Shore Dr',
      city: 'Chicago',
    });
    expect(updatedGuest?.addressLine1).toBe('900 Lake Shore Dr');

    purgeDemoSampleData();
    expect(getActiveArchetypeDataset().registryItems).toHaveLength(0);
    // Preset fallback still resolves SMITH2026 even after sample purge
    expect(findDemoGuestByCode('smith2026')?.code).toBe('SMITH2026');
    expect(findDemoGuestByCode('   ')).toBeNull();
    expect(findDemoGuestByCode('NO_SUCH_CODE')).toBeNull();

    applyDemoSampleSelection('romantic', ['registry', 'guests', 'seating']);
    expect(getDemoState().archetype).toBe('romantic');
    expect(getActiveArchetypeDataset().registryItems.length).toBeGreaterThan(0);

    mutateActiveDataset((curr) => ({ ...curr }));
  });

  it('intercepts same-origin /api/* routes across admin, setup, registry, seating, and guest portals', async () => {
    const fallbackFetch = jest.fn(async () => new Response('passthrough', { status: 200 }));
    const originalFetch = window.fetch;
    window.fetch = fallbackFetch as unknown as typeof window.fetch;

    const uninstallFirst = installDemoFetchInterceptor();
    const uninstallSecond = installDemoFetchInterceptor();

    try {
      // Cross-origin and non-API requests pass through untouched
      const extRes = await window.fetch('https://example.com/api/admin/me');
      expect(await extRes.text()).toBe('passthrough');
      const assetRes = await window.fetch('/images/hero.jpg');
      expect(await assetRes.text()).toBe('passthrough');

      // Aborted signal rejects with AbortError
      const abortController = new AbortController();
      abortController.abort();
      await expect(
        window.fetch('/api/admin/me', { signal: abortController.signal })
      ).rejects.toMatchObject({ name: 'AbortError' });

      // 1. Setup & admin session endpoints (URL and Request inputs)
      const meInitial = await (await window.fetch(new URL('/api/admin/me', window.location.origin))).json();
      expect(meInitial.isAdmin).toBe(false);

      await window.fetch('/api/admin/setup', {
        method: 'POST',
        body: JSON.stringify({ password: 'demo-password' }),
      });
      setDemoPersona('setup');
      expect((await (await window.fetch('/api/admin/me')).json()).isAdmin).toBe(true);

      await window.fetch('/api/admin/setup', {
        method: 'POST',
        body: JSON.stringify({
          partner1Name: 'Riley',
          partner2Name: 'Morgan',
          weddingDate: '2026-11-08',
          venueName: 'Harbor Conservatory',
          venueCity: 'Seattle',
          venueState: 'WA',
          timezone: 'America/Los_Angeles',
          contactEmail: 'couple@example.com',
          themePreset: 'editorial',
          colorPrimary: '#222222',
          colorSecondary: '#888888',
        }),
      });
      expect(getDemoState().configOverrides.partner1Name).toBe('Riley');
      expect(getDemoState().themePreset).toBe('editorial');

      await window.fetch('/api/admin/logout', { method: 'POST' });
      expect(getDemoState().persona).toBe('guest');

      if (typeof Request !== 'undefined') {
        const reqObj = new Request(`${window.location.origin}/api/admin/me`);
        expect((await window.fetch(reqObj)).status).toBe(200);
      }

      // Base-path stripping, trailing-slash normalization, and malformed JSON body handling
      const prevBasePath = process.env.NEXT_PUBLIC_BASE_PATH;
      process.env.NEXT_PUBLIC_BASE_PATH = '/wedding_website/demo/';
      try {
        expect((await window.fetch('/wedding_website/demo/api/admin/me')).status).toBe(200);
        expect((await window.fetch('/wedding_website/demo/api/admin/me/')).status).toBe(200);
        expect((await window.fetch('/api/admin/me/')).status).toBe(200);
      } finally {
        if (prevBasePath === undefined) {
          delete process.env.NEXT_PUBLIC_BASE_PATH;
        } else {
          process.env.NEXT_PUBLIC_BASE_PATH = prevBasePath;
        }
      }

      // 2. Sample data status, seed, and delete
      const sampleStatus = await (await window.fetch('/api/admin/sample-data')).json();
      expect(sampleStatus.hasSampleData).toBe(true);

      await window.fetch('/api/admin/sample-data', {
        method: 'POST',
        body: JSON.stringify({ archetype: 'destination', modules: ['registry', 'guests', 'seating'] }),
      });
      expect(getDemoState().archetype).toBe('destination');

      // Fallback archetype/modules defaults when omitted
      await window.fetch('/api/admin/sample-data', {
        method: 'POST',
        body: '{invalid-json',
      });
      expect(getDemoState().archetype).toBe('classic');

      await window.fetch('/api/admin/sample-data', { method: 'DELETE' });
      expect((await (await window.fetch('/api/admin/sample-data')).json()).hasSampleData).toBe(false);

      // Re-seed classic for CRUD tests
      await window.fetch('/api/admin/sample-data', {
        method: 'POST',
        body: JSON.stringify({
          archetype: 'classic',
          modules: ['registry', 'guests', 'seating', 'weddingParty', 'attractions', 'faqs'],
        }),
      });

      // 3. Registry capabilities, CRUD, contribution, claim, code validation, and session
      const caps = await (await window.fetch('/api/registry/capabilities')).json();
      expect(caps.cardCheckoutEnabled).toBe(true);
      expect(caps.stripePublishableKey).toBeNull();

      const createdItem = await (
        await window.fetch('/api/registry/items', {
          method: 'POST',
          body: JSON.stringify({
            name: 'Espresso Grinder',
            description: 'Burr grinder',
            category: 'Kitchen',
            price: 220,
            quantity: 1,
            itemType: 'PHYSICAL',
            isGroupGift: false,
            vendorUrl: 'https://example.com/grinder',
          }),
        })
      ).json();
      expect(createdItem.name).toBe('Espresso Grinder');

      const createdFund = await (
        await window.fetch('/api/registry/items', {
          method: 'POST',
          body: JSON.stringify({
            itemType: 'CASH_FUND',
            isGroupGift: true,
            isMostWanted: true,
          }),
        })
      ).json();
      expect(createdFund.itemType).toBe('CASH_FUND');

      const listedItems = await (await window.fetch('/api/registry/items?page=1&limit=20')).json();
      expect(listedItems.items.some((i: { id: string }) => i.id === createdItem.id)).toBe(true);

      expect((await window.fetch(`/api/registry/items/${createdItem.id}`)).status).toBe(200);
      expect((await window.fetch('/api/registry/items/missing-item')).status).toBe(404);
      expect((await window.fetch('/api/registry/items/missing-item', { method: 'PUT', body: '{}' })).status).toBe(404);
      expect((await window.fetch('/api/registry/items/missing-item', { method: 'DELETE' })).status).toBe(404);

      const patchedItem = await (
        await window.fetch(`/api/registry/items/${createdItem.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: 'Pro Espresso Grinder',
            description: 'Updated burr grinder',
            category: 'Coffee',
            price: 250,
          }),
        })
      ).json();
      expect(patchedItem.price).toBe(250);

      // Contribute validation + claim flow
      expect(
        (await window.fetch('/api/registry/contribute', { method: 'POST', body: '{}' })).status
      ).toBe(400);
      expect(
        (
          await window.fetch('/api/registry/contribute', {
            method: 'POST',
            body: JSON.stringify({ itemId: 'missing', purchaserName: 'Pat', amount: 50 }),
          })
        ).status
      ).toBe(404);

      const contribRes = await (
        await window.fetch('/api/registry/contribute', {
          method: 'POST',
          body: JSON.stringify({
            itemId: createdItem.id,
            purchaserName: 'Pat Guest',
            amount: 250,
            code: 'SMITH2026',
            message: 'Enjoy!',
            coverFee: true,
            email: 'pat@example.com',
            retailerOrderNumber: 'ORD-1',
            carrier: 'FedEx',
            trackingNumber: 'TRK-1',
          }),
        })
      ).json();
      expect(contribRes.claimActions.confirmToken).toBeDefined();

      // Card contribution with paymentIntentId on group fund
      const cardContrib = await (
        await window.fetch('/api/registry/contribute', {
          method: 'POST',
          body: JSON.stringify({
            itemId: createdFund.id,
            purchaserName: 'Card Guest',
            amount: 40,
            paymentIntentId: 'pi_demo_test123',
          }),
        })
      ).json();
      expect(cardContrib.amountContributed).toBe(40);

      expect((await window.fetch('/api/registry/claim')).status).toBe(400);
      expect((await window.fetch('/api/registry/claim?token=bad')).status).toBe(404);
      const claimGetRes = await (
        await window.fetch(`/api/registry/claim?token=${contribRes.claimActions.confirmToken}`)
      ).json();
      expect(claimGetRes.status).toBe('CONFIRMED');
      const claimCancelRes = await (
        await window.fetch('/api/registry/claim', {
          method: 'POST',
          body: JSON.stringify({ token: contribRes.claimActions.cancelToken }),
        })
      ).json();
      expect(claimCancelRes.status).toBe('CANCELLED');

      expect((await window.fetch(`/api/registry/items/${createdItem.id}`, { method: 'DELETE' })).status).toBe(200);

      // Validate code & guest address portal
      expect((await window.fetch('/api/registry/validate-code?code=INVALID')).status).toBe(404);
      expect((await window.fetch('/api/guest/address')).status).toBe(401);
      expect((await (await window.fetch('/api/registry/session')).json()).isVerified).toBe(false);

      const validCodeRes = await (
        await window.fetch('/api/registry/validate-code?code=SMITH2026')
      ).json();
      expect(validCodeRes.valid).toBe(true);
      expect((await (await window.fetch('/api/registry/session')).json()).isVerified).toBe(true);

      expect((await window.fetch('/api/guest/address')).status).toBe(200);
      const updatedAddr = await (
        await window.fetch('/api/guest/address', {
          method: 'PUT',
          body: JSON.stringify({
            addressLine1: '123 Oak St',
            addressLine2: 'Apt 4B',
            city: 'Evanston',
            state: 'IL',
            zipCode: '60201',
            country: 'USA',
          }),
        })
      ).json();
      expect(updatedAddr.data.addressLine1).toBe('123 Oak St');

      await window.fetch('/api/registry/session', { method: 'DELETE' });
      expect((await (await window.fetch('/api/registry/session')).json()).isVerified).toBe(false);

      // 4. Admin seating, guests, wedding party, attractions, sub-events, broadcast
      const newTable = (
        await (
          await window.fetch('/api/admin/seating-tables', {
            method: 'POST',
            body: JSON.stringify({ name: 'Table 9', shape: 'rectangular', capacity: 8 }),
          })
        ).json()
      ).data;
      expect((await window.fetch('/api/admin/seating-tables')).status).toBe(200);
      expect(
        (
          await window.fetch(`/api/admin/seating-tables/${newTable.id}`, {
            method: 'PUT',
            body: JSON.stringify({ name: 'VIP Table 9', capacity: 10, x: 150, y: 250, rotation: 90 }),
          })
        ).status
      ).toBe(200);

      const guestsList = (await (await window.fetch('/api/admin/invitation-codes/catalog')).json()).data.items;
      expect(
        (
          await window.fetch('/api/admin/seating/assign', {
            method: 'POST',
            body: JSON.stringify({
              invitationCodeId: guestsList[0].id,
              tableId: newTable.id,
              seatNumber: 1,
            }),
          })
        ).status
      ).toBe(200);
      expect(
        (
          await window.fetch('/api/admin/seating/assign', {
            method: 'POST',
            body: JSON.stringify({
              invitationCodeId: 'missing-guest-id',
              tableId: newTable.id,
            }),
          })
        ).status
      ).toBe(404);
      expect(
        (
          await window.fetch('/api/admin/seating/assign', {
            method: 'POST',
            body: JSON.stringify({
              assignments: [
                {
                  invitationCodeId: guestsList[0].id,
                  tableId: newTable.id,
                  seatNumber: 2,
                  plusOneSeatNumbers: [3],
                },
              ],
            }),
          })
        ).status
      ).toBe(200);
      expect(
        (
          await window.fetch('/api/admin/seating/assign', {
            method: 'POST',
            body: JSON.stringify({
              invitationCodeIds: [guestsList[0].id],
              tableId: newTable.id,
              action: 'assignBatch',
            }),
          })
        ).status
      ).toBe(200);
      expect(
        (
          await window.fetch('/api/admin/seating/assign', {
            method: 'POST',
            body: JSON.stringify({
              invitationCodeIds: [guestsList[0].id],
              tableId: null,
              action: 'clearTable',
            }),
          })
        ).status
      ).toBe(200);
      const landmarkTable = (
        await (
          await window.fetch('/api/admin/seating-tables', {
            method: 'POST',
            body: JSON.stringify({ name: 'Dance Floor', shape: 'dance-floor', capacity: 0 }),
          })
        ).json()
      ).data;
      expect(landmarkTable.capacity).toBe(0);
      expect(
        (
          await window.fetch('/api/admin/seating/auto-assign', {
            method: 'POST',
            body: JSON.stringify({ keepHouseholdsIntact: true }),
          })
        ).status
      ).toBe(200);
      // Deleting table also unassigns seated guests on that table
      expect((await window.fetch(`/api/admin/seating-tables/${newTable.id}`, { method: 'DELETE' })).status).toBe(200);
      expect((await window.fetch(`/api/admin/seating-tables/${landmarkTable.id}`, { method: 'DELETE' })).status).toBe(200);
      expect((await window.fetch('/api/admin/seating-tables/missing', { method: 'DELETE' })).status).toBe(404);

      expect(
        (
          await window.fetch('/api/admin/invitation-codes', {
            method: 'POST',
            body: JSON.stringify({
              guestName: 'New Household',
              householdName: 'New Family',
              partyGroup: 'VIPs',
              code: 'NEW2026',
              partyTags: ['VIP'],
              plusOneAllocations: 1,
            }),
          })
        ).status
      ).toBe(201);
      expect(
        (
          await window.fetch('/api/admin/invitation-codes/import', {
            method: 'POST',
            body: JSON.stringify({ records: [{ guestName: 'CSV Guest', code: 'CSV2026' }] }),
          })
        ).status
      ).toBe(200);
      expect(
        (
          await window.fetch('/api/admin/invitation-codes/import', {
            method: 'POST',
            body: JSON.stringify({ items: [{}] }),
          })
        ).status
      ).toBe(200);

      expect((await window.fetch('/api/admin/wedding-party')).status).toBe(200);
      expect(
        (
          await window.fetch('/api/admin/wedding-party', {
            method: 'POST',
            body: JSON.stringify({ name: 'Casey', role: 'Best Person', side: 'BRIDE' }),
          })
        ).status
      ).toBe(201);

      expect((await window.fetch('/api/admin/attractions')).status).toBe(200);
      expect(
        (
          await window.fetch('/api/admin/attractions', {
            method: 'POST',
            body: JSON.stringify({
              name: 'Botanic Walk',
              category: 'Activities',
              website: 'https://botanic.example.com',
              promoCode: 'WED26',
              bookingUrl: 'https://botanic.example.com/book',
              roomRate: '$199/night',
            }),
          })
        ).status
      ).toBe(201);

      expect((await (await window.fetch('/api/admin/sub-events/rsvp-summary')).json()).data).toBeNull();
      expect((await (await window.fetch('/api/admin/sub-events/access')).json()).data.subEvents).toEqual([]);
      expect((await window.fetch('/api/admin/sub-events/access/batch', { method: 'POST' })).status).toBe(200);
      expect((await (await window.fetch('/api/admin/sub-events')).json()).data).toEqual([]);
      expect((await (await window.fetch('/api/admin/invitation-codes/rsvps')).json()).data).toEqual([]);
      expect((await (await window.fetch('/api/admin/broadcast/history')).json()).data).toEqual([]);
      expect((await window.fetch('/api/admin/broadcast/missing-id')).status).toBe(404);
      const setupStatusPayload = await (await window.fetch('/api/admin/setup')).json();
      expect(setupStatusPayload.initialized).toBe(true);
      expect(setupStatusPayload.setupCompleted).toBe(true);

      expect((await window.fetch('/api/admin/geocode?q=a')).status).toBe(400);
      const geocodeRes = await (
        await window.fetch('/api/admin/geocode?q=Glasshouse%20Estate&limit=5')
      ).json();
      expect(geocodeRes.success).toBe(true);
      expect(geocodeRes.data).toHaveLength(1);
      expect(geocodeRes.data[0]).toMatchObject({
        name: 'Glasshouse Estate',
        city: 'Chicago',
        state: 'IL',
      });
      expect(
        (
          await window.fetch('/api/admin/setup', {
            method: 'POST',
            body: JSON.stringify({
              partner1Name: 'Alex',
              partner2Name: 'Taylor',
              venueName: 'Glasshouse Estate',
              venueAddress: '123 Oak Ave',
              venueCity: 'Chicago',
              venueState: 'IL',
              venueZip: '60601',
              latitude: 41.8842,
              longitude: -87.6324,
            }),
          })
        ).status
      ).toBe(200);
      expect(getDemoState().configOverrides.venueAddress).toBe('123 Oak Ave');
      expect(getDemoState().configOverrides.latitude).toBe(41.8842);

      const milestonesPayload = await (await window.fetch('/api/admin/onboarding-milestones')).json();
      expect(milestonesPayload.data.milestones).toHaveLength(6);
      expect(milestonesPayload.data.milestones.some((m: { id: string }) => m.id === 'story-and-schedule')).toBe(true);

      // Contribute to a fund item so we can test contributor edit/action/delete & thank-you updates (#1242)
      const fundTarget = getActiveArchetypeDataset().registryItems.find((i) => i.isGroupGift)!;
      const contribForReconcile = await (
        await window.fetch('/api/registry/contribute', {
          method: 'POST',
          body: JSON.stringify({
            itemId: fundTarget.id,
            purchaserName: 'Reconcile Guest',
            amount: 75,
            email: 'reconcile@example.com',
            message: 'Congrats!',
          }),
        })
      ).json();
      const targetContributorId = contribForReconcile.contributors[contribForReconcile.contributors.length - 1].id;

      expect(
        (
          await window.fetch(`/api/admin/contributors/${targetContributorId}`, {
            method: 'PATCH',
            body: JSON.stringify({ name: 'Updated Guest', amount: 85, status: 'CONFIRMED' }),
          })
        ).status
      ).toBe(200);
      expect(
        (
          await window.fetch(`/api/admin/contributors/${targetContributorId}/action`, {
            method: 'POST',
            body: JSON.stringify({ action: 'void' }),
          })
        ).status
      ).toBe(200);
      expect(
        (
          await window.fetch('/api/admin/contributors/missing-contributor', {
            method: 'PATCH',
            body: JSON.stringify({ name: 'Missing' }),
          })
        ).status
      ).toBe(404);

      expect(
        (
          await window.fetch('/api/admin/thank-you-notes', {
            method: 'POST',
            body: JSON.stringify({ name: 'Offline Aunt', amount: 120, thankYouStatus: 'Sent' }),
          })
        ).status
      ).toBe(201);
      const sampleGuest = getActiveArchetypeDataset().guests[0];
      const catalogSearchRes = await (
        await window.fetch(
          `/api/admin/invitation-codes/catalog?search=${encodeURIComponent(sampleGuest.code)}&limit=5`
        )
      ).json();
      expect(catalogSearchRes.data.items.length).toBeGreaterThanOrEqual(1);

      expect(
        (
          await window.fetch(`/api/admin/thank-you-notes/${targetContributorId}`, {
            method: 'PATCH',
            body: JSON.stringify({
              thankYouStatus: 'Sent',
              thankYouNote: 'Thank you so much!',
              invitationCodeId: sampleGuest.id,
              addressLine1: '742 Evergreen Terrace',
              addressLine2: 'Suite 2',
              city: 'Springfield',
              state: 'IL',
              zipCode: '62704',
              country: 'USA',
              syncAddressToGuest: true,
            }),
          })
        ).status
      ).toBe(200);

      const previewEmailRes = await (
        await window.fetch(`/api/admin/thank-you-notes/${targetContributorId}/send-email`, {
          method: 'POST',
          body: JSON.stringify({
            mode: 'preview',
            body: 'Dear {{guestName}}, thank you for {{giftName}} ({{amount}})!',
          }),
        })
      ).json();
      expect(previewEmailRes.mode).toBe('preview');
      expect(previewEmailRes.htmlBody).toContain('Updated Guest');

      const testEmailRes = await (
        await window.fetch(`/api/admin/thank-you-notes/${targetContributorId}/send-email`, {
          method: 'POST',
          body: JSON.stringify({
            mode: 'test',
            subject: 'Warm thanks',
            body: 'Thank you kindly!',
          }),
        })
      ).json();
      expect(testEmailRes.mode).toBe('test');
      expect(testEmailRes.subject).toBe('[TEST] Warm thanks');

      const sendEmailRes = await (
        await window.fetch(`/api/admin/thank-you-notes/${targetContributorId}/send-email`, {
          method: 'POST',
          body: JSON.stringify({
            mode: 'send',
            subject: 'Warm thanks',
            body: 'Thank you kindly!',
          }),
        })
      ).json();
      expect(sendEmailRes.mode).toBe('send');
      expect(sendEmailRes.thankYouStatus).toBe('Sent');
      expect(
        (
          await window.fetch('/api/admin/thank-you-notes/missing-id/send-email', {
            method: 'POST',
            body: JSON.stringify({ mode: 'preview', body: 'Hi' }),
          })
        ).status
      ).toBe(404);

      expect(
        (
          await window.fetch('/api/admin/thank-you-notes/batch', {
            method: 'POST',
            body: JSON.stringify({ ids: [targetContributorId], status: 'Not Needed' }),
          })
        ).status
      ).toBe(200);

      const thankYouPayload = await (await window.fetch('/api/admin/thank-you-notes')).json();
      expect(Array.isArray(thankYouPayload.items)).toBe(true);
      const matchedThankYou = thankYouPayload.items.find(
        (i: { id: string }) => i.id === targetContributorId
      );
      expect(matchedThankYou.addressLine1).toBe('742 Evergreen Terrace');
      expect(matchedThankYou.invitationCode?.id).toBe(sampleGuest.id);
      expect(thankYouPayload.metrics).toBeDefined();

      expect(
        (
          await window.fetch(`/api/admin/contributors/${targetContributorId}`, {
            method: 'DELETE',
          })
        ).status
      ).toBe(200);
      expect(
        (await window.fetch('/api/admin/contributors/missing-contributor', { method: 'DELETE' }))
          .status
      ).toBe(404);

      const claimableId = getActiveArchetypeDataset().registryItems[0].id;
      const unclaimRes = await window.fetch(`/api/admin/registry/items/${claimableId}/unclaim`, {
        method: 'POST',
      });
      expect(unclaimRes.status).toBe(200);
      expect(
        (await window.fetch('/api/admin/registry/items/missing-item/unclaim', { method: 'POST' }))
          .status
      ).toBe(404);
      expect((await window.fetch('/api/admin/overview-stats')).status).toBe(200);

      // Guest portal session, personalized schedule, and interactive RSVP submission
      const initialGuestSession = await (await window.fetch('/api/guest/session')).json();
      expect(initialGuestSession).toEqual(
        expect.objectContaining({ status: 'none', isVerified: false, invitationCode: null })
      );
      const publicSchedule = await (await window.fetch('/api/schedule')).json();
      expect(publicSchedule.isGuest).toBe(false);
      expect(Array.isArray(publicSchedule.data)).toBe(true);
      expect(publicSchedule.data.length).toBeGreaterThan(0);
      expect(
        (
          await window.fetch('/api/rsvp', {
            method: 'POST',
            body: JSON.stringify({ subEventId: publicSchedule.data[0].id, status: 'attending' }),
          })
        ).status
      ).toBe(401);

      await window.fetch('/api/registry/validate-code?code=SMITH2026');
      const unlockedGuestSession = await (await window.fetch('/api/guest/session')).json();
      expect(unlockedGuestSession).toEqual(
        expect.objectContaining({
          status: 'invitation',
          isVerified: true,
          invitationCode: 'SMITH2026',
          code: 'SMITH2026',
        })
      );
      const guestSchedule = await (await window.fetch('/api/schedule')).json();
      expect(guestSchedule.isGuest).toBe(true);
      const targetSubEventId = guestSchedule.data[0].id as string;
      expect(
        (
          await window.fetch('/api/rsvp', {
            method: 'POST',
            body: JSON.stringify({ subEventId: targetSubEventId, status: 'pending' }),
          })
        ).status
      ).toBe(400);
      const rsvpSaveRes = await window.fetch('/api/rsvp', {
        method: 'POST',
        body: JSON.stringify({
          subEventId: targetSubEventId,
          status: 'attending',
          plusOneCount: 1,
          dietaryNotes: 'No shellfish',
          plusOneNames: ['Alex Smith'],
        }),
      });
      expect(rsvpSaveRes.status).toBe(200);
      const refreshedSchedule = await (await window.fetch('/api/schedule')).json();
      const savedEvent = refreshedSchedule.data.find(
        (evt: { id: string }) => evt.id === targetSubEventId
      );
      expect(savedEvent.userRsvp).toEqual(
        expect.objectContaining({
          status: 'attending',
          plusOneCount: 1,
          dietaryNotes: 'No shellfish',
        })
      );
      const rsvpClearDietaryRes = await window.fetch('/api/rsvp', {
        method: 'POST',
        body: JSON.stringify({
          subEventId: targetSubEventId,
          status: 'attending',
          plusOneCount: 1,
          dietaryNotes: '',
          clearDietaryNotes: true,
        }),
      });
      expect(rsvpClearDietaryRes.status).toBe(200);
      const scheduleAfterClear = await (await window.fetch('/api/schedule')).json();
      const clearedNoteEvent = scheduleAfterClear.data.find(
        (evt: { id: string }) => evt.id === targetSubEventId
      );
      expect(clearedNoteEvent.userRsvp.dietaryNotes).toBe('');
      const clearedGuestSession = await (
        await window.fetch('/api/guest/session', { method: 'DELETE' })
      ).json();
      expect(clearedGuestSession).toEqual(
        expect.objectContaining({ status: 'none', isVerified: false })
      );

      expect((await window.fetch('/api/ready')).status).toBe(200);
      expect(
        Array.isArray((await (await window.fetch('/api/weather')).json()).data.daily.temperature_2m_max)
      ).toBe(true);
      const photosInitial = await (await window.fetch('/api/photos')).json();
      expect(Array.isArray(photosInitial.photos)).toBe(true);
      expect(photosInitial.photos.length).toBeGreaterThan(0);
      const photosSince = await (
        await window.fetch('/api/photos?since=2026-02-01T00%3A00%3A00.000Z')
      ).json();
      expect(photosSince.photos).toEqual([]);
      expect(Array.isArray((await (await window.fetch('/api/media')).json()).data)).toBe(true);
      const moderationPayload = await (
        await window.fetch('/api/admin/photos/moderation')
      ).json();
      expect(moderationPayload.photos).toEqual([]);
      expect(moderationPayload.data).toEqual([]);
      const publicAddrRes = await window.fetch('/api/guest/address/public', {
        method: 'POST',
        body: JSON.stringify({
          guestName: 'Public Collect Guest',
          addressLine1: '100 Michigan Ave',
          city: 'Chicago',
          state: 'IL',
          zipCode: '60601',
        }),
      });
      expect(publicAddrRes.status).toBe(200);
      expect(Array.isArray((await (await window.fetch('/api/admin/features')).json()).data)).toBe(true);
      expect(Array.isArray((await (await window.fetch('/api/admin/settings?list=true')).json()).data)).toBe(true);
      expect((await (await window.fetch('/api/admin/settings')).json()).data.id).toBe('global');
      expect(Array.isArray((await (await window.fetch('/api/admin/content-nodes')).json()).data)).toBe(true);
      expect(Array.isArray((await (await window.fetch('/api/admin/versions')).json()).data.items)).toBe(true);
      expect((await window.fetch('/api/admin/seating/export?format=pdf')).headers.get('Content-Type')).toBe('application/pdf');
      expect((await window.fetch('/api/unknown-endpoint', { method: 'POST', body: '["array-body"]' })).status).toBe(404);

      // Public address collection postal validation, tag isolation, and promotion to invited
      resetDemoState();
      setDemoRuntimeActive(true);
      purgeDemoSampleData();
      const catalogRes = await window.fetch('/api/admin/invitation-codes?limit=1000');
      expect(catalogRes.headers.get('X-Total-Count')).toBe('0');

      const invalidCollectRes = await window.fetch('/api/guest/address/public', {
        method: 'POST',
        body: JSON.stringify({ guestName: 'Incomplete Postal' }),
      });
      expect(invalidCollectRes.status).toBe(400);

      const validCollectRes = await window.fetch('/api/guest/address/public', {
        method: 'POST',
        body: JSON.stringify({
          guestName: 'Morgan Address Only',
          addressLine1: '742 Evergreen Terrace',
          city: 'Springfield',
          state: 'IL',
          zipCode: '62704',
          notes: 'Gate code 4815',
        }),
      });
      expect(validCollectRes.status).toBe(200);
      const validCollectJson = await validCollectRes.json();
      expect(validCollectJson).toEqual({
        success: true,
        message: 'Address submitted successfully.',
      });

      const collectedGuest = getActiveArchetypeDataset().guests.find(
        (g) => g.guestName === 'Morgan Address Only'
      );
      expect(collectedGuest).toBeDefined();
      const collectedId = collectedGuest!.id;
      const collectedCode = collectedGuest!.code;
      expect(collectedGuest?.dietaryNotes).toBeNull();
      expect((collectedGuest?.extraFields as Record<string, unknown>)?.householdNotes).toBe(
        'Gate code 4815'
      );

      // Unpromoted address-collection records cannot validate as invited guests or complete Guest List milestone
      expect(
        (await window.fetch(`/api/registry/validate-code?code=${encodeURIComponent(collectedCode)}`))
          .status
      ).toBe(404);
      setDemoGuestSession({ invitationCode: collectedCode, guestName: 'Morgan Address Only' });
      const unpromotedDemoSession = await (await window.fetch('/api/guest/session')).json();
      expect(unpromotedDemoSession).toEqual(
        expect.objectContaining({ status: 'none', isVerified: false, invitationCode: null })
      );
      setDemoGuestSession(null);
      const milestonesBeforePromote = await (
        await window.fetch('/api/admin/onboarding-milestones')
      ).json();
      expect(
        milestonesBeforePromote.data.milestones.find((m: { id: string }) => m.id === 'guest-list')
          ?.completed
      ).toBe(false);

      // Promoting removes 'address-collection' tag and unlocks validation + milestone completion
      const promoteRes = await window.fetch('/api/admin/invitation-codes/batch', {
        method: 'POST',
        body: JSON.stringify({
          ids: [collectedId],
          tags: ['address-collection'],
          action: 'remove',
        }),
      });
      expect(promoteRes.status).toBe(200);
      expect(
        (await window.fetch(`/api/registry/validate-code?code=${encodeURIComponent(collectedCode)}`))
          .status
      ).toBe(200);
      const milestonesAfterPromote = await (
        await window.fetch('/api/admin/onboarding-milestones')
      ).json();
      expect(
        milestonesAfterPromote.data.milestones.find((m: { id: string }) => m.id === 'guest-list')
          ?.completed
      ).toBe(true);

      // Uninstalling restores fallback fetch behavior for /api/* routes
      uninstallSecond();
      uninstallFirst();
      fallbackFetch.mockClear();
      const restoredRes = await window.fetch('/api/admin/me');
      expect(await restoredRes.text()).toBe('passthrough');
      expect(fallbackFetch).toHaveBeenCalledTimes(1);
    } finally {
      uninstallSecond();
      uninstallFirst();
      window.fetch = originalFetch;
    }
  });

  it('serves localized seasonal climate forecast from /api/weather in demo mode without external calls', async () => {
    const originalFetch = window.fetch;
    const fallbackFetch = jest.fn(async () => new Response('unexpected', { status: 500 }));
    window.fetch = fallbackFetch as unknown as typeof window.fetch;

    setDemoRuntimeActive(true);
    const uninstall = installDemoFetchInterceptor();

    try {
      // Classic preset (Minneapolis, September -> warm temperate)
      const classicRes = await window.fetch('/api/weather');
      expect(classicRes.status).toBe(200);
      const classicForecast = await classicRes.json();
      expect(classicForecast.isLiveForecast).toBe(false);
      expect(classicForecast.liveForecastAvailableDate).toBe('2026-09-02');
      expect(classicForecast.daily.time).toEqual(['2026-09-19']);
      expect(classicForecast.daily.temperature_2m_max[0]).toBe(82);

      // Destination preset (Amalfi Coast October -> mild Mediterranean autumn)
      setDemoArchetype('destination');
      const destRes = await window.fetch('/api/weather');
      expect(destRes.status).toBe(200);
      const destForecast = await destRes.json();
      expect(destForecast.isLiveForecast).toBe(false);
      expect(destForecast.daily.temperature_2m_max[0]).toBe(62);

      // Tropical venue override (Maui July -> warm tropical band)
      updateDemoConfigOverrides({
        latitude: 20.7984,
        longitude: -156.3319,
        weddingDate: new Date('2026-07-18T18:00:00.000Z'),
        timezone: 'Pacific/Honolulu',
      });
      const tropicalRes = await window.fetch('/api/weather');
      expect(tropicalRes.status).toBe(200);
      const tropicalForecast = await tropicalRes.json();
      expect(tropicalForecast.daily.temperature_2m_max[0]).toBeGreaterThanOrEqual(85);

      // Custom venue override (high latitude winter)
      updateDemoConfigOverrides({
        latitude: 64.1466,
        longitude: -21.9426,
        weddingDate: new Date('2026-12-12T16:00:00.000Z'),
        timezone: 'UTC',
      });
      const customRes = await window.fetch('/api/weather');
      expect(customRes.status).toBe(200);
      const customForecast = await customRes.json();
      expect(customForecast.daily.time).toEqual(['2026-12-12']);
      expect(customForecast.daily.temperature_2m_max[0]).toBeLessThanOrEqual(32);
      expect(fallbackFetch).not.toHaveBeenCalled();
    } finally {
      uninstall();
      window.fetch = originalFetch;
    }
  });

  it('dispatches demo API requests directly without patching window.fetch and provides safe noop stubs for standalone builds', async () => {
    expect(await noopDispatchDemoApiRequest('/api/admin/me')).toBeNull();
    const noopUninstall = noopInstallDemoFetchInterceptor();
    expect(() => noopUninstall()).not.toThrow();

    setDemoPersona('setup');
    const emptySetupCheck = await dispatchDemoApiRequest('/api/admin/setup', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(emptySetupCheck?.status).toBe(200);
    expect(await emptySetupCheck?.json()).toMatchObject({
      success: true,
      requiresSetup: true,
      setupCompleted: false,
    });

    const modulesRes = await dispatchDemoApiRequest('/api/admin/setup', {
      method: 'POST',
      body: JSON.stringify({
        partner1Name: 'Avery',
        partner2Name: 'Jordan',
        modules: { weather: false, interactive3D: false },
      }),
    });
    expect(modulesRes?.status).toBe(200);
    expect(getDemoState().configOverrides.modules?.weather).toBe(false);
    expect(getDemoState().configOverrides.modules?.interactive3D).toBe(false);

    const completeRes = await dispatchDemoApiRequest('/api/admin/setup', {
      method: 'POST',
      body: JSON.stringify({ setupCompleted: true }),
    });
    expect(completeRes?.status).toBe(200);
    expect(getDemoState().persona).toBe('admin');

    // Subpath /api/* normalization works without patching global fetch
    const subpathRes = await dispatchDemoApiRequest('/wedding_website/api/admin/me');
    expect(subpathRes?.status).toBe(200);
    expect(await subpathRes?.json()).toEqual({ isAdmin: true });
  });

  it('normalizes subpath URLs idempotently via basePath helpers', () => {
    expect(getBasePath('')).toBe('');
    expect(getBasePath('/wedding_website/demo/')).toBe('/wedding_website/demo');
    expect(withBasePath('/images/placeholder.png', '/wedding_website/demo')).toBe(
      '/wedding_website/demo/images/placeholder.png'
    );
    expect(
      withBasePath('/wedding_website/demo/images/placeholder.png', '/wedding_website/demo')
    ).toBe('/wedding_website/demo/images/placeholder.png');
    expect(withBasePath('https://example.com/photo.jpg', '/wedding_website/demo')).toBe(
      'https://example.com/photo.jpg'
    );
    expect(stripBasePath('/wedding_website/demo/api/weather', '/wedding_website/demo')).toBe(
      '/api/weather'
    );
    expect(getPortalBaseUrl('/wedding_website/demo')).toBe('/wedding_website/');
    expect(getPortalBaseUrl('/demo')).toBe('/');
  });
});
