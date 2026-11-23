import { ARCHETYPE_PRESETS, type ArchetypeId } from '@/lib/sampleData/archetypes';
import { THEME_PRESET_KEYS, type ThemePreset } from '@/lib/theme/presets';
import type { PublicAppConfig } from '@/lib/config';
import type { InvitationCodeDTO, RegistryItem } from '@/features/registry';
import type { SeatingTableDTO } from '@/features/seating';
import type { WeddingPartyMemberDTO, WeddingPartySide } from '@/features/wedding-party';
import type { AttractionDTO } from '@/features/attractions';
import { DEMO_SHIPPING_ADDRESS } from './demoSeed';
import {
  applyDemoSampleSelection,
  findDemoGuestByCode,
  getActiveArchetypeDataset,
  getDemoState,
  isDemoAdminSession,
  isDemoRuntimeActive,
  mutateActiveDataset,
  processDemoClaimToken,
  purgeDemoSampleData,
  recordDemoContribution,
  setDemoGuestSession,
  setDemoPersona,
  setDemoSetupAuthenticated,
  updateDemoConfigOverrides,
  updateDemoGuestAddress,
} from './demoStore';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function parseJsonBody(init?: RequestInit): Promise<Record<string, unknown>> {
  if (!init?.body) return {};
  if (typeof init.body === 'string') {
    try {
      const parsed: unknown = JSON.parse(init.body);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function resolveApiPathname(input: RequestInfo | URL): URL | null {
  if (typeof window === 'undefined') return null;
  let rawUrl = '';
  if (typeof input === 'string') {
    rawUrl = input;
  } else if (input instanceof URL) {
    rawUrl = input.toString();
  } else if (typeof Request !== 'undefined' && input instanceof Request) {
    rawUrl = input.url;
  }
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
    let path = url.pathname;
    if (basePath && path.startsWith(basePath)) {
      path = path.slice(basePath.length) || '/';
    }
    if (!path.startsWith('/api/')) return null;
    const normalized = new URL(url.toString());
    normalized.pathname = path;
    return normalized;
  } catch {
    return null;
  }
}

async function handleDemoApi(url: URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method || 'GET').toUpperCase();
  const path = url.pathname;

  // 1. Admin auth & setup
  if (path === '/api/admin/me' && method === 'GET') {
    return jsonResponse({ isAdmin: isDemoAdminSession() });
  }

  if (path === '/api/admin/logout' && method === 'POST') {
    setDemoPersona('guest');
    return jsonResponse({ success: true });
  }

  if (path === '/api/admin/setup' && method === 'POST') {
    const body = await parseJsonBody(init);
    if ('password' in body && Object.keys(body).length === 1) {
      setDemoSetupAuthenticated(true);
      return jsonResponse({ success: true });
    }
    const overrides: Partial<PublicAppConfig> = {};
    if (typeof body.partner1Name === 'string') overrides.partner1Name = body.partner1Name;
    if (typeof body.partner2Name === 'string') overrides.partner2Name = body.partner2Name;
    if (typeof body.weddingDate === 'string' && body.weddingDate) {
      overrides.weddingDate = new Date(
        body.weddingDate.includes('T') ? body.weddingDate : `${body.weddingDate}T16:00:00Z`
      );
    }
    if (typeof body.venueName === 'string') overrides.venueName = body.venueName;
    if (typeof body.venueCity === 'string') overrides.venueCity = body.venueCity;
    if (typeof body.venueState === 'string') overrides.venueState = body.venueState;
    if (typeof body.timezone === 'string') overrides.timezone = body.timezone;
    if (typeof body.contactEmail === 'string') overrides.contactEmail = body.contactEmail;
    if (
      typeof body.themePreset === 'string' &&
      THEME_PRESET_KEYS.includes(body.themePreset as ThemePreset)
    ) {
      overrides.themePreset = body.themePreset as ThemePreset;
    }
    if (typeof body.colorPrimary === 'string') overrides.colorPrimary = body.colorPrimary;
    if (typeof body.colorSecondary === 'string') overrides.colorSecondary = body.colorSecondary;
    updateDemoConfigOverrides(overrides);
    setDemoSetupAuthenticated(true);
    return jsonResponse({ success: true });
  }

  // 2. Sample data status, seed, and purge
  if (path === '/api/admin/sample-data') {
    if (method === 'GET') {
      const dataset = getActiveArchetypeDataset();
      const counts = {
        registry: dataset.registryItems.filter((i) => i.isSample).length,
        guests: dataset.guests.filter((g) => g.isSample).length,
        seating: dataset.seatingTables.filter((t) => t.isSample).length,
        weddingParty: dataset.weddingParty.filter((m) => m.isSample).length,
        attractions: dataset.attractions.filter((a) => a.isSample).length,
        faqs: dataset.faqs.length,
      };
      const total =
        counts.registry +
        counts.guests +
        counts.seating +
        counts.weddingParty +
        counts.attractions +
        counts.faqs;
      return jsonResponse({
        success: true,
        hasSampleData: total > 0,
        counts,
      });
    }
    if (method === 'POST') {
      const body = await parseJsonBody(init);
      const rawArch = typeof body.archetype === 'string' ? body.archetype : 'classic';
      const archetype: ArchetypeId =
        rawArch in ARCHETYPE_PRESETS ? (rawArch as ArchetypeId) : 'classic';
      const modules = Array.isArray(body.modules)
        ? body.modules.filter((m): m is string => typeof m === 'string')
        : ['registry', 'guests', 'seating', 'weddingParty', 'attractions', 'faqs'];
      applyDemoSampleSelection(archetype, modules);
      return jsonResponse({ success: true });
    }
    if (method === 'DELETE') {
      purgeDemoSampleData();
      return jsonResponse({ success: true });
    }
  }

  // 3. Registry capabilities, items, contribution, claims, and guest sessions
  if (path === '/api/registry/capabilities' && method === 'GET') {
    return jsonResponse({
      cardCheckoutEnabled: true,
      stripePublishableKey: null,
      defaultPaymentHandleType: 'Venmo',
      defaultPaymentHandle: '@alex-and-taylor',
      shippingAddress: DEMO_SHIPPING_ADDRESS,
    });
  }

  if (path === '/api/registry/items') {
    if (method === 'GET') {
      const items = getActiveArchetypeDataset().registryItems;
      const page = Math.max(1, Number(url.searchParams.get('page') || '1'));
      const limit = Math.max(1, Number(url.searchParams.get('limit') || '100'));
      return jsonResponse({
        items,
        total: items.length,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(items.length / limit)),
      });
    }
    if (method === 'POST') {
      const body = await parseJsonBody(init);
      const id = `demo-custom-item-${Date.now()}`;
      const newItem: RegistryItem = {
        id,
        name: String(body.name || 'Custom Gift'),
        description: String(body.description || ''),
        category: String(body.category || 'Home'),
        price: Number(body.price || 50),
        quantity: Number(body.quantity || 1),
        itemType:
          body.itemType === 'CASH_FUND' || body.itemType === 'EXPERIENCE_FUND'
            ? body.itemType
            : 'PHYSICAL',
        isGroupGift: Boolean(body.isGroupGift),
        isMostWanted: Boolean(body.isMostWanted),
        displayOrder: Number(body.displayOrder || 0),
        vendorUrl: typeof body.vendorUrl === 'string' ? body.vendorUrl : null,
        paymentHandleType: 'Venmo',
        paymentHandle: '@alex-and-taylor',
        purchased: false,
        purchaserName: null,
        amountContributed: 0,
        isSample: false,
        imageId: null,
        image: null,
        contributors: [],
      };
      mutateActiveDataset((current) => ({
        ...current,
        registryItems: [newItem, ...current.registryItems],
      }));
      return jsonResponse(newItem, 201);
    }
  }

  if (path.startsWith('/api/registry/items/')) {
    const itemId = decodeURIComponent(path.slice('/api/registry/items/'.length));
    const currentItems = getActiveArchetypeDataset().registryItems;
    const existing = currentItems.find((i) => i.id === itemId);

    if (method === 'GET') {
      if (!existing) return jsonResponse({ error: 'Item not found' }, 404);
      return jsonResponse(existing);
    }
    if (method === 'DELETE') {
      if (!existing) return jsonResponse({ error: 'Item not found' }, 404);
      mutateActiveDataset((current) => ({
        ...current,
        registryItems: current.registryItems.filter((i) => i.id !== itemId),
      }));
      return jsonResponse(existing);
    }
    if (method === 'PUT' || method === 'PATCH') {
      if (!existing) return jsonResponse({ error: 'Item not found' }, 404);
      const body = await parseJsonBody(init);
      const updated: RegistryItem = {
        ...existing,
        ...(typeof body.name === 'string' ? { name: body.name } : {}),
        ...(typeof body.description === 'string' ? { description: body.description } : {}),
        ...(typeof body.category === 'string' ? { category: body.category } : {}),
        ...(typeof body.price === 'number' ? { price: body.price } : {}),
      };
      mutateActiveDataset((current) => ({
        ...current,
        registryItems: current.registryItems.map((i) => (i.id === itemId ? updated : i)),
      }));
      return jsonResponse(updated);
    }
  }

  if (path === '/api/registry/contribute' && method === 'POST') {
    const body = await parseJsonBody(init);
    const itemId = String(body.itemId || '');
    const purchaserName = String(body.purchaserName || body.name || '').trim();
    const amount = Number(body.amount || 0);
    if (!itemId || !purchaserName || !(amount > 0)) {
      return jsonResponse({ error: 'Missing contribution details.' }, 400);
    }
    const updated = recordDemoContribution({
      itemId,
      purchaserName,
      amount,
      code: typeof body.code === 'string' ? body.code : undefined,
      message: typeof body.message === 'string' ? body.message : null,
      coverFee: Boolean(body.coverFee),
      email: typeof body.email === 'string' ? body.email : null,
      paymentIntentId:
        typeof body.paymentIntentId === 'string' && body.paymentIntentId
          ? body.paymentIntentId
          : undefined,
      retailerOrderNumber:
        typeof body.retailerOrderNumber === 'string' ? body.retailerOrderNumber : undefined,
      carrier: typeof body.carrier === 'string' ? body.carrier : undefined,
      trackingNumber:
        typeof body.trackingNumber === 'string' ? body.trackingNumber : undefined,
    });
    if (!updated) {
      return jsonResponse({ error: 'Registry item not found.' }, 404);
    }
    return jsonResponse(updated);
  }

  if (path === '/api/registry/claim') {
    const token =
      method === 'GET'
        ? url.searchParams.get('token') || ''
        : String((await parseJsonBody(init)).token || '');
    if (!token) {
      return jsonResponse({ error: 'Missing claim token.' }, 400);
    }
    const result = processDemoClaimToken(token);
    if (!result) {
      return jsonResponse({ error: 'Invalid or expired reservation token.' }, 404);
    }
    return jsonResponse(result);
  }

  if (path === '/api/registry/validate-code' && method === 'GET') {
    const rawCode = url.searchParams.get('code') || '';
    const matched = findDemoGuestByCode(rawCode);
    if (!matched) {
      return jsonResponse(
        {
          valid: false,
          success: false,
          error: 'Invalid invitation code for the active wedding archetype.',
        },
        404
      );
    }
    setDemoGuestSession({
      invitationCode: matched.code,
      guestName: matched.guestName,
    });
    return jsonResponse({
      valid: true,
      success: true,
      code: matched.code,
      guestName: matched.guestName,
      data: {
        valid: true,
        code: matched.code,
        guestName: matched.guestName,
      },
    });
  }

  if (path === '/api/registry/session') {
    if (method === 'GET') {
      const session = getDemoState().guestSession;
      if (!session) {
        return jsonResponse({ isVerified: false, invitationCode: '', guestName: '' });
      }
      return jsonResponse({
        isVerified: true,
        invitationCode: session.invitationCode,
        code: session.invitationCode,
        guestName: session.guestName,
      });
    }
    if (method === 'DELETE') {
      setDemoGuestSession(null);
      return jsonResponse({ success: true });
    }
  }

  // 4. Guest Address Portal
  if (path === '/api/guest/address') {
    const session = getDemoState().guestSession;
    if (!session) {
      return jsonResponse({ success: false, error: 'Authentication required.' }, 401);
    }
    const guest = findDemoGuestByCode(session.invitationCode);
    if (method === 'GET') {
      return jsonResponse({
        success: true,
        data: {
          guestName: guest?.guestName || session.guestName,
          code: session.invitationCode,
          addressLine1: guest?.addressLine1 || '',
          addressLine2: guest?.addressLine2 || '',
          city: guest?.city || '',
          state: guest?.state || '',
          zipCode: guest?.zipCode || '',
          country: guest?.country || '',
        },
      });
    }
    if (method === 'PUT' || method === 'POST') {
      const body = await parseJsonBody(init);
      const updated = updateDemoGuestAddress(session.invitationCode, {
        addressLine1: typeof body.addressLine1 === 'string' ? body.addressLine1 : '',
        addressLine2: typeof body.addressLine2 === 'string' ? body.addressLine2 : '',
        city: typeof body.city === 'string' ? body.city : '',
        state: typeof body.state === 'string' ? body.state : '',
        zipCode: typeof body.zipCode === 'string' ? body.zipCode : '',
        country: typeof body.country === 'string' ? body.country : '',
      });
      return jsonResponse({
        success: true,
        data: {
          guestName: updated?.guestName || session.guestName,
          code: session.invitationCode,
          addressLine1: updated?.addressLine1 || '',
          addressLine2: updated?.addressLine2 || '',
          city: updated?.city || '',
          state: updated?.state || '',
          zipCode: updated?.zipCode || '',
          country: updated?.country || '',
        },
      });
    }
  }

  // 5. Admin Seating, Guests, Wedding Party, and Attractions
  if (path === '/api/admin/seating-tables') {
    if (method === 'GET') {
      return jsonResponse({
        success: true,
        data: getActiveArchetypeDataset().seatingTables,
      });
    }
    if (method === 'POST') {
      const body = await parseJsonBody(init);
      const newTable: SeatingTableDTO = {
        id: `demo-table-${Date.now()}`,
        name: String(body.name || 'New Table'),
        shape:
          body.shape === 'rectangular' ||
          body.shape === 'square' ||
          body.shape === 'head' ||
          body.shape === 'sweetheart'
            ? body.shape
            : 'round',
        capacity: Number(body.capacity || 8),
        x: Number(body.x || 200),
        y: Number(body.y || 200),
        width: Number(body.width || 120),
        height: Number(body.height || 120),
        rotation: Number(body.rotation || 0),
        isSample: false,
        invitationCodes: [],
      };
      mutateActiveDataset((current) => ({
        ...current,
        seatingTables: [...current.seatingTables, newTable],
      }));
      return jsonResponse({ success: true, data: newTable }, 201);
    }
  }

  if (path.startsWith('/api/admin/seating-tables/')) {
    const tableId = decodeURIComponent(path.slice('/api/admin/seating-tables/'.length));
    const existing = getActiveArchetypeDataset().seatingTables.find((t) => t.id === tableId);
    if (!existing) return jsonResponse({ error: 'Table not found' }, 404);

    if (method === 'PUT' || method === 'PATCH') {
      const body = await parseJsonBody(init);
      const updated: SeatingTableDTO = {
        ...existing,
        ...(typeof body.name === 'string' ? { name: body.name } : {}),
        ...(typeof body.capacity === 'number' ? { capacity: body.capacity } : {}),
        ...(typeof body.x === 'number' ? { x: body.x } : {}),
        ...(typeof body.y === 'number' ? { y: body.y } : {}),
        ...(typeof body.rotation === 'number' ? { rotation: body.rotation } : {}),
      };
      mutateActiveDataset((current) => ({
        ...current,
        seatingTables: current.seatingTables.map((t) => (t.id === tableId ? updated : t)),
      }));
      return jsonResponse({ success: true, data: updated });
    }
    if (method === 'DELETE') {
      mutateActiveDataset((current) => ({
        ...current,
        seatingTables: current.seatingTables.filter((t) => t.id !== tableId),
        guests: current.guests.map((g) =>
          g.tableId === tableId ? { ...g, tableId: null, seatNumber: null } : g
        ),
      }));
      return jsonResponse({ success: true });
    }
  }

  if (path === '/api/admin/seating/assign' && method === 'POST') {
    const body = await parseJsonBody(init);
    if (Array.isArray(body.assignments)) {
      const updates = body.assignments as Array<{
        invitationCodeId?: string;
        tableId?: string | null;
        seatNumber?: number | null;
      }>;
      const updateMap = new Map(
        updates
          .filter((u) => typeof u.invitationCodeId === 'string')
          .map((u) => [u.invitationCodeId as string, u])
      );
      const updatedGuests: InvitationCodeDTO[] = [];
      mutateActiveDataset((current) => {
        const nextGuests = current.guests.map((g) => {
          const match = updateMap.get(g.id);
          if (!match) return g;
          const next: InvitationCodeDTO = {
            ...g,
            tableId: match.tableId ?? null,
            seatNumber: match.seatNumber ?? null,
          };
          updatedGuests.push(next);
          return next;
        });
        return { ...current, guests: nextGuests };
      });
      return jsonResponse({ success: true, data: { updatedGuests } });
    }
    const guestId = String(body.invitationCodeId || '');
    const tableId = typeof body.tableId === 'string' ? body.tableId : null;
    const seatNumber = typeof body.seatNumber === 'number' ? body.seatNumber : null;
    let updatedGuest: InvitationCodeDTO | null = null;
    mutateActiveDataset((current) => {
      const nextGuests = current.guests.map((g) => {
        if (g.id !== guestId) return g;
        const next: InvitationCodeDTO = { ...g, tableId, seatNumber };
        updatedGuest = next;
        return next;
      });
      return { ...current, guests: nextGuests };
    });
    if (!updatedGuest) return jsonResponse({ error: 'Guest not found' }, 404);
    return jsonResponse({ success: true, data: updatedGuest });
  }

  if (path === '/api/admin/invitation-codes/catalog' || path === '/api/admin/invitation-codes') {
    if (method === 'GET') {
      const guests = getActiveArchetypeDataset().guests;
      return jsonResponse({
        success: true,
        data: {
          items: guests,
          total: guests.length,
          page: 1,
          limit: Math.max(50, guests.length),
          totalPages: 1,
        },
      });
    }
    if (method === 'POST') {
      const body = await parseJsonBody(init);
      const code = String(body.code || `GUEST${Date.now().toString().slice(-4)}`).toUpperCase();
      const newGuest: InvitationCodeDTO = {
        id: `demo-guest-${Date.now()}`,
        code,
        guestName: String(body.guestName || 'Invited Guest'),
        householdName: typeof body.householdName === 'string' ? body.householdName : '',
        partyGroup: typeof body.partyGroup === 'string' ? body.partyGroup : 'Friends',
        partyTags: Array.isArray(body.partyTags)
          ? body.partyTags.filter((t): t is string => typeof t === 'string')
          : [],
        plusOneAllocations: Number(body.plusOneAllocations || 0),
        used: false,
        isSample: false,
      };
      mutateActiveDataset((current) => ({
        ...current,
        guests: [...current.guests, newGuest],
      }));
      return jsonResponse({ success: true, data: newGuest }, 201);
    }
  }

  if (path === '/api/admin/invitation-codes/import' && method === 'POST') {
    const body = await parseJsonBody(init);
    const records = Array.isArray(body.records)
      ? (body.records as Array<Record<string, unknown>>)
      : Array.isArray(body.items)
        ? (body.items as Array<Record<string, unknown>>)
        : [];
    const created: InvitationCodeDTO[] = records.map((rec, idx) => ({
      id: `demo-imported-${Date.now()}-${idx}`,
      code: String(rec.code || `IMPORT${100 + idx}`).toUpperCase(),
      guestName: String(rec.guestName || `Imported Guest ${idx + 1}`),
      householdName: typeof rec.householdName === 'string' ? rec.householdName : '',
      partyGroup: typeof rec.partyGroup === 'string' ? rec.partyGroup : 'Imported',
      partyTags: [],
      plusOneAllocations: Number(rec.plusOneAllocations || 0),
      used: false,
      isSample: false,
    }));
    if (created.length > 0) {
      mutateActiveDataset((current) => ({
        ...current,
        guests: [...current.guests, ...created],
      }));
    }
    return jsonResponse({
      success: true,
      data: {
        importedCount: created.length,
        createdCount: created.length,
        updatedCount: 0,
        skippedCount: 0,
        items: created,
      },
    });
  }

  if (path === '/api/admin/wedding-party') {
    if (method === 'GET') {
      return jsonResponse({
        success: true,
        data: getActiveArchetypeDataset().weddingParty,
      });
    }
    if (method === 'POST') {
      const body = await parseJsonBody(init);
      const now = new Date();
      const side: WeddingPartySide =
        body.side === 'BRIDE' || body.side === 'GROOM' || body.side === 'JOINT'
          ? body.side
          : 'JOINT';
      const member: WeddingPartyMemberDTO = {
        id: `demo-party-${Date.now()}`,
        name: String(body.name || 'Party Member'),
        role: String(body.role || 'Attendant'),
        bio: String(body.bio || ''),
        side,
        link: null,
        order: Number(body.order || getActiveArchetypeDataset().weddingParty.length + 1),
        isSample: false,
        photoId: null,
        photo: null,
        createdAt: now,
        updatedAt: now,
      };
      mutateActiveDataset((current) => ({
        ...current,
        weddingParty: [...current.weddingParty, member],
      }));
      return jsonResponse({ success: true, data: member }, 201);
    }
  }

  if (path === '/api/admin/attractions') {
    if (method === 'GET') {
      return jsonResponse({
        success: true,
        data: getActiveArchetypeDataset().attractions,
      });
    }
    if (method === 'POST') {
      const body = await parseJsonBody(init);
      const now = new Date();
      const attraction: AttractionDTO = {
        id: `demo-attraction-${Date.now()}`,
        name: String(body.name || 'Local Spot'),
        description: String(body.description || ''),
        category: String(body.category || 'Activities'),
        website: typeof body.website === 'string' ? body.website : 'https://example.com',
        directions: String(body.directions || ''),
        latitude: Number(body.latitude || 41.8781),
        longitude: Number(body.longitude || -87.6298),
        isVisible: body.isVisible !== false,
        promoCode: typeof body.promoCode === 'string' ? body.promoCode : null,
        bookingUrl: typeof body.bookingUrl === 'string' ? body.bookingUrl : null,
        roomRate: typeof body.roomRate === 'string' ? body.roomRate : null,
        cutoffDate: null,
        shuttleInfo: null,
        isSample: false,
        imageId: null,
        image: null,
        createdAt: now,
        updatedAt: now,
      };
      mutateActiveDataset((current) => ({
        ...current,
        attractions: [...current.attractions, attraction],
      }));
      return jsonResponse({ success: true, data: attraction }, 201);
    }
  }

  if (path === '/api/admin/sub-events/rsvp-summary' && method === 'GET') {
    return jsonResponse({ success: true, data: null });
  }

  if (path === '/api/admin/sub-events/access' && method === 'GET') {
    return jsonResponse({
      success: true,
      data: {
        subEvents: [],
        invitationCodes: [],
      },
    });
  }

  if (path === '/api/admin/sub-events/access/batch' && method === 'POST') {
    return jsonResponse({ success: true, data: { updatedCount: 0 } });
  }

  if (path === '/api/admin/sub-events' && method === 'GET') {
    return jsonResponse({ success: true, data: [] });
  }

  if (path === '/api/admin/invitation-codes/rsvps' && method === 'GET') {
    return jsonResponse({ success: true, data: [] });
  }

  if (path === '/api/admin/broadcast/history' && method === 'GET') {
    return jsonResponse({ success: true, data: [] });
  }

  if (path.startsWith('/api/admin/broadcast/') && method === 'GET') {
    return jsonResponse({ error: 'Broadcast message not found in demo mode.' }, 404);
  }

  // Safe fallback for read-only admin overview widgets on static export
  if (path.startsWith('/api/admin/') && method === 'GET') {
    const dataset = getActiveArchetypeDataset();
    return jsonResponse({
      success: true,
      data: {
        items: [],
        total: 0,
        registryCount: dataset.registryItems.length,
        guestCount: dataset.guests.length,
      },
    });
  }

  return jsonResponse({ error: `Demo endpoint not implemented: ${method} ${path}` }, 404);
}

let activeInterceptCount = 0;
let originalFetchRef: typeof window.fetch | null = null;

export function installDemoFetchInterceptor(): () => void {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
    return () => {};
  }

  activeInterceptCount += 1;
  if (activeInterceptCount === 1) {
    originalFetchRef = window.fetch.bind(window);
    const fallbackFetch = originalFetchRef;

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (isDemoRuntimeActive()) {
        const apiUrl = resolveApiPathname(input);
        if (apiUrl) {
          if (init?.signal?.aborted) {
            throw new DOMException('The operation was aborted.', 'AbortError');
          }
          return handleDemoApi(apiUrl, init);
        }
      }
      return fallbackFetch(input, init);
    };
  }

  return () => {
    activeInterceptCount = Math.max(0, activeInterceptCount - 1);
    if (activeInterceptCount === 0 && originalFetchRef) {
      window.fetch = originalFetchRef;
      originalFetchRef = null;
    }
  };
}
