import type {
  DemoAppConfigRecord,
  DemoAttractionRecord,
  DemoContentNodeRecord,
  DemoContributorRecord,
  DemoInvitationCodeRecord,
  DemoMediaRecord,
  DemoRegistryItemRecord,
  DemoSeatingTableRecord,
  DemoWeddingPartyMemberRecord,
  StaticDemoSnapshot,
} from './types';
import { buildArchetypeSeedSnapshot } from './seeds';
import { createDemoSvgDataUrl } from './svgAssets';
import { generateDemoId } from './responseHelpers';

const MAX_AUDIT_SNAPSHOTS = 40;

export function getActiveAppConfig(
  snapshot: StaticDemoSnapshot,
): DemoAppConfigRecord {
  const found =
    snapshot.appConfig.find((cfg) => cfg.id === 'global') ??
    snapshot.appConfig[0];
  if (found) {
    return found;
  }
  const fallback = buildArchetypeSeedSnapshot(snapshot.activeArchetype).appConfig[0];
  snapshot.appConfig.push(fallback);
  return fallback;
}

export function toAdminConfigDto(
  config: DemoAppConfigRecord,
): Record<string, unknown> {
  return {
    ...config,
    hasResendApiKey: Boolean(config.resendFrom && config.resendFrom.trim().length > 0),
    hasSendgridApiKey: Boolean(config.sendgridFrom && config.sendgridFrom.trim().length > 0),
    hasSmtpPass: Boolean(config.smtpUser && config.smtpUser.trim().length > 0),
    hasTwilioAuthToken: Boolean(
      config.twilioAccountSid && config.twilioAccountSid.trim().length > 0,
    ),
  };
}

export function toPublicConfigDto(
  config: DemoAppConfigRecord,
): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...config };
  delete clone.smtpHost;
  delete clone.smtpPort;
  delete clone.smtpUser;
  delete clone.twilioAccountSid;
  return clone;
}

function findMediaRecord(
  snapshot: StaticDemoSnapshot,
  mediaId: string | null | undefined,
): DemoMediaRecord | null {
  if (!mediaId) return null;
  return snapshot.media.find((m) => m.id === mediaId) ?? null;
}

export function recalculateRegistryItemTotals(
  snapshot: StaticDemoSnapshot,
  itemId: string,
): DemoRegistryItemRecord | null {
  const item = snapshot.registryItem.find((r) => r.id === itemId);
  if (!item) return null;

  const activeStatuses = new Set(['CONFIRMED', 'RESERVED']);
  const linkedContributors = snapshot.contributor.filter(
    (c) => c.registryItemId === itemId && activeStatuses.has(c.status.toUpperCase()),
  );

  const totalNet = linkedContributors.reduce((sum, c) => {
    const net = Math.max(0, Number(c.amount || 0) - Number(c.refundedAmount || 0));
    return sum + net;
  }, 0);

  const roundedNet = Math.round(totalNet * 100) / 100;
  item.amountContributed = roundedNet;
  if (item.price > 0) {
    item.purchased = roundedNet >= item.price;
  }
  item.purchaserName =
    linkedContributors.length > 0 ? linkedContributors[0].name : null;
  item.updatedAt = new Date().toISOString();
  return item;
}

export function toContributorDto(
  snapshot: StaticDemoSnapshot,
  contributor: DemoContributorRecord,
  options: {
    maskPublic?: boolean;
    includeRelations?: boolean;
    omitEmail?: boolean;
  } = {},
): Record<string, unknown> {
  if (options.maskPublic) {
    return {
      name: 'Anonymous',
      amount: 'Anonymous',
      date: 'Anonymous',
    };
  }

  const base: Record<string, unknown> = {
    ...contributor,
  };
  if (options.omitEmail) {
    delete base.email;
  }

  if (options.includeRelations) {
    const regItem = contributor.registryItemId
      ? snapshot.registryItem.find((r) => r.id === contributor.registryItemId)
      : null;
    const inv = contributor.invitationCodeId
      ? snapshot.invitationCode.find((i) => i.id === contributor.invitationCodeId)
      : null;
    base.registryItem = regItem
      ? {
        id: regItem.id,
        name: regItem.name,
        category: regItem.category,
      }
      : null;
    base.invitationCode = inv
      ? {
        id: inv.id,
        code: inv.code,
        guestName: inv.guestName,
        email: inv.email,
        householdName: inv.householdName,
        addressLine1: inv.addressLine1,
        addressLine2: inv.addressLine2,
        city: inv.city,
        state: inv.state,
        zipCode: inv.zipCode,
        country: inv.country,
      }
      : null;
  }

  return base;
}

