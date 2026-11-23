/**
 * @jest-environment node
 */

import fs from 'node:fs';
import path from 'node:path';
import { createDemoStore } from '../store';
import { createStaticDemoRouter } from '../router';
import {
  STATIC_DEMO_MAX_STORAGE_BYTES,
  STATIC_DEMO_STORAGE_KEY,
  type StaticDemoSnapshot,
} from '../types';

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  public failWrites = false;

  get length(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) {
      const quotaErr = new Error('QuotaExceededError');
      quotaErr.name = 'QuotaExceededError';
      throw quotaErr;
    }
    this.map.set(key, value);
  }
}

const ENTITY_SLUGS = [
  'content-nodes',
  'wedding-party',
  'attractions',
  'registry-items',
  'invitation-codes',
  'seating-tables',
  'sub-events',
] as const;

function resolveEntityRecordId(
  snapshot: StaticDemoSnapshot,
  slug: (typeof ENTITY_SLUGS)[number],
): string {
  switch (slug) {
    case 'content-nodes':
      return snapshot.contentNode[0]?.id ?? 'node-1';
    case 'wedding-party':
      return snapshot.weddingPartyMember[0]?.id ?? 'party-1';
    case 'attractions':
      return snapshot.attraction[0]?.id ?? 'attr-1';
    case 'registry-items':
      return snapshot.registryItem[0]?.id ?? '1';
    case 'invitation-codes':
      return snapshot.invitationCode[0]?.id ?? 'inv-1';
    case 'seating-tables':
      return snapshot.seatingTable[0]?.id ?? 'table-1';
    case 'sub-events':
      return snapshot.subEvent[0]?.id ?? 'sub-1';
  }
}

