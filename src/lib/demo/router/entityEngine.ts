import type { AttractionDTO } from '@/features/attractions';
import type { ContentNodeDTO } from '@/features/content';
import type { InvitationCodeDTO, RegistryItem } from '@/features/registry';
import type { SeatingTableDTO } from '@/features/seating';
import type { SubEventDTO } from '@/features/sub-events';
import type { WeddingPartyMemberDTO, WeddingPartySide } from '@/features/wedding-party';
import { normalizePartyTags } from '@/utils/invitationValidation';
import { createSampleItemSvgDataUrl, type ArchetypeDataset, type DemoPhotoRecord } from '../demoSeed';
import {
  getActiveArchetypeDataset,
  getDemoContentNodes,
  mutateActiveDataset,
  recordDemoAuditVersion,
} from '../demoStore';
import {
  buildPaginationHeaders,
  jsonResponse,
  nextDemoId,
  parseJsonBody,
  parseRawJsonValue,
  upsertInvitationsIntoStaticDemoStore,
  type DemoRouteContext,
} from './http';

const DEMO_ENTITY_SLUGS = new Set([
  'content-nodes',
  'wedding-party',
  'attractions',
  'registry-items',
  'invitation-codes',
  'seating-tables',
  'sub-events',
]);

const DEMO_LANDMARK_SHAPES = new Set<string>(['dance-floor', 'bar', 'dj', 'buffet', 'cake']);

export function isDemoLandmarkShape(shape?: string): boolean {
  return Boolean(shape && DEMO_LANDMARK_SHAPES.has(shape));
}

function writeBackContentNode(
  current: ArchetypeDataset,
  node: ContentNodeDTO
): ArchetypeDataset {
  const normalizedType = node.type;
  if (normalizedType === 'FAQ') {
    const exists = current.faqs.some((n) => n.id === node.id);
    return {
      ...current,
      faqs: exists
        ? current.faqs.map((n) => (n.id === node.id ? node : n))
        : [...current.faqs, node],
    };
  }
  if (normalizedType === 'Logistics') {
    const exists = current.logisticsNodes.some((n) => n.id === node.id);
    return {
      ...current,
      logisticsNodes: exists
        ? current.logisticsNodes.map((n) => (n.id === node.id ? node : n))
        : [...current.logisticsNodes, node],
    };
  }
  if (normalizedType === 'Schedule') {
    const exists = current.scheduleNodes.some((n) => n.id === node.id);
    return {
      ...current,
      scheduleNodes: exists
        ? current.scheduleNodes.map((n) => (n.id === node.id ? node : n))
        : [...current.scheduleNodes, node],
    };
  }
  if (normalizedType === 'Photo') {
    const data = (node.data ?? {}) as Record<string, unknown>;
    const tags = Array.isArray(node.tags) ? node.tags : ['Gallery'];
    const isGuest = tags.includes('guest-upload');
    const nowIso = new Date().toISOString();
    const existingPhoto = current.photos.find((p) => p.nodeId === node.id || p.id === node.id);
    const updatedPhoto: DemoPhotoRecord = {
      id: existingPhoto?.id ?? node.id,
      nodeId: node.id,
      mediaId:
        typeof data.mediaId === 'string'
          ? data.mediaId
          : existingPhoto?.mediaId ?? `${node.id}-media`,
      url: typeof data.url === 'string' ? data.url : existingPhoto?.url ?? '',
      title: typeof data.title === 'string' ? data.title : existingPhoto?.title ?? 'Wedding Photo',
      caption: typeof data.caption === 'string' ? data.caption : existingPhoto?.caption ?? '',
      altText:
        typeof data.altText === 'string' ? data.altText : existingPhoto?.altText ?? 'Wedding Photo',
      category: isGuest ? 'guest' : 'curated',
      source: isGuest ? 'guest-upload' : 'curated',
      status:
        data.status === 'PENDING' || data.status === 'REJECTED'
          ? data.status
          : data.status === 'APPROVED'
            ? 'APPROVED'
            : existingPhoto?.status ?? 'APPROVED',
      isVisible: typeof data.isVisible === 'boolean' ? data.isVisible : true,
      isGuestUpload: isGuest,
      ...(typeof data.uploaderName === 'string' ? { uploaderName: data.uploaderName } : {}),
      createdAt: existingPhoto?.createdAt ?? nowIso,
      updatedAt: nowIso,
    };
    return {
      ...current,
      photos: existingPhoto
        ? current.photos.map((p) =>
          p.nodeId === node.id || p.id === node.id ? updatedPhoto : p
        )
        : [updatedPhoto, ...current.photos],
    };
  }
  const exists = current.customNodes.some((n) => n.id === node.id);
  return {
    ...current,
    customNodes: exists
      ? current.customNodes.map((n) => (n.id === node.id ? node : n))
      : [...current.customNodes, node],
  };
}

function removeContentNodesByIds(
  current: ArchetypeDataset,
  ids: Set<string>
): ArchetypeDataset {
  return {
    ...current,
    faqs: current.faqs.filter((n) => !ids.has(n.id)),
    logisticsNodes: current.logisticsNodes.filter((n) => !ids.has(n.id)),
    scheduleNodes: current.scheduleNodes.filter((n) => !ids.has(n.id)),
    customNodes: current.customNodes.filter((n) => !ids.has(n.id)),
    photos: current.photos.filter((p) => !ids.has(p.nodeId) && !ids.has(p.id)),
  };
}

function getOrderedIdsFromPayload(body: Record<string, unknown>, rawBody: unknown): string[] {
  if (Array.isArray(rawBody)) {
    return rawBody
      .map((entry) =>
        typeof entry === 'string'
          ? entry
          : entry && typeof entry === 'object' && 'id' in entry
            ? String((entry as { id?: unknown }).id ?? '')
            : ''
      )
      .filter(Boolean);
  }
  const candidateList = Array.isArray(body.orderedIds)
    ? body.orderedIds
    : Array.isArray(body.ids)
      ? body.ids
      : Array.isArray(body.items)
        ? body.items
        : [];
  return candidateList
    .map((entry) =>
      typeof entry === 'string'
        ? entry
        : entry && typeof entry === 'object' && 'id' in entry
          ? String((entry as { id?: unknown }).id ?? '')
          : ''
    )
    .filter(Boolean);
}

