import { ARCHETYPE_PRESETS, type ArchetypeId } from '@/lib/sampleData/archetypes';
import { THEME_PRESET_KEYS, type ThemePreset } from '@/lib/theme/presets';
import type { PublicAppConfig } from '@/lib/config';
import {
  substituteThankYouTemplateTokens,
  type InvitationCodeDTO,
  type RegistryItem,
} from '@/features/registry';
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

const DEMO_LANDMARK_SHAPES = new Set<string>(['dance-floor', 'bar', 'dj', 'buffet', 'cake']);
let demoAutoApproveGuestPhotos = false;
let demoPhotoQrTokenVersion = 1;

function isDemoLandmarkShape(shape?: string): boolean {
  return Boolean(shape && DEMO_LANDMARK_SHAPES.has(shape));
}

function escapeDemoHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDemoEmailHtml(text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px;">${escapeDemoHtml(p).replace(/\n/g, '<br />')}</p>`)
    .join('');
  return `<div style="font-family:Georgia,serif;color:#1f2937;line-height:1.6;">${paragraphs}</div>`;
}

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
    const rawBasePath = (process.env.NEXT_PUBLIC_BASE_PATH || '').trim().replace(/\/+$/, '');
    const basePath =
      rawBasePath && rawBasePath !== '/'
        ? rawBasePath.startsWith('/')
          ? rawBasePath
          : `/${rawBasePath}`
        : '';
    let path = url.pathname;
    if (basePath && (path === basePath || path.startsWith(`${basePath}/`))) {
      path = path.slice(basePath.length) || '/';
    }
    if (!path.startsWith('/api/')) return null;
    if (path.length > 1 && path.endsWith('/')) {
      path = path.replace(/\/+$/, '');
    }
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

  if (path === '/api/admin/setup' && method === 'GET') {
    const isSetup = getDemoState().persona === 'setup';
    return jsonResponse({
      success: true,
      initialized: true,
      setupCompleted: !isSetup,
      requiresSetup: isSetup,
    });
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
    if (typeof body.venueAddress === 'string') overrides.venueAddress = body.venueAddress;
    if (typeof body.venueCity === 'string') overrides.venueCity = body.venueCity;
    if (typeof body.venueState === 'string') overrides.venueState = body.venueState;
    if (typeof body.venueZip === 'string') overrides.venueZip = body.venueZip;
    if (typeof body.latitude === 'number' && Number.isFinite(body.latitude)) {
      overrides.latitude = body.latitude;
    }
    if (typeof body.longitude === 'number' && Number.isFinite(body.longitude)) {
      overrides.longitude = body.longitude;
    }
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

  if (path === '/api/admin/geocode' && method === 'GET') {
    const q = (url.searchParams.get('q') || '').trim();
    if (q.length < 2) {
      return jsonResponse({ success: false, error: 'Search query is required.' }, 400);
    }
    const archetype = getDemoState().archetype;
    const region =
      archetype === 'destination'
        ? {
          streetAddress: '450 Ocean Drive',
          city: 'Miami Beach',
          state: 'FL',
          zip: '33139',
          latitude: 25.7743,
          longitude: -80.1304,
        }
        : archetype === 'romantic'
          ? {
            streetAddress: '1120 Silverado Trail',
            city: 'Napa',
            state: 'CA',
            zip: '94558',
            latitude: 38.2975,
            longitude: -122.2869,
          }
          : {
            streetAddress: '123 Oak Ave',
            city: 'Chicago',
            state: 'IL',
            zip: '60601',
            latitude: 41.8842,
            longitude: -87.6324,
          };
    return jsonResponse({
      success: true,
      data: [
        {
          displayName: `${q}, ${region.streetAddress}, ${region.city}, ${region.state} ${region.zip}, United States`,
          name: q,
          streetAddress: region.streetAddress,
          city: region.city,
          state: region.state,
          zip: region.zip,
          country: 'United States',
          latitude: region.latitude,
          longitude: region.longitude,
        },
      ],
    });
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
      addressLine1: typeof body.addressLine1 === 'string' ? body.addressLine1 : undefined,
      addressLine2: typeof body.addressLine2 === 'string' ? body.addressLine2 : undefined,
      city: typeof body.city === 'string' ? body.city : undefined,
      state: typeof body.state === 'string' ? body.state : undefined,
      zipCode: typeof body.zipCode === 'string' ? body.zipCode : undefined,
      country: typeof body.country === 'string' ? body.country : undefined,
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
      const validShapes: ReadonlyArray<SeatingTableDTO['shape']> = [
        'round',
        'rectangular',
        'square',
        'head',
        'sweetheart',
        'dance-floor',
        'bar',
        'dj',
        'buffet',
        'cake',
      ];
      const resolvedShape: SeatingTableDTO['shape'] =
        typeof body.shape === 'string' &&
        validShapes.includes(body.shape as SeatingTableDTO['shape'])
          ? (body.shape as SeatingTableDTO['shape'])
          : 'round';
      const isLandmark = isDemoLandmarkShape(resolvedShape);
      const newTable: SeatingTableDTO = {
        id: `demo-table-${Date.now()}`,
        name: String(body.name || (isLandmark ? 'Landmark' : 'New Table')),
        shape: resolvedShape,
        capacity: isLandmark ? 0 : typeof body.capacity === 'number' ? body.capacity : 8,
        x: typeof body.x === 'number' ? body.x : 200,
        y: typeof body.y === 'number' ? body.y : 200,
        width: typeof body.width === 'number' ? body.width : 120,
        height: typeof body.height === 'number' ? body.height : 120,
        rotation: typeof body.rotation === 'number' ? body.rotation : 0,
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
      const nextShape =
        typeof body.shape === 'string' ? (body.shape as SeatingTableDTO['shape']) : existing.shape;
      const isLandmark = isDemoLandmarkShape(nextShape);
      const updated: SeatingTableDTO = {
        ...existing,
        ...(typeof body.name === 'string' ? { name: body.name } : {}),
        shape: nextShape,
        capacity: isLandmark
          ? 0
          : typeof body.capacity === 'number'
            ? body.capacity
            : existing.capacity,
        ...(typeof body.x === 'number' ? { x: body.x } : {}),
        ...(typeof body.y === 'number' ? { y: body.y } : {}),
        ...(typeof body.width === 'number' ? { width: body.width } : {}),
        ...(typeof body.height === 'number' ? { height: body.height } : {}),
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
          g.tableId === tableId
            ? { ...g, tableId: null, seatNumber: null, plusOneSeatNumbers: [] }
            : g
        ),
      }));
      return jsonResponse({ success: true });
    }
  }

  if (path === '/api/admin/seating/assign' && method === 'POST') {
    const body = await parseJsonBody(init);
    if (Array.isArray(body.invitationCodeIds)) {
      const targetIds = new Set(
        body.invitationCodeIds.filter((id): id is string => typeof id === 'string')
      );
      const targetTableId = typeof body.tableId === 'string' ? body.tableId : null;
      const updatedGuests: InvitationCodeDTO[] = [];
      mutateActiveDataset((current) => {
        const occupiedOnTable = new Set<number>(
          targetTableId
            ? current.guests
              .filter((g) => g.tableId === targetTableId && !targetIds.has(g.id))
              .flatMap((g) => [
                ...(typeof g.seatNumber === 'number' ? [g.seatNumber] : []),
                ...(Array.isArray(g.plusOneSeatNumbers) ? g.plusOneSeatNumbers : []),
              ])
            : []
        );
        let nextSeat = 1;
        const claimSeat = () => {
          while (occupiedOnTable.has(nextSeat)) nextSeat += 1;
          occupiedOnTable.add(nextSeat);
          return nextSeat;
        };
        const nextGuests = current.guests.map((g) => {
          if (!targetIds.has(g.id)) return g;
          if (!targetTableId) {
            const cleared: InvitationCodeDTO = {
              ...g,
              tableId: null,
              seatNumber: null,
              plusOneSeatNumbers: [],
            };
            updatedGuests.push(cleared);
            return cleared;
          }
          const primarySeat = claimSeat();
          const plusOneCount = Math.max(0, g.plusOneAllocations ?? 0);
          const plusOneSeatNumbers = Array.from({ length: plusOneCount }, () => claimSeat());
          const assigned: InvitationCodeDTO = {
            ...g,
            tableId: targetTableId,
            seatNumber: primarySeat,
            plusOneSeatNumbers,
          };
          updatedGuests.push(assigned);
          return assigned;
        });
        return { ...current, guests: nextGuests };
      });
      return jsonResponse({ success: true, data: { updatedGuests } });
    }
    if (Array.isArray(body.assignments)) {
      const updates = body.assignments as Array<{
        invitationCodeId?: string;
        tableId?: string | null;
        seatNumber?: number | null;
        plusOneSeatNumbers?: number[];
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
          const nextTableId = match.tableId ?? null;
          const next: InvitationCodeDTO = {
            ...g,
            tableId: nextTableId,
            seatNumber: nextTableId ? (match.seatNumber ?? null) : null,
            plusOneSeatNumbers:
              nextTableId && Array.isArray(match.plusOneSeatNumbers)
                ? match.plusOneSeatNumbers.filter((n): n is number => typeof n === 'number')
                : [],
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
    const seatNumber = tableId && typeof body.seatNumber === 'number' ? body.seatNumber : null;
    const plusOneSeatNumbers =
      tableId && Array.isArray(body.plusOneSeatNumbers)
        ? body.plusOneSeatNumbers.filter((n): n is number => typeof n === 'number')
        : [];
    let updatedGuest: InvitationCodeDTO | null = null;
    mutateActiveDataset((current) => {
      const nextGuests = current.guests.map((g) => {
        if (g.id !== guestId) return g;
        const next: InvitationCodeDTO = { ...g, tableId, seatNumber, plusOneSeatNumbers };
        updatedGuest = next;
        return next;
      });
      return { ...current, guests: nextGuests };
    });
    if (!updatedGuest) return jsonResponse({ error: 'Guest not found' }, 404);
    return jsonResponse({ success: true, data: updatedGuest });
  }

  if (path === '/api/admin/seating/auto-assign' && method === 'POST') {
    const assignedGuests: InvitationCodeDTO[] = [];
    let unassignedCount = 0;
    mutateActiveDataset((current) => {
      const guestTables = current.seatingTables.filter((t) => !isDemoLandmarkShape(t.shape));
      const occupiedByTable = new Map<string, Set<number>>();
      for (const table of guestTables) {
        occupiedByTable.set(table.id, new Set<number>());
      }
      for (const g of current.guests) {
        if (g.tableId && occupiedByTable.has(g.tableId)) {
          const set = occupiedByTable.get(g.tableId)!;
          if (typeof g.seatNumber === 'number') set.add(g.seatNumber);
          if (Array.isArray(g.plusOneSeatNumbers)) {
            for (const ps of g.plusOneSeatNumbers) set.add(ps);
          }
        }
      }
      const nextGuests = current.guests.map((g) => {
        if (g.tableId) return g;
        const needed = 1 + Math.max(0, g.plusOneAllocations ?? 0);
        const targetTable = guestTables.find((t) => {
          const occupied = occupiedByTable.get(t.id)!;
          return t.capacity - occupied.size >= needed;
        });
        if (!targetTable) {
          unassignedCount += 1;
          return g;
        }
        const occupied = occupiedByTable.get(targetTable.id)!;
        const claim = () => {
          let s = 1;
          while (occupied.has(s)) s += 1;
          occupied.add(s);
          return s;
        };
        const seatNumber = claim();
        const plusOneSeatNumbers = Array.from({ length: needed - 1 }, () => claim());
        const updated: InvitationCodeDTO = {
          ...g,
          tableId: targetTable.id,
          seatNumber,
          plusOneSeatNumbers,
        };
        assignedGuests.push(updated);
        return updated;
      });
      return { ...current, guests: nextGuests };
    });
    return jsonResponse({
      assignedCount: assignedGuests.length,
      unassignedCount,
      assignedGuests,
    });
  }

  if (path === '/api/admin/invitation-codes/catalog' || path === '/api/admin/invitation-codes') {
    if (method === 'GET') {
      const search = (url.searchParams.get('search') || '').trim().toLowerCase();
      const limitParam = Number(url.searchParams.get('limit') || '0');
      let guests = getActiveArchetypeDataset().guests;
      if (search) {
        guests = guests.filter(
          (g) =>
            g.guestName.toLowerCase().includes(search) ||
            (g.householdName || '').toLowerCase().includes(search) ||
            g.code.toLowerCase().includes(search) ||
            (g.email || '').toLowerCase().includes(search) ||
            (g.city || '').toLowerCase().includes(search)
        );
      }
      const limited = limitParam > 0 ? guests.slice(0, limitParam) : guests;
      return jsonResponse({
        success: true,
        data: {
          items: limited,
          total: guests.length,
          page: 1,
          limit: limitParam > 0 ? limitParam : Math.max(50, guests.length),
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

  if (path === '/api/admin/onboarding-milestones' && method === 'GET') {
    const state = getDemoState();
    const dataset = getActiveArchetypeDataset();
    const venueName = (state.configOverrides.venueName || '').trim();
    const weddingDetailsCompleted =
      Boolean(state.configOverrides.partner1Name && state.configOverrides.partner2Name) &&
      Boolean(venueName && venueName.toUpperCase() !== 'TBD');
    const guestListCompleted = dataset.guests.some((g) => !g.isSample);
    const registryCompleted = dataset.registryItems.some((i) => !i.isSample);
    const seatingCompleted = dataset.seatingTables.some((t) => !t.isSample);
    const faqCompleted = dataset.faqs.some((n) => n.type === 'FAQ' && !n.data.isSample);
    const milestones = [
      {
        id: 'wedding-details',
        title: 'Wedding Details',
        description:
          'Verify partner names, wedding date, venue details, and your public website URL.',
        completed: weddingDetailsCompleted,
        href: '/admin/dashboard/settings',
        actionLabel: weddingDetailsCompleted ? 'Edit Wedding Details' : 'Configure Wedding Details',
      },
      {
        id: 'guest-list',
        title: 'Guest List',
        description: 'Import or add guest invitations so guests can RSVP.',
        completed: guestListCompleted,
        href: '/admin/dashboard/invitation-codes',
        actionLabel: guestListCompleted ? 'Manage Guest List' : 'Add Guest List',
      },
      {
        id: 'registry',
        title: 'Gift Registry',
        description: 'Add gifts or cash funds to your wedding registry.',
        completed: registryCompleted,
        href: '/registry/add-item',
        actionLabel: registryCompleted ? 'Add More Gifts' : 'Add Registry Gifts',
      },
      {
        id: 'seating-layout',
        title: 'Seating Layout',
        description: 'Create reception tables and organize your seating chart.',
        completed: seatingCompleted,
        href: '/admin/dashboard/seating-chart',
        actionLabel: seatingCompleted ? 'Edit Seating Layout' : 'Create Seating Layout',
      },
      {
        id: 'faq-setup',
        title: 'Wedding Q&A (FAQs)',
        description:
          'Publish guest Q&A answers for attire, RSVP deadlines, travel, and accommodations.',
        completed: faqCompleted,
        href: '/admin/dashboard/content',
        actionLabel: faqCompleted ? 'Manage Wedding Q&A' : 'Add Starter FAQs',
      },
    ];
    const completedCount = milestones.filter((m) => m.completed).length;
    return jsonResponse({
      success: true,
      data: {
        completedCount,
        pendingCount: milestones.length - completedCount,
        totalCount: milestones.length,
        allComplete: completedCount === milestones.length,
        milestones,
      },
    });
  }

  if (
    path.startsWith('/api/admin/registry/items/') &&
    path.endsWith('/unclaim') &&
    method === 'POST'
  ) {
    const itemId = decodeURIComponent(
      path.slice('/api/admin/registry/items/'.length, -'/unclaim'.length)
    );
    let updatedItem: RegistryItem | null = null;
    mutateActiveDataset((current) => ({
      ...current,
      registryItems: current.registryItems.map((item) => {
        if (item.id !== itemId) return item;
        updatedItem = {
          ...item,
          purchased: false,
          purchaserName: null,
          amountContributed: 0,
          contributors: [],
        };
        return updatedItem;
      }),
    }));
    if (!updatedItem) {
      return jsonResponse({ error: 'Registry item not found.' }, 404);
    }
    return jsonResponse({ success: true, data: { item: updatedItem }, item: updatedItem });
  }

  if (path.startsWith('/api/admin/contributors/')) {
    const rawRest = path.slice('/api/admin/contributors/'.length);
    const isAction = rawRest.endsWith('/action');
    const contributorId = decodeURIComponent(
      isAction ? rawRest.slice(0, -'/action'.length) : rawRest
    );
    const body = await parseJsonBody(init);
    let matchedContributor: RegistryItem['contributors'][number] | null = null;
    let updatedParentItem: RegistryItem | null = null;
    let deleted = false;

    mutateActiveDataset((current) => ({
      ...current,
      registryItems: current.registryItems.map((item) => {
        const idx = (item.contributors || []).findIndex((c) => c.id === contributorId);
        if (idx === -1) return item;
        const target = item.contributors[idx];

        if (method === 'DELETE' && !isAction) {
          deleted = true;
          const nextContributors = item.contributors.filter((c) => c.id !== contributorId);
          const nextTotal = nextContributors.reduce(
            (sum, c) => (c.status === 'CANCELLED' ? sum : sum + c.amount),
            0
          );
          updatedParentItem = {
            ...item,
            contributors: nextContributors,
            amountContributed: nextTotal,
            purchased: item.isGroupGift ? nextTotal >= item.price : nextContributors.length > 0,
            purchaserName: nextContributors[0]?.name ?? null,
          };
          return updatedParentItem;
        }

        const nextStatus =
          isAction && method === 'POST'
            ? body.action === 'void'
              ? 'CANCELLED'
              : body.action === 'confirm'
                ? 'CONFIRMED'
                : target.status
            : body.status === 'CONFIRMED' || body.status === 'RESERVED' || body.status === 'CANCELLED'
              ? body.status
              : target.status;

        const nextContributor: RegistryItem['contributors'][number] = {
          ...target,
          ...(typeof body.name === 'string' && body.name.trim() ? { name: body.name.trim() } : {}),
          ...(body.email === null || typeof body.email === 'string' ? { email: body.email } : {}),
          ...(typeof body.amount === 'number' && body.amount > 0 ? { amount: body.amount } : {}),
          ...(body.message === null || typeof body.message === 'string'
            ? { message: body.message }
            : {}),
          status: nextStatus,
        };
        matchedContributor = nextContributor;
        const nextContributors = item.contributors.map((c) =>
          c.id === contributorId ? nextContributor : c
        );
        const nextTotal = nextContributors.reduce(
          (sum, c) => (c.status === 'CANCELLED' ? sum : sum + c.amount),
          0
        );
        updatedParentItem = {
          ...item,
          contributors: nextContributors,
          amountContributed: nextTotal,
          purchased: item.isGroupGift
            ? nextTotal >= item.price
            : nextContributors.some((c) => c.status !== 'CANCELLED'),
        };
        return updatedParentItem;
      }),
    }));

    if (method === 'DELETE' && !isAction) {
      if (!deleted) return jsonResponse({ error: 'Contributor not found.' }, 404);
      return jsonResponse({
        success: true,
        deletedId: contributorId,
        item: updatedParentItem,
        data: { deletedId: contributorId, item: updatedParentItem },
      });
    }
    if (!matchedContributor) {
      return jsonResponse({ error: 'Contributor not found.' }, 404);
    }
    return jsonResponse({
      success: true,
      changed: true,
      action: typeof body.action === 'string' ? body.action : 'confirm',
      contributor: matchedContributor,
      item: updatedParentItem,
      data: {
        changed: true,
        contributor: matchedContributor,
        item: updatedParentItem,
      },
    });
  }

  if (path === '/api/admin/thank-you-notes' && method === 'POST') {
    const body = await parseJsonBody(init);
    const created = {
      id: `demo-offline-gift-${Date.now()}`,
      name: String(body.name || 'Offline Contributor').trim(),
      email: typeof body.email === 'string' ? body.email : null,
      amount: Number(body.amount || 50),
      refundedAmount: 0,
      status: 'CONFIRMED' as const,
      date: typeof body.date === 'string' ? body.date : new Date().toISOString(),
      message: typeof body.message === 'string' ? body.message : null,
      thankYouStatus:
        body.thankYouStatus === 'Sent' || body.thankYouStatus === 'Not Needed'
          ? body.thankYouStatus
          : ('Unsent' as const),
      thankYouNote: typeof body.thankYouNote === 'string' ? body.thankYouNote : null,
      registryItemId: typeof body.registryItemId === 'string' ? body.registryItemId : null,
      registryItem: null,
    };
    return jsonResponse({ success: true, item: created }, 201);
  }

  if (path === '/api/admin/thank-you-notes/batch' && method === 'POST') {
    const body = await parseJsonBody(init);
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((id): id is string => typeof id === 'string')
      : [];
    const nextStatus =
      body.thankYouStatus === 'Sent' ||
      body.thankYouStatus === 'Not Needed' ||
      body.status === 'Sent' ||
      body.status === 'Not Needed'
        ? ((body.thankYouStatus || body.status) as 'Sent' | 'Not Needed')
        : 'Unsent';
    if (ids.length > 0) {
      const idSet = new Set(ids);
      mutateActiveDataset((current) => ({
        ...current,
        registryItems: current.registryItems.map((item) => ({
          ...item,
          contributors: (item.contributors || []).map((c) =>
            c.id && idSet.has(c.id) ? { ...c, thankYouStatus: nextStatus } : c
          ),
        })),
      }));
    }
    return jsonResponse({ success: true, updatedCount: ids.length });
  }

  if (
    path.startsWith('/api/admin/thank-you-notes/') &&
    path.endsWith('/send-email') &&
    method === 'POST'
  ) {
    const noteId = decodeURIComponent(
      path.slice('/api/admin/thank-you-notes/'.length, -'/send-email'.length)
    );
    const body = await parseJsonBody(init);
    const mode = body.mode === 'test' || body.mode === 'send' ? body.mode : 'preview';
    const dataset = getActiveArchetypeDataset();
    let foundContributor: RegistryItem['contributors'][number] | null = null;
    let foundItem: RegistryItem | null = null;
    for (const regItem of dataset.registryItems) {
      const match = (regItem.contributors || []).find((c) => c.id === noteId);
      if (match) {
        foundContributor = match;
        foundItem = regItem;
        break;
      }
    }
    if (!foundContributor) {
      return jsonResponse({ error: 'Contributor record not found' }, 404);
    }

    const linkedGuest = foundContributor.invitationCodeId
      ? dataset.guests.find((g) => g.id === foundContributor.invitationCodeId) ?? null
      : null;
    const demoState = getDemoState();
    const presetConfig = ARCHETYPE_PRESETS[demoState.archetype].siteConfig;
    const p1 = demoState.configOverrides.partner1Name || presetConfig.partner1Name;
    const p2 = demoState.configOverrides.partner2Name || presetConfig.partner2Name;
    const contactEmail = demoState.configOverrides.contactEmail || presetConfig.contactEmail;

    const rawBody = typeof body.body === 'string' ? body.body.trim() : '';
    const renderedText = substituteThankYouTemplateTokens(rawBody, {
      guestName: foundContributor.name,
      giftName: foundItem?.name || 'Wedding Gift',
      amount: foundContributor.amount,
    });
    const rawSubject =
      typeof body.subject === 'string' && body.subject.trim()
        ? body.subject.trim()
        : `Thank you from ${p1} & ${p2}!`;
    const safeSubject = rawSubject.replace(/[\r\n]+/g, ' ').trim();
    const overrideEmail =
      typeof body.recipientEmail === 'string' && body.recipientEmail.trim()
        ? body.recipientEmail.trim()
        : null;
    const resolvedRecipient =
      overrideEmail || foundContributor.email || linkedGuest?.email || null;

    if (mode === 'preview') {
      return jsonResponse({
        mode: 'preview',
        to: resolvedRecipient,
        testRecipient: contactEmail || null,
        subject: safeSubject,
        textBody: renderedText,
        htmlBody: formatDemoEmailHtml(renderedText),
      });
    }

    if (mode === 'test') {
      const targetTestEmail = contactEmail || 'couple-demo@example.com';
      return jsonResponse({
        mode: 'test',
        to: targetTestEmail,
        subject: `[TEST] ${safeSubject}`,
        messageId: `demo-test-${Date.now()}`,
      });
    }

    if (!resolvedRecipient) {
      return jsonResponse(
        { error: 'Contributor has no email address on file. Please provide a recipient email.' },
        400
      );
    }
    const nowIso = new Date().toISOString();
    mutateActiveDataset((current) => ({
      ...current,
      registryItems: current.registryItems.map((item) => ({
        ...item,
        contributors: (item.contributors || []).map((c) =>
          c.id === noteId
            ? {
              ...c,
              ...(overrideEmail && !c.email ? { email: overrideEmail } : {}),
              thankYouStatus: 'Sent',
              thankYouSentAt: c.thankYouSentAt || nowIso,
              thankYouEmailSentAt: nowIso,
              thankYouNote: renderedText,
            }
            : c
        ),
      })),
    }));
    return jsonResponse({
      mode: 'send',
      to: resolvedRecipient,
      subject: safeSubject,
      messageId: `demo-send-${Date.now()}`,
      thankYouStatus: 'Sent',
      thankYouSentAt: foundContributor.thankYouSentAt || nowIso,
      thankYouEmailSentAt: nowIso,
    });
  }

  if (path.startsWith('/api/admin/thank-you-notes/') && (method === 'PATCH' || method === 'PUT')) {
    const noteId = decodeURIComponent(path.slice('/api/admin/thank-you-notes/'.length));
    const body = await parseJsonBody(init);
    mutateActiveDataset((current) => {
      let targetInviteId: string | null | undefined;
      let syncedAddress: Record<string, string> | null = null;
      const nextRegistryItems = current.registryItems.map((item) => ({
        ...item,
        contributors: (item.contributors || []).map((c) => {
          if (c.id !== noteId) return c;
          const nextStatus =
            body.thankYouStatus === 'Sent' ||
            body.thankYouStatus === 'Not Needed' ||
            body.thankYouStatus === 'Unsent'
              ? body.thankYouStatus
              : (c.thankYouStatus ?? 'Unsent');
          const resolvedInviteId =
            body.invitationCodeId === null
              ? null
              : typeof body.invitationCodeId === 'string'
                ? body.invitationCodeId
                : (c.invitationCodeId ?? null);
          targetInviteId = resolvedInviteId;
          const nextContrib = {
            ...c,
            thankYouStatus: nextStatus,
            ...(body.thankYouNote === null || typeof body.thankYouNote === 'string'
              ? { thankYouNote: body.thankYouNote }
              : {}),
            ...(body.thankYouSentAt === null || typeof body.thankYouSentAt === 'string'
              ? { thankYouSentAt: body.thankYouSentAt }
              : {}),
            invitationCodeId: resolvedInviteId,
            ...(body.addressLine1 === null || typeof body.addressLine1 === 'string'
              ? { addressLine1: body.addressLine1 || null }
              : {}),
            ...(body.addressLine2 === null || typeof body.addressLine2 === 'string'
              ? { addressLine2: body.addressLine2 || null }
              : {}),
            ...(body.city === null || typeof body.city === 'string'
              ? { city: body.city || null }
              : {}),
            ...(body.state === null || typeof body.state === 'string'
              ? { state: body.state || null }
              : {}),
            ...(body.zipCode === null || typeof body.zipCode === 'string'
              ? { zipCode: body.zipCode || null }
              : {}),
            ...(body.country === null || typeof body.country === 'string'
              ? { country: body.country || null }
              : {}),
          };
          if (body.syncAddressToGuest && resolvedInviteId) {
            syncedAddress = {
              addressLine1: nextContrib.addressLine1 || '',
              addressLine2: nextContrib.addressLine2 || '',
              city: nextContrib.city || '',
              state: nextContrib.state || '',
              zipCode: nextContrib.zipCode || '',
              country: nextContrib.country || '',
            };
          }
          return nextContrib;
        }),
      }));
      const nextGuests =
        syncedAddress && targetInviteId
          ? current.guests.map((g) => (g.id === targetInviteId ? { ...g, ...syncedAddress } : g))
          : current.guests;
      return {
        ...current,
        registryItems: nextRegistryItems,
        guests: nextGuests,
      };
    });
    return jsonResponse({ success: true, id: noteId });
  }

  if (path === '/api/admin/thank-you-notes' && method === 'GET') {
    const dataset = getActiveArchetypeDataset();
    const guestById = new Map(dataset.guests.map((g) => [g.id, g]));
    const items = dataset.registryItems.flatMap((registryItem) =>
      (registryItem.contributors || []).map((contributor) => {
        const linked = contributor.invitationCodeId
          ? guestById.get(contributor.invitationCodeId) ?? null
          : null;
        return {
          id: contributor.id,
          name: contributor.name,
          email: contributor.email ?? null,
          addressLine1: contributor.addressLine1 ?? null,
          addressLine2: contributor.addressLine2 ?? null,
          city: contributor.city ?? null,
          state: contributor.state ?? null,
          zipCode: contributor.zipCode ?? null,
          country: contributor.country ?? null,
          message: contributor.message ?? null,
          amount: contributor.amount,
          refundedAmount: contributor.refundedAmount ?? 0,
          status: contributor.status ?? 'CONFIRMED',
          date: contributor.date || new Date().toISOString(),
          thankYouStatus: contributor.thankYouStatus || 'Unsent',
          thankYouSentAt: contributor.thankYouSentAt ?? null,
          thankYouEmailSentAt: contributor.thankYouEmailSentAt ?? null,
          thankYouNote: contributor.thankYouNote ?? null,
          invitationCodeId: contributor.invitationCodeId ?? null,
          invitationCode: linked
            ? {
              id: linked.id,
              code: linked.code,
              guestName: linked.guestName,
              email: linked.email ?? null,
              householdName: linked.householdName ?? null,
              addressLine1: linked.addressLine1 ?? null,
              addressLine2: linked.addressLine2 ?? null,
              city: linked.city ?? null,
              state: linked.state ?? null,
              zipCode: linked.zipCode ?? null,
              country: linked.country ?? null,
            }
            : null,
          registryItemId: registryItem.id,
          registryItem: {
            id: registryItem.id,
            name: registryItem.name,
            category: registryItem.category,
          },
        };
      })
    );
    const sent = items.filter((i) => i.thankYouStatus === 'Sent').length;
    const notNeeded = items.filter((i) => i.thankYouStatus === 'Not Needed').length;
    const unsent = items.length - sent - notNeeded;
    const thanked = sent + notNeeded;
    return jsonResponse({
      items,
      metrics: {
        total: items.length,
        sent,
        unsent,
        notNeeded,
        thanked,
        completionPercentage: items.length > 0 ? Math.round((thanked / items.length) * 100) : 0,
      },
      pagination: {
        page: 1,
        pageSize: Math.max(25, items.length),
        totalItems: items.length,
        totalPages: 1,
      },
    });
  }

  if (path === '/api/admin/photos/qr') {
    if (method === 'POST') {
      const body = await parseJsonBody(init);
      if (typeof body.autoApproveGuestPhotos === 'boolean') {
        demoAutoApproveGuestPhotos = body.autoApproveGuestPhotos;
      }
      if (body.action === 'rotate') {
        demoPhotoQrTokenVersion += 1;
      }
    }
    if (method === 'GET' || method === 'POST') {
      return jsonResponse({
        success: true,
        uploadUrl: `${url.origin}/photos?tab=guest&v=${demoPhotoQrTokenVersion}`,
        tokenVersion: demoPhotoQrTokenVersion,
        autoApproveGuestPhotos: demoAutoApproveGuestPhotos,
      });
    }
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
