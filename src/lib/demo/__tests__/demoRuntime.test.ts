import type { Pool } from 'pg';
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
  previewDemoClaimToken,
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
  consumePrimedDemoFetchInterceptor as noopConsumePrimedDemoFetchInterceptor,
  dispatchDemoApiRequest as noopDispatchDemoApiRequest,
  installDemoFetchInterceptor as noopInstallDemoFetchInterceptor,
  primeDemoRuntimeForMount as noopPrimeDemoRuntimeForMount,
} from '../demoApiHandler.noop';
import * as noopDemoContext from '@/components/demo/DemoContext.noop';
import * as noopDemoToolbar from '@/components/demo/DemoToolbar.noop';
import * as noopDemoSetupSlot from '@/components/demo/DemoSetupSlot.noop';
import * as noopDemoSeed from '../demoSeed.noop';
import * as noopDemoStore from '../demoStore.noop';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { DatabaseBackupSchema, formatZodIssues, reviveDates } from '@/utils/backupValidation';
import { isDemoRuntimeFlagActive } from '../runtimeFlag';
import { buildRegistryEditItemHref as buildRegistryEditItemHrefDirect } from '@/lib/sampleData/registryEditHref';
import { buildRegistryEditItemHref as buildRegistryEditItemHrefFromBuilder } from '@/lib/sampleData/builder';

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

      // Unverified invitation code without active guestSession is rejected with 403
      expect(
        (
          await window.fetch('/api/registry/contribute', {
            method: 'POST',
            body: JSON.stringify({
              itemId: createdItem.id,
              purchaserName: 'Pat Guest',
              amount: 250,
              code: 'SMITH2026',
            }),
          })
        ).status
      ).toBe(403);

      const seededGuest = getActiveArchetypeDataset().guests[0]!;
      await window.fetch('/api/registry/validate-code', {
        method: 'POST',
        body: JSON.stringify({ code: seededGuest.code }),
      });

      const contribRes = await (
        await window.fetch('/api/registry/contribute', {
          method: 'POST',
          body: JSON.stringify({
            itemId: createdItem.id,
            purchaserName: 'Pat Guest',
            amount: 250,
            code: seededGuest.code,
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

      await window.fetch('/api/registry/session', { method: 'DELETE' });

      // Card contribution with paymentIntentId requires matching clientSecret (403 if omitted)
      expect(
        (
          await window.fetch('/api/registry/contribute', {
            method: 'POST',
            body: JSON.stringify({
              itemId: createdFund.id,
              purchaserName: 'Card Guest',
              amount: 40,
              paymentIntentId: 'pi_demo_test123',
            }),
          })
        ).status
      ).toBe(403);

      const guestAddressBefore = getActiveArchetypeDataset().guests[0]!.addressLine1;
      const cardContrib = await (
        await window.fetch('/api/registry/contribute', {
          method: 'POST',
          body: JSON.stringify({
            itemId: createdFund.id,
            purchaserName: 'Card Guest',
            email: seededGuest.email || 'guest@example.com',
            addressLine1: '999 Unverified Email Way',
            city: 'Chicago',
            state: 'IL',
            zipCode: '60699',
            amount: 40,
            paymentIntentId: 'pi_demo_test123',
            clientSecret: 'pi_demo_test123_secret_demo',
          }),
        })
      ).json();
      expect(cardContrib.amountContributed).toBe(40);
      expect(getActiveArchetypeDataset().guests[0]!.addressLine1).toBe(guestAddressBefore);

      expect((await window.fetch('/api/registry/claim')).status).toBe(400);
      expect((await window.fetch('/api/registry/claim?token=bad')).status).toBe(404);
      const claimPreviewDirect = previewDemoClaimToken(contribRes.claimActions.confirmToken);
      expect(claimPreviewDirect).toMatchObject({
        status: 'RESERVED',
        action: 'confirm',
        itemName: 'Pro Espresso Grinder',
        amount: 250,
      });
      const claimGetRes = await (
        await window.fetch(`/api/registry/claim?token=${contribRes.claimActions.confirmToken}`)
      ).json();
      expect(claimGetRes.status).toBe('RESERVED');
      expect(claimGetRes.action).toBe('confirm');
      expect(claimGetRes.itemName).toBe('Pro Espresso Grinder');
      expect(claimGetRes.amount).toBe(250);
      const itemStillReserved = await (
        await window.fetch(`/api/registry/items/${createdItem.id}`)
      ).json();
      expect(itemStillReserved.contributors[0].status).toBe('RESERVED');

      const claimConfirmRes = await (
        await window.fetch('/api/registry/claim', {
          method: 'POST',
          body: JSON.stringify({ token: contribRes.claimActions.confirmToken }),
        })
      ).json();
      expect(claimConfirmRes.status).toBe('CONFIRMED');
      const itemAfterConfirm = await (
        await window.fetch(`/api/registry/items/${createdItem.id}`)
      ).json();
      expect(itemAfterConfirm.contributors[0].status).toBe('CONFIRMED');

      const claimCancelRes = await (
        await window.fetch('/api/registry/claim', {
          method: 'POST',
          body: JSON.stringify({ token: contribRes.claimActions.cancelToken }),
        })
      ).json();
      expect(claimCancelRes.status).toBe('CANCELLED');
      const itemAfterCancel = await (
        await window.fetch(`/api/registry/items/${createdItem.id}`)
      ).json();
      expect(itemAfterCancel.purchased).toBe(false);
      expect(itemAfterCancel.amountContributed).toBe(0);

      expect((await window.fetch(`/api/registry/items/${createdItem.id}`, { method: 'DELETE' })).status).toBe(200);

      // Validate code & guest address portal
      expect((await window.fetch('/api/registry/validate-code?code=INVALID')).status).toBe(404);
      expect(
        (
          await window.fetch('/api/registry/validate-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: '   ' }),
          })
        ).status
      ).toBe(400);
      expect((await window.fetch('/api/guest/address')).status).toBe(401);
      expect((await (await window.fetch('/api/registry/session')).json()).isVerified).toBe(false);

      const readOnlyCodeRes = await (
        await window.fetch('/api/registry/validate-code?code=SMITH2026')
      ).json();
      expect(readOnlyCodeRes.valid).toBe(true);
      expect((await (await window.fetch('/api/registry/session')).json()).isVerified).toBe(false);

      const validCodeRes = await (
        await window.fetch('/api/registry/validate-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: 'SMITH2026' }),
        })
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

      const rsvpSummaryData = (await (await window.fetch('/api/admin/sub-events/rsvp-summary')).json()).data;
      expect(Array.isArray(rsvpSummaryData.subEvents)).toBe(true);
      expect(rsvpSummaryData.subEvents.length).toBeGreaterThan(0);
      const subEventAccessData = (await (await window.fetch('/api/admin/sub-events/access')).json()).data;
      expect(subEventAccessData.subEvents.length).toBeGreaterThan(0);
      expect((await window.fetch('/api/admin/sub-events/access/batch', { method: 'POST' })).status).toBe(200);
      expect((await (await window.fetch('/api/admin/sub-events')).json()).data.length).toBeGreaterThan(0);
      expect((await (await window.fetch('/api/admin/invitation-codes/rsvps')).json()).data.length).toBeGreaterThan(0);
      expect((await (await window.fetch('/api/admin/broadcast/history')).json()).data.length).toBeGreaterThan(0);
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
      expect((await window.fetch('/api/admin/overview-stats')).status).toBe(404);

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

      const previewCodeRes = await window.fetch('/api/registry/validate-code?code=SMITH2026');
      expect(previewCodeRes.status).toBe(200);
      expect(await (await window.fetch('/api/guest/session')).json()).toEqual(
        expect.objectContaining({ status: 'none', isVerified: false })
      );

      await window.fetch('/api/registry/validate-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'SMITH2026' }),
      });
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
      expect(moderationPayload.photos.length).toBeGreaterThanOrEqual(1);
      expect(moderationPayload.data.length).toBeGreaterThanOrEqual(1);
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

      // Registry item alias resolution & full field persistence across /api/registry/items* and /api/admin/registry-items*
      resetDemoState();
      setDemoRuntimeActive(true);
      const aliasGetOne = await (await window.fetch('/api/registry/items/1')).json();
      expect(aliasGetOne.id).toBe('demo-classic-item-1');
      const aliasGetSample = await (
        await window.fetch('/api/registry/items/sample-registry-classic-1')
      ).json();
      expect(aliasGetSample.id).toBe('demo-classic-item-1');

      const updatedViaAdminAlias = await (
        await window.fetch('/api/admin/registry-items/sample-registry-classic-1', {
          method: 'PUT',
          body: JSON.stringify({
            name: 'Heirloom Stand Mixer',
            description: 'Updated description for demo showcase',
            category: 'Baking',
            price: 399.5,
            quantity: 2,
            itemType: 'PHYSICAL',
            isGroupGift: true,
            isMostWanted: false,
            displayOrder: 4,
            vendorUrl: 'https://example.com/gifts/heirloom-mixer',
            paymentHandleType: 'PayPal',
            paymentHandle: '@couple-paypal',
            imageUrl: 'https://example.com/images/mixer.png',
            imageAlt: 'Updated mixer alt text',
            imageDecorative: false,
          }),
        })
      ).json();
      expect(updatedViaAdminAlias).toMatchObject({
        id: 'demo-classic-item-1',
        name: 'Heirloom Stand Mixer',
        description: 'Updated description for demo showcase',
        category: 'Baking',
        price: 399.5,
        quantity: 2,
        isGroupGift: true,
        isMostWanted: false,
        displayOrder: 4,
        vendorUrl: 'https://example.com/gifts/heirloom-mixer',
        paymentHandleType: 'PayPal',
        paymentHandle: '@couple-paypal',
      });
      expect(updatedViaAdminAlias.image?.url).toBe('https://example.com/images/mixer.png');
      expect(updatedViaAdminAlias.image?.altText).toBe('Updated mixer alt text');

      const reorderRes = await window.fetch('/api/admin/registry-items', {
        method: 'PUT',
        body: JSON.stringify({
          action: 'reorder',
          orderedIds: ['demo-classic-item-2', 'demo-classic-item-1'],
        }),
      });
      expect(reorderRes.status).toBe(200);

      // Catalog household search supports both ?q= and ?search=
      const qCatalog = await (
        await window.fetch('/api/admin/invitation-codes/catalog?q=Smith')
      ).json();
      expect(qCatalog.data.items.length).toBeGreaterThan(0);

      // Browser-safe binary exports: ICS, Seating CSV/PDF/Meals/PlaceCards/EscortCards, Invitations CSV, Thank-You CSV + Avery PDFs, Maintenance JSON backup
      const icsRes = await window.fetch('/api/schedule/sample-subevent-classic-ceremony/ics');
      expect(icsRes.status).toBe(200);
      expect(icsRes.headers.get('Content-Type')).toContain('text/calendar');
      expect(await icsRes.text()).toContain('BEGIN:VCALENDAR');

      for (const format of ['csv', 'meals'] as const) {
        const seatCsvRes = await window.fetch(`/api/admin/seating/export?format=${format}`);
        expect(seatCsvRes.status).toBe(200);
        expect(seatCsvRes.headers.get('Content-Type')).toContain('text/csv');
        expect((await seatCsvRes.text()).length).toBeGreaterThan(10);
      }
      for (const format of ['pdf', 'place-cards', 'escort-cards'] as const) {
        const seatPdfRes = await window.fetch(`/api/admin/seating/export?format=${format}`);
        expect(seatPdfRes.status).toBe(200);
        expect(seatPdfRes.headers.get('Content-Type')).toContain('application/pdf');
        const seatPdfBytes = new Uint8Array(await seatPdfRes.arrayBuffer());
        expect(new TextDecoder().decode(seatPdfBytes.slice(0, 8))).toContain('%PDF-1.4');
      }

      const inviteCsvRes = await window.fetch('/api/admin/invitation-codes/export');
      expect(inviteCsvRes.status).toBe(200);
      expect(inviteCsvRes.headers.get('Content-Type')).toContain('text/csv');
      expect(await inviteCsvRes.text()).toContain('SMITH2026');

      await window.fetch('/api/registry/validate-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'SMITH2026' }),
      });
      await window.fetch('/api/rsvp', {
        method: 'POST',
        body: JSON.stringify({
          subEventId: 'sample-subevent-classic-ceremony',
          status: 'declined',
          plusOneCount: 2,
          dietaryNotes: 'Gluten-free',
        }),
      });
      const redeemedCsvRes = await window.fetch(
        '/api/admin/invitation-codes/export?status=redeemed'
      );
      const redeemedCsvLines = (await redeemedCsvRes.text()).split(/\r?\n/);
      const smithRedeemedRow = redeemedCsvLines.find((line) => line.startsWith('SMITH2026,'))!;
      expect(smithRedeemedRow).toContain(',0,Gluten-free,');
      await window.fetch('/api/guest/session', { method: 'DELETE' });

      await window.fetch('/api/admin/thank-you-notes', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Aunt Clara',
          amount: 120,
          addressLine1: '500 Maple Ave',
          city: 'Chicago',
          state: 'IL',
          zipCode: '60611',
        }),
      });
      const tyCsvRes = await window.fetch('/api/admin/thank-you-notes/export');
      expect(tyCsvRes.status).toBe(200);
      expect(await tyCsvRes.text()).toContain('Aunt Clara');

      for (const template of ['avery_5160', 'avery_5163'] as const) {
        const labelsRes = await window.fetch(
          `/api/admin/thank-you-notes/export-labels?template=${template}`
        );
        expect(labelsRes.status).toBe(200);
        expect(labelsRes.headers.get('Content-Type')).toContain('application/pdf');
        const labelBytes = new Uint8Array(await labelsRes.arrayBuffer());
        expect(new TextDecoder().decode(labelBytes.slice(0, 8))).toContain('%PDF-1.4');
      }

      const maintExportRes = await window.fetch('/api/admin/maintenance/export');
      expect(maintExportRes.status).toBe(200);
      expect(maintExportRes.headers.get('Content-Type')).toContain('application/json');
      const maintBackupJson = await maintExportRes.json();
      const parsedBackup = DatabaseBackupSchema.safeParse(reviveDates(maintBackupJson));
      expect(parsedBackup.success ? [] : formatZodIssues(parsedBackup.error)).toEqual([]);

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

  it('initializes archetype datasets lazily on demand and keeps runtimeFlag synchronized with demoRuntimeBridge', () => {
    resetDemoState();
    const initialState = getDemoState();

    // Before reading any archetype dataset, zero datasets are materialized and claim preview stays lazy
    expect(Object.keys(JSON.parse(JSON.stringify(initialState.datasets)))).toEqual([]);
    expect(previewDemoClaimToken('nonexistent-token')).toBeNull();
    expect(Object.keys(JSON.parse(JSON.stringify(getDemoState().datasets)))).toEqual([]);

    // Runtime flag stays synchronized with demoRuntimeBridge / demoStore state
    setDemoRuntimeActive(false);
    expect(isDemoRuntimeFlagActive()).toBe(false);
    expect(isDemoRuntimeActive()).toBe(false);
    setDemoRuntimeActive(true);
    expect(isDemoRuntimeFlagActive()).toBe(true);
    expect(isDemoRuntimeActive()).toBe(true);

    // Lightweight registryEditHref module matches builder re-export
    expect(buildRegistryEditItemHrefDirect('item-42', true)).toBe(
      buildRegistryEditItemHrefFromBuilder('item-42', true)
    );
    expect(buildRegistryEditItemHrefDirect('item-42', false)).toBe('/registry/edit-item/item-42');

    // Reading the active ('classic') dataset builds only 'classic'
    const classicDataset = getActiveArchetypeDataset();
    expect(classicDataset.registryItems.length).toBeGreaterThan(0);
    expect(Object.keys(JSON.parse(JSON.stringify(getDemoState().datasets)))).toEqual([
      'classic',
    ]);

    // Switching to 'destination' and reading active dataset builds 'destination' while leaving 'romantic' unbuilt
    setDemoArchetype('destination');
    const destinationDataset = getActiveArchetypeDataset();
    expect(destinationDataset.guests[0].city).toBe('Miami');
    expect(
      Object.keys(JSON.parse(JSON.stringify(getDemoState().datasets))).sort()
    ).toEqual(['classic', 'destination']);
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
    expect(() => noopPrimeDemoRuntimeForMount()).not.toThrow();
    expect(noopConsumePrimedDemoFetchInterceptor()).toBeNull();
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

    // Subpath /api/* normalization, alias lookup, read-only claim preview, and binary exports work via dispatchDemoApiRequest
    const subpathRes = await dispatchDemoApiRequest('/wedding_website/api/admin/me');
    expect(subpathRes?.status).toBe(200);
    expect(await subpathRes?.json()).toEqual({ isAdmin: true });

    const aliasRes = await dispatchDemoApiRequest(
      '/wedding_website/api/registry/items/sample-registry-classic-1'
    );
    expect(aliasRes?.status).toBe(200);
    expect((await aliasRes?.json()).id).toBe('demo-classic-item-1');

    const reconcileAliasRes = await dispatchDemoApiRequest(
      '/wedding_website/api/registry/payment-intent/reconcile',
      {
        method: 'POST',
        body: JSON.stringify({
          paymentIntentId: 'pi_demo_1',
          clientSecret: 'pi_demo_1_secret_demo',
          itemId: 'sample-registry-classic-1',
        }),
      }
    );
    expect(reconcileAliasRes?.status).toBe(200);
    expect(await reconcileAliasRes?.json()).toMatchObject({
      reconciled: true,
      status: 'succeeded',
      itemId: 'demo-classic-item-1',
    });

    const physicalItem = getActiveArchetypeDataset().registryItems.find((i) => !i.isGroupGift)!;
    const reservedContrib = recordDemoContribution({
      itemId: physicalItem.id,
      purchaserName: 'Sandbox Guest',
      amount: physicalItem.price,
    });
    expect(reservedContrib?.claimActions?.confirmToken).toBeDefined();
    const claimPreviewRes = await dispatchDemoApiRequest(
      `/wedding_website/api/registry/claim?token=${encodeURIComponent(reservedContrib!.claimActions!.confirmToken)}`
    );
    expect(claimPreviewRes?.status).toBe(200);
    expect(await claimPreviewRes?.json()).toMatchObject({
      action: 'confirm',
      status: 'RESERVED',
      itemId: physicalItem.id,
    });

    const icsExportRes = await dispatchDemoApiRequest(
      '/wedding_website/api/schedule/sample-subevent-classic-ceremony/ics'
    );
    expect(icsExportRes?.status).toBe(200);
    expect(icsExportRes?.headers.get('Content-Type')).toContain('text/calendar');
    expect(await icsExportRes?.text()).toContain('BEGIN:VCALENDAR');
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

  it('persists FormData photo uploads (<=512KB base64 vs >512KB blob), features array, guest login/lookup, offline gifts, household merge, broadcast, backup import, and snapshot restore', async () => {
    const originalFetch = window.fetch;
    const uninstall = installDemoFetchInterceptor();
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = jest.fn(() => 'blob:http://localhost/demo-large-photo');
    URL.revokeObjectURL = jest.fn();

    try {
      // 1. Features returns a typed array and supports reorder persistence
      const featuresRes = await (await window.fetch('/api/admin/features')).json();
      expect(Array.isArray(featuresRes.data)).toBe(true);
      expect(featuresRes.data.length).toBeGreaterThan(0);

      const reorderedFeatures = [...featuresRes.data].reverse();
      const saveFeaturesRes = await window.fetch('/api/admin/features', {
        method: 'PUT',
        body: JSON.stringify({ features: reorderedFeatures }),
      });
      expect(saveFeaturesRes.status).toBe(200);
      const afterFeatures = await (await window.fetch('/api/admin/features')).json();
      expect(afterFeatures.data[0].id).toBe(reorderedFeatures[0].id);

      // 2. Guest login, lookup, and logout
      const lookupRes = await (
        await window.fetch('/api/guest/lookup', {
          method: 'POST',
          body: JSON.stringify({ guestName: 'Smith' }),
        })
      ).json();
      expect(lookupRes.matches.length).toBeGreaterThan(0);

      const loginRes = await window.fetch('/api/guest/login', {
        method: 'POST',
        body: JSON.stringify({ code: 'SMITH2026' }),
      });
      expect(loginRes.status).toBe(200);
      expect(getDemoState().guestSession?.invitationCode).toBe('SMITH2026');

      await window.fetch('/api/guest/logout', { method: 'POST' });
      expect(getDemoState().guestSession).toBeNull();

      // 3. FormData photo uploads: <=512KB persists as base64 data URL; >512KB uses session blob URL
      const smallBytes = new Uint8Array(1024);
      smallBytes.fill(65);
      const smallFile = new File([smallBytes], 'small-guest.png', { type: 'image/png' });
      const smallForm = new FormData();
      smallForm.append('file', smallFile);
      smallForm.append('uploaderName', 'Taylor Guest');
      smallForm.append('caption', 'Small reception snapshot');

      const smallUploadRes = await (
        await window.fetch('/api/guest/photos/upload', {
          method: 'POST',
          body: smallForm,
        })
      ).json();
      expect(smallUploadRes.success).toBe(true);
      expect(smallUploadRes.data.url).toMatch(/^data:image\/png;base64,/);

      const largeBytes = new Uint8Array(600 * 1024);
      largeBytes.fill(66);
      const largeFile = new File([largeBytes], 'large-guest.jpg', { type: 'image/jpeg' });
      const largeForm = new FormData();
      largeForm.append('file', largeFile);
      largeForm.append('uploaderName', 'Alex Guest');

      const largeUploadRes = await (
        await window.fetch('/api/guest/photos/upload', {
          method: 'POST',
          body: largeForm,
        })
      ).json();
      expect(largeUploadRes.success).toBe(true);
      expect(largeUploadRes.data.url).toBe('blob:http://localhost/demo-large-photo');
      expect(URL.createObjectURL).toHaveBeenCalled();

      // Approve uploaded photo via moderation batch
      const modBatchRes = await window.fetch('/api/admin/photos/moderation/batch', {
        method: 'POST',
        body: JSON.stringify({ ids: [smallUploadRes.data.id], action: 'approve' }),
      });
      expect(modBatchRes.status).toBe(200);

      // 4. Offline thank-you gift persists across storage re-hydration
      const offlineCreate = await (
        await window.fetch('/api/admin/thank-you-notes', {
          method: 'POST',
          body: JSON.stringify({
            name: 'Persistent Offline Uncle',
            amount: 250,
            giftName: 'Crystal Decanter',
            thankYouStatus: 'Pending',
          }),
        })
      ).json();
      expect(offlineCreate.id).toBeDefined();

      hydrateDemoStateFromStorage();
      const tyAfterHydrate = await (await window.fetch('/api/admin/thank-you-notes')).json();
      expect(
        tyAfterHydrate.items.some(
          (item: { name: string }) => item.name === 'Persistent Offline Uncle'
        )
      ).toBe(true);

      // 5. Household merge combines guests and removes secondary record
      const g1 = await (
        await window.fetch('/api/admin/invitation-codes', {
          method: 'POST',
          body: JSON.stringify({
            guestName: 'Primary Household',
            code: 'MERGEPRI',
            plusOneAllocations: 1,
          }),
        })
      ).json();
      const g2 = await (
        await window.fetch('/api/admin/invitation-codes', {
          method: 'POST',
          body: JSON.stringify({
            guestName: 'Secondary Household',
            code: 'MERGESEC',
            plusOneAllocations: 2,
          }),
        })
      ).json();
      const mergeRes = await window.fetch('/api/admin/invitation-codes/merge', {
        method: 'POST',
        body: JSON.stringify({
          primaryId: g1.data.id,
          secondaryIds: [g2.data.id],
        }),
      });
      expect(mergeRes.status).toBe(200);
      expect((await window.fetch(`/api/admin/invitation-codes/${g2.data.id}`)).status).toBe(404);

      // 6. Broadcast preview & send persist into history
      const previewBroadcast = await (
        await window.fetch('/api/admin/broadcast/preview', {
          method: 'POST',
          body: JSON.stringify({ subject: 'Shuttle Update', body: 'Buses depart at 4pm' }),
        })
      ).json();
      expect(previewBroadcast.data.recipientCount).toBeGreaterThan(0);

      const sendBroadcast = await window.fetch('/api/admin/broadcast/send', {
        method: 'POST',
        body: JSON.stringify({ subject: 'Shuttle Update', body: 'Buses depart at 4pm' }),
      });
      expect(sendBroadcast.status).toBe(201);

      // 7. Database backup export -> import round-trip & version restore
      const exportedBackup = await (await window.fetch('/api/admin/maintenance/export')).json();
      const importRes = await window.fetch('/api/admin/maintenance/import', {
        method: 'POST',
        body: JSON.stringify(exportedBackup),
      });
      expect(importRes.status).toBe(200);

      const versionsList = (await (await window.fetch('/api/admin/versions')).json()).data.items;
      expect(versionsList.length).toBeGreaterThan(0);
      const restorable = versionsList.find(
        (v: { hasSnapshot?: boolean }) => v.hasSnapshot !== false
      );
      if (restorable) {
        const restoreRes = await window.fetch(`/api/admin/versions/${restorable.id}/restore`, {
          method: 'POST',
        });
        expect(restoreRes.status).toBe(200);
      }

      // Reset revokes session blob URLs
      resetDemoState();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/demo-large-photo');
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
      uninstall();
      window.fetch = originalFetch;
    }
  });
});