function reorderListByIds<T extends { id: string }>(
  items: T[],
  orderedIds: string[],
  applyIndex: (item: T, index: number) => T
): T[] {
  if (orderedIds.length === 0) return items;
  const byId = new Map(items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const reordered: T[] = [];
  for (const id of orderedIds) {
    const match = byId.get(id);
    if (match && !seen.has(id)) {
      seen.add(id);
      reordered.push(match);
    }
  }
  for (const item of items) {
    if (!seen.has(item.id)) {
      reordered.push(item);
    }
  }
  return reordered.map((item, idx) => applyIndex(item, idx));
}

export async function handleAdminEntityRoutes(ctx: DemoRouteContext): Promise<Response | null> {
  const { path, method, url, init, rawInput } = ctx;
  if (!path.startsWith('/api/admin/')) return null;

  const rest = path.slice('/api/admin/'.length);
  const segments = rest.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  const entity = segments[0];
  if (!DEMO_ENTITY_SLUGS.has(entity)) return null;

  // Let specialized sub-routes be handled by workflow handlers
  if (
    entity === 'invitation-codes' &&
    segments[1] &&
    ['catalog', 'validate', 'import', 'merge', 'rsvps', 'export'].includes(segments[1])
  ) {
    return null;
  }
  if (
    entity === 'invitation-codes' &&
    segments[1] === 'batch' &&
    segments[2] === 'validate'
  ) {
    return null;
  }
  if (
    entity === 'sub-events' &&
    segments[1] &&
    ['rsvp-summary', 'access'].includes(segments[1])
  ) {
    return null;
  }

  // 1. Collection-level GET / POST / PUT (reorder)
  if (segments.length === 1) {
    if (method === 'GET') {
      return handleEntityCollectionGet(entity, url);
    }
    if (method === 'POST') {
      const body = await parseJsonBody(init, rawInput);
      return handleEntityCreate(entity, body);
    }
    if (method === 'PUT' || method === 'PATCH') {
      const rawBody = await parseRawJsonValue(init, rawInput);
      const body = await parseJsonBody(init, rawInput);
      const orderedIds = getOrderedIdsFromPayload(body, rawBody);
      return handleEntityReorder(entity, orderedIds, body);
    }
  }

  // 2. Batch operations: /api/admin/:entity/batch
  if (segments.length === 2 && segments[1] === 'batch') {
    const rawBody = await parseRawJsonValue(init, rawInput);
    const body = await parseJsonBody(init, rawInput);
    return handleEntityBatch(entity, method, body, rawBody);
  }

  // 3. Single item operations: /api/admin/:entity/:id
  if (segments.length === 2) {
    const id = decodeURIComponent(segments[1]);
    if (method === 'GET') {
      return handleEntityGetById(entity, id);
    }
    if (method === 'PUT' || method === 'PATCH') {
      const body = await parseJsonBody(init, rawInput);
      return handleEntityUpdateById(entity, id, body);
    }
    if (method === 'DELETE') {
      return handleEntityDeleteById(entity, id);
    }
  }

  return null;
}

function handleEntityCollectionGet(entity: string, url: URL): Response {
  const dataset = getActiveArchetypeDataset();
  const search = (url.searchParams.get('search') || '').trim().toLowerCase();
  const page = Math.max(1, Number(url.searchParams.get('page') || '1') || 1);
  const limitParam = Number(url.searchParams.get('limit') || '0');

  if (entity === 'invitation-codes') {
    let guests = dataset.guests;
    const tagFilter = (url.searchParams.get('partyTag') || url.searchParams.get('tag') || '').trim();
    const groupFilter = (url.searchParams.get('partyGroup') || '').trim();
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
    if (tagFilter && tagFilter !== 'all') {
      guests = guests.filter((g) => (g.partyTags || []).includes(tagFilter));
    }
    if (groupFilter && groupFilter !== 'all') {
      guests = guests.filter((g) => g.partyGroup === groupFilter);
    }
    const effectiveLimit = limitParam > 0 ? limitParam : Math.max(50, guests.length);
    const start = limitParam > 0 ? (page - 1) * limitParam : 0;
    const paged = limitParam > 0 ? guests.slice(start, start + limitParam) : guests;
    const totalPages = Math.max(1, Math.ceil(guests.length / effectiveLimit));
    return jsonResponse(
      {
        success: true,
        data: {
          items: paged,
          total: guests.length,
          page,
          limit: effectiveLimit,
          totalPages,
        },
      },
      200,
      buildPaginationHeaders(guests.length, page, effectiveLimit)
    );
  }

  if (entity === 'content-nodes') {
    let nodes = getDemoContentNodes(dataset);
    const typeParam = (url.searchParams.get('type') || '').trim();
    const tagParam = (url.searchParams.get('tag') || '').trim();
    if (typeParam) {
      nodes = nodes.filter((n) => n.type.toLowerCase() === typeParam.toLowerCase());
    }
    if (tagParam) {
      nodes = nodes.filter((n) => n.tags.some((t) => t.toLowerCase() === tagParam.toLowerCase()));
    }
    if (search) {
      nodes = nodes.filter((n) => JSON.stringify(n.data).toLowerCase().includes(search));
    }
    return jsonResponse(
      { success: true, data: nodes },
      200,
      buildPaginationHeaders(nodes.length, page, limitParam || Math.max(50, nodes.length))
    );
  }

  if (entity === 'wedding-party') {
    const items = [...dataset.weddingParty].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return jsonResponse(
      { success: true, data: items },
      200,
      buildPaginationHeaders(items.length, page, limitParam || Math.max(50, items.length))
    );
  }

  if (entity === 'attractions') {
    let items = dataset.attractions;
    const category = (url.searchParams.get('category') || '').trim();
    if (category && category !== 'all') {
      items = items.filter((a) => a.category.toLowerCase() === category.toLowerCase());
    }
    if (search) {
      items = items.filter(
        (a) =>
          a.name.toLowerCase().includes(search) ||
          a.description.toLowerCase().includes(search) ||
          a.category.toLowerCase().includes(search)
      );
    }
    return jsonResponse(
      { success: true, data: items },
      200,
      buildPaginationHeaders(items.length, page, limitParam || Math.max(50, items.length))
    );
  }

  if (entity === 'registry-items') {
    let items = [...dataset.registryItems].sort(
      (a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)
    );
    if (search) {
      items = items.filter(
        (i) =>
          i.name.toLowerCase().includes(search) ||
          i.category.toLowerCase().includes(search) ||
          (i.description || '').toLowerCase().includes(search)
      );
    }
    return jsonResponse(
      { success: true, data: items },
      200,
      buildPaginationHeaders(items.length, page, limitParam || Math.max(50, items.length))
    );
  }

  if (entity === 'seating-tables') {
    const tables = dataset.seatingTables;
    return jsonResponse(
      { success: true, data: tables },
      200,
      buildPaginationHeaders(tables.length, page, limitParam || Math.max(50, tables.length))
    );
  }

  // sub-events
  const subEvents = [...dataset.subEvents].sort((a, b) => {
    const aTime = a.startTime ? new Date(a.startTime).getTime() : 0;
    const bTime = b.startTime ? new Date(b.startTime).getTime() : 0;
    return aTime - bTime;
  });
  return jsonResponse(
    { success: true, data: subEvents },
    200,
    buildPaginationHeaders(subEvents.length, page, limitParam || Math.max(50, subEvents.length))
  );
}

function handleEntityCreate(entity: string, body: Record<string, unknown>): Response {
  const now = new Date();
  const nowIso = now.toISOString();

  if (entity === 'wedding-party') {
    const side: WeddingPartySide =
      body.side === 'BRIDE' || body.side === 'GROOM' || body.side === 'JOINT'
        ? body.side
        : 'JOINT';
    const member: WeddingPartyMemberDTO = {
      id: nextDemoId('demo-party'),
      name: String(body.name || 'Party Member'),
      role: String(body.role || 'Attendant'),
      bio: String(body.bio || ''),
      side,
      link: typeof body.link === 'string' ? body.link : null,
      order: Number(body.order || getActiveArchetypeDataset().weddingParty.length + 1),
      isSample: false,
      photoId: typeof body.photoId === 'string' ? body.photoId : null,
      photo: null,
      createdAt: now,
      updatedAt: now,
    };
    mutateActiveDataset((curr) => ({
      ...curr,
      weddingParty: [...curr.weddingParty, member],
    }));
    recordDemoAuditVersion({
      entityType: 'WeddingPartyMember',
      entityId: member.id,
      action: 'CREATE',
      summary: `Added wedding party member "${member.name}"`,
    });
    return jsonResponse({ success: true, data: member }, 201);
  }

  if (entity === 'attractions') {
    const attraction: AttractionDTO = {
      id: nextDemoId('demo-attraction'),
      name: String(body.name || 'Local Spot'),
      description: String(body.description || ''),
      category: String(body.category || 'Activities'),
      website: typeof body.website === 'string' ? body.website : 'https://example.com',
      directions: String(body.directions || ''),
      latitude: Number(body.latitude ?? 41.8781),
      longitude: Number(body.longitude ?? -87.6298),
      isVisible: body.isVisible !== false,
      promoCode: typeof body.promoCode === 'string' ? body.promoCode : null,
      bookingUrl: typeof body.bookingUrl === 'string' ? body.bookingUrl : null,
      roomRate: typeof body.roomRate === 'string' ? body.roomRate : null,
      cutoffDate: typeof body.cutoffDate === 'string' ? body.cutoffDate : null,
      shuttleInfo: typeof body.shuttleInfo === 'string' ? body.shuttleInfo : null,
      isSample: false,
      imageId: typeof body.imageId === 'string' ? body.imageId : null,
      image: null,
      createdAt: now,
      updatedAt: now,
    };
    mutateActiveDataset((curr) => ({
      ...curr,
      attractions: [...curr.attractions, attraction],
    }));
    recordDemoAuditVersion({
      entityType: 'Attraction',
      entityId: attraction.id,
      action: 'CREATE',
      summary: `Added attraction "${attraction.name}"`,
    });
    return jsonResponse({ success: true, data: attraction }, 201);
  }

  if (entity === 'seating-tables') {
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
      id: nextDemoId('demo-table'),
      name: String(body.name || (isLandmark ? 'Landmark' : 'New Table')),
      shape: resolvedShape,
      capacity: isLandmark ? 0 : typeof body.capacity === 'number' ? body.capacity : 8,
      x: typeof body.x === 'number' ? body.x : 200,
      y: typeof body.y === 'number' ? body.y : 200,
      width: typeof body.width === 'number' ? body.width : 120,
      height: typeof body.height === 'number' ? body.height : 120,
      rotation: typeof body.rotation === 'number' ? body.rotation : 0,
      isSample: false,
      createdAt: nowIso,
      updatedAt: nowIso,
      invitationCodes: [],
    };
    mutateActiveDataset((curr) => ({
      ...curr,
      seatingTables: [...curr.seatingTables, newTable],
    }));
    recordDemoAuditVersion({
      entityType: 'SeatingTable',
      entityId: newTable.id,
      action: 'CREATE',
      summary: `Created seating table "${newTable.name}"`,
    });
    return jsonResponse({ success: true, data: newTable }, 201);
  }

  if (entity === 'invitation-codes') {
    const suffix = Date.now().toString().slice(-4);
    const code = String(body.code || `GUEST${suffix}`).toUpperCase();
    const newGuest: InvitationCodeDTO = {
      id: nextDemoId('demo-guest'),
      code,
      guestName: String(body.guestName || 'Invited Guest'),
      email: typeof body.email === 'string' ? body.email : null,
      addressLine1: typeof body.addressLine1 === 'string' ? body.addressLine1 : '',
      addressLine2: typeof body.addressLine2 === 'string' ? body.addressLine2 : '',
      city: typeof body.city === 'string' ? body.city : '',
      state: typeof body.state === 'string' ? body.state : '',
      zipCode: typeof body.zipCode === 'string' ? body.zipCode : '',
      country: typeof body.country === 'string' ? body.country : 'USA',
      dietaryNotes: typeof body.dietaryNotes === 'string' ? body.dietaryNotes : '',
      householdName: typeof body.householdName === 'string' ? body.householdName : '',
      partyGroup: typeof body.partyGroup === 'string' ? body.partyGroup : 'Friends',
      partyTags: Array.isArray(body.partyTags)
        ? body.partyTags.filter((t): t is string => typeof t === 'string')
        : [],
      plusOneAllocations: Number(body.plusOneAllocations ?? 0),
      plusOneFirstName: typeof body.plusOneFirstName === 'string' ? body.plusOneFirstName : '',
      plusOneLastName: typeof body.plusOneLastName === 'string' ? body.plusOneLastName : '',
      used: false,
      isSample: false,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    mutateActiveDataset((curr) => ({
      ...curr,
      guests: [...curr.guests, newGuest],
    }));
    upsertInvitationsIntoStaticDemoStore([newGuest]);
    recordDemoAuditVersion({
      entityType: 'InvitationCode',
      entityId: newGuest.id,
      action: 'CREATE',
      summary: `Added household invitation "${newGuest.guestName}" (${newGuest.code})`,
    });
    return jsonResponse({ success: true, data: newGuest }, 201);
  }

  if (entity === 'registry-items') {
    const id = nextDemoId('demo-item');
    const name = String(body.name || 'Custom Gift');
    const category = String(body.category || 'Home');
    const itemType =
      body.itemType === 'CASH_FUND' || body.itemType === 'EXPERIENCE_FUND'
        ? body.itemType
        : 'PHYSICAL';
    const newItem: RegistryItem = {
      id,
      name,
      description: String(body.description || ''),
      category,
      price: Number(body.price ?? 75),
      quantity: Math.max(1, Number(body.quantity ?? 1)),
      itemType,
      isGroupGift: Boolean(body.isGroupGift || itemType !== 'PHYSICAL'),
      isMostWanted: Boolean(body.isMostWanted),
      displayOrder: Number(body.displayOrder ?? getActiveArchetypeDataset().registryItems.length),
      vendorUrl: typeof body.vendorUrl === 'string' ? body.vendorUrl : null,
      paymentHandleType:
        typeof body.paymentHandleType === 'string' ? body.paymentHandleType : 'Venmo',
      paymentHandle:
        typeof body.paymentHandle === 'string' ? body.paymentHandle : '@alex-and-taylor',
      purchased: false,
      purchaserName: null,
      amountContributed: 0,
      isSample: false,
      imageId: `${id}-img`,
      image: {
        id: `${id}-img`,
        url: createSampleItemSvgDataUrl(name, category),
        altText: name,
        isDecorative: false,
        isSample: false,
      },
      contributors: [],
    };
    mutateActiveDataset((curr) => ({
      ...curr,
      registryItems: [newItem, ...curr.registryItems],
    }));
    recordDemoAuditVersion({
      entityType: 'RegistryItem',
      entityId: newItem.id,
      action: 'CREATE',
      summary: `Added registry gift "${newItem.name}"`,
    });
    return jsonResponse({ success: true, data: newItem }, 201);
  }

  if (entity === 'sub-events') {
    const subEventId = nextDemoId('demo-subevent');
    const isPrivate = Boolean(body.isPrivate);
    const created: SubEventDTO = {
      id: subEventId,
      title: String(body.title || 'Wedding Event'),
      description: String(body.description || ''),
      startTime: typeof body.startTime === 'string' ? body.startTime : '2026-09-19T18:00:00.000Z',
      endTime: typeof body.endTime === 'string' ? body.endTime : '2026-09-19T21:00:00.000Z',
      locationName: String(body.locationName || body.location || 'Main Venue'),
      location: String(body.location || body.locationName || 'Main Venue'),
      category: String(body.category || 'Wedding'),
      attireRules: typeof body.attireRules === 'string' ? body.attireRules : null,
      isPrivate,
      displayOrder: Number(body.displayOrder ?? getActiveArchetypeDataset().subEvents.length),
      mealOptions: Array.isArray(body.mealOptions)
        ? (body.mealOptions as SubEventDTO['mealOptions'])
        : [],
      customQuestions: Array.isArray(body.customQuestions)
        ? (body.customQuestions as SubEventDTO['customQuestions'])
        : [],
      createdAt: nowIso,
      updatedAt: nowIso,
    } as SubEventDTO;

    mutateActiveDataset((curr) => {
      const publicAccess = !isPrivate
        ? curr.guests.map((g, idx) => ({
          id: `${subEventId}-acc-${idx}`,
          subEventId,
          invitationCodeId: g.id,
          createdAt: nowIso,
        }))
        : [];
      const nextScheduleNodes: ContentNodeDTO[] = !isPrivate
        ? [
          ...curr.scheduleNodes,
          {
            id: `${subEventId}-schedule-node`,
            type: 'Schedule',
            tags: ['Homepage', 'Schedule'],
            data: {
              title: created.title,
              description: created.description ?? '',
              startTime: String(created.startTime),
              endTime: String(created.endTime),
              locationName: created.locationName ?? '',
              location: created.location ?? '',
              category: created.category ?? 'Wedding',
              isSample: false,
              isVisible: true,
            },
            createdAt: now,
            updatedAt: now,
          },
        ]
        : curr.scheduleNodes;
      return {
        ...curr,
        subEvents: [...curr.subEvents, created],
        subEventAccess: [...curr.subEventAccess, ...publicAccess],
        scheduleNodes: nextScheduleNodes,
      };
    });
    recordDemoAuditVersion({
      entityType: 'SubEvent',
      entityId: created.id,
      action: 'CREATE',
      summary: `Created sub-event "${created.title}"`,
    });
    return jsonResponse({ success: true, data: created }, 201);
  }

  // content-nodes
  const rawType = typeof body.type === 'string' && body.type.trim() ? body.type.trim() : 'FAQ';
  const rawTags = Array.isArray(body.tags)
    ? body.tags.filter((t): t is string => typeof t === 'string')
    : rawType === 'FAQ'
      ? ['Homepage', 'FAQ']
      : ['Homepage', rawType];
  const rawData =
    body.data && typeof body.data === 'object' && !Array.isArray(body.data)
      ? { ...(body.data as Record<string, unknown>), isSample: false }
      : { isSample: false };
  const node = {
    id: nextDemoId(`demo-${rawType.toLowerCase()}`),
    type: rawType,
    tags: rawTags,
    data: rawData,
    createdAt: now,
    updatedAt: now,
  } as ContentNodeDTO;

  mutateActiveDataset((curr) => writeBackContentNode(curr, node));
  recordDemoAuditVersion({
    entityType: 'ContentNode',
    entityId: node.id,
    action: 'CREATE',
    summary: `Created ${node.type} content node`,
  });
  return jsonResponse({ success: true, data: node }, 201);
}

function handleEntityReorder(
  entity: string,
  orderedIds: string[],
  body: Record<string, unknown>
): Response {
  const dataset = getActiveArchetypeDataset();

  if (entity === 'wedding-party') {
    const next = reorderListByIds(dataset.weddingParty, orderedIds, (m, idx) => ({
      ...m,
      order: idx + 1,
      updatedAt: new Date(),
    }));
    mutateActiveDataset((curr) => ({ ...curr, weddingParty: next }));
    recordDemoAuditVersion({
      entityType: 'WeddingPartyMember',
      entityId: 'reorder',
      action: 'REORDER',
      summary: 'Reordered wedding party lineup',
    });
    return jsonResponse({ success: true, data: next });
  }

  if (entity === 'attractions') {
    const next = reorderListByIds(dataset.attractions, orderedIds, (a) => ({
      ...a,
      updatedAt: new Date(),
    }));
    mutateActiveDataset((curr) => ({ ...curr, attractions: next }));
    return jsonResponse({ success: true, data: next });
  }

  if (entity === 'registry-items') {
    const next = reorderListByIds(dataset.registryItems, orderedIds, (i, idx) => ({
      ...i,
      displayOrder: idx,
    }));
    mutateActiveDataset((curr) => ({ ...curr, registryItems: next }));
    return jsonResponse({ success: true, data: next });
  }

  if (entity === 'sub-events') {
    const next = reorderListByIds(dataset.subEvents, orderedIds, (se, idx) => ({
      ...se,
      displayOrder: idx,
      updatedAt: new Date().toISOString(),
    }));
    mutateActiveDataset((curr) => ({ ...curr, subEvents: next }));
    return jsonResponse({ success: true, data: next });
  }

  if (entity === 'content-nodes') {
    const nextFaqs = reorderListByIds(dataset.faqs, orderedIds, (node, idx) => ({
      ...node,
      data: {
        ...(node.data as Record<string, unknown>),
        displayOrder: idx,
      },
      updatedAt: new Date(),
    })) as ContentNodeDTO[];
    mutateActiveDataset((curr) => ({ ...curr, faqs: nextFaqs }));
    recordDemoAuditVersion({
      entityType: 'ContentNode',
      entityId: 'faq-order',
      action: 'REORDER',
      summary: 'Updated Wedding Q&A display order',
    });
    return jsonResponse({
      success: true,
      data: getDemoContentNodes({ ...dataset, faqs: nextFaqs }),
      ...(body.action ? { action: body.action } : {}),
    });
  }

  return jsonResponse({ success: true, data: [] });
}

function handleEntityGetById(entity: string, id: string): Response {
  const dataset = getActiveArchetypeDataset();
  if (entity === 'wedding-party') {
    const found = dataset.weddingParty.find((m) => m.id === id);
    return found
      ? jsonResponse({ success: true, data: found })
      : jsonResponse({ error: 'Member not found' }, 404);
  }
  if (entity === 'attractions') {
    const found = dataset.attractions.find((a) => a.id === id);
    return found
      ? jsonResponse({ success: true, data: found })
      : jsonResponse({ error: 'Attraction not found' }, 404);
  }
  if (entity === 'seating-tables') {
    const found = dataset.seatingTables.find((t) => t.id === id);
    return found
      ? jsonResponse({ success: true, data: found })
      : jsonResponse({ error: 'Table not found' }, 404);
  }
  if (entity === 'invitation-codes') {
    const found = dataset.guests.find((g) => g.id === id);
    return found
      ? jsonResponse({ success: true, data: found })
      : jsonResponse({ error: 'Invitation code not found' }, 404);
  }
  if (entity === 'registry-items') {
    const found = dataset.registryItems.find((i) => i.id === id);
    return found
      ? jsonResponse({ success: true, data: found })
      : jsonResponse({ error: 'Registry item not found' }, 404);
  }
  if (entity === 'sub-events') {
    const found = dataset.subEvents.find((s) => s.id === id);
    return found
      ? jsonResponse({ success: true, data: found })
      : jsonResponse({ error: 'Sub-event not found' }, 404);
  }
  const foundNode = getDemoContentNodes(dataset).find((n) => n.id === id);
  return foundNode
    ? jsonResponse({ success: true, data: foundNode })
    : jsonResponse({ error: 'Content node not found' }, 404);
}

function handleEntityUpdateById(
  entity: string,
  id: string,
  body: Record<string, unknown>
): Response {
  const dataset = getActiveArchetypeDataset();
  const now = new Date();
  const nowIso = now.toISOString();

  if (entity === 'wedding-party') {
    const existing = dataset.weddingParty.find((m) => m.id === id);
    if (!existing) return jsonResponse({ error: 'Member not found' }, 404);
    const side: WeddingPartySide =
      body.side === 'BRIDE' || body.side === 'GROOM' || body.side === 'JOINT'
        ? body.side
        : (existing.side ?? 'JOINT');
    const updated: WeddingPartyMemberDTO = {
      ...existing,
      ...(typeof body.name === 'string' ? { name: body.name } : {}),
      ...(typeof body.role === 'string' ? { role: body.role } : {}),
      ...(typeof body.bio === 'string' ? { bio: body.bio } : {}),
      ...(body.link === null || typeof body.link === 'string' ? { link: body.link } : {}),
      ...(typeof body.order === 'number' ? { order: body.order } : {}),
      side,
      isSample: false,
      updatedAt: now,
    };
    mutateActiveDataset((curr) => ({
      ...curr,
      weddingParty: curr.weddingParty.map((m) => (m.id === id ? updated : m)),
    }));
    recordDemoAuditVersion({
      entityType: 'WeddingPartyMember',
      entityId: id,
      action: 'UPDATE',
      summary: `Updated wedding party member "${updated.name}"`,
    });
    return jsonResponse({ success: true, data: updated });
  }

  if (entity === 'attractions') {
    const existing = dataset.attractions.find((a) => a.id === id);
    if (!existing) return jsonResponse({ error: 'Attraction not found' }, 404);
    const updated: AttractionDTO = {
      ...existing,
      ...(typeof body.name === 'string' ? { name: body.name } : {}),
      ...(typeof body.description === 'string' ? { description: body.description } : {}),
      ...(typeof body.category === 'string' ? { category: body.category } : {}),
      ...(typeof body.website === 'string' ? { website: body.website } : {}),
      ...(typeof body.directions === 'string' ? { directions: body.directions } : {}),
      ...(typeof body.latitude === 'number' ? { latitude: body.latitude } : {}),
      ...(typeof body.longitude === 'number' ? { longitude: body.longitude } : {}),
      ...(typeof body.isVisible === 'boolean' ? { isVisible: body.isVisible } : {}),
      ...(body.promoCode === null || typeof body.promoCode === 'string'
        ? { promoCode: body.promoCode }
        : {}),
      ...(body.bookingUrl === null || typeof body.bookingUrl === 'string'
        ? { bookingUrl: body.bookingUrl }
        : {}),
      ...(body.roomRate === null || typeof body.roomRate === 'string'
        ? { roomRate: body.roomRate }
        : {}),
      ...(body.cutoffDate === null || typeof body.cutoffDate === 'string'
        ? { cutoffDate: body.cutoffDate }
        : {}),
      ...(body.shuttleInfo === null || typeof body.shuttleInfo === 'string'
        ? { shuttleInfo: body.shuttleInfo }
        : {}),
      isSample: false,
      updatedAt: now,
    };
    mutateActiveDataset((curr) => ({
      ...curr,
      attractions: curr.attractions.map((a) => (a.id === id ? updated : a)),
    }));
    recordDemoAuditVersion({
      entityType: 'Attraction',
      entityId: id,
      action: 'UPDATE',
      summary: `Updated attraction "${updated.name}"`,
    });
    return jsonResponse({ success: true, data: updated });
  }

  if (entity === 'seating-tables') {
    const existing = dataset.seatingTables.find((t) => t.id === id);
    if (!existing) return jsonResponse({ error: 'Table not found' }, 404);
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
      updatedAt: nowIso,
    };
    mutateActiveDataset((curr) => ({
      ...curr,
      seatingTables: curr.seatingTables.map((t) => (t.id === id ? updated : t)),
    }));
    recordDemoAuditVersion({
      entityType: 'SeatingTable',
      entityId: id,
      action: 'UPDATE',
      summary: `Updated seating table "${updated.name}"`,
    });
    return jsonResponse({ success: true, data: updated });
  }

  if (entity === 'invitation-codes') {
    const existing = dataset.guests.find((g) => g.id === id);
    if (!existing) return jsonResponse({ error: 'Invitation code not found' }, 404);
    const updated: InvitationCodeDTO = {
      ...existing,
      ...(typeof body.code === 'string' && body.code.trim()
        ? { code: body.code.trim().toUpperCase() }
        : {}),
      ...(typeof body.guestName === 'string' ? { guestName: body.guestName } : {}),
      ...(body.email === null || typeof body.email === 'string' ? { email: body.email } : {}),
      ...(body.addressLine1 === null || typeof body.addressLine1 === 'string'
        ? { addressLine1: body.addressLine1 }
        : {}),
      ...(body.addressLine2 === null || typeof body.addressLine2 === 'string'
        ? { addressLine2: body.addressLine2 }
        : {}),
      ...(body.city === null || typeof body.city === 'string' ? { city: body.city } : {}),
      ...(body.state === null || typeof body.state === 'string' ? { state: body.state } : {}),
      ...(body.zipCode === null || typeof body.zipCode === 'string'
        ? { zipCode: body.zipCode }
        : {}),
      ...(body.country === null || typeof body.country === 'string'
        ? { country: body.country }
        : {}),
      ...(body.dietaryNotes === null || typeof body.dietaryNotes === 'string'
        ? { dietaryNotes: body.dietaryNotes }
        : {}),
      ...(body.householdName === null || typeof body.householdName === 'string'
        ? { householdName: body.householdName }
        : {}),
      ...(body.partyGroup === null || typeof body.partyGroup === 'string'
        ? { partyGroup: body.partyGroup }
        : {}),
      ...(Array.isArray(body.partyTags)
        ? { partyTags: normalizePartyTags(body.partyTags, { dedupe: true }) }
        : {}),
      ...(typeof body.plusOneAllocations === 'number'
        ? { plusOneAllocations: body.plusOneAllocations }
        : {}),
      ...(body.plusOneFirstName === null || typeof body.plusOneFirstName === 'string'
        ? { plusOneFirstName: body.plusOneFirstName }
        : {}),
      ...(body.plusOneLastName === null || typeof body.plusOneLastName === 'string'
        ? { plusOneLastName: body.plusOneLastName }
        : {}),
      ...(body.extraFields && typeof body.extraFields === 'object'
        ? { extraFields: body.extraFields as Record<string, unknown> }
        : {}),
      isSample: false,
      updatedAt: nowIso,
    };
    mutateActiveDataset((curr) => ({
      ...curr,
      guests: curr.guests.map((g) => (g.id === id ? updated : g)),
    }));
    upsertInvitationsIntoStaticDemoStore([updated]);
    recordDemoAuditVersion({
      entityType: 'InvitationCode',
      entityId: id,
      action: 'UPDATE',
      summary: `Updated household "${updated.guestName}"`,
    });
    return jsonResponse({ success: true, data: updated });
  }

  if (entity === 'registry-items') {
    const existing = dataset.registryItems.find((i) => i.id === id);
    if (!existing) return jsonResponse({ error: 'Registry item not found' }, 404);
    const updated: RegistryItem = {
      ...existing,
      ...(typeof body.name === 'string' ? { name: body.name } : {}),
      ...(typeof body.description === 'string' ? { description: body.description } : {}),
      ...(typeof body.category === 'string' ? { category: body.category } : {}),
      ...(typeof body.price === 'number' ? { price: body.price } : {}),
      ...(typeof body.quantity === 'number' ? { quantity: Math.max(1, body.quantity) } : {}),
      ...(typeof body.isGroupGift === 'boolean' ? { isGroupGift: body.isGroupGift } : {}),
      ...(typeof body.isMostWanted === 'boolean' ? { isMostWanted: body.isMostWanted } : {}),
      ...(typeof body.displayOrder === 'number' ? { displayOrder: body.displayOrder } : {}),
      ...(body.vendorUrl === null || typeof body.vendorUrl === 'string'
        ? { vendorUrl: body.vendorUrl }
        : {}),
      isSample: false,
    };
    mutateActiveDataset((curr) => ({
      ...curr,
      registryItems: curr.registryItems.map((i) => (i.id === id ? updated : i)),
    }));
    recordDemoAuditVersion({
      entityType: 'RegistryItem',
      entityId: id,
      action: 'UPDATE',
      summary: `Updated registry gift "${updated.name}"`,
    });
    return jsonResponse({ success: true, data: updated });
  }

  if (entity === 'sub-events') {
    const existing = dataset.subEvents.find((s) => s.id === id);
    if (!existing) return jsonResponse({ error: 'Sub-event not found' }, 404);
    const updated: SubEventDTO = {
      ...existing,
      ...(typeof body.title === 'string' ? { title: body.title } : {}),
      ...(typeof body.description === 'string' ? { description: body.description } : {}),
      ...(typeof body.startTime === 'string' ? { startTime: body.startTime } : {}),
      ...(typeof body.endTime === 'string' ? { endTime: body.endTime } : {}),
      ...(typeof body.locationName === 'string' ? { locationName: body.locationName } : {}),
      ...(typeof body.location === 'string' ? { location: body.location } : {}),
      ...(typeof body.category === 'string' ? { category: body.category } : {}),
      ...(body.attireRules === null || typeof body.attireRules === 'string'
        ? { attireRules: body.attireRules }
        : {}),
      ...(typeof body.isPrivate === 'boolean' ? { isPrivate: body.isPrivate } : {}),
      ...(Array.isArray(body.mealOptions)
        ? { mealOptions: body.mealOptions as SubEventDTO['mealOptions'] }
        : {}),
      ...(Array.isArray(body.customQuestions)
        ? { customQuestions: body.customQuestions as SubEventDTO['customQuestions'] }
        : {}),
      updatedAt: nowIso,
    };
    mutateActiveDataset((curr) => ({
      ...curr,
      subEvents: curr.subEvents.map((s) => (s.id === id ? updated : s)),
    }));
    recordDemoAuditVersion({
      entityType: 'SubEvent',
      entityId: id,
      action: 'UPDATE',
      summary: `Updated sub-event "${updated.title}"`,
    });
    return jsonResponse({ success: true, data: updated });
  }

  // content-nodes
  const existingNode = getDemoContentNodes(dataset).find((n) => n.id === id);
  if (!existingNode) return jsonResponse({ error: 'Content node not found' }, 404);
  const incomingData =
    body.data && typeof body.data === 'object' && !Array.isArray(body.data)
      ? (body.data as Record<string, unknown>)
      : {};
  const mergedNode = {
    ...existingNode,
    ...(typeof body.type === 'string' ? { type: body.type as ContentNodeDTO['type'] } : {}),
    ...(Array.isArray(body.tags)
      ? { tags: body.tags.filter((t): t is string => typeof t === 'string') }
      : {}),
    data: {
      ...(existingNode.data as Record<string, unknown>),
      ...incomingData,
      isSample: false,
    },
    updatedAt: now,
  } as ContentNodeDTO;

  mutateActiveDataset((curr) => writeBackContentNode(curr, mergedNode));
  recordDemoAuditVersion({
    entityType: 'ContentNode',
    entityId: id,
    action: 'UPDATE',
    summary: `Updated ${mergedNode.type} content node`,
  });
  return jsonResponse({ success: true, data: mergedNode });
}

