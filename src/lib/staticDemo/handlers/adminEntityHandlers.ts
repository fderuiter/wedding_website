import type {
  DemoAttractionRecord,
  DemoContentNodeRecord,
  DemoInvitationCodeRecord,
  DemoRegistryItemRecord,
  DemoSeatingTableRecord,
  DemoSubEventRecord,
  DemoWeddingPartyMemberRecord,
  NormalizedDemoRequest,
  StaticDemoSnapshot,
  StaticDemoStore,
} from '../types';
import {
  errorJson,
  generateDemoId,
  readJsonBody,
  wrapMiddlewareJson,
} from '../responseHelpers';
import {
  pushAuditVersion,
  toAttractionDto,
  toInvitationCodeDto,
  toRegistryItemDto,
  toSeatingTableDto,
  toWeddingPartyDto,
} from '../dtoMappers';
import { createDemoSvgDataUrl } from '../svgAssets';

type AdminEntitySlug =
  | 'content-nodes'
  | 'wedding-party'
  | 'attractions'
  | 'registry-items'
  | 'invitation-codes'
  | 'seating-tables'
  | 'sub-events';

const VALID_ENTITY_SLUGS = new Set<AdminEntitySlug>([
  'content-nodes',
  'wedding-party',
  'attractions',
  'registry-items',
  'invitation-codes',
  'seating-tables',
  'sub-events',
]);

function isEntitySlug(value: string): value is AdminEntitySlug {
  return VALID_ENTITY_SLUGS.has(value as AdminEntitySlug);
}

function getAuditEntityType(slug: AdminEntitySlug): string {
  switch (slug) {
    case 'content-nodes':
      return 'ContentNode';
    case 'wedding-party':
      return 'WeddingPartyMember';
    case 'attractions':
      return 'Attraction';
    case 'registry-items':
      return 'RegistryItem';
    case 'invitation-codes':
      return 'InvitationCode';
    case 'seating-tables':
      return 'SeatingTable';
    case 'sub-events':
      return 'SubEvent';
  }
}

function listEntityDtos(
  snapshot: StaticDemoSnapshot,
  slug: AdminEntitySlug,
  searchParams: URLSearchParams,
): Array<Record<string, unknown>> {
  switch (slug) {
    case 'content-nodes': {
      const typeFilter = searchParams.get('type')?.trim().toLowerCase();
      return snapshot.contentNode
        .filter((node) => {
          if (typeFilter) {
            return node.type.toLowerCase() === typeFilter;
          }
          return true;
        })
        .map((n) => ({ ...n }));
    }
    case 'wedding-party':
      return [...snapshot.weddingPartyMember]
        .sort((a, b) => a.order - b.order)
        .map((m) => toWeddingPartyDto(snapshot, m));
    case 'attractions':
      return snapshot.attraction.map((a) => toAttractionDto(snapshot, a));
    case 'registry-items':
      return [...snapshot.registryItem]
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((r) => toRegistryItemDto(snapshot, r));
    case 'invitation-codes':
      return snapshot.invitationCode.map((i) => toInvitationCodeDto(snapshot, i));
    case 'seating-tables':
      return snapshot.seatingTable.map((t) => toSeatingTableDto(snapshot, t));
    case 'sub-events':
      return [...snapshot.subEvent]
        .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''))
        .map((e) => ({ ...e }));
  }
}