export function toRegistryItemDto(
  snapshot: StaticDemoSnapshot,
  item: DemoRegistryItemRecord,
  options: { maskPublic?: boolean; emptyPublicContributors?: boolean } = {},
): Record<string, unknown> {
  const media = findMediaRecord(snapshot, item.imageId);
  const fallbackUrl = createDemoSvgDataUrl(
    item.name,
    item.category,
    snapshot.activeArchetype,
  );
  const resolvedMedia = media
    ? {
      id: media.id,
      url: media.url,
      altText: media.altText ?? `${item.name} product photo`,
      isDecorative: media.isDecorative,
    }
    : {
      id: item.imageId || `media-fallback-${item.id}`,
      url: fallbackUrl,
      altText: `${item.name} product photo`,
      isDecorative: false,
    };

  const itemContributors = snapshot.contributor
    .filter((c) => c.registryItemId === item.id)
    .sort((a, b) => b.date.localeCompare(a.date));

  const remainingAmount = Math.max(
    0,
    Math.round((item.price - item.amountContributed) * 100) / 100,
  );

  const contributors = options.maskPublic
    ? options.emptyPublicContributors
      ? []
      : itemContributors
        .filter((c) => {
          const status = c.status.toUpperCase();
          return status !== 'CANCELLED' && status !== 'REFUNDED';
        })
        .map((c) => toContributorDto(snapshot, c, { maskPublic: true }))
    : itemContributors.map((c) =>
      toContributorDto(snapshot, c, { omitEmail: true }),
    );

  return {
    ...item,
    purchaserName:
      options.maskPublic && item.purchaserName
        ? 'Anonymous'
        : item.purchaserName,
    imageUrl: resolvedMedia.url,
    image: resolvedMedia,
    media: resolvedMedia,
    remainingAmount,
    isFullyFunded: item.purchased || remainingAmount <= 0,
    contributors,
  };
}

export function toWeddingPartyDto(
  snapshot: StaticDemoSnapshot,
  member: DemoWeddingPartyMemberRecord,
): Record<string, unknown> {
  const photo = findMediaRecord(snapshot, member.photoId);
  const fallbackUrl = createDemoSvgDataUrl(
    member.name,
    member.role,
    snapshot.activeArchetype,
  );
  const resolvedPhoto = photo
    ? {
      id: photo.id,
      url: photo.url,
      altText: photo.altText ?? `Portrait of ${member.name}`,
      isDecorative: photo.isDecorative,
    }
    : {
      id: member.photoId || `photo-fallback-${member.id}`,
      url: fallbackUrl,
      altText: `Portrait of ${member.name}`,
      isDecorative: false,
    };

  return {
    ...member,
    imageUrl: resolvedPhoto.url,
    photo: resolvedPhoto,
  };
}

export function toAttractionDto(
  snapshot: StaticDemoSnapshot,
  attraction: DemoAttractionRecord,
): Record<string, unknown> {
  const image = findMediaRecord(snapshot, attraction.imageId);
  const fallbackUrl = createDemoSvgDataUrl(
    attraction.name,
    attraction.category,
    snapshot.activeArchetype,
  );
  const resolvedImage = image
    ? {
      id: image.id,
      url: image.url,
      altText: image.altText ?? attraction.name,
      isDecorative: image.isDecorative,
    }
    : {
      id: attraction.imageId || `image-fallback-${attraction.id}`,
      url: fallbackUrl,
      altText: attraction.name,
      isDecorative: false,
    };

  return {
    ...attraction,
    imageUrl: resolvedImage.url,
    image: resolvedImage,
  };
}

export function toInvitationSubEventRsvps(
  snapshot: StaticDemoSnapshot,
  invitationCodeId: string,
): Array<Record<string, unknown>> {
  const subEventTitleById = new Map(snapshot.subEvent.map((ev) => [ev.id, ev.title]));
  return snapshot.subEventRsvp
    .filter((rsvp) => rsvp.invitationCodeId === invitationCodeId)
    .map((rsvp) => ({
      id: rsvp.id,
      subEventId: rsvp.subEventId,
      subEventTitle: subEventTitleById.get(rsvp.subEventId) ?? 'Event',
      status:
        rsvp.status === 'attending' || rsvp.status === 'declined'
          ? rsvp.status
          : 'pending',
      plusOneCount: rsvp.plusOneCount ?? 0,
      plusOneNames: Array.isArray(rsvp.plusOneNames) ? rsvp.plusOneNames : [],
      mealSelections: Array.isArray(rsvp.mealSelections) ? rsvp.mealSelections : [],
      dietaryNotes: rsvp.dietaryNotes ?? null,
      customAnswers:
        rsvp.customAnswers && typeof rsvp.customAnswers === 'object'
          ? rsvp.customAnswers
          : {},
      updatedAt: rsvp.updatedAt,
    }));
}