function buildOpenApiRequestInit(
  method: string,
  resolvedPath: string,
  snapshot: StaticDemoSnapshot,
): { url: string; init: RequestInit } {
  const base = `http://localhost:3000${resolvedPath}`;
  const firstInvite = snapshot.invitationCode[0];
  const secondInvite = snapshot.invitationCode[1];
  const firstItem = snapshot.registryItem[0];
  const firstMedia = snapshot.media[0];
  const firstContrib = snapshot.contributor[0];
  const firstPhotoNode = snapshot.contentNode.find(
    (n) => n.type.toUpperCase() === 'PHOTO',
  );

  if (resolvedPath === '/api/registry/validate-code' && method === 'GET') {
    return {
      url: `${base}?code=${encodeURIComponent(firstInvite?.code ?? 'DEMO2026')}`,
      init: { method },
    };
  }
  if (resolvedPath === '/api/registry/claim' && method === 'GET') {
    return {
      url: `${base}?token=${encodeURIComponent(`demo-claim:confirm:${firstContrib?.id ?? 'c1'}`)}`,
      init: { method },
    };
  }
  if (resolvedPath === '/api/admin/invitation-codes/rsvps' && method === 'GET') {
    return {
      url: `${base}?invitationCodeId=${encodeURIComponent(firstInvite?.id ?? 'inv-1')}`,
      init: { method },
    };
  }
  if (resolvedPath === '/api/admin/geocode' && method === 'GET') {
    return {
      url: `${base}?q=${encodeURIComponent('Glasshouse Estate')}`,
      init: { method },
    };
  }

  if (method === 'GET' || method === 'HEAD') {
    return { url: base, init: { method } };
  }

  if (
    (resolvedPath === '/api/photos/upload' ||
      resolvedPath === '/api/guest/photos/upload' ||
      resolvedPath === '/api/admin/upload' ||
      resolvedPath === '/api/media') &&
    method === 'POST'
  ) {
    const formData = new FormData();
    formData.append(
      'file',
      new Blob(['fake-image-bytes'], { type: 'image/png' }),
      'celebration.png',
    );
    formData.append('caption', 'Dancing under lanterns');
    formData.append('uploaderName', 'Jordan');
    return { url: base, init: { method, body: formData } };
  }

  let body: Record<string, unknown> = { name: 'Demo Entry', title: 'Demo Entry' };

  if (resolvedPath === '/api/guest/login') {
    body = { code: firstInvite?.code ?? 'SMITH2026' };
  } else if (resolvedPath === '/api/guest/lookup') {
    body = { query: firstInvite?.guestName ?? 'Alex' };
  } else if (resolvedPath === '/api/guest/address/public') {
    body = {
      guestName: 'Casey Taylor',
      email: 'casey@example.org',
      addressLine1: '500 Oak St',
      city: 'Minneapolis',
      state: 'MN',
      zipCode: '55401',
    };
  } else if (resolvedPath === '/api/guest/address') {
    body = {
      addressLine1: '742 Evergreen Terrace',
      city: 'Minneapolis',
      state: 'MN',
      zipCode: '55402',
    };
  } else if (resolvedPath === '/api/rsvp') {
    body = {
      rsvps: [
        {
          subEventId: 'sub-3',
          status: 'attending',
          plusOneCount: 1,
          dietaryNotes: 'No peanuts',
          mealSelections: ['meal-veg'],
          customAnswers: { 'q-shuttle': 'Yes, round-trip' },
        },
      ],
    };
  } else if (resolvedPath === '/api/registry/contribute') {
    body = {
      itemId: firstItem?.id ?? '1',
      name: 'Taylor Friend',
      email: 'taylor@example.org',
      amount: 50,
      message: 'Congrats!',
    };
  } else if (resolvedPath === '/api/registry/claim') {
    body = { token: `demo-claim:confirm:${firstContrib?.id ?? 'c1'}` };
  } else if (resolvedPath === '/api/registry/payment-intent') {
    body = {
      itemId: firstItem?.id ?? '1',
      amount: 75,
      name: 'Sam Donor',
      email: 'sam@example.org',
    };
  } else if (resolvedPath === '/api/registry/scrape') {
    body = { url: 'https://shop.example.org/linen-duvet-set' };
  } else if (resolvedPath === '/api/registry/scrape/batch') {
    body = { urls: ['https://shop.example.org/espresso-cup'] };
  } else if (resolvedPath === '/api/registry/items/batch') {
    body = { action: 'update', ids: [firstItem?.id ?? '1'], data: { category: 'Kitchen' } };
  } else if (resolvedPath.endsWith('/send-email') && method === 'POST') {
    body = {
      mode: 'preview',
      body: 'Dear {{guestName}}, thank you so much for {{giftName}}!',
    };
  } else if (resolvedPath === '/api/admin/thank-you-notes' && method === 'POST') {
    body = {
      name: 'Offline Gift Donor',
      amount: 120,
      thankYouStatus: 'Unsent',
    };
  } else if (resolvedPath.endsWith('/unclaim')) {
    body = { confirmVerifiedPayment: true };
  } else if (resolvedPath.startsWith('/api/admin/contributors/')) {
    if (resolvedPath.endsWith('/action')) {
      body = { action: 'confirm' };
    } else if (method === 'PATCH') {
      body = {
        name: 'Updated Donor',
        amount: 75,
        status: 'CONFIRMED',
        confirmVerifiedPayment: true,
      };
    } else if (method === 'DELETE') {
      body = { confirmVerifiedPayment: true };
    } else {
      body = { action: 'confirm' };
    }
  } else if (resolvedPath === '/api/admin/invitation-codes/merge') {
    body = {
      primaryId: firstInvite?.id ?? 'inv-1',
      secondaryIds: secondInvite ? [secondInvite.id] : [],
    };
  } else if (
    resolvedPath === '/api/admin/invitation-codes/validate' ||
    resolvedPath === '/api/admin/invitation-codes/batch/validate'
  ) {
    body = {
      records: [{ code: 'NEWGUEST26', guestName: 'Riley Parker', plusOneAllocations: 1 }],
    };
  } else if (resolvedPath === '/api/admin/invitation-codes/batch') {
    if (method === 'DELETE') {
      body = { ids: [secondInvite?.id ?? 'inv-2'] };
    } else if (method === 'POST') {
      body = {
        records: [{ code: 'IMPORTED99', guestName: 'Morgan Lee', plusOneAllocations: 0 }],
      };
    } else {
      body = { ids: [firstInvite?.id ?? 'inv-1'], data: { partyGroup: 'VIP' } };
    }
  } else if (resolvedPath.endsWith('/batch')) {
    body = {
      action: method === 'DELETE' ? 'delete' : 'update',
      ids: [firstPhotoNode?.id ?? firstMedia?.id ?? 'id-1'],
      status: 'APPROVED',
      thankYouStatus: 'Sent',
      data: { isVisible: true },
    };
  } else if (resolvedPath === '/api/admin/seating/assign') {
    body = {
      invitationCodeId: firstInvite?.id ?? 'inv-1',
      tableId: snapshot.seatingTable[0]?.id ?? null,
      seatNumber: 1,
    };
  } else if (resolvedPath === '/api/admin/seating/auto-assign') {
    body = { clearExisting: false };
  } else if (resolvedPath === '/api/admin/maintenance/import') {
    body = {
      version: '2.0',
      exportedAt: new Date().toISOString(),
      tables: {
        appConfig: snapshot.appConfig,
        media: snapshot.media,
        contentNode: snapshot.contentNode,
        weddingPartyMember: snapshot.weddingPartyMember,
        attraction: snapshot.attraction,
        registryItem: snapshot.registryItem,
        invitationCode: snapshot.invitationCode,
        contributor: snapshot.contributor,
        seatingTable: snapshot.seatingTable,
        subEvent: snapshot.subEvent,
        subEventAccess: snapshot.subEventAccess,
        subEventRsvp: snapshot.subEventRsvp,
        broadcastMessage: snapshot.broadcastMessage,
        broadcastRecipient: snapshot.broadcastRecipient,
        snapshotVersion: snapshot.snapshotVersion,
      },
    };
  } else if (resolvedPath === '/api/admin/photos/qr' && method === 'POST') {
    body = { autoApproveGuestPhotos: true };
  } else if (resolvedPath === '/api/media/export') {
    body = { ids: [firstMedia?.id ?? 'm-1'], preflight: true };
  }

  return {
    url: base,
    init: {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  };
}

describe('Static Demo Fetch Router & Versioned Store', () => {
  it('contains zero server-only SDK imports (@/lib/stripe or @/lib/prisma) across MSW and staticDemo modules', () => {
    const mocksSource = fs.readFileSync(
      path.join(process.cwd(), 'src/mocks/handlers.ts'),
      'utf8',
    );
    expect(mocksSource).not.toMatch(/['"]@\/lib\/stripe['"]/);
    expect(mocksSource).not.toMatch(/['"]@\/lib\/prisma['"]/);

    const staticDemoDir = path.join(process.cwd(), 'src/lib/staticDemo');
    const walkFiles = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.name === '__tests__') return [];
        return entry.isDirectory() ? walkFiles(full) : [full];
      });

    for (const filePath of walkFiles(staticDemoDir)) {
      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).not.toMatch(/from\s+['"]@\/lib\/stripe['"]/);
      expect(content).not.toMatch(/from\s+['"]@\/lib\/prisma['"]/);
      expect(content).not.toMatch(/from\s+['"]pdfkit['"]/);
      expect(content).not.toMatch(/from\s+['"]archiver['"]/);
    }
  });

  it('serves every OpenAPI path and HTTP method (including all 7 dynamic [entity] slugs) with zero 404 or 5xx responses', async () => {
    const specRaw = fs.readFileSync(
      path.join(process.cwd(), 'public/openapi.json'),
      'utf8',
    );
    const spec = JSON.parse(specRaw) as {
      paths: Record<string, Record<string, unknown>>;
    };

    const failures: string[] = [];
    let exercisedOperations = 0;

    for (const [openApiPath, pathItem] of Object.entries(spec.paths)) {
      const methods = Object.keys(pathItem).filter((m) =>
        ['get', 'post', 'put', 'patch', 'delete'].includes(m.toLowerCase()),
      );

      const expandedVariants: Array<{
        template: string;
        entitySlug?: (typeof ENTITY_SLUGS)[number];
      }> = openApiPath.includes('{entity}')
        ? ENTITY_SLUGS.map((slug) => ({ template: openApiPath, entitySlug: slug }))
        : [{ template: openApiPath }];

      for (const variant of expandedVariants) {
        for (const rawMethod of methods) {
          const method = rawMethod.toUpperCase();
          const store = createDemoStore({ storage: null, initialArchetype: 'classic' });
          const router = createStaticDemoRouter({ store, mode: 'browser' });
          const snap = store.getSnapshot();

          let resolvedPath = variant.template;
          if (variant.entitySlug) {
            resolvedPath = resolvedPath.replace('{entity}', variant.entitySlug);
            if (resolvedPath.includes('{id}')) {
              resolvedPath = resolvedPath.replace(
                '{id}',
                resolveEntityRecordId(snap, variant.entitySlug),
              );
            }
          } else if (resolvedPath.includes('{id}')) {
            let idVal = '1';
            if (resolvedPath.startsWith('/api/schedule/')) {
              idVal = snap.subEvent[0]?.id ?? 'sub-1';
            } else if (
              resolvedPath.startsWith('/api/registry/items/') ||
              resolvedPath.startsWith('/api/admin/registry/items/')
            ) {
              idVal = snap.registryItem[0]?.id ?? '1';
            } else if (resolvedPath.startsWith('/api/media/')) {
              idVal = snap.media[0]?.id ?? 'm-1';
            } else if (resolvedPath.startsWith('/api/admin/photos/')) {
              idVal =
                snap.contentNode.find((n) => n.type.toUpperCase() === 'PHOTO')?.id ??
                'photo-1';
            } else if (resolvedPath.startsWith('/api/admin/thank-you-notes/')) {
              idVal = snap.contributor[0]?.id ?? 'c-1';
            } else if (resolvedPath.startsWith('/api/admin/contributors/')) {
              idVal = snap.contributor[0]?.id ?? 'c-1';
            } else if (resolvedPath.startsWith('/api/admin/broadcast/')) {
              idVal = snap.broadcastMessage[0]?.id ?? 'b-1';
            } else if (resolvedPath.startsWith('/api/admin/versions/')) {
              idVal = snap.snapshotVersion[0]?.id ?? 'v-1';
            }
            resolvedPath = resolvedPath.replace('{id}', idVal);
          } else if (resolvedPath.includes('{path}')) {
            resolvedPath = resolvedPath.replace('{path}', 'hero-showcase.svg');
          }

          const { url, init } = buildOpenApiRequestInit(method, resolvedPath, snap);
          const response = await router(url, init);
          exercisedOperations += 1;

          if (!response || response.status === 404 || response.status >= 500) {
            failures.push(
              `${method} ${resolvedPath} -> ${response ? response.status : 'null'}`,
            );
          }
        }
      }
    }

    expect(exercisedOperations).toBeGreaterThanOrEqual(150);
    expect(failures).toEqual([]);
  });

  it('resolves both root (/api/*) and subpath (/wedding_website/demo/api/*) URLs while passing external URLs through', async () => {
    const store = createDemoStore({ storage: null, initialArchetype: 'classic' });
    const router = createStaticDemoRouter({
      store,
      mode: 'browser',
      basePath: '/wedding_website/demo',
    });

    const subpathRes = await router(
      'http://localhost:3000/wedding_website/demo/api/registry/items',
    );
    expect(subpathRes?.status).toBe(200);
    const subpathJson = await subpathRes!.json();
    const subpathItems = subpathJson.data ?? subpathJson;
    expect(Array.isArray(subpathItems)).toBe(true);
    expect(subpathItems.length).toBeGreaterThan(0);
    expect(subpathItems[0].image?.url).toMatch(/^data:image\/svg\+xml;base64,/);

    const rootRes = await router('http://localhost:3000/api/health');
    expect(rootRes?.status).toBe(200);

    const externalRes = await router('https://api.stripe.com/v1/payment_intents');
    expect(externalRes).toBeNull();

    const pageHtmlRes = await router(
      'http://localhost:3000/wedding_website/demo/registry',
    );
    expect(pageHtmlRes).toBeNull();
  });

  it('persists mutations in versioned localStorage (< 2 MB), switches archetypes, resets cleanly, and survives QuotaExceededError', async () => {
    const storage = new MemoryStorage();
    const store1 = createDemoStore({ storage, initialArchetype: 'classic' });
    const router1 = createStaticDemoRouter({ store: store1, mode: 'browser' });

    const serializedInitial = storage.getItem(STATIC_DEMO_STORAGE_KEY);
    expect(serializedInitial).toBeTruthy();
    expect(serializedInitial!.length).toBeLessThan(200_000);
    expect(serializedInitial!.length).toBeLessThan(STATIC_DEMO_MAX_STORAGE_BYTES);

    // Mutate settings via PUT /api/admin/settings
    const putRes = await router1('http://localhost:3000/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        partner1Name: 'Riley Stone',
        partner2Name: 'Quinn Harper',
        venueName: 'Crystal Conservatory',
      }),
    });
    expect(putRes?.status).toBe(200);

    // Re-instantiate store from the same localStorage to simulate browser reload
    const store2 = createDemoStore({ storage });
    expect(store2.getSnapshot().appConfig[0].partner1Name).toBe('Riley Stone');
    expect(store2.getSnapshot().appConfig[0].venueName).toBe('Crystal Conservatory');

    // Switch archetype to destination and romantic
    store2.switchArchetype('destination');
    expect(store2.getSnapshot().activeArchetype).toBe('destination');
    expect(store2.getSnapshot().appConfig[0].venueCity).toBe('Key Biscayne');

    store2.switchArchetype('romantic');
    expect(store2.getSnapshot().activeArchetype).toBe('romantic');
    expect(store2.getSnapshot().appConfig[0].venueCity).toBe('Sonoma');

    // Mutate then reset back to clean romantic preset
    store2.mutate((draft) => {
      draft.appConfig[0].venueCity = 'Modified City';
    });
    expect(store2.getSnapshot().appConfig[0].venueCity).toBe('Modified City');

    store2.reset('romantic');
    expect(store2.getSnapshot().appConfig[0].venueCity).toBe('Sonoma');

    // Simulate QuotaExceededError on storage writes: in-memory state must keep working cleanly
    storage.failWrites = true;
    expect(() => {
      store2.mutate((draft) => {
        draft.appConfig[0].heroTitle = 'In-Memory Resilient';
      });
    }).not.toThrow();
    expect(store2.getSnapshot().appConfig[0].heroTitle).toBe('In-Memory Resilient');
  });

  it('maintains cross-module relational consistency across RSVPs, gift claims/refunds, seating, merges, and backups', async () => {
    const store = createDemoStore({ storage: null, initialArchetype: 'classic' });
    const router = createStaticDemoRouter({ store, mode: 'browser' });

    // 1. Self-serve guest address + login + RSVP updates admin RSVP summary
    const initialAttendingRes = await router(
      'http://localhost:3000/api/admin/sub-events/rsvp-summary',
    );
    const initialAttending = (await initialAttendingRes!.json()).data.global
      .attendingHouseholds as number;

    const missingPostalRes = await router(
      'http://localhost:3000/api/guest/address/public',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guestName: 'Missing Address Guest',
        }),
      },
    );
    expect(missingPostalRes?.status).toBe(400);

    const catalogEntityRes = await router(
      'http://localhost:3000/api/admin/invitation-codes?limit=1000',
    );
    expect(catalogEntityRes?.status).toBe(200);
    expect(catalogEntityRes?.headers.get('X-Limit')).toBe('1000');

    const newAddrRes = await router(
      'http://localhost:3000/api/guest/address/public',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guestName: 'Avery Brooks',
          email: 'avery@example.org',
          addressLine1: '88 Lakeview Ave',
          city: 'Minneapolis',
          state: 'MN',
          zipCode: '55401',
          notes: 'Gate code #4412',
        }),
      },
    );
    expect(newAddrRes?.status).toBe(201);
    const newAddrJson = await newAddrRes!.json();
    const newCode = newAddrJson.code ?? newAddrJson.data?.code;
    const newInviteId = newAddrJson.data?.id as string;
    expect(typeof newCode).toBe('string');
    expect(typeof newInviteId).toBe('string');
    const savedCollectInvite = store
      .getSnapshot()
      .invitationCode.find((inv) => inv.id === newInviteId);
    expect(savedCollectInvite?.dietaryNotes).toBeNull();
    expect(savedCollectInvite?.extraFields?.householdNotes).toBe('Gate code #4412');

    // Unpromoted address-collection rows cannot authenticate as invited guests until promoted
    const unpromotedLoginRes = await router('http://localhost:3000/api/guest/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: newCode }),
    });
    expect(unpromotedLoginRes?.status).toBe(401);

    const unpromotedValidateRes = await router(
      `http://localhost:3000/api/registry/validate-code?code=${encodeURIComponent(newCode)}`,
    );
    expect(unpromotedValidateRes?.status).toBe(404);

    const unpromotedLookupRes = await router(
      'http://localhost:3000/api/guest/lookup',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'avery@example.org' }),
      },
    );
    expect(unpromotedLookupRes?.status).toBe(404);

    const promoteRes = await router(
      'http://localhost:3000/api/admin/invitation-codes/batch',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: [newInviteId],
          tags: ['address-collection'],
          action: 'remove',
        }),
      },
    );
    expect(promoteRes?.status).toBe(200);

    const promotedLoginRes = await router('http://localhost:3000/api/guest/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: newCode }),
    });
    expect(promotedLoginRes?.status).toBe(200);
    const rsvpRes = await router('http://localhost:3000/api/rsvp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rsvps: [
          {
            subEventId: 'sub-3',
            status: 'attending',
            plusOneCount: 1,
            dietaryNotes: 'Vegan, Nut-free',
            mealSelections: ['meal-veg'],
            customAnswers: { 'q-shuttle': 'Yes, round-trip' },
          },
        ],
      }),
    });
    expect(rsvpRes?.status).toBe(200);

    const summaryRes = await router(
      'http://localhost:3000/api/admin/sub-events/rsvp-summary',
    );
    const summaryJson = await summaryRes!.json();
    expect(summaryJson.data.global.attendingHouseholds).toBe(initialAttending + 1);
    expect(summaryJson.data.global.dietary.vegan).toBeGreaterThanOrEqual(1);

    // 2. Registry contribution -> magic-link confirm -> thank-you ledger -> admin void recalculation
    const targetItem = store.getSnapshot().registryItem[0]!;
    const contribRes = await router('http://localhost:3000/api/registry/contribute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemId: targetItem.id,
        name: 'Jordan Gift',
        email: 'jordan@example.org',
        amount: targetItem.price,
        paymentMethod: 'VENMO',
      }),
    });
    expect(contribRes?.status).toBe(200);
    const contribBody = await contribRes!.json();
    const claimActions = contribBody.data?.claimActions ?? contribBody.claimActions;
    expect(claimActions?.confirmToken).toContain('demo-claim:confirm:');

    // Confirm via claim token
    const confirmToken = claimActions.confirmToken as string;
    const claimRes = await router('http://localhost:3000/api/registry/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: confirmToken }),
    });
    expect(claimRes?.status).toBe(200);

    // Verify Thank-You Notes ledger sees the new contributor
    const tyRes = await router('http://localhost:3000/api/admin/thank-you-notes');
    const tyJson = await tyRes!.json();
    const tyList = tyJson.data?.items ?? tyJson.items ?? tyJson.data ?? [];
    const createdNote = tyList.find(
      (n: { name: string }) => n.name === 'Jordan Gift',
    );
    expect(createdNote).toBeDefined();

    // Void the contribution in admin and verify item purchased resets to false
    const voidRes = await router(
      `http://localhost:3000/api/admin/contributors/${createdNote.id}/action`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'void' }),
      },
    );
    expect(voidRes?.status).toBe(200);
    const refreshedItem = store
      .getSnapshot()
      .registryItem.find((i) => i.id === targetItem.id)!;
    expect(refreshedItem.purchased).toBe(false);
    expect(refreshedItem.amountContributed).toBe(0);

    // 3. Backup export -> mutate -> restore via backup import
    const exportRes = await router(
      'http://localhost:3000/api/admin/maintenance/export',
    );
    expect(exportRes?.status).toBe(200);
    const backupJson = await exportRes!.json();
    expect(backupJson.version).toBe('2.0');

    store.switchArchetype('destination');
    expect(store.getSnapshot().appConfig[0].venueCity).toBe('Key Biscayne');

    const importRes = await router(
      'http://localhost:3000/api/admin/maintenance/import',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(backupJson),
      },
    );
    expect(importRes?.status).toBe(200);
    expect(store.getSnapshot().appConfig[0].venueCity).toBe('Minneapolis');
  });

  it('supports floorplan landmarks, inline party seat assignments, and all caterer export formats', async () => {
    const store = createDemoStore({ storage: null, initialArchetype: 'classic' });
    const router = createStaticDemoRouter({ store, mode: 'browser' });

    // Create a 0-capacity dance-floor landmark
    const landmarkRes = await router('http://localhost:3000/api/admin/seating-tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Grand Dance Floor',
        shape: 'dance-floor',
        capacity: 0,
        x: 320,
        y: 220,
      }),
    });
    expect(landmarkRes?.status).toBe(201);
    const landmarkJson = await landmarkRes!.json();
    const landmark = landmarkJson.data ?? landmarkJson;
    expect(landmark.shape).toBe('dance-floor');
    expect(landmark.capacity).toBe(0);

    // Reject assigning a guest to a landmark
    const guestWithPlusOne = store
      .getSnapshot()
      .invitationCode.find((inv) => inv.plusOneAllocations > 0)!;
    const badAssignRes = await router('http://localhost:3000/api/admin/seating/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        invitationCodeId: guestWithPlusOne.id,
        tableId: landmark.id,
        seatNumber: 1,
      }),
    });
    expect(badAssignRes?.status).toBe(400);

    // Assign guest with plus-one to a real guest table and verify plusOneSeatNumbers
    const guestTable = store
      .getSnapshot()
      .seatingTable.find((t) => t.capacity > 0)!;
    const assignRes = await router('http://localhost:3000/api/admin/seating/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        invitationCodeId: guestWithPlusOne.id,
        tableId: guestTable.id,
        seatNumber: 1,
        plusOneSeatNumbers: [2],
      }),
    });
    expect(assignRes?.status).toBe(200);
    const assignedJson = await assignRes!.json();
    const assignedGuest = assignedJson.data ?? assignedJson;
    expect(assignedGuest.id).toBe(guestWithPlusOne.id);
    expect(assignedGuest.seatNumber).toBe(1);
    expect(assignedGuest.plusOneSeatNumbers).toEqual([2]);

    // Verify all 5 caterer / floorplan export formats succeed and omit landmarks
    const rosterRes = await router('http://localhost:3000/api/admin/seating/export');
    expect(rosterRes?.status).toBe(200);
    expect(rosterRes?.headers.get('content-disposition')).toContain('seating-roster-');
    const rosterText = await rosterRes!.text();
    expect(rosterText).toContain('Plus-One Seats');
    expect(rosterText).toContain('Table Meal Counts');
    expect(rosterText).not.toContain('Grand Dance Floor');

    const mealsRes = await router(
      'http://localhost:3000/api/admin/seating/export?format=meals',
    );
    expect(mealsRes?.status).toBe(200);
    expect(mealsRes?.headers.get('content-disposition')).toContain(
      'seating-meal-counts-',
    );
    const mealsText = await mealsRes!.text();
    expect(mealsText).toContain('Entree Counts');
    expect(mealsText).toContain('TOTAL');
    expect(mealsText).not.toContain('Grand Dance Floor');

    for (const pdfFormat of ['pdf', 'place-cards', 'escort-cards'] as const) {
      const pdfRes = await router(
        `http://localhost:3000/api/admin/seating/export?format=${pdfFormat}`,
      );
      expect(pdfRes?.status).toBe(200);
      expect(pdfRes?.headers.get('content-type')).toBe('application/pdf');
    }
  });

  it('enforces PR #1242 guest privacy masking, admin email sanitization, purchaserName contributions, and 409 verified-payment guards', async () => {
    const store = createDemoStore({ storage: null, initialArchetype: 'classic' });
    const router = createStaticDemoRouter({ store, mode: 'browser' });

    // Log out admin to test public guest privacy masking
    await router('http://localhost:3000/api/admin/logout', { method: 'POST' });
    expect(store.getSnapshot().isAdminAuthenticated).toBe(false);

    // UI contribution payload uses purchaserName (from useRegistry.ts / RegistryItemCard)
    const targetItem = store
      .getSnapshot()
      .registryItem.find((item) => !item.isSample && !item.purchased)!;
    const contributeRes = await router(
      'http://localhost:3000/api/registry/contribute',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: targetItem.id,
          purchaserName: 'Casey Guest',
          email: 'casey@example.org',
          amount: 45,
          message: 'Enjoy!',
        }),
      },
    );
    expect(contributeRes?.status).toBe(200);
    const contributeJson = await contributeRes!.json();
    const contributedDto = contributeJson.data ?? contributeJson;
    expect(contributedDto.purchaserName).toBe('Anonymous');
    expect(contributedDto.contributors).toEqual([]);
    expect(contributedDto.claimActions?.confirmToken).toBeTruthy();
    expect(contributedDto.claimActions?.cancelToken).toBeTruthy();

    // Public GET /api/registry/items masks purchaserName & active contributor identities
    const publicItemsRes = await router(
      'http://localhost:3000/api/registry/items?sortBy=price-asc',
    );
    expect(publicItemsRes?.status).toBe(200);
    const publicItemsJson = await publicItemsRes!.json();
    const publicItems = (publicItemsJson.data ?? publicItemsJson) as Array<{
      id: string;
      price: number;
      purchaserName: string | null;
      contributors: Array<Record<string, unknown>>;
    }>;
    expect(publicItems[0].price).toBeLessThanOrEqual(
      publicItems[publicItems.length - 1].price,
    );
    const publicTarget = publicItems.find((item) => item.id === targetItem.id)!;
    expect(publicTarget.purchaserName).toBe('Anonymous');
    expect(publicTarget.contributors.length).toBeGreaterThan(0);
    expect(publicTarget.contributors[0]).toEqual({
      name: 'Anonymous',
      amount: 'Anonymous',
      date: 'Anonymous',
    });

    // Confirming via claim link then trying to cancel via claim link returns 409
    const confirmClaimRes = await router('http://localhost:3000/api/registry/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: contributedDto.claimActions.confirmToken }),
    });
    expect(confirmClaimRes?.status).toBe(200);

    const cancelConfirmedRes = await router(
      'http://localhost:3000/api/registry/claim',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: contributedDto.claimActions.cancelToken }),
      },
    );
    expect(cancelConfirmedRes?.status).toBe(409);

    // Log back in as admin: embedded contributors omit email, while thank-you-notes retains email
    await router('http://localhost:3000/api/admin/login', { method: 'POST' });
    const adminItemRes = await router(
      `http://localhost:3000/api/registry/items/${targetItem.id}`,
    );
    const adminItemJson = await adminItemRes!.json();
    const adminItem = adminItemJson.data ?? adminItemJson;
    expect(adminItem.purchaserName).toBe('Casey Guest');
    expect(adminItem.contributors[0].name).toBe('Casey Guest');
    expect(adminItem.contributors[0]).not.toHaveProperty('email');

    const thankYouRes = await router(
      'http://localhost:3000/api/admin/thank-you-notes',
    );
    const thankYouJson = await thankYouRes!.json();
    const thankYouData = thankYouJson.data ?? thankYouJson;
    const caseyNote = (thankYouData.items as Array<Record<string, unknown>>).find(
      (n) => n.name === 'Casey Guest',
    )!;
    expect(caseyNote.email).toBe('casey@example.org');

    // Create a Stripe-verified contribution to test 409 reconciliation guards
    const stripeContribRes = await router(
      'http://localhost:3000/api/registry/contribute',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: targetItem.id,
          name: 'Verified Stripe Donor',
          amount: 55,
          paymentIntentId: 'pi_demo_verified_123',
        }),
      },
    );
    expect(stripeContribRes?.status).toBe(200);
    const stripeContrib = store
      .getSnapshot()
      .contributor.find((c) => c.stripePaymentIntentId === 'pi_demo_verified_123')!;

    // Unclaim, PATCH, and DELETE without confirmVerifiedPayment must return 409
    const unclaimBlocked = await router(
      `http://localhost:3000/api/admin/registry/items/${targetItem.id}/unclaim`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    expect(unclaimBlocked?.status).toBe(409);

    const patchBlocked = await router(
      `http://localhost:3000/api/admin/contributors/${stripeContrib.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 60 }),
      },
    );
    expect(patchBlocked?.status).toBe(409);

    const deleteBlocked = await router(
      `http://localhost:3000/api/admin/contributors/${stripeContrib.id}`,
      { method: 'DELETE' },
    );
    expect(deleteBlocked?.status).toBe(409);

    // Unclaim with confirmVerifiedPayment: true cancels active claims and marks Unsent thank-you notes Not Needed
    const unclaimAllowed = await router(
      `http://localhost:3000/api/admin/registry/items/${targetItem.id}/unclaim`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmVerifiedPayment: true }),
      },
    );
    expect(unclaimAllowed?.status).toBe(200);
    const cancelledStripeContrib = store
      .getSnapshot()
      .contributor.find((c) => c.id === stripeContrib.id)!;
    expect(cancelledStripeContrib.status).toBe('CANCELLED');
    expect(cancelledStripeContrib.thankYouStatus).toBe('Not Needed');

    // DELETE with ?confirmVerifiedPayment=true query param succeeds
    const deleteAllowed = await router(
      `http://localhost:3000/api/admin/contributors/${stripeContrib.id}?confirmVerifiedPayment=true`,
      { method: 'DELETE' },
    );
    expect(deleteAllowed?.status).toBe(200);
  });

  it('persists resumable setupCompleted=false state on POST /api/admin/setup for PR #1231 cross-tab recovery', async () => {
    const store = createDemoStore({ storage: null, initialArchetype: 'classic' });
    const router = createStaticDemoRouter({ store, mode: 'browser' });
    store.setSetupMode(true);

    const step2SaveRes = await router('http://localhost:3000/api/admin/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        partner1Name: 'Taylor',
        partner2Name: 'Jordan',
        weddingDate: '2027-06-19',
        baseUrl: 'https://taylorandjordan.org',
        contactEmail: 'hello@taylorandjordan.org',
        venueName: 'Conservatory Hall',
        venueCity: 'Chicago',
        venueState: 'IL',
        timezone: 'America/Chicago',
        setupCompleted: false,
      }),
    });
    expect(step2SaveRes?.status).toBe(200);

    const statusRes = await router('http://localhost:3000/api/admin/setup');
    const statusJson = await statusRes!.json();
    const statusData = statusJson.data ?? statusJson;
    expect(statusData.setupCompleted).toBe(false);
    expect(statusData.requiresSetup).toBe(true);
    expect(store.getSnapshot().appConfig[0].partner1Name).toBe('Taylor');
    expect(store.getSnapshot().appConfig[0].setupCompleted).toBe(false);

    // Completing Step 5 flips setupCompleted true and clears requiresSetup
    const step5Res = await router('http://localhost:3000/api/admin/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setupCompleted: true }),
    });
    expect(step5Res?.status).toBe(200);
    const afterStep5 = store.getSnapshot();
    expect(afterStep5.isSetupMode).toBe(false);
    expect(afterStep5.appConfig[0].setupCompleted).toBe(true);
  });

  it('serves GET /api/admin/geocode candidates by archetype and resolves cross-archetype seeded registry items (#1222, #1248)', async () => {
    const store = createDemoStore({ storage: null, initialArchetype: 'destination' });
    const router = createStaticDemoRouter({ store, mode: 'browser' });

    const shortQuery = await router('http://localhost:3000/api/admin/geocode?q=a');
    expect(shortQuery?.status).toBe(400);

    const geocodeRes = await router(
      'http://localhost:3000/api/admin/geocode?q=Coral%20Gables%20Villa&limit=5',
    );
    expect(geocodeRes?.status).toBe(200);
    const geocodeJson = await geocodeRes!.json();
    expect(geocodeJson.success).toBe(true);
    expect(geocodeJson.data[0]).toMatchObject({
      name: 'Coral Gables Villa',
      city: 'Miami Beach',
      state: 'FL',
    });

    // Cross-archetype seeded item ID from classic resolves cleanly even when active archetype is destination
    const crossArchGet = await router(
      'http://localhost:3000/api/registry/items/sample-registry-classic-1',
    );
    expect(crossArchGet?.status).toBe(200);
    const crossArchJson = await crossArchGet!.json();
    expect((crossArchJson.data ?? crossArchJson).id).toBe('sample-registry-classic-1');

    const crossArchPut = await router(
      'http://localhost:3000/api/registry/items/sample-registry-classic-1',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Stand Mixer', price: 425 }),
      },
    );
    expect(crossArchPut?.status).toBe(200);
    const updatedCross = await crossArchPut!.json();
    expect((updatedCross.data ?? updatedCross).name).toBe('Updated Stand Mixer');
    expect((updatedCross.data ?? updatedCross).price).toBe(425);
  });

  it('supports contributor postal addresses, thank-you email composer, photo moderation overrides, and broadcast open tracking (#1232, #1237, #1239, #1240)', async () => {
    const store = createDemoStore({ storage: null, initialArchetype: 'classic' });
    const router = createStaticDemoRouter({ store, mode: 'browser' });

    // 1. Health probe returns status: 'ok' and database: 'connected' (#1240)
    const healthRes = await router('http://localhost:3000/api/health');
    expect(healthRes?.status).toBe(200);
    const healthJson = await healthRes!.json();
    expect(healthJson.data ?? healthJson).toMatchObject({
      status: 'ok',
      database: 'connected',
    });

    // 2. Broadcast send -> guest code login marks recipient VIEWED & photo upload inherits guestName (#1232, #1237)
    const firstInvite = store.getSnapshot().invitationCode[0]!;
    await router('http://localhost:3000/api/admin/broadcast/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'EMAIL',
        subject: 'Save the Date',
        body: 'Hello {{guestName}}!',
      }),
    });
    expect(
      store
        .getSnapshot()
        .broadcastRecipient.some(
          (r) => r.invitationCodeId === firstInvite.id && r.status === 'SENT',
        ),
    ).toBe(true);

    const loginRes = await router('http://localhost:3000/api/guest/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: firstInvite.code }),
    });
    expect(loginRes?.status).toBe(200);
    expect(
      store
        .getSnapshot()
        .broadcastRecipient.some(
          (r) => r.invitationCodeId === firstInvite.id && r.status === 'VIEWED',
        ),
    ).toBe(true);

    // Upload guest photo without explicit uploaderName -> inherits session guestName
    const uploadRes = await router('http://localhost:3000/api/guest/photos/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caption: 'Reception Toast' }),
    });
    expect(uploadRes?.status).toBe(201);
    const uploadedNodeId = (await uploadRes!.json()).data[0].nodeId as string;
    const uploadedNode = store
      .getSnapshot()
      .contentNode.find((n) => n.id === uploadedNodeId)!;
    expect(uploadedNode.data.uploaderName).toBe(firstInvite.guestName);

    // Moderate photo with inline caption & uploaderName overrides (#1232)
    const modRes = await router('http://localhost:3000/api/admin/photos/moderation', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: uploadedNodeId,
        action: 'approve',
        caption: 'Curated Reception Toast',
        uploaderName: 'The Newlyweds',
      }),
    });
    expect(modRes?.status).toBe(200);
    const moderatedNode = store
      .getSnapshot()
      .contentNode.find((n) => n.id === uploadedNodeId)!;
    expect(moderatedNode.data.status).toBe('APPROVED');
    expect(moderatedNode.data.caption).toBe('Curated Reception Toast');
    expect(moderatedNode.data.uploaderName).toBe('The Newlyweds');

    // 3. Contributor postal addresses, syncAddressToGuest, skipUnaddressed labels, & thank-you email composer (#1239)
    const targetItem = store.getSnapshot().registryItem[0]!;
    await router('http://localhost:3000/api/registry/contribute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemId: targetItem.id,
        name: 'Postal Donor',
        email: 'postal@example.org',
        amount: 80,
        code: firstInvite.code,
        addressLine1: '900 Summit Ave',
        city: 'St. Paul',
        state: 'MN',
        zipCode: '55105',
        country: 'US',
      }),
    });
    const postalContrib = store
      .getSnapshot()
      .contributor.find((c) => c.name === 'Postal Donor')!;
    expect(postalContrib.addressLine1).toBe('900 Summit Ave');

    // PATCH thank-you note with syncAddressToGuest updates linked invitationCode
    const syncPatchRes = await router(
      `http://localhost:3000/api/admin/thank-you-notes/${postalContrib.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          addressLine1: '901 Grand Ave',
          city: 'St. Paul',
          state: 'MN',
          zipCode: '55105',
          country: 'US',
          syncAddressToGuest: true,
        }),
      },
    );
    expect(syncPatchRes?.status).toBe(200);
    expect(
      store.getSnapshot().invitationCode.find((i) => i.id === firstInvite.id)
        ?.addressLine1,
    ).toBe('901 Grand Ave');

    // Preview & send thank-you email via /send-email
    const previewEmailRes = await router(
      `http://localhost:3000/api/admin/thank-you-notes/${postalContrib.id}/send-email`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'preview',
          body: 'Dear {{guestName}}, thank you for {{amount}} towards {{giftName}}!',
        }),
      },
    );
    expect(previewEmailRes?.status).toBe(200);
    const previewData = (await previewEmailRes!.json()).data;
    expect(previewData.textBody).toContain('Dear Postal Donor');
    expect(previewData.textBody).toContain(targetItem.name);

    const sendEmailRes = await router(
      `http://localhost:3000/api/admin/thank-you-notes/${postalContrib.id}/send-email`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'send',
          subject: 'With Gratitude',
          body: 'Dear {{guestName}}, thank you so much!',
        }),
      },
    );
    expect(sendEmailRes?.status).toBe(200);
    const updatedPostal = store
      .getSnapshot()
      .contributor.find((c) => c.id === postalContrib.id)!;
    expect(updatedPostal.thankYouStatus).toBe('Sent');
    expect(updatedPostal.thankYouEmailSentAt).toBeTruthy();

    // Mailing labels with skipUnaddressed=true succeeds
    const labelsRes = await router(
      'http://localhost:3000/api/admin/thank-you-notes/export-labels?skipUnaddressed=true',
    );
    expect(labelsRes?.status).toBe(200);
    expect(labelsRes?.headers.get('content-type')).toBe('application/pdf');
  });
});
