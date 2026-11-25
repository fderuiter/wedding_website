import type { AttractionDTO } from '@/features/attractions';
import type { ContentNodeDTO } from '@/features/content';
import type {
  HouseholdMemberDTO,
  HouseholdMemberRole,
  InvitationCodeDTO,
  RegistryItem,
} from '@/features/registry';
import type { SeatingTableDTO } from '@/features/seating';
import type { SubEventDTO } from '@/features/sub-events';
import type { WeddingPartyMemberDTO, WeddingPartySide } from '@/features/wedding-party';
import { normalizePartyTags, splitMemberFullName } from '@/utils/invitationValidation';
import {
  buildDemoHouseholdMembersForGuest,
  createSampleItemSvgDataUrl,
  type ArchetypeDataset,
  type DemoPhotoRecord,
} from '../demoSeed';
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

type DemoEntitySlug =
  | 'content-nodes'
  | 'wedding-party'
  | 'attractions'
  | 'registry-items'
  | 'invitation-codes'
  | 'seating-tables'
  | 'sub-events';

const DEMO_LANDMARK_SHAPES = new Set<string>(['dance-floor', 'bar', 'dj', 'buffet', 'cake']);

const VALID_TABLE_SHAPES: ReadonlyArray<SeatingTableDTO['shape']> = [
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

export function isDemoLandmarkShape(shape?: string): boolean {
  return Boolean(shape && DEMO_LANDMARK_SHAPES.has(shape));
}

function upsertById<T extends { id: string }>(list: T[], item: T, prepend = false): T[] {
  if (list.some((entry) => entry.id === item.id)) {
    return list.map((entry) => (entry.id === item.id ? item : entry));
  }
  return prepend ? [item, ...list] : [...list, item];
}

function writeBackContentNode(
  current: ArchetypeDataset,
  node: ContentNodeDTO
): ArchetypeDataset {
  if (node.type === 'FAQ') {
    return { ...current, faqs: upsertById(current.faqs, node) };
  }
  if (node.type === 'Logistics') {
    return { ...current, logisticsNodes: upsertById(current.logisticsNodes, node) };
  }
  if (node.type === 'Schedule') {
    return { ...current, scheduleNodes: upsertById(current.scheduleNodes, node) };
  }
  if (node.type === 'Photo') {
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
        data.status === 'PENDING' || data.status === 'REJECTED' || data.status === 'APPROVED'
          ? data.status
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
  return { ...current, customNodes: upsertById(current.customNodes, node) };
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
  const source = Array.isArray(rawBody)
    ? rawBody
    : Array.isArray(body.orderedIds)
      ? body.orderedIds
      : Array.isArray(body.ids)
        ? body.ids
        : Array.isArray(body.items)
          ? body.items
          : [];
  return source
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

interface DemoEntityDescriptor<T extends { id: string }> {
  auditType: string;
  notFoundError: string;
  paginatedEnvelope?: boolean;
  selectAll: (dataset: ArchetypeDataset) => T[];
  filterList?: (items: T[], url: URL, search: string) => T[];
  buildCreated: (body: Record<string, unknown>, dataset: ArchetypeDataset, now: Date) => T;
  writeCreated: (curr: ArchetypeDataset, created: T, now: Date) => ArchetypeDataset;
  describeItem: (item: T) => string;
  mergeUpdated: (existing: T, body: Record<string, unknown>, now: Date) => T;
  writeUpdated: (curr: ArchetypeDataset, updated: T) => ArchetypeDataset;
  removeByIds: (curr: ArchetypeDataset, ids: Set<string>) => {
    next: ArchetypeDataset;
    deletedCount: number;
  };
  reorder?: (curr: ArchetypeDataset, orderedIds: string[]) => {
    next: ArchetypeDataset;
    result: unknown[];
  };
  afterUpsert?: (items: T[]) => void;
}

const weddingPartyDescriptor: DemoEntityDescriptor<WeddingPartyMemberDTO> = {
  auditType: 'WeddingPartyMember',
  notFoundError: 'Member not found',
  selectAll: (d) => [...d.weddingParty].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
  filterList: (items, _url, search) =>
    search
      ? items.filter(
        (m) =>
          m.name.toLowerCase().includes(search) ||
            m.role.toLowerCase().includes(search) ||
            (m.bio || '').toLowerCase().includes(search)
      )
      : items,
  buildCreated: (body, dataset, now) => {
    const side: WeddingPartySide =
      body.side === 'BRIDE' || body.side === 'GROOM' || body.side === 'JOINT'
        ? body.side
        : 'JOINT';
    return {
      id: nextDemoId('demo-party'),
      name: String(body.name || 'Party Member'),
      role: String(body.role || 'Attendant'),
      bio: String(body.bio || ''),
      side,
      link: typeof body.link === 'string' ? body.link : null,
      order: Number(body.order || dataset.weddingParty.length + 1),
      isSample: false,
      photoId: typeof body.photoId === 'string' ? body.photoId : null,
      photo: null,
      createdAt: now,
      updatedAt: now,
    };
  },
  writeCreated: (curr, member) => ({ ...curr, weddingParty: [...curr.weddingParty, member] }),
  describeItem: (m) => `wedding party member "${m.name}"`,
  mergeUpdated: (existing, body, now) => ({
    ...existing,
    ...(typeof body.name === 'string' ? { name: body.name } : {}),
    ...(typeof body.role === 'string' ? { role: body.role } : {}),
    ...(typeof body.bio === 'string' ? { bio: body.bio } : {}),
    ...(body.link === null || typeof body.link === 'string' ? { link: body.link } : {}),
    ...(typeof body.order === 'number' ? { order: body.order } : {}),
    side:
      body.side === 'BRIDE' || body.side === 'GROOM' || body.side === 'JOINT'
        ? body.side
        : (existing.side ?? 'JOINT'),
    isSample: false,
    updatedAt: now,
  }),
  writeUpdated: (curr, updated) => ({
    ...curr,
    weddingParty: curr.weddingParty.map((m) => (m.id === updated.id ? updated : m)),
  }),
  removeByIds: (curr, ids) => {
    const remaining = curr.weddingParty.filter((m) => !ids.has(m.id));
    return {
      next: { ...curr, weddingParty: remaining },
      deletedCount: curr.weddingParty.length - remaining.length,
    };
  },
  reorder: (curr, orderedIds) => {
    const nextList = reorderListByIds(curr.weddingParty, orderedIds, (m, idx) => ({
      ...m,
      order: idx + 1,
      updatedAt: new Date(),
    }));
    return { next: { ...curr, weddingParty: nextList }, result: nextList };
  },
};

const attractionsDescriptor: DemoEntityDescriptor<AttractionDTO> = {
  auditType: 'Attraction',
  notFoundError: 'Attraction not found',
  selectAll: (d) => d.attractions,
  filterList: (items, url, search) => {
    const category = (url.searchParams.get('category') || '').trim();
    let filtered =
      category && category !== 'all'
        ? items.filter((a) => a.category.toLowerCase() === category.toLowerCase())
        : items;
    if (search) {
      filtered = filtered.filter(
        (a) =>
          a.name.toLowerCase().includes(search) ||
          a.description.toLowerCase().includes(search) ||
          a.category.toLowerCase().includes(search)
      );
    }
    return filtered;
  },
  buildCreated: (body, _dataset, now) => ({
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
  }),
  writeCreated: (curr, attraction) => ({ ...curr, attractions: [...curr.attractions, attraction] }),
  describeItem: (a) => `attraction "${a.name}"`,
  mergeUpdated: (existing, body, now) => ({
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
  }),
  writeUpdated: (curr, updated) => ({
    ...curr,
    attractions: curr.attractions.map((a) => (a.id === updated.id ? updated : a)),
  }),
  removeByIds: (curr, ids) => {
    const remaining = curr.attractions.filter((a) => !ids.has(a.id));
    return {
      next: { ...curr, attractions: remaining },
      deletedCount: curr.attractions.length - remaining.length,
    };
  },
  reorder: (curr, orderedIds) => {
    const nextList = reorderListByIds(curr.attractions, orderedIds, (a) => ({
      ...a,
      updatedAt: new Date(),
    }));
    return { next: { ...curr, attractions: nextList }, result: nextList };
  },
};

const seatingTablesDescriptor: DemoEntityDescriptor<SeatingTableDTO> = {
  auditType: 'SeatingTable',
  notFoundError: 'Table not found',
  selectAll: (d) => d.seatingTables,
  buildCreated: (body, _dataset, now) => {
    const nowIso = now.toISOString();
    const resolvedShape: SeatingTableDTO['shape'] =
      typeof body.shape === 'string' &&
      VALID_TABLE_SHAPES.includes(body.shape as SeatingTableDTO['shape'])
        ? (body.shape as SeatingTableDTO['shape'])
        : 'round';
    const isLandmark = isDemoLandmarkShape(resolvedShape);
    return {
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
  },
  writeCreated: (curr, table) => ({ ...curr, seatingTables: [...curr.seatingTables, table] }),
  describeItem: (t) => `seating table "${t.name}"`,
  mergeUpdated: (existing, body, now) => {
    const nextShape =
      typeof body.shape === 'string' ? (body.shape as SeatingTableDTO['shape']) : existing.shape;
    const isLandmark = isDemoLandmarkShape(nextShape);
    return {
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
      updatedAt: now.toISOString(),
    };
  },
  writeUpdated: (curr, updated) => ({
    ...curr,
    seatingTables: curr.seatingTables.map((t) => (t.id === updated.id ? updated : t)),
  }),
  removeByIds: (curr, ids) => {
    const remaining = curr.seatingTables.filter((t) => !ids.has(t.id));
    return {
      next: {
        ...curr,
        seatingTables: remaining,
        guests: curr.guests.map((g) =>
          g.tableId && ids.has(g.tableId)
            ? {
              ...g,
              tableId: null,
              seatNumber: null,
              plusOneSeatNumbers: [],
              ...(Array.isArray(g.members)
                ? { members: g.members.map((m) => ({ ...m, seatNumber: null })) }
                : {}),
            }
            : g
        ),
      },
      deletedCount: curr.seatingTables.length - remaining.length,
    };
  },
};

const invitationCodesDescriptor: DemoEntityDescriptor<InvitationCodeDTO> = {
  auditType: 'InvitationCode',
  notFoundError: 'Invitation code not found',
  paginatedEnvelope: true,
  selectAll: (d) => d.guests,
  filterList: (guests, url, search) => {
    const tagFilter = (url.searchParams.get('partyTag') || url.searchParams.get('tag') || '').trim();
    const groupFilter = (url.searchParams.get('partyGroup') || '').trim();
    let filtered = guests;
    if (search) {
      filtered = filtered.filter((g) => {
        if (
          g.guestName.toLowerCase().includes(search) ||
          (g.householdName || '').toLowerCase().includes(search) ||
          g.code.toLowerCase().includes(search) ||
          (g.email || '').toLowerCase().includes(search) ||
          (g.city || '').toLowerCase().includes(search)
        ) {
          return true;
        }
        return (g.members ?? []).some(
          (m) =>
            m.fullName.toLowerCase().includes(search) ||
            (m.email || '').toLowerCase().includes(search) ||
            (m.phone || '').toLowerCase().includes(search)
        );
      });
    }
    if (tagFilter && tagFilter !== 'all') {
      filtered = filtered.filter((g) => (g.partyTags || []).includes(tagFilter));
    }
    if (groupFilter && groupFilter !== 'all') {
      filtered = filtered.filter((g) => g.partyGroup === groupFilter);
    }
    return filtered;
  },
  buildCreated: (body, _dataset, now) => {
    const nowIso = now.toISOString();
    const suffix = Date.now().toString().slice(-4);
    const code = String(body.code || `GUEST${suffix}`).toUpperCase();
    const id = nextDemoId('demo-guest');
    const rawMembers = Array.isArray(body.members)
      ? (body.members as Array<Record<string, unknown>>)
      : null;
    const explicitMembers: HouseholdMemberDTO[] | undefined =
      rawMembers && rawMembers.length > 0
        ? rawMembers.map((m, idx) => {
          const fullName = String(m.fullName || (idx === 0 ? body.guestName : '') || `Guest #${idx + 1}`).trim();
          const split = splitMemberFullName(fullName);
          const role: HouseholdMemberRole =
            idx === 0
              ? 'PRIMARY'
              : m.role === 'PARTNER' || m.role === 'CHILD' || m.role === 'PLUS_ONE'
                ? m.role
                : 'PARTNER';
          return {
            id: typeof m.id === 'string' && m.id ? m.id : `${id}-member-${idx + 1}`,
            invitationCodeId: id,
            fullName,
            firstName: typeof m.firstName === 'string' ? m.firstName : split.firstName,
            lastName: typeof m.lastName === 'string' ? m.lastName : split.lastName,
            role,
            email: typeof m.email === 'string' && m.email.trim() ? m.email.trim() : null,
            phone: typeof m.phone === 'string' && m.phone.trim() ? m.phone.trim() : null,
            dietaryNotes:
              typeof m.dietaryNotes === 'string' && m.dietaryNotes.trim()
                ? m.dietaryNotes.trim()
                : null,
            tags: Array.isArray(m.tags) ? m.tags.map(String) : [],
            displayOrder: idx,
            seatNumber: typeof m.seatNumber === 'number' ? m.seatNumber : null,
            createdAt: nowIso,
            updatedAt: nowIso,
          };
        })
        : undefined;
    const base: InvitationCodeDTO = {
      id,
      code,
      guestName: String(explicitMembers?.[0]?.fullName || body.guestName || 'Invited Guest'),
      email:
        explicitMembers?.[0]?.email ??
        (typeof body.email === 'string' ? body.email : null),
      addressLine1: typeof body.addressLine1 === 'string' ? body.addressLine1 : '',
      addressLine2: typeof body.addressLine2 === 'string' ? body.addressLine2 : '',
      city: typeof body.city === 'string' ? body.city : '',
      state: typeof body.state === 'string' ? body.state : '',
      zipCode: typeof body.zipCode === 'string' ? body.zipCode : '',
      country: typeof body.country === 'string' ? body.country : 'USA',
      dietaryNotes: typeof body.dietaryNotes === 'string' ? body.dietaryNotes : '',
      householdName: typeof body.householdName === 'string' ? body.householdName : '',
      partyGroup: typeof body.partyGroup === 'string' ? body.partyGroup : 'Friends',
      partyTags: normalizePartyTags(body.partyTags, { dedupe: true }),
      plusOneAllocations: explicitMembers
        ? Math.max(Number(body.plusOneAllocations ?? 0), explicitMembers.length - 1)
        : Number(body.plusOneAllocations ?? 0),
      plusOneFirstName: typeof body.plusOneFirstName === 'string' ? body.plusOneFirstName : '',
      plusOneLastName: typeof body.plusOneLastName === 'string' ? body.plusOneLastName : '',
      ...(explicitMembers ? { members: explicitMembers } : {}),
      used: false,
      isSample: false,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    return {
      ...base,
      members: explicitMembers ?? buildDemoHouseholdMembersForGuest(base),
    };
  },
  writeCreated: (curr, guest) => ({ ...curr, guests: [...curr.guests, guest] }),
  describeItem: (g) => `household invitation "${g.guestName}" (${g.code})`,
  mergeUpdated: (existing, body, now) => {
    const nowIso = now.toISOString();
    const prevMembers = buildDemoHouseholdMembersForGuest(existing);
    const prevById = new Map(prevMembers.map((m) => [m.id, m]));
    let nextMembers: HouseholdMemberDTO[] = prevMembers;

    if (Array.isArray(body.members) && body.members.length > 0) {
      nextMembers = (body.members as Array<Record<string, unknown>>).map((m, idx) => {
        const prev = typeof m.id === 'string' ? prevById.get(m.id) : undefined;
        const fullName = String(m.fullName || prev?.fullName || `Member #${idx + 1}`).trim();
        const split = splitMemberFullName(fullName);
        const role: HouseholdMemberRole =
          idx === 0
            ? 'PRIMARY'
            : m.role === 'PARTNER' || m.role === 'CHILD' || m.role === 'PLUS_ONE'
              ? m.role
              : (prev?.role && prev.role !== 'PRIMARY' ? prev.role : 'PARTNER');
        return {
          id: prev?.id || (typeof m.id === 'string' && m.id ? m.id : `${existing.id}-member-${idx + 1}`),
          invitationCodeId: existing.id,
          fullName,
          firstName: typeof m.firstName === 'string' ? m.firstName : split.firstName,
          lastName: typeof m.lastName === 'string' ? m.lastName : split.lastName,
          role,
          email:
            m.email === null || typeof m.email === 'string'
              ? (m.email?.trim() || null)
              : (prev?.email ?? null),
          phone:
            m.phone === null || typeof m.phone === 'string'
              ? (m.phone?.trim() || null)
              : (prev?.phone ?? null),
          dietaryNotes:
            m.dietaryNotes === null || typeof m.dietaryNotes === 'string'
              ? (m.dietaryNotes?.trim() || null)
              : (prev?.dietaryNotes ?? null),
          tags: Array.isArray(m.tags) ? m.tags.map(String) : (prev?.tags ?? []),
          displayOrder: idx,
          seatNumber:
            typeof m.seatNumber === 'number'
              ? m.seatNumber
              : m.seatNumber === null
                ? null
                : (prev?.seatNumber ?? null),
          createdAt: prev?.createdAt ?? nowIso,
          updatedAt: nowIso,
        };
      });
    } else if (nextMembers[0]) {
      const updatedName = typeof body.guestName === 'string' ? body.guestName : existing.guestName;
      const split = splitMemberFullName(updatedName);
      nextMembers = nextMembers.map((m, idx) =>
        idx === 0
          ? {
            ...m,
            fullName: updatedName,
            firstName: split.firstName,
            lastName: split.lastName,
            email:
              body.email === null || typeof body.email === 'string'
                ? body.email
                : m.email,
            dietaryNotes:
              body.dietaryNotes === null || typeof body.dietaryNotes === 'string'
                ? body.dietaryNotes
                : m.dietaryNotes,
            updatedAt: nowIso,
          }
          : m
      );
    }

    const resolvedGuestName =
      Array.isArray(body.members) && nextMembers[0]
        ? nextMembers[0].fullName
        : typeof body.guestName === 'string'
          ? body.guestName
          : existing.guestName;

    return {
      ...existing,
      ...(typeof body.code === 'string' && body.code.trim()
        ? { code: body.code.trim().toUpperCase() }
        : {}),
      guestName: resolvedGuestName,
      ...(body.email === null || typeof body.email === 'string' ? { email: body.email } : {}),
      ...(body.addressLine1 === null || typeof body.addressLine1 === 'string'
        ? { addressLine1: body.addressLine1 }
        : {}),
      ...(body.addressLine2 === null || typeof body.addressLine2 === 'string'
        ? { addressLine2: body.addressLine2 }
        : {}),
      ...(body.city === null || typeof body.city === 'string' ? { city: body.city } : {}),
      ...(body.state === null || typeof body.state === 'string' ? { state: body.state } : {}),
      ...(body.zipCode === null || typeof body.zipCode === 'string' ? { zipCode: body.zipCode } : {}),
      ...(body.country === null || typeof body.country === 'string' ? { country: body.country } : {}),
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
      plusOneAllocations: Array.isArray(body.members)
        ? Math.max(
          typeof body.plusOneAllocations === 'number'
            ? body.plusOneAllocations
            : (existing.plusOneAllocations ?? 0),
          Math.max(0, nextMembers.length - 1)
        )
        : typeof body.plusOneAllocations === 'number'
          ? body.plusOneAllocations
          : existing.plusOneAllocations,
      ...(body.plusOneFirstName === null || typeof body.plusOneFirstName === 'string'
        ? { plusOneFirstName: body.plusOneFirstName }
        : {}),
      ...(body.plusOneLastName === null || typeof body.plusOneLastName === 'string'
        ? { plusOneLastName: body.plusOneLastName }
        : {}),
      ...(body.extraFields && typeof body.extraFields === 'object'
        ? { extraFields: body.extraFields as Record<string, unknown> }
        : {}),
      members: nextMembers,
      isSample: false,
      updatedAt: nowIso,
    };
  },
  writeUpdated: (curr, updated) => ({
    ...curr,
    guests: curr.guests.map((g) => (g.id === updated.id ? updated : g)),
  }),
  removeByIds: (curr, ids) => {
    const remaining = curr.guests.filter((g) => !ids.has(g.id));
    return {
      next: {
        ...curr,
        guests: remaining,
        subEventAccess: curr.subEventAccess.filter((a) => !ids.has(a.invitationCodeId)),
        subEventRsvps: curr.subEventRsvps.filter((r) => !ids.has(r.invitationCodeId)),
      },
      deletedCount: curr.guests.length - remaining.length,
    };
  },
  afterUpsert: (items) => upsertInvitationsIntoStaticDemoStore(items),
};

const registryItemsDescriptor: DemoEntityDescriptor<RegistryItem> = {
  auditType: 'RegistryItem',
  notFoundError: 'Registry item not found',
  selectAll: (d) =>
    [...d.registryItems].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)),
  filterList: (items, _url, search) =>
    search
      ? items.filter(
        (i) =>
          i.name.toLowerCase().includes(search) ||
            i.category.toLowerCase().includes(search) ||
            (i.description || '').toLowerCase().includes(search)
      )
      : items,
  buildCreated: (body, dataset) => {
    const id = nextDemoId('demo-item');
    const name = String(body.name || 'Custom Gift');
    const category = String(body.category || 'Home');
    const itemType =
      body.itemType === 'CASH_FUND' || body.itemType === 'EXPERIENCE_FUND'
        ? body.itemType
        : 'PHYSICAL';
    return {
      id,
      name,
      description: String(body.description || ''),
      category,
      price: Number(body.price ?? 75),
      quantity: Math.max(1, Number(body.quantity ?? 1)),
      itemType,
      isGroupGift: Boolean(body.isGroupGift || itemType !== 'PHYSICAL'),
      isMostWanted: Boolean(body.isMostWanted),
      displayOrder: Number(body.displayOrder ?? dataset.registryItems.length),
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
  },
  writeCreated: (curr, item) => ({ ...curr, registryItems: [item, ...curr.registryItems] }),
  describeItem: (i) => `registry gift "${i.name}"`,
  mergeUpdated: (existing, body) => ({
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
  }),
  writeUpdated: (curr, updated) => ({
    ...curr,
    registryItems: curr.registryItems.map((i) => (i.id === updated.id ? updated : i)),
  }),
  removeByIds: (curr, ids) => {
    const remaining = curr.registryItems.filter((i) => !ids.has(i.id));
    return {
      next: { ...curr, registryItems: remaining },
      deletedCount: curr.registryItems.length - remaining.length,
    };
  },
  reorder: (curr, orderedIds) => {
    const nextList = reorderListByIds(curr.registryItems, orderedIds, (i, idx) => ({
      ...i,
      displayOrder: idx,
    }));
    return { next: { ...curr, registryItems: nextList }, result: nextList };
  },
};

const subEventsDescriptor: DemoEntityDescriptor<SubEventDTO> = {
  auditType: 'SubEvent',
  notFoundError: 'Sub-event not found',
  selectAll: (d) =>
    [...d.subEvents].sort((a, b) => {
      const aTime = a.startTime ? new Date(a.startTime).getTime() : 0;
      const bTime = b.startTime ? new Date(b.startTime).getTime() : 0;
      return aTime - bTime;
    }),
  filterList: (items, _url, search) =>
    search
      ? items.filter(
        (s) =>
          s.title.toLowerCase().includes(search) ||
            (s.description || '').toLowerCase().includes(search)
      )
      : items,
  buildCreated: (body, dataset, now) => {
    const nowIso = now.toISOString();
    return {
      id: nextDemoId('demo-subevent'),
      title: String(body.title || 'Wedding Event'),
      description: String(body.description || ''),
      startTime: typeof body.startTime === 'string' ? body.startTime : '2026-09-19T18:00:00.000Z',
      endTime: typeof body.endTime === 'string' ? body.endTime : '2026-09-19T21:00:00.000Z',
      locationName: String(body.locationName || body.location || 'Main Venue'),
      location: String(body.location || body.locationName || 'Main Venue'),
      category: String(body.category || 'Wedding'),
      attireRules: typeof body.attireRules === 'string' ? body.attireRules : null,
      isPrivate: Boolean(body.isPrivate),
      displayOrder: Number(body.displayOrder ?? dataset.subEvents.length),
      mealOptions: Array.isArray(body.mealOptions)
        ? (body.mealOptions as SubEventDTO['mealOptions'])
        : [],
      customQuestions: Array.isArray(body.customQuestions)
        ? (body.customQuestions as SubEventDTO['customQuestions'])
        : [],
      createdAt: nowIso,
      updatedAt: nowIso,
    } as SubEventDTO;
  },
  writeCreated: (curr, created, now) => {
    const nowIso = now.toISOString();
    const publicAccess = !created.isPrivate
      ? curr.guests.map((g, idx) => ({
        id: `${created.id}-acc-${idx}`,
        subEventId: created.id,
        invitationCodeId: g.id,
        createdAt: nowIso,
      }))
      : [];
    const nextScheduleNodes: ContentNodeDTO[] = !created.isPrivate
      ? [
        ...curr.scheduleNodes,
        {
          id: `${created.id}-schedule-node`,
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
  },
  describeItem: (s) => `sub-event "${s.title}"`,
  mergeUpdated: (existing, body, now) => ({
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
    updatedAt: now.toISOString(),
  }),
  writeUpdated: (curr, updated) => ({
    ...curr,
    subEvents: curr.subEvents.map((s) => (s.id === updated.id ? updated : s)),
  }),
  removeByIds: (curr, ids) => {
    const remaining = curr.subEvents.filter((s) => !ids.has(s.id));
    return {
      next: {
        ...curr,
        subEvents: remaining,
        subEventAccess: curr.subEventAccess.filter((a) => !ids.has(a.subEventId)),
        subEventRsvps: curr.subEventRsvps.filter((r) => !ids.has(r.subEventId)),
      },
      deletedCount: curr.subEvents.length - remaining.length,
    };
  },
  reorder: (curr, orderedIds) => {
    const nextList = reorderListByIds(curr.subEvents, orderedIds, (se, idx) => ({
      ...se,
      displayOrder: idx,
      updatedAt: new Date().toISOString(),
    }));
    return { next: { ...curr, subEvents: nextList }, result: nextList };
  },
};

const contentNodesDescriptor: DemoEntityDescriptor<ContentNodeDTO> = {
  auditType: 'ContentNode',
  notFoundError: 'Content node not found',
  selectAll: (d) => getDemoContentNodes(d),
  filterList: (nodes, url, search) => {
    const typeParam = (url.searchParams.get('type') || '').trim().toLowerCase();
    const tagParam = (url.searchParams.get('tag') || '').trim().toLowerCase();
    let filtered = nodes;
    if (typeParam) {
      filtered = filtered.filter((n) => n.type.toLowerCase() === typeParam);
    }
    if (tagParam) {
      filtered = filtered.filter((n) => n.tags.some((t) => t.toLowerCase() === tagParam));
    }
    if (search) {
      filtered = filtered.filter((n) => JSON.stringify(n.data).toLowerCase().includes(search));
    }
    return filtered;
  },
  buildCreated: (body, _dataset, now) => {
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
    return {
      id: nextDemoId(`demo-${rawType.toLowerCase()}`),
      type: rawType,
      tags: rawTags,
      data: rawData,
      createdAt: now,
      updatedAt: now,
    } as ContentNodeDTO;
  },
  writeCreated: (curr, node) => writeBackContentNode(curr, node),
  describeItem: (n) => `${n.type} content node`,
  mergeUpdated: (existingNode, body, now) => {
    const incomingData =
      body.data && typeof body.data === 'object' && !Array.isArray(body.data)
        ? (body.data as Record<string, unknown>)
        : {};
    return {
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
  },
  writeUpdated: (curr, mergedNode) => writeBackContentNode(curr, mergedNode),
  removeByIds: (curr, ids) => ({
    next: removeContentNodesByIds(curr, ids),
    deletedCount: ids.size,
  }),
  reorder: (curr, orderedIds) => {
    const nextFaqs = reorderListByIds(curr.faqs, orderedIds, (node, idx) => ({
      ...node,
      data: {
        ...(node.data as Record<string, unknown>),
        displayOrder: idx,
      },
      updatedAt: new Date(),
    })) as ContentNodeDTO[];
    const nextDataset = { ...curr, faqs: nextFaqs };
    return { next: nextDataset, result: getDemoContentNodes(nextDataset) };
  },
};

const DEMO_ENTITY_DESCRIPTORS: Record<DemoEntitySlug, DemoEntityDescriptor<{ id: string }>> = {
  'content-nodes': contentNodesDescriptor as unknown as DemoEntityDescriptor<{ id: string }>,
  'wedding-party': weddingPartyDescriptor as unknown as DemoEntityDescriptor<{ id: string }>,
  attractions: attractionsDescriptor as unknown as DemoEntityDescriptor<{ id: string }>,
  'registry-items': registryItemsDescriptor as unknown as DemoEntityDescriptor<{ id: string }>,
  'invitation-codes': invitationCodesDescriptor as unknown as DemoEntityDescriptor<{ id: string }>,
  'seating-tables': seatingTablesDescriptor as unknown as DemoEntityDescriptor<{ id: string }>,
  'sub-events': subEventsDescriptor as unknown as DemoEntityDescriptor<{ id: string }>,
};

function isDemoEntitySlug(value: string): value is DemoEntitySlug {
  return value in DEMO_ENTITY_DESCRIPTORS;
}

export async function handleAdminEntityRoutes(ctx: DemoRouteContext): Promise<Response | null> {
  const { path, method, url, init, rawInput } = ctx;
  if (!path.startsWith('/api/admin/')) return null;

  const segments = path
    .slice('/api/admin/'.length)
    .split('/')
    .filter(Boolean);
  if (segments.length === 0 || !isDemoEntitySlug(segments[0])) return null;

  const entity = segments[0];

  // Delegate specialized domain workflow sub-routes to adminWorkflowRoutes
  if (
    entity === 'invitation-codes' &&
    segments[1] &&
    (['catalog', 'validate', 'import', 'merge', 'rsvps', 'export'].includes(segments[1]) ||
      (segments[1] === 'batch' && segments[2] === 'validate'))
  ) {
    return null;
  }
  if (entity === 'sub-events' && segments[1] && ['rsvp-summary', 'access'].includes(segments[1])) {
    return null;
  }

  const descriptor = DEMO_ENTITY_DESCRIPTORS[entity];

  if (segments.length === 1) {
    if (method === 'GET') {
      return dispatchEntityCollectionGet(descriptor, url);
    }
    if (method === 'POST') {
      const body = await parseJsonBody(init, rawInput);
      return dispatchEntityCreate(descriptor, body);
    }
    if (method === 'PUT' || method === 'PATCH') {
      const rawBody = await parseRawJsonValue(init, rawInput);
      const body = await parseJsonBody(init, rawInput);
      const orderedIds = getOrderedIdsFromPayload(body, rawBody);
      return dispatchEntityReorder(descriptor, orderedIds, body);
    }
  }

  if (segments.length === 2 && segments[1] === 'batch') {
    const rawBody = await parseRawJsonValue(init, rawInput);
    const body = await parseJsonBody(init, rawInput);
    return dispatchEntityBatch(entity, descriptor, method, body, rawBody);
  }

  if (segments.length === 2) {
    const id = decodeURIComponent(segments[1]);
    if (method === 'GET') {
      const found = descriptor.selectAll(getActiveArchetypeDataset()).find((item) => item.id === id);
      return found
        ? jsonResponse({ success: true, data: found })
        : jsonResponse({ error: descriptor.notFoundError }, 404);
    }
    if (method === 'PUT' || method === 'PATCH') {
      const body = await parseJsonBody(init, rawInput);
      return dispatchEntityUpdateById(descriptor, id, body);
    }
    if (method === 'DELETE') {
      return dispatchEntityDeleteById(descriptor, id);
    }
  }

  return null;
}

function dispatchEntityCollectionGet(
  descriptor: DemoEntityDescriptor<{ id: string }>,
  url: URL
): Response {
  const dataset = getActiveArchetypeDataset();
  const search = (url.searchParams.get('search') || url.searchParams.get('q') || '')
    .trim()
    .toLowerCase();
  const page = Math.max(1, Number(url.searchParams.get('page') || '1') || 1);
  const limitParam = Number(url.searchParams.get('limit') || '0');

  const baseItems = descriptor.selectAll(dataset);
  const filtered = descriptor.filterList ? descriptor.filterList(baseItems, url, search) : baseItems;
  const effectiveLimit = limitParam > 0 ? limitParam : Math.max(50, filtered.length);

  if (descriptor.paginatedEnvelope) {
    const start = limitParam > 0 ? (page - 1) * limitParam : 0;
    const paged = limitParam > 0 ? filtered.slice(start, start + limitParam) : filtered;
    const totalPages = Math.max(1, Math.ceil(filtered.length / effectiveLimit));
    return jsonResponse(
      {
        success: true,
        data: {
          items: paged,
          total: filtered.length,
          page,
          limit: effectiveLimit,
          totalPages,
        },
      },
      200,
      buildPaginationHeaders(filtered.length, page, effectiveLimit)
    );
  }

  return jsonResponse(
    { success: true, data: filtered },
    200,
    buildPaginationHeaders(filtered.length, page, effectiveLimit)
  );
}

function dispatchEntityCreate(
  descriptor: DemoEntityDescriptor<{ id: string }>,
  body: Record<string, unknown>
): Response {
  const now = new Date();
  const dataset = getActiveArchetypeDataset();
  const created = descriptor.buildCreated(body, dataset, now);
  mutateActiveDataset((curr) => descriptor.writeCreated(curr, created, now));
  descriptor.afterUpsert?.([created]);
  recordDemoAuditVersion({
    entityType: descriptor.auditType,
    entityId: created.id,
    action: 'CREATE',
    summary: `Created ${descriptor.describeItem(created)}`,
  });
  return jsonResponse({ success: true, data: created }, 201);
}

function dispatchEntityReorder(
  descriptor: DemoEntityDescriptor<{ id: string }>,
  orderedIds: string[],
  body: Record<string, unknown>
): Response {
  if (!descriptor.reorder) {
    return jsonResponse({ success: true, data: [] });
  }
  let reorderedResult: unknown[] = [];
  mutateActiveDataset((curr) => {
    const { next, result } = descriptor.reorder!(curr, orderedIds);
    reorderedResult = result;
    return next;
  });
  recordDemoAuditVersion({
    entityType: descriptor.auditType,
    entityId: 'reorder',
    action: 'REORDER',
    summary: `Reordered ${descriptor.auditType} collection`,
  });
  return jsonResponse({
    success: true,
    data: reorderedResult,
    ...(body.action ? { action: body.action } : {}),
  });
}

function dispatchEntityUpdateById(
  descriptor: DemoEntityDescriptor<{ id: string }>,
  id: string,
  body: Record<string, unknown>
): Response {
  const existing = descriptor.selectAll(getActiveArchetypeDataset()).find((item) => item.id === id);
  if (!existing) {
    return jsonResponse({ error: descriptor.notFoundError }, 404);
  }
  const updated = descriptor.mergeUpdated(existing, body, new Date());
  mutateActiveDataset((curr) => descriptor.writeUpdated(curr, updated));
  descriptor.afterUpsert?.([updated]);
  recordDemoAuditVersion({
    entityType: descriptor.auditType,
    entityId: id,
    action: 'UPDATE',
    summary: `Updated ${descriptor.describeItem(updated)}`,
  });
  return jsonResponse({ success: true, data: updated });
}

function dispatchEntityDeleteById(
  descriptor: DemoEntityDescriptor<{ id: string }>,
  id: string
): Response {
  const exists = descriptor.selectAll(getActiveArchetypeDataset()).some((item) => item.id === id);
  if (!exists) {
    return jsonResponse({ error: descriptor.notFoundError }, 404);
  }
  mutateActiveDataset((curr) => descriptor.removeByIds(curr, new Set([id])).next);
  recordDemoAuditVersion({
    entityType: descriptor.auditType,
    entityId: id,
    action: 'DELETE',
    summary: `Deleted ${descriptor.auditType} ${id}`,
  });
  return jsonResponse({ success: true, deletedId: id });
}

function dispatchEntityBatch(
  entity: DemoEntitySlug,
  descriptor: DemoEntityDescriptor<{ id: string }>,
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

  if (method === 'DELETE' || action === 'delete') {
    let deletedCount = 0;
    mutateActiveDataset((curr) => {
      const res = descriptor.removeByIds(curr, idSet);
      deletedCount = res.deletedCount;
      return res.next;
    });
    return jsonResponse({
      success: true,
      count: deletedCount,
      deletedCount,
      data: { count: deletedCount, deletedCount },
    });
  }

  // Invitation-code tag & batch record import support
  if (entity === 'invitation-codes' && !Array.isArray(body.items) && !Array.isArray(body.records)) {
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

  const batchItems = Array.isArray(body.items)
    ? (body.items as Array<Record<string, unknown>>)
    : Array.isArray(body.records)
      ? (body.records as Array<Record<string, unknown>>)
      : Array.isArray(rawBody)
        ? rawBody.filter((x): x is Record<string, unknown> => Boolean(x && typeof x === 'object'))
        : [];

  if (batchItems.length > 0 && method === 'POST') {
    const now = new Date();
    const createdRecords: Array<{ id: string }> = [];
    for (const item of batchItems) {
      const created = descriptor.buildCreated(item, getActiveArchetypeDataset(), now);
      mutateActiveDataset((curr) => descriptor.writeCreated(curr, created, now));
      createdRecords.push(created);
    }
    descriptor.afterUpsert?.(createdRecords);
    return jsonResponse({
      success: true,
      count: createdRecords.length,
      createdCount: createdRecords.length,
      records: createdRecords,
      data: {
        count: createdRecords.length,
        createdCount: createdRecords.length,
        items: createdRecords,
        records: createdRecords,
      },
    });
  }

  const updates =
    body.updates && typeof body.updates === 'object'
      ? (body.updates as Record<string, unknown>)
      : body.data && typeof body.data === 'object'
        ? (body.data as Record<string, unknown>)
        : body;

  let updatedCount = 0;
  for (const id of idSet) {
    const res = dispatchEntityUpdateById(descriptor, id, updates);
    if (res.status === 200) updatedCount += 1;
  }

  return jsonResponse({
    success: true,
    count: updatedCount,
    updatedCount,
    data: { count: updatedCount, updatedCount },
  });
}