export function toSeatingTableDto(
  snapshot: StaticDemoSnapshot,
  table: DemoSeatingTableRecord,
): Record<string, unknown> {
  const invitationCodes = snapshot.invitationCode
    .filter((inv) => inv.tableId === table.id)
    .sort((a, b) => (a.seatNumber ?? 999) - (b.seatNumber ?? 999))
    .map((inv) => ({
      ...inv,
      plusOneSeatNumbers: Array.isArray(inv.plusOneSeatNumbers)
        ? inv.plusOneSeatNumbers
        : [],
      subEventRsvps: toInvitationSubEventRsvps(snapshot, inv.id),
    }));
  return {
    ...table,
    invitationCodes,
  };
}

export function toInvitationCodeDto(
  snapshot: StaticDemoSnapshot,
  invite: DemoInvitationCodeRecord,
): Record<string, unknown> {
  const table = invite.tableId
    ? snapshot.seatingTable.find((t) => t.id === invite.tableId) ?? null
    : null;
  return {
    ...invite,
    plusOneSeatNumbers: Array.isArray(invite.plusOneSeatNumbers)
      ? invite.plusOneSeatNumbers
      : [],
    subEventRsvps: toInvitationSubEventRsvps(snapshot, invite.id),
    table: table
      ? {
        id: table.id,
        name: table.name,
        shape: table.shape,
        capacity: table.capacity,
      }
      : null,
  };
}

export function toPhotoDto(
  snapshot: StaticDemoSnapshot,
  node: DemoContentNodeRecord,
): Record<string, unknown> {
  const data = node.data ?? {};
  const mediaId = typeof data.mediaId === 'string' ? data.mediaId : null;
  const media = findMediaRecord(snapshot, mediaId);
  const rawUrl =
    typeof data.url === 'string' && data.url.trim().length > 0
      ? data.url
      : media?.url ??
        createDemoSvgDataUrl('Wedding Photo', 'Gallery', snapshot.activeArchetype);
  const caption = typeof data.caption === 'string' ? data.caption : '';
  const explicitAltText =
    typeof data.altText === 'string' && data.altText.trim().length > 0
      ? data.altText.trim()
      : '';
  const title =
    typeof data.title === 'string' && data.title.trim().length > 0
      ? data.title
      : caption || explicitAltText || 'Wedding Photo';
  const altText = explicitAltText || (media?.altText ?? title);
  const category = typeof data.category === 'string' ? data.category : 'Curated';
  const status =
    typeof data.status === 'string' ? data.status.toUpperCase() : 'APPROVED';
  const uploaderName =
    typeof data.uploaderName === 'string'
      ? data.uploaderName
      : typeof data.uploadedBy === 'string'
        ? data.uploadedBy
        : 'Couple';

  return {
    id: node.id,
    nodeId: node.id,
    mediaId,
    url: rawUrl,
    imageUrl: rawUrl,
    title,
    caption,
    altText,
    category,
    status,
    isVisible: data.isVisible !== false && status === 'APPROVED',
    uploaderName,
    uploadedBy: uploaderName,
    isSample: Boolean(data.isSample),
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    tags: node.tags,
    data: {
      ...data,
      url: rawUrl,
      title,
      altText,
      caption,
      category,
      status,
      uploaderName,
    },
  };
}

export function pushAuditVersion(
  snapshot: StaticDemoSnapshot,
  entityType: string,
  entityId: string,
  data: unknown,
  author = 'Admin',
): void {
  const cloned =
    data && typeof data === 'object'
      ? (JSON.parse(JSON.stringify(data)) as Record<string, unknown>)
      : { value: data };

  snapshot.snapshotVersion.unshift({
    id: generateDemoId('ver'),
    entityType,
    entityId,
    data: cloned,
    createdAt: new Date().toISOString(),
    author,
  });

  if (snapshot.snapshotVersion.length > MAX_AUDIT_SNAPSHOTS) {
    snapshot.snapshotVersion.length = MAX_AUDIT_SNAPSHOTS;
  }
}