function ensureMediaFromBody(
  draft: StaticDemoSnapshot,
  body: Record<string, unknown>,
  label: string,
  subtitle: string,
): string {
  const existingId =
    typeof body.imageId === 'string' && body.imageId.trim()
      ? body.imageId.trim()
      : typeof body.photoId === 'string' && body.photoId.trim()
        ? body.photoId.trim()
        : typeof body.mediaId === 'string' && body.mediaId.trim()
          ? body.mediaId.trim()
          : '';
  if (existingId && draft.media.some((m) => m.id === existingId)) {
    return existingId;
  }
  const nowIso = new Date().toISOString();
  const newId = existingId || generateDemoId('media');
  const rawUrl =
    typeof body.imageUrl === 'string' && body.imageUrl.trim()
      ? body.imageUrl.trim()
      : typeof body.photoUrl === 'string' && body.photoUrl.trim()
        ? body.photoUrl.trim()
        : createDemoSvgDataUrl(label, subtitle, draft.activeArchetype);
  draft.media.unshift({
    id: newId,
    url: rawUrl,
    altText: label,
    isDecorative: false,
    isSample: false,
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  return newId;
}

function createEntityRecord(
  draft: StaticDemoSnapshot,
  slug: AdminEntitySlug,
  body: Record<string, unknown>,
): Record<string, unknown> {
  const nowIso = new Date().toISOString();
  switch (slug) {
    case 'content-nodes': {
      const record: DemoContentNodeRecord = {
        id:
          typeof body.id === 'string' && body.id.trim()
            ? body.id.trim()
            : generateDemoId('node'),
        type: typeof body.type === 'string' && body.type.trim() ? body.type.trim() : 'FAQ',
        tags: Array.isArray(body.tags)
          ? body.tags.filter((t): t is string => typeof t === 'string')
          : [],
        data:
          body.data && typeof body.data === 'object' && !Array.isArray(body.data)
            ? (body.data as Record<string, unknown>)
            : {},
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      draft.contentNode.unshift(record);
      pushAuditVersion(draft, 'ContentNode', record.id, record);
      return { ...record };
    }
    case 'wedding-party': {
      const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Wedding Party Member';
      const role = typeof body.role === 'string' && body.role.trim() ? body.role.trim() : 'Attendant';
      const photoId = ensureMediaFromBody(draft, body, name, role);
      const sideRaw = typeof body.side === 'string' ? body.side.toUpperCase() : 'JOINT';
      const side: 'BRIDE' | 'GROOM' | 'JOINT' =
        sideRaw === 'BRIDE' || sideRaw === 'GROOM' ? sideRaw : 'JOINT';
      const record: DemoWeddingPartyMemberRecord = {
        id: generateDemoId('party'),
        name,
        role,
        bio: typeof body.bio === 'string' ? body.bio : '',
        photoId,
        side,
        link: typeof body.link === 'string' && body.link.trim() ? body.link.trim() : null,
        order:
          typeof body.order === 'number'
            ? body.order
            : draft.weddingPartyMember.length + 1,
        isSample: false,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      draft.weddingPartyMember.push(record);
      pushAuditVersion(draft, 'WeddingPartyMember', record.id, record);
      return toWeddingPartyDto(draft, record);
    }
    case 'attractions': {
      const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Local Recommendation';
      const category = typeof body.category === 'string' && body.category.trim() ? body.category.trim() : 'Dining';
      const imageId = ensureMediaFromBody(draft, body, name, category);
      const record: DemoAttractionRecord = {
        id: generateDemoId('attr'),
        name,
        description: typeof body.description === 'string' ? body.description : '',
        category,
        website: typeof body.website === 'string' ? body.website : '',
        directions: typeof body.directions === 'string' ? body.directions : '',
        latitude: Number(body.latitude ?? 44.9778) || 44.9778,
        longitude: Number(body.longitude ?? -93.265) || -93.265,
        imageId,
        isVisible: body.isVisible !== false,
        isSample: false,
        promoCode: typeof body.promoCode === 'string' ? body.promoCode : null,
        bookingUrl: typeof body.bookingUrl === 'string' ? body.bookingUrl : null,
        roomRate: typeof body.roomRate === 'string' ? body.roomRate : null,
        cutoffDate: typeof body.cutoffDate === 'string' ? body.cutoffDate : null,
        shuttleInfo: typeof body.shuttleInfo === 'string' ? body.shuttleInfo : null,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      draft.attraction.push(record);
      pushAuditVersion(draft, 'Attraction', record.id, record);
      return toAttractionDto(draft, record);
    }
    case 'registry-items': {
      const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Registry Gift';
      const category = typeof body.category === 'string' && body.category.trim() ? body.category.trim() : 'Home';
      const imageId = ensureMediaFromBody(draft, body, name, category);
      const itemType: 'PHYSICAL' | 'CASH_FUND' | 'EXPERIENCE_FUND' =
        body.itemType === 'CASH_FUND' || body.itemType === 'EXPERIENCE_FUND'
          ? body.itemType
          : 'PHYSICAL';
      const record: DemoRegistryItemRecord = {
        id: generateDemoId('reg'),
        name,
        description: typeof body.description === 'string' ? body.description : '',
        category,
        price: Math.max(0, Number(body.price ?? 50) || 50),
        imageId,
        quantity: Math.max(1, Number(body.quantity ?? 1) || 1),
        itemType,
        paymentHandleType:
          typeof body.paymentHandleType === 'string' ? body.paymentHandleType : null,
        paymentHandle:
          typeof body.paymentHandle === 'string' ? body.paymentHandle : null,
        vendorUrl: typeof body.vendorUrl === 'string' ? body.vendorUrl : null,
        isGroupGift: Boolean(body.isGroupGift),
        isMostWanted: Boolean(body.isMostWanted),
        displayOrder: draft.registryItem.length + 1,
        purchased: Boolean(body.purchased),
        isSample: false,
        purchaserName: null,
        amountContributed: 0,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      draft.registryItem.push(record);
      pushAuditVersion(draft, 'RegistryItem', record.id, record);
      return toRegistryItemDto(draft, record);
    }
    case 'invitation-codes': {
      const guestName =
        typeof body.guestName === 'string' && body.guestName.trim()
          ? body.guestName.trim()
          : 'Invited Guest';
      const code =
        typeof body.code === 'string' && body.code.trim()
          ? body.code.trim().toUpperCase()
          : `INV${Date.now().toString(36).slice(-5).toUpperCase()}`;
      const record: DemoInvitationCodeRecord = {
        id: generateDemoId('inv'),
        code,
        guestName,
        email: typeof body.email === 'string' && body.email.trim() ? body.email.trim() : null,
        addressLine1: typeof body.addressLine1 === 'string' ? body.addressLine1 : null,
        addressLine2: typeof body.addressLine2 === 'string' ? body.addressLine2 : null,
        city: typeof body.city === 'string' ? body.city : null,
        state: typeof body.state === 'string' ? body.state : null,
        zipCode: typeof body.zipCode === 'string' ? body.zipCode : null,
        country: typeof body.country === 'string' ? body.country : 'United States',
        dietaryNotes: typeof body.dietaryNotes === 'string' ? body.dietaryNotes : null,
        plusOneAllocations: Math.max(0, Number(body.plusOneAllocations ?? 0) || 0),
        plusOneFirstName: typeof body.plusOneFirstName === 'string' ? body.plusOneFirstName : null,
        plusOneLastName: typeof body.plusOneLastName === 'string' ? body.plusOneLastName : null,
        householdName: typeof body.householdName === 'string' ? body.householdName : guestName,
        partyGroup: typeof body.partyGroup === 'string' ? body.partyGroup : null,
        partyTags: Array.isArray(body.partyTags)
          ? body.partyTags.filter((t): t is string => typeof t === 'string')
          : [],
        extraFields: null,
        used: Boolean(body.used),
        usedAt: body.used ? nowIso : null,
        tableId: typeof body.tableId === 'string' && body.tableId ? body.tableId : null,
        seatNumber: typeof body.seatNumber === 'number' ? body.seatNumber : null,
        isSample: false,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      draft.invitationCode.unshift(record);
      pushAuditVersion(draft, 'InvitationCode', record.id, record);
      return toInvitationCodeDto(draft, record);
    }
    case 'seating-tables': {
      const shapeRaw = typeof body.shape === 'string' ? body.shape : 'round';
      const shape: DemoSeatingTableRecord['shape'] =
        shapeRaw === 'rectangular' ||
        shapeRaw === 'square' ||
        shapeRaw === 'head' ||
        shapeRaw === 'sweetheart'
          ? shapeRaw
          : 'round';
      const record: DemoSeatingTableRecord = {
        id: generateDemoId('table'),
        name:
          typeof body.name === 'string' && body.name.trim()
            ? body.name.trim()
            : `Table ${draft.seatingTable.length + 1}`,
        shape,
        capacity: Math.max(1, Number(body.capacity ?? 8) || 8),
        x: Number(body.x ?? 180) || 180,
        y: Number(body.y ?? 180) || 180,
        width: Number(body.width ?? 120) || 120,
        height: Number(body.height ?? 120) || 120,
        rotation: Number(body.rotation ?? 0) || 0,
        isSample: false,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      draft.seatingTable.push(record);
      pushAuditVersion(draft, 'SeatingTable', record.id, record);
      return toSeatingTableDto(draft, record);
    }
    case 'sub-events': {
      const record: DemoSubEventRecord = {
        id: generateDemoId('sub'),
        title:
          typeof body.title === 'string' && body.title.trim()
            ? body.title.trim()
            : 'Wedding Event',
        description: typeof body.description === 'string' ? body.description : '',
        startTime:
          typeof body.startTime === 'string' && body.startTime
            ? body.startTime
            : '2026-09-19T18:00:00.000Z',
        endTime:
          typeof body.endTime === 'string' && body.endTime
            ? body.endTime
            : '2026-09-19T21:00:00.000Z',
        locationName: typeof body.locationName === 'string' ? body.locationName : '',
        location: typeof body.location === 'string' ? body.location : '',
        attireRules: typeof body.attireRules === 'string' ? body.attireRules : undefined,
        category: typeof body.category === 'string' ? body.category : 'Celebration',
        isPrivate: Boolean(body.isPrivate),
        mealOptions: Array.isArray(body.mealOptions)
          ? (body.mealOptions as DemoSubEventRecord['mealOptions'])
          : [],
        customQuestions: Array.isArray(body.customQuestions)
          ? (body.customQuestions as DemoSubEventRecord['customQuestions'])
          : [],
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      draft.subEvent.push(record);
      pushAuditVersion(draft, 'SubEvent', record.id, record);
      return { ...record };
    }
  }
}

function updateEntityRecordById(
  draft: StaticDemoSnapshot,
  slug: AdminEntitySlug,
  id: string,
  patch: Record<string, unknown>,
): Record<string, unknown> | null {
  const nowIso = new Date().toISOString();
  switch (slug) {
    case 'content-nodes': {
      const node = draft.contentNode.find((n) => n.id === id);
      if (!node) return null;
      if (typeof patch.type === 'string' && patch.type.trim()) node.type = patch.type.trim();
      if (Array.isArray(patch.tags)) {
        node.tags = patch.tags.filter((t): t is string => typeof t === 'string');
      }
      if (patch.data && typeof patch.data === 'object' && !Array.isArray(patch.data)) {
        node.data = { ...node.data, ...(patch.data as Record<string, unknown>) };
      }
      node.updatedAt = nowIso;
      pushAuditVersion(draft, 'ContentNode', node.id, node);
      return { ...node };
    }
    case 'wedding-party': {
      const member = draft.weddingPartyMember.find((m) => m.id === id);
      if (!member) return null;
      if (typeof patch.name === 'string' && patch.name.trim()) member.name = patch.name.trim();
      if (typeof patch.role === 'string') member.role = patch.role;
      if (typeof patch.bio === 'string') member.bio = patch.bio;
      if (typeof patch.side === 'string') {
        const up = patch.side.toUpperCase();
        if (up === 'BRIDE' || up === 'GROOM' || up === 'JOINT') member.side = up;
      }
      if (patch.link !== undefined) {
        member.link = typeof patch.link === 'string' && patch.link ? patch.link : null;
      }
      if (typeof patch.order === 'number') member.order = patch.order;
      if (typeof patch.photoId === 'string' && patch.photoId) {
        member.photoId = patch.photoId;
      } else if (typeof patch.imageUrl === 'string' && patch.imageUrl.trim()) {
        member.photoId = ensureMediaFromBody(draft, patch, member.name, member.role);
      }
      member.updatedAt = nowIso;
      pushAuditVersion(draft, 'WeddingPartyMember', member.id, member);
      return toWeddingPartyDto(draft, member);
    }
    case 'attractions': {
      const attr = draft.attraction.find((a) => a.id === id);
      if (!attr) return null;
      if (typeof patch.name === 'string' && patch.name.trim()) attr.name = patch.name.trim();
      if (typeof patch.description === 'string') attr.description = patch.description;
      if (typeof patch.category === 'string') attr.category = patch.category;
      if (typeof patch.website === 'string') attr.website = patch.website;
      if (typeof patch.directions === 'string') attr.directions = patch.directions;
      if (patch.latitude !== undefined) attr.latitude = Number(patch.latitude) || attr.latitude;
      if (patch.longitude !== undefined) attr.longitude = Number(patch.longitude) || attr.longitude;
      if (typeof patch.isVisible === 'boolean') attr.isVisible = patch.isVisible;
      if (patch.promoCode !== undefined) attr.promoCode = typeof patch.promoCode === 'string' ? patch.promoCode : null;
      if (patch.bookingUrl !== undefined) attr.bookingUrl = typeof patch.bookingUrl === 'string' ? patch.bookingUrl : null;
      if (patch.roomRate !== undefined) attr.roomRate = typeof patch.roomRate === 'string' ? patch.roomRate : null;
      if (patch.cutoffDate !== undefined) attr.cutoffDate = typeof patch.cutoffDate === 'string' ? patch.cutoffDate : null;
      if (patch.shuttleInfo !== undefined) attr.shuttleInfo = typeof patch.shuttleInfo === 'string' ? patch.shuttleInfo : null;
      if (typeof patch.imageId === 'string' && patch.imageId) {
        attr.imageId = patch.imageId;
      } else if (typeof patch.imageUrl === 'string' && patch.imageUrl.trim()) {
        attr.imageId = ensureMediaFromBody(draft, patch, attr.name, attr.category);
      }
      attr.updatedAt = nowIso;
      pushAuditVersion(draft, 'Attraction', attr.id, attr);
      return toAttractionDto(draft, attr);
    }
    case 'registry-items': {
      const item = draft.registryItem.find((r) => r.id === id);
      if (!item) return null;
      if (typeof patch.name === 'string' && patch.name.trim()) item.name = patch.name.trim();
      if (typeof patch.description === 'string') item.description = patch.description;
      if (typeof patch.category === 'string' && patch.category.trim()) item.category = patch.category.trim();
      if (patch.price !== undefined) item.price = Math.max(0, Number(patch.price) || 0);
      if (patch.quantity !== undefined) item.quantity = Math.max(1, Number(patch.quantity) || 1);
      if (typeof patch.purchased === 'boolean') item.purchased = patch.purchased;
      if (typeof patch.isGroupGift === 'boolean') item.isGroupGift = patch.isGroupGift;
      if (typeof patch.isMostWanted === 'boolean') item.isMostWanted = patch.isMostWanted;
      if (patch.vendorUrl !== undefined) item.vendorUrl = typeof patch.vendorUrl === 'string' ? patch.vendorUrl : null;
      if (patch.paymentHandle !== undefined) item.paymentHandle = typeof patch.paymentHandle === 'string' ? patch.paymentHandle : null;
      if (patch.paymentHandleType !== undefined) item.paymentHandleType = typeof patch.paymentHandleType === 'string' ? patch.paymentHandleType : null;
      if (patch.itemType === 'PHYSICAL' || patch.itemType === 'CASH_FUND' || patch.itemType === 'EXPERIENCE_FUND') {
        item.itemType = patch.itemType;
      }
      if (typeof patch.imageId === 'string' && patch.imageId) {
        item.imageId = patch.imageId;
      } else if (typeof patch.imageUrl === 'string' && patch.imageUrl.trim()) {
        item.imageId = ensureMediaFromBody(draft, patch, item.name, item.category);
      }
      item.updatedAt = nowIso;
      pushAuditVersion(draft, 'RegistryItem', item.id, item);
      return toRegistryItemDto(draft, item);
    }
    case 'invitation-codes': {
      const inv = draft.invitationCode.find((i) => i.id === id);
      if (!inv) return null;
      if (typeof patch.guestName === 'string' && patch.guestName.trim()) inv.guestName = patch.guestName.trim();
      if (typeof patch.code === 'string' && patch.code.trim()) inv.code = patch.code.trim().toUpperCase();
      if (patch.email !== undefined) inv.email = typeof patch.email === 'string' && patch.email ? patch.email : null;
      if (patch.householdName !== undefined) inv.householdName = typeof patch.householdName === 'string' ? patch.householdName : null;
      if (patch.partyGroup !== undefined) inv.partyGroup = typeof patch.partyGroup === 'string' ? patch.partyGroup : null;
      if (Array.isArray(patch.partyTags)) {
        inv.partyTags = patch.partyTags.filter((t): t is string => typeof t === 'string');
      }
      if (patch.plusOneAllocations !== undefined) inv.plusOneAllocations = Math.max(0, Number(patch.plusOneAllocations) || 0);
      if (patch.dietaryNotes !== undefined) inv.dietaryNotes = typeof patch.dietaryNotes === 'string' ? patch.dietaryNotes : null;
      if (patch.addressLine1 !== undefined) inv.addressLine1 = typeof patch.addressLine1 === 'string' ? patch.addressLine1 : null;
      if (patch.addressLine2 !== undefined) inv.addressLine2 = typeof patch.addressLine2 === 'string' ? patch.addressLine2 : null;
      if (patch.city !== undefined) inv.city = typeof patch.city === 'string' ? patch.city : null;
      if (patch.state !== undefined) inv.state = typeof patch.state === 'string' ? patch.state : null;
      if (patch.zipCode !== undefined) inv.zipCode = typeof patch.zipCode === 'string' ? patch.zipCode : null;
      if (patch.country !== undefined) inv.country = typeof patch.country === 'string' ? patch.country : null;
      if (typeof patch.used === 'boolean') inv.used = patch.used;
      if (patch.tableId !== undefined) inv.tableId = typeof patch.tableId === 'string' ? patch.tableId : null;
      if (patch.seatNumber !== undefined) inv.seatNumber = typeof patch.seatNumber === 'number' ? patch.seatNumber : null;
      inv.updatedAt = nowIso;
      pushAuditVersion(draft, 'InvitationCode', inv.id, inv);
      return toInvitationCodeDto(draft, inv);
    }
    case 'seating-tables': {
      const tbl = draft.seatingTable.find((t) => t.id === id);
      if (!tbl) return null;
      if (typeof patch.name === 'string' && patch.name.trim()) tbl.name = patch.name.trim();
      if (
        patch.shape === 'round' ||
        patch.shape === 'rectangular' ||
        patch.shape === 'square' ||
        patch.shape === 'head' ||
        patch.shape === 'sweetheart'
      ) {
        tbl.shape = patch.shape;
      }
      if (patch.capacity !== undefined) tbl.capacity = Math.max(1, Number(patch.capacity) || tbl.capacity);
      if (patch.x !== undefined) tbl.x = Number(patch.x);
      if (patch.y !== undefined) tbl.y = Number(patch.y);
      if (patch.width !== undefined) tbl.width = Number(patch.width) || tbl.width;
      if (patch.height !== undefined) tbl.height = Number(patch.height) || tbl.height;
      if (patch.rotation !== undefined) tbl.rotation = Number(patch.rotation) || 0;
      tbl.updatedAt = nowIso;
      pushAuditVersion(draft, 'SeatingTable', tbl.id, tbl);
      return toSeatingTableDto(draft, tbl);
    }
    case 'sub-events': {
      const ev = draft.subEvent.find((e) => e.id === id);
      if (!ev) return null;
      if (typeof patch.title === 'string' && patch.title.trim()) ev.title = patch.title.trim();
      if (typeof patch.description === 'string') ev.description = patch.description;
      if (patch.startTime !== undefined) ev.startTime = typeof patch.startTime === 'string' ? patch.startTime : null;
      if (patch.endTime !== undefined) ev.endTime = typeof patch.endTime === 'string' ? patch.endTime : null;
      if (typeof patch.locationName === 'string') ev.locationName = patch.locationName;
      if (typeof patch.location === 'string') ev.location = patch.location;
      if (typeof patch.attireRules === 'string') ev.attireRules = patch.attireRules;
      if (typeof patch.category === 'string') ev.category = patch.category;
      if (typeof patch.isPrivate === 'boolean') ev.isPrivate = patch.isPrivate;
      if (Array.isArray(patch.mealOptions)) {
        ev.mealOptions = patch.mealOptions as DemoSubEventRecord['mealOptions'];
      }
      if (Array.isArray(patch.customQuestions)) {
        ev.customQuestions = patch.customQuestions as DemoSubEventRecord['customQuestions'];
      }
      ev.updatedAt = nowIso;
      pushAuditVersion(draft, 'SubEvent', ev.id, ev);
      return { ...ev };
    }
  }
}

function deleteEntityRecordById(
  draft: StaticDemoSnapshot,
  slug: AdminEntitySlug,
  id: string,
): boolean {
  const entityType = getAuditEntityType(slug);
  switch (slug) {
    case 'content-nodes': {
      const idx = draft.contentNode.findIndex((n) => n.id === id);
      if (idx < 0) return false;
      const [removed] = draft.contentNode.splice(idx, 1);
      pushAuditVersion(draft, entityType, id, { deleted: true, previous: removed });
      return true;
    }
    case 'wedding-party': {
      const idx = draft.weddingPartyMember.findIndex((m) => m.id === id);
      if (idx < 0) return false;
      const [removed] = draft.weddingPartyMember.splice(idx, 1);
      pushAuditVersion(draft, entityType, id, { deleted: true, previous: removed });
      return true;
    }
    case 'attractions': {
      const idx = draft.attraction.findIndex((a) => a.id === id);
      if (idx < 0) return false;
      const [removed] = draft.attraction.splice(idx, 1);
      pushAuditVersion(draft, entityType, id, { deleted: true, previous: removed });
      return true;
    }
    case 'registry-items': {
      const idx = draft.registryItem.findIndex((r) => r.id === id);
      if (idx < 0) return false;
      const [removed] = draft.registryItem.splice(idx, 1);
      draft.contributor = draft.contributor.filter((c) => c.registryItemId !== id);
      pushAuditVersion(draft, entityType, id, { deleted: true, previous: removed });
      return true;
    }
    case 'invitation-codes': {
      const idx = draft.invitationCode.findIndex((i) => i.id === id);
      if (idx < 0) return false;
      const [removed] = draft.invitationCode.splice(idx, 1);
      draft.subEventAccess = draft.subEventAccess.filter((a) => a.invitationCodeId !== id);
      draft.subEventRsvp = draft.subEventRsvp.filter((r) => r.invitationCodeId !== id);
      pushAuditVersion(draft, entityType, id, { deleted: true, previous: removed });
      return true;
    }
    case 'seating-tables': {
      const idx = draft.seatingTable.findIndex((t) => t.id === id);
      if (idx < 0) return false;
      const [removed] = draft.seatingTable.splice(idx, 1);
      for (const inv of draft.invitationCode) {
        if (inv.tableId === id) {
          inv.tableId = null;
          inv.seatNumber = null;
        }
      }
      pushAuditVersion(draft, entityType, id, { deleted: true, previous: removed });
      return true;
    }
    case 'sub-events': {
      const idx = draft.subEvent.findIndex((e) => e.id === id);
      if (idx < 0) return false;
      const [removed] = draft.subEvent.splice(idx, 1);
      draft.subEventAccess = draft.subEventAccess.filter((a) => a.subEventId !== id);
      draft.subEventRsvp = draft.subEventRsvp.filter((r) => r.subEventId !== id);
      pushAuditVersion(draft, entityType, id, { deleted: true, previous: removed });
      return true;
    }
  }
}

export async function handleAdminEntityRoutes(
  req: NormalizedDemoRequest,
  store: StaticDemoStore,
): Promise<Response | null> {
  const { method, pathname, searchParams, request } = req;

  const batchMatch = pathname.match(/^\/api\/admin\/([^/]+)\/batch$/);
  if (batchMatch && isEntitySlug(batchMatch[1])) {
    const slug = batchMatch[1];
    const body = await readJsonBody(request);

    if (method === 'DELETE') {
      const ids = Array.isArray(body.ids)
        ? body.ids.filter((id): id is string => typeof id === 'string')
        : [];
      if (ids.length === 0) {
        return errorJson(400, 'At least one record identifier is required');
      }
      const deletedCount = store.mutate((draft) => {
        let count = 0;
        for (const id of ids) {
          if (deleteEntityRecordById(draft, slug, id)) {
            count += 1;
          }
        }
        return count;
      });
      return wrapMiddlewareJson({
        success: true,
        count: deletedCount,
        deletedCount,
      });
    }

    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      const ids = Array.isArray(body.ids)
        ? body.ids.filter((id): id is string => typeof id === 'string')
        : [];
      const rawPatch =
        body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
          ? (body.payload as Record<string, unknown>)
          : body;
      const updated = store.mutate((draft) => {
        const list: Array<Record<string, unknown>> = [];
        for (const id of ids) {
          const rec = updateEntityRecordById(draft, slug, id, rawPatch);
          if (rec) list.push(rec);
        }
        return list;
      });
      return wrapMiddlewareJson({
        success: true,
        count: updated.length,
        updatedCount: updated.length,
        records: updated,
      });
    }
  }

  const baseMatch = pathname.match(/^\/api\/admin\/([^/]+)$/);
  if (baseMatch && isEntitySlug(baseMatch[1])) {
    const slug = baseMatch[1];

    if (method === 'GET') {
      const snapshot = store.getSnapshot();
      const allRecords = listEntityDtos(snapshot, slug, searchParams);
      const limit = Math.min(
        100,
        Math.max(1, parseInt(searchParams.get('limit') || '50', 10) || 50),
      );
      const page = Math.max(
        1,
        parseInt(searchParams.get('page') || '1', 10) || 1,
      );
      const skip = searchParams.has('skip')
        ? Math.max(0, parseInt(searchParams.get('skip') || '0', 10) || 0)
        : (page - 1) * limit;

      const total = allRecords.length;
      const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
      const paged = allRecords.slice(skip, skip + limit);

      const headers: Record<string, string> = {
        'X-Total-Count': String(total),
        'X-Page': String(page),
        'X-Limit': String(limit),
        'X-Total-Pages': String(totalPages),
        'X-Per-Page': String(limit),
        'X-Current-Page': String(page),
        'X-Has-Next-Page': String(page < totalPages),
        'X-Has-Prev-Page': String(page > 1),
        'Access-Control-Expose-Headers':
          'X-Total-Count, X-Page, X-Limit, X-Total-Pages, X-Per-Page, X-Current-Page, X-Has-Next-Page, X-Has-Prev-Page, X-Next-Cursor',
      };
      const lastItem = paged[paged.length - 1];
      if (lastItem && typeof lastItem.id === 'string' && page < totalPages) {
        headers['X-Next-Cursor'] = lastItem.id;
      }

      return wrapMiddlewareJson(paged, { headers });
    }

    if (method === 'POST') {
      const body = await readJsonBody(request);
      const created = store.mutate((draft) => createEntityRecord(draft, slug, body));
      return wrapMiddlewareJson(created, { status: 201 });
    }

    if (method === 'PUT') {
      const body = await readJsonBody(request);
      if (body.action === 'reorder' && Array.isArray(body.orderedIds)) {
        const orderedIds = body.orderedIds.filter(
          (id): id is string => typeof id === 'string',
        );
        store.mutate((draft) => {
          orderedIds.forEach((id, index) => {
            if (slug === 'wedding-party') {
              const member = draft.weddingPartyMember.find((m) => m.id === id);
              if (member) member.order = index + 1;
            } else if (slug === 'registry-items') {
              const item = draft.registryItem.find((r) => r.id === id);
              if (item) item.displayOrder = index + 1;
            } else if (slug === 'content-nodes') {
              const node = draft.contentNode.find((n) => n.id === id);
              if (node) node.data = { ...node.data, order: index + 1 };
            }
          });
        });
        return wrapMiddlewareJson({ success: true });
      }
      return errorJson(400, 'Invalid reorder payload');
    }
  }

  const idMatch = pathname.match(/^\/api\/admin\/([^/]+)\/([^/]+)$/);
  if (idMatch && isEntitySlug(idMatch[1])) {
    const slug = idMatch[1];
    const id = decodeURIComponent(idMatch[2]);

    if (method === 'GET') {
      const snapshot = store.getSnapshot();
      const allRecords = listEntityDtos(snapshot, slug, searchParams);
      const found = allRecords.find((r) => r.id === id);
      if (!found) {
        return errorJson(404, 'Record not found');
      }
      return wrapMiddlewareJson(found);
    }

    if (method === 'PUT' || method === 'PATCH') {
      const body = await readJsonBody(request);
      const updated = store.mutate((draft) =>
        updateEntityRecordById(draft, slug, id, body),
      );
      if (!updated) {
        return errorJson(404, 'Record not found');
      }
      return wrapMiddlewareJson(updated);
    }

    if (method === 'DELETE') {
      const deleted = store.mutate((draft) =>
        deleteEntityRecordById(draft, slug, id),
      );
      if (!deleted) {
        return errorJson(404, 'Record not found');
      }
      return wrapMiddlewareJson({ id, deleted: true });
    }
  }

  return null;
}