describe('jsdom-env.cjs Node timer handles, pg.Pool allowExitOnIdle, and unref() semantics', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('returns Node timer handles supporting .unref(), .ref(), and hasRef() === false across real and fake timer transitions', () => {
    const realHandle = setTimeout(() => {}, 10_000);
    try {
      expect(typeof realHandle.unref).toBe('function');
      expect(typeof realHandle.ref).toBe('function');
      expect(typeof realHandle.hasRef).toBe('function');
      expect(realHandle.hasRef()).toBe(true);
      expect(realHandle.unref()).toBe(realHandle);
      expect(realHandle.hasRef()).toBe(false);
      realHandle.ref();
      expect(realHandle.hasRef()).toBe(true);
      realHandle.unref();
      expect(realHandle.hasRef()).toBe(false);
    } finally {
      clearTimeout(realHandle);
    }

    const intervalHandle = setInterval(() => {}, 10_000);
    try {
      expect(intervalHandle.unref()).toBe(intervalHandle);
      expect(intervalHandle.hasRef()).toBe(false);
    } finally {
      clearInterval(intervalHandle);
    }

    jest.useFakeTimers();
    const fakeFired: string[] = [];
    const fakeHandle = setTimeout(() => {
      fakeFired.push('fired');
    }, 250);
    expect(typeof fakeHandle.unref).toBe('function');
    fakeHandle.unref();
    expect(fakeHandle.hasRef()).toBe(false);
    jest.advanceTimersByTime(250);
    expect(fakeFired).toEqual(['fired']);

    jest.useRealTimers();
    const restoredHandle = setTimeout(() => {}, 10_000);
    try {
      restoredHandle.unref();
      expect(restoredHandle.hasRef()).toBe(false);
    } finally {
      clearTimeout(restoredHandle);
    }
  });

  it('executes pg.Pool with allowExitOnIdle: true in jsdom-env.cjs without TypeError', async () => {
    const net = await import('node:net');
    const { Pool } = await import('pg');

    // Minimal loopback server that speaks PostgreSQL Startup -> AuthenticationOk -> ReadyForQuery -> Terminate
    const server = net.createServer((socket) => {
      let startupHandled = false;
      socket.on('data', () => {
        if (!startupHandled) {
          startupHandled = true;
          // AuthenticationOk ('R', len=8, status=0) + ReadyForQuery ('Z', len=5, 'I')
          const authOk = Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0]);
          const ready = Buffer.from([0x5a, 0, 0, 0, 5, 0x49]);
          socket.write(Buffer.concat([authOk, ready]));
        } else {
          socket.end();
        }
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 5432;

    const pool = new Pool({
      host: '127.0.0.1',
      port,
      user: 'wedding',
      database: 'wedding_test',
      ssl: false,
      idleTimeoutMillis: 50,
      allowExitOnIdle: true,
    });

    try {
      const client = await pool.connect();
      client.release();
    } finally {
      await pool.end();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('reports hasRef() === false on timers created by rateLimit queryPoolWithTimeout and prisma shutdown safety timers under jsdom-env.cjs', async () => {
    const { NextRequest } = await import('next/server');
    const { createAuthLockoutInstance } = await import('@/utils/rateLimit');

    const capturedRateLimitTimers: Array<ReturnType<typeof setTimeout>> = [];
    const realSetTimeout = globalThis.setTimeout;
    const timeoutSpy = jest
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(((cb: (..._args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
        const handle = realSetTimeout(cb, ms, ...args);
        capturedRateLimitTimers.push(handle);
        return handle;
      }) as typeof setTimeout);

    let resolveQuery!: (_value: { rows: never[] }) => void;
    const mockPool = {
      query: jest.fn(
        () =>
          new Promise<{ rows: never[] }>((resolve) => {
            resolveQuery = resolve;
          })
      ),
      ending: false,
      ended: false,
    } as unknown as Pool;

    const lockout = createAuthLockoutInstance({
      pool: mockPool,
      queryTimeoutMs: 5000,
    });
    const req = new NextRequest('http://localhost/api/admin/login', { method: 'POST' });
    const pendingCheck = lockout.checkLockout(req, 5, 60_000);

    expect(capturedRateLimitTimers.length).toBeGreaterThan(0);
    const rateLimitTimer = capturedRateLimitTimers[capturedRateLimitTimers.length - 1];
    expect(rateLimitTimer.hasRef()).toBe(false);

    resolveQuery({ rows: [] });
    await pendingCheck;
    timeoutSpy.mockRestore();

    // Verify both safetyTimer branches in src/lib/prisma.ts (L119-L123 and L149-L153) under jsdom-env.cjs
    const originalExit = process.exit;
    const globalState = globalThis as unknown as Record<string, unknown>;
    const savedPrismaState = {
      prisma: globalState.prisma,
      pgPool: globalState.pgPool,
      prismaShutdownRegistered: globalState.prismaShutdownRegistered,
      prismaShutdownPromise: globalState.prismaShutdownPromise,
    };

    for (const hasFrameworkListener of [true, false]) {
      const capturedSafetyTimers: Array<ReturnType<typeof setTimeout>> = [];
      const registeredSignals = new Map<string, () => void>();

      delete globalState.prisma;
      delete globalState.pgPool;
      delete globalState.prismaShutdownRegistered;
      delete globalState.prismaShutdownPromise;

      process.exit = jest.fn(() => undefined as never) as unknown as typeof process.exit;
      const onceSpy = jest.spyOn(process, 'once').mockImplementation(((
        event: string | symbol,
        listener: (..._args: unknown[]) => void
      ) => {
        registeredSignals.set(String(event), () => listener(event));
        return process;
      }) as typeof process.once);
      const listenerCountSpy = jest
        .spyOn(process, 'listenerCount')
        .mockImplementation((event: string | symbol) =>
          hasFrameworkListener && event === 'SIGTERM' ? 1 : 0
        );
      const safetySpy = jest
        .spyOn(globalThis, 'setTimeout')
        .mockImplementation(((
          cb: (..._args: unknown[]) => void,
          ms?: number,
          ...args: unknown[]
        ) => {
          const handle = realSetTimeout(cb, ms, ...args);
          capturedSafetyTimers.push(handle);
          return handle;
        }) as typeof setTimeout);

      try {
        await jest.isolateModulesAsync(async () => {
          jest.doMock('pg', () => ({
            Pool: jest.fn().mockImplementation(() => ({
              end: jest.fn().mockResolvedValue(undefined),
              ending: false,
              ended: false,
            })),
          }));
          jest.doMock('@prisma/adapter-pg', () => ({
            PrismaPg: jest.fn().mockImplementation(() => ({})),
          }));
          jest.doMock('@prisma/client', () => ({
            PrismaClient: jest.fn().mockImplementation(() => ({
              $disconnect: jest.fn().mockResolvedValue(undefined),
            })),
          }));
          jest.doMock('@/env', () => ({
            env: {
              DATABASE_URL: 'postgresql://wedding:wedding123@localhost:5432/wedding_test',
              NODE_ENV: 'production',
            },
          }));

          await import('@/lib/prisma');
        });

        registeredSignals.get('SIGTERM')!();
        if (hasFrameworkListener) {
          process.exit(143);
        }

        expect(capturedSafetyTimers.length).toBeGreaterThan(0);
        const safetyTimer = capturedSafetyTimers[capturedSafetyTimers.length - 1];
        expect(safetyTimer.hasRef()).toBe(false);

        await (globalState.prismaShutdownPromise as Promise<void>);
      } finally {
        safetySpy.mockRestore();
        listenerCountSpy.mockRestore();
        onceSpy.mockRestore();
        process.exit = originalExit;
        jest.dontMock('pg');
        jest.dontMock('@prisma/adapter-pg');
        jest.dontMock('@prisma/client');
        jest.dontMock('@/env');
      }
    }

    globalState.prisma = savedPrismaState.prisma;
    globalState.pgPool = savedPrismaState.pgPool;
    globalState.prismaShutdownRegistered = savedPrismaState.prismaShutdownRegistered;
    globalState.prismaShutdownPromise = savedPrismaState.prismaShutdownPromise;
  });

  it('matches runtime export signatures across all standalone .noop.ts demo stubs and returns inert values', async () => {
    const _contextParity: typeof import('@/components/demo/DemoContext') = noopDemoContext;
    const _toolbarParity: typeof import('@/components/demo/DemoToolbar') = noopDemoToolbar;
    const _setupSlotParity: typeof import('@/components/demo/DemoSetupSlot') = noopDemoSetupSlot;
    const _seedParity: typeof import('../demoSeed') = noopDemoSeed;
    const _storeParity: typeof import('../demoStore') = noopDemoStore;

    expect(_contextParity.useOptionalDemo()).toBeNull();
    expect(_toolbarParity.DemoToolbar()).toBeNull();
    expect(
      _setupSlotParity.DemoSetupSlot({
        className: 'pb-28',
        resetCounter: 1,
        onDemoComplete: () => {},
      })
    ).toBeNull();

    const { unmount } = render(
      createElement(_contextParity.DemoProvider, {
        enabled: true,
        children: createElement('span', { 'data-testid': 'noop-provider-child' }, 'Standalone Child'),
      })
    );
    expect(screen.getByTestId('noop-provider-child')).toHaveTextContent('Standalone Child');
    unmount();

    expect(_seedParity.DEMO_SHIPPING_ADDRESS.recipientName).toBe('');
    expect(_seedParity.createSampleItemSvgDataUrl('Mixer', 'Kitchen')).toBe('');
    const emptySeed = _seedParity.buildArchetypeDataset('classic');
    expect(emptySeed.registryItems).toEqual([]);
    expect(emptySeed.guests).toEqual([]);
    expect(emptySeed.modules.registry).toBe(false);

    const uploaded = await _storeParity.encodeDemoUploadedFile(new Blob(['img'], { type: 'image/png' }));
    expect(uploaded).toEqual({
      url: '',
      persistentUrl: '',
      isSessionBlob: false,
      sizeBytes: 0,
      mimeType: 'image/jpeg',
    });

    expect(() => _storeParity.hydrateDemoStateFromStorage()).not.toThrow();
    expect(() => _storeParity.setDemoRuntimeActive(true)).not.toThrow();
    expect(_storeParity.isDemoRuntimeActive()).toBe(false);
    expect(_storeParity.isDemoAdminSession()).toBe(false);

    const noopState = _storeParity.getDemoState();
    expect(noopState.persona).toBe('guest');
    expect(noopState.datasets.classic.registryItems).toEqual([]);
    expect(_storeParity.getDemoState()).toBe(noopState);

    const unsub = _storeParity.subscribeDemoState(() => {});
    expect(() => unsub()).not.toThrow();

    expect(() => _storeParity.setDemoPersona('admin')).not.toThrow();
    expect(() => _storeParity.setDemoArchetype('destination')).not.toThrow();
    expect(() => _storeParity.setDemoThemePreset('modern')).not.toThrow();
    expect(() => _storeParity.setDemoToolbarCollapsed(true)).not.toThrow();
    expect(() => _storeParity.setDemoSetupAuthenticated(true)).not.toThrow();
    expect(() => _storeParity.updateDemoConfigOverrides({ partner1Name: 'A' })).not.toThrow();
    expect(() => _storeParity.applyDemoSampleSelection('romantic', ['registry'])).not.toThrow();
    expect(() => _storeParity.purgeDemoSampleData()).not.toThrow();
    expect(() => _storeParity.resetDemoState()).not.toThrow();

    expect(_storeParity.getActiveArchetypeDataset().registryItems).toEqual([]);
    expect(_storeParity.findDemoGuestByCode('SMITH2026')).toBeNull();
    expect(() => _storeParity.setDemoGuestSession(null)).not.toThrow();
    expect(_storeParity.updateDemoGuestAddress('SMITH2026', { city: 'Chicago' })).toBeNull();
    expect(_storeParity.resolveDemoRegistryItemIdAlias([], '1')).toBeNull();
    expect(
      _storeParity.recordDemoContribution({
        itemId: '1',
        purchaserName: 'Guest',
        amount: 50,
      })
    ).toBeNull();
    expect(_storeParity.previewDemoClaimToken('tok')).toBeNull();
    expect(_storeParity.processDemoClaimToken('tok')).toBeNull();
    expect(() => _storeParity.mutateActiveDataset((curr) => curr)).not.toThrow();
    expect(_storeParity.getEffectiveDemoSettings()).toEqual({});
    expect(_storeParity.getDemoContentNodes(emptySeed)).toEqual([]);

    expect(_storeParity.recordDemoAuditVersion('AppConfig', 'global', 'UPDATE', 'Changed')).toMatchObject({
      entityType: 'AppConfig',
      entityId: 'global',
      action: 'UPDATE',
      summary: 'Changed',
      createdBy: 'Admin',
    });
    expect(
      _storeParity.recordDemoAuditVersion({
        entityType: 'RegistryItem',
        entityId: 'item-1',
        action: 'CREATE',
        summary: 'Added item',
        data: { price: 100 },
        createdBy: 'Couple',
      })
    ).toMatchObject({
      entityType: 'RegistryItem',
      entityId: 'item-1',
      action: 'CREATE',
      summary: 'Added item',
      createdBy: 'Couple',
      data: { price: 100 },
    });
    expect(_storeParity.restoreDemoAuditVersion('v1')).toBeNull();
    expect(_storeParity.buildDemoDatabaseBackup()).toEqual({});
    expect(_storeParity.importDemoDatabaseBackup({})).toEqual({ importedCounts: {} });
  });

  it('defers dataset construction in demoStore and DemoContext at module load and when DemoProvider has enabled=false', async () => {
    let buildCalls = 0;

    await jest.isolateModulesAsync(async () => {
      const actualSeed = jest.requireActual<typeof import('../demoSeed')>('../demoSeed');
      jest.doMock('../demoSeed', () => ({
        ...actualSeed,
        buildArchetypeDataset: jest.fn((...args: Parameters<typeof actualSeed.buildArchetypeDataset>) => {
          buildCalls += 1;
          return actualSeed.buildArchetypeDataset(...args);
        }),
      }));
      jest.doMock('@/lib/demo/demoSeed', () => ({
        ...actualSeed,
        buildArchetypeDataset: jest.fn((...args: Parameters<typeof actualSeed.buildArchetypeDataset>) => {
          buildCalls += 1;
          return actualSeed.buildArchetypeDataset(...args);
        }),
      }));

      const isolatedStore = await import('../demoStore');
      const isolatedContext = await import('@/components/demo/DemoContext');

      // Importing demoStore and DemoContext builds zero archetype datasets
      expect(buildCalls).toBe(0);

      // Rendering DemoProvider with enabled={false} builds zero archetype datasets
      const { unmount } = render(
        createElement(isolatedContext.DemoProvider, {
          enabled: false,
          children: createElement('div', { 'data-testid': 'disabled-demo-child' }, 'Live Site'),
        })
      );
      expect(screen.getByTestId('disabled-demo-child')).toHaveTextContent('Live Site');
      expect(buildCalls).toBe(0);
      unmount();

      // Reading an active archetype dataset builds only that single archetype on demand
      const active = isolatedStore.getActiveArchetypeDataset();
      expect(active.registryItems.length).toBeGreaterThan(0);
      expect(buildCalls).toBe(1);
    });

    jest.dontMock('../demoSeed');
    jest.dontMock('@/lib/demo/demoSeed');
  });
});