function handleEntityDeleteById(entity: string, id: string): Response {
  const dataset = getActiveArchetypeDataset();

  if (entity === 'wedding-party') {
    if (!dataset.weddingParty.some((m) => m.id === id)) {
      return jsonResponse({ error: 'Member not found' }, 404);
    }
    mutateActiveDataset((curr) => ({
      ...curr,
      weddingParty: curr.weddingParty.filter((m) => m.id !== id),
    }));
    recordDemoAuditVersion({
      entityType: 'WeddingPartyMember',
      entityId: id,
      action: 'DELETE',
      summary: 'Removed wedding party member',
    });
    return jsonResponse({ success: true, deletedId: id });
  }

  if (entity === 'attractions') {
    if (!dataset.attractions.some((a) => a.id === id)) {
      return jsonResponse({ error: 'Attraction not found' }, 404);
    }
    mutateActiveDataset((curr) => ({
      ...curr,
      attractions: curr.attractions.filter((a) => a.id !== id),
    }));
    recordDemoAuditVersion({
      entityType: 'Attraction',
      entityId: id,
      action: 'DELETE',
      summary: 'Removed attraction',
    });
    return jsonResponse({ success: true, deletedId: id });
  }

  if (entity === 'seating-tables') {
    if (!dataset.seatingTables.some((t) => t.id === id)) {
      return jsonResponse({ error: 'Table not found' }, 404);
    }
    mutateActiveDataset((curr) => ({
      ...curr,
      seatingTables: curr.seatingTables.filter((t) => t.id !== id),
      guests: curr.guests.map((g) =>
        g.tableId === id ? { ...g, tableId: null, seatNumber: null, plusOneSeatNumbers: [] } : g
      ),
    }));
    recordDemoAuditVersion({
      entityType: 'SeatingTable',
      entityId: id,
      action: 'DELETE',
      summary: 'Deleted seating table and unassigned guests',
    });
    return jsonResponse({ success: true, deletedId: id });
  }

  if (entity === 'invitation-codes') {
    if (!dataset.guests.some((g) => g.id === id)) {
      return jsonResponse({ error: 'Invitation code not found' }, 404);
    }
    mutateActiveDataset((curr) => ({
      ...curr,
      guests: curr.guests.filter((g) => g.id !== id),
      subEventAccess: curr.subEventAccess.filter((a) => a.invitationCodeId !== id),
      subEventRsvps: curr.subEventRsvps.filter((r) => r.invitationCodeId !== id),
    }));
    recordDemoAuditVersion({
      entityType: 'InvitationCode',
      entityId: id,
      action: 'DELETE',
      summary: 'Removed household invitation',
    });
    return jsonResponse({ success: true, deletedId: id });
  }

  if (entity === 'registry-items') {
    if (!dataset.registryItems.some((i) => i.id === id)) {
      return jsonResponse({ error: 'Registry item not found' }, 404);
    }
    mutateActiveDataset((curr) => ({
      ...curr,
      registryItems: curr.registryItems.filter((i) => i.id !== id),
    }));
    recordDemoAuditVersion({
      entityType: 'RegistryItem',
      entityId: id,
      action: 'DELETE',
      summary: 'Deleted registry gift',
    });
    return jsonResponse({ success: true, deletedId: id });
  }

  if (entity === 'sub-events') {
    if (!dataset.subEvents.some((s) => s.id === id)) {
      return jsonResponse({ error: 'Sub-event not found' }, 404);
    }
    mutateActiveDataset((curr) => ({
      ...curr,
      subEvents: curr.subEvents.filter((s) => s.id !== id),
      subEventAccess: curr.subEventAccess.filter((a) => a.subEventId !== id),
      subEventRsvps: curr.subEventRsvps.filter((r) => r.subEventId !== id),
    }));
    recordDemoAuditVersion({
      entityType: 'SubEvent',
      entityId: id,
      action: 'DELETE',
      summary: 'Deleted sub-event',
    });
    return jsonResponse({ success: true, deletedId: id });
  }

  // content-nodes
  const existingNode = getDemoContentNodes(dataset).find((n) => n.id === id);
  if (!existingNode) {
    return jsonResponse({ error: 'Content node not found' }, 404);
  }
  mutateActiveDataset((curr) => removeContentNodesByIds(curr, new Set([id])));
  recordDemoAuditVersion({
    entityType: 'ContentNode',
    entityId: id,
    action: 'DELETE',
    summary: `Deleted ${existingNode.type} content node`,
  });
  return jsonResponse({ success: true, deletedId: id });
}

