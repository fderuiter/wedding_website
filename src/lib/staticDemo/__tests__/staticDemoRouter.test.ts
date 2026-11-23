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
  } else if (resolvedPath.startsWith('/api/admin/contributors/')) {
    body = { action: 'confirm' };
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
            } else if (resolvedPath.startsWith('/api/registry/items/')) {
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
            } else if (resolvedPath.startsWith('/api/admin/broadcast/schedule/')) {
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
        }),
      },
    );
    expect(newAddrRes?.status).toBe(201);
    const newAddrJson = await newAddrRes!.json();
    const newCode = newAddrJson.code ?? newAddrJson.data?.code;
    expect(typeof newCode).toBe('string');

    await router('http://localhost:3000/api/guest/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: newCode }),
    });
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
});