function handleEntityBatch(
  entity: string,
  method: string,
  body: Record<string, unknown>,
  rawBody: unknown
): Response {
  const idsFromBody = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === 'string')
    : Array.isArray(rawBody)
      ? rawBody.filter((id): id is string => typeof id === 'string')
      : [];
  const idSet = new Set(idsFromBody);
  const action = typeof body.action === 'string' ? body.action : '';

  // Special invitation-codes tag / delete / create batch operations
  if (entity === 'invitation-codes') {
    if (method === 'DELETE' || action === 'delete') {
      let deletedCount = 0;
      mutateActiveDataset((curr) => {
        const before = curr.guests.length;
        const remaining = curr.guests.filter((g) => !idSet.has(g.id));
        deletedCount = before - remaining.length;
        return {
          ...curr,
          guests: remaining,
          subEventAccess: curr.subEventAccess.filter((a) => !idSet.has(a.invitationCodeId)),
          subEventRsvps: curr.subEventRsvps.filter((r) => !idSet.has(r.invitationCodeId)),
        };
      });
      return jsonResponse({
        success: true,
        deletedCount,
        count: deletedCount,
        data: { deletedCount, count: deletedCount },
      });
    }

    if (Array.isArray(body.items) || Array.isArray(body.records)) {
      const records = (Array.isArray(body.items) ? body.items : body.records) as Array<
        Record<string, unknown>
      >;
      const nowIso = new Date().toISOString();
      const created: InvitationCodeDTO[] = records.map((rec, idx) => ({
        id: `${nextDemoId('demo-batch-guest')}-${idx}`,
        code: String(rec.code || `BATCH${100 + idx}`).toUpperCase(),
        guestName: String(rec.guestName || `Guest ${idx + 1}`),
        email: typeof rec.email === 'string' ? rec.email : null,
        householdName: typeof rec.householdName === 'string' ? rec.householdName : '',
        partyGroup: typeof rec.partyGroup === 'string' ? rec.partyGroup : 'Invited',
        partyTags: normalizePartyTags(rec.partyTags, { dedupe: true }),
        plusOneAllocations: Number(rec.plusOneAllocations ?? 0),
        used: false,
        isSample: false,
        createdAt: nowIso,
        updatedAt: nowIso,
      }));
      mutateActiveDataset((curr) => ({
        ...curr,
        guests: [...curr.guests, ...created],
      }));
      upsertInvitationsIntoStaticDemoStore(created);
      return jsonResponse({
        success: true,
        count: created.length,
        createdCount: created.length,
        records: created,
        data: { count: created.length, createdCount: created.length, records: created },
      });
    }

    const cleanTags = normalizePartyTags(body.tags, { dedupe: true });
    const tagAction = action === 'remove' || action === 'replace' ? action : 'add';
    const updatedRecords: InvitationCodeDTO[] = [];
    if (idSet.size > 0) {
      mutateActiveDataset((curr) => ({
        ...curr,
        guests: curr.guests.map((guest) => {
          if (!idSet.has(guest.id)) return guest;
          const existing = normalizePartyTags(guest.partyTags, { dedupe: true });
          const nextTags =
            tagAction === 'replace'
              ? [...cleanTags]
              : tagAction === 'remove'
                ? existing.filter((tag) => !cleanTags.includes(tag))
                : Array.from(new Set([...existing, ...cleanTags]));
          const updated: InvitationCodeDTO = { ...guest, partyTags: nextTags };
          updatedRecords.push(updated);
          return updated;
        }),
      }));
      upsertInvitationsIntoStaticDemoStore(updatedRecords);
    }
    return jsonResponse({
      success: true,
      count: updatedRecords.length,
      updatedCount: updatedRecords.length,
      records: updatedRecords,
      data: {
        count: updatedRecords.length,
        updatedCount: updatedRecords.length,
        records: updatedRecords,
      },
    });
  }

  // Generic batch DELETE across all other entities
  if (method === 'DELETE' || action === 'delete') {
    let deletedCount = 0;
    mutateActiveDataset((curr) => {
      if (entity === 'wedding-party') {
        deletedCount = curr.weddingParty.filter((m) => idSet.has(m.id)).length;
        return { ...curr, weddingParty: curr.weddingParty.filter((m) => !idSet.has(m.id)) };
      }
      if (entity === 'attractions') {
        deletedCount = curr.attractions.filter((a) => idSet.has(a.id)).length;
        return { ...curr, attractions: curr.attractions.filter((a) => !idSet.has(a.id)) };
      }
      if (entity === 'seating-tables') {
        deletedCount = curr.seatingTables.filter((t) => idSet.has(t.id)).length;
        return {
          ...curr,
          seatingTables: curr.seatingTables.filter((t) => !idSet.has(t.id)),
          guests: curr.guests.map((g) =>
            g.tableId && idSet.has(g.tableId)
              ? { ...g, tableId: null, seatNumber: null, plusOneSeatNumbers: [] }
              : g
          ),
        };
      }
      if (entity === 'registry-items') {
        deletedCount = curr.registryItems.filter((i) => idSet.has(i.id)).length;
        return { ...curr, registryItems: curr.registryItems.filter((i) => !idSet.has(i.id)) };
      }
      if (entity === 'sub-events') {
        deletedCount = curr.subEvents.filter((s) => idSet.has(s.id)).length;
        return {
          ...curr,
          subEvents: curr.subEvents.filter((s) => !idSet.has(s.id)),
          subEventAccess: curr.subEventAccess.filter((a) => !idSet.has(a.subEventId)),
          subEventRsvps: curr.subEventRsvps.filter((r) => !idSet.has(r.subEventId)),
        };
      }
      deletedCount = idSet.size;
      return removeContentNodesByIds(curr, idSet);
    });
    return jsonResponse({
      success: true,
      count: deletedCount,
      deletedCount,
      data: { count: deletedCount, deletedCount },
    });
  }

  // Generic batch create/upsert when items array is provided
  const batchItems = Array.isArray(body.items)
    ? (body.items as Array<Record<string, unknown>>)
    : Array.isArray(rawBody)
      ? (rawBody.filter((x): x is Record<string, unknown> => Boolean(x && typeof x === 'object')))
      : [];

  if (batchItems.length > 0 && method === 'POST') {
    const createdRecords: unknown[] = [];
    for (const item of batchItems) {
      const res = handleEntityCreate(entity, item);
      if (res.status === 201) {
        createdRecords.push(item);
      }
    }
    return jsonResponse({
      success: true,
      count: createdRecords.length,
      data: { count: createdRecords.length, items: createdRecords },
    });
  }

  // Generic batch update (e.g., visibility toggle or category update)
  const updates =
    body.updates && typeof body.updates === 'object'
      ? (body.updates as Record<string, unknown>)
      : body.data && typeof body.data === 'object'
        ? (body.data as Record<string, unknown>)
        : body;

  let updatedCount = 0;
  for (const id of idSet) {
    const res = handleEntityUpdateById(entity, id, updates);
    if (res.status === 200) updatedCount += 1;
  }

  return jsonResponse({
    success: true,
    count: updatedCount,
    updatedCount,
    data: { count: updatedCount, updatedCount },
  });
}
