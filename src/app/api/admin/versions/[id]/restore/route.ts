import { NextRequest, NextResponse } from 'next/server';
import { Prisma, WeddingPartySide } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { createAuditSnapshot } from '@/lib/audit';
import {
  coordinateSchema,
  isSafeMediaOrPhotoUrl,
  safeUrlSchema,
} from '@/utils/validation';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import {
  AppConfigSchema,
  PhotoDataSchema,
  translateAppConfigSnapshot,
} from '@/features/content';
import { MediaSchema } from '@/features/media';
import {
  translateSnapshotToActive,
  translateContributorSnapshot,
} from '@/features/registry';
import {
  parseOptionalDate,
  stripAppConfigSecrets,
} from '@/lib/backupPersistence';

const BATCH_SUMMARY_IDS = new Set([
  'batch_import',
  'batch_update_tags',
  'batch_delete',
]);

interface ForeignKeyDelegate {
  findUnique?: (_args: { where: { id: string } }) => Promise<unknown>;
}

interface SnapshotPayload extends Record<string, unknown> {
  deleted?: boolean;
  previous?: Record<string, unknown> | null;
  current?: Prisma.InputJsonValue;
  type?: string;
  tags?: string[];
  data?: Prisma.InputJsonValue;
  photoId?: string | null;
  imageId?: string | null;
  name?: string;
  role?: string;
  bio?: string;
  link?: string | null;
  order?: number;
  side?: WeddingPartySide | null;
  isSample?: boolean;
  description?: string;
  category?: string;
  website?: string;
  directions?: string;
  latitude?: number | string;
  longitude?: number | string;
  isVisible?: boolean;
  promoCode?: string | null;
  bookingUrl?: string | null;
  roomRate?: string | null;
  cutoffDate?: Date | string | null;
  shuttleInfo?: string | null;
  invitationCodeId?: string | null;
  registryItemId?: string | null;
  url?: string;
  altText?: string | null;
  isDecorative?: boolean;
  createdAt?: string | number | Date;
  updatedAt?: string | number | Date;
  tableId?: string | null;
  action?: string;
  code?: string;
  seatNumber?: number | null;
  plusOneSeatNumbers?: number[];
  guestName?: string;
  email?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  country?: string | null;
  dietaryNotes?: string | null;
  plusOneAllocations?: number;
  plusOneFirstName?: string | null;
  plusOneLastName?: string | null;
  householdName?: string | null;
  partyGroup?: string | null;
  partyTags?: string[];
  extraFields?: Prisma.InputJsonValue | null;
  used?: boolean;
  usedAt?: unknown;
  shape?: string;
  capacity?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  title?: string;
  startTime?: unknown;
  endTime?: unknown;
  locationName?: string;
  location?: string;
  isPrivate?: boolean;
  mealOptions?: Prisma.InputJsonValue;
  customQuestions?: Prisma.InputJsonValue;
  subEventId?: string;
  status?: string;
  plusOneCount?: number;
  mealSelections?: Prisma.InputJsonValue;
  customAnswers?: Prisma.InputJsonValue;
  plusOneNames?: Prisma.InputJsonValue;
  channel?: string;
  subject?: string | null;
  body?: string;
  targetFilters?: Prisma.InputJsonValue | null;
  totalRecipients?: number;
  sentCount?: number;
  failedCount?: number;
  scheduledFor?: unknown;
  sentAt?: unknown;
  broadcastId?: string;
  destination?: string;
  error?: string | null;
}

async function resolveForeignKeyId<T>(
  rawId: T,
  delegate: ForeignKeyDelegate | undefined,
): Promise<T | null> {
  if (
    typeof rawId === 'string' &&
    rawId.length > 0 &&
    typeof delegate?.findUnique === 'function'
  ) {
    const existing = await delegate.findUnique({ where: { id: rawId } });
    if (existing === null) {
      return null;
    }
  }
  return rawId;
}

function isFeatureToggleDelta(snapshotData: Record<string, unknown>): boolean {
  return (
    'current' in snapshotData &&
    Array.isArray(snapshotData.current) &&
    !('partner1Name' in snapshotData) &&
    !('brideName' in snapshotData) &&
    !('venueName' in snapshotData)
  );
}

const APP_CONFIG_STRICT_URL_KEYS = [
  'baseUrl',
  'photoAlbumUrl',
  'faviconUrl',
  'ogImageUrl',
  'brandLogoUrl',
  'heroImageUrl',
  'brandWatermarkUrl',
  'badgeGraphicUrl',
] as const;

const APP_CONFIG_STRICT_LAYOUT_KEYS = [
  'layoutContainerMaxWidth',
  'layoutGridGap',
  'layoutCardPadding',
  'layoutBorderRadius',
] as const;

function validateAppConfigSnapshotFields(
  snapshotData: Record<string, unknown>,
): void {
  for (const key of APP_CONFIG_STRICT_URL_KEYS) {
    const rawVal = snapshotData[key];
    if (rawVal !== undefined && rawVal !== null) {
      if (
        typeof rawVal !== 'string' ||
        !AppConfigSchema.shape[key].safeParse(rawVal).success
      ) {
        throw new ApiError(400, `Invalid ${key} in AppConfig snapshot`);
      }
    }
  }

  if (
    snapshotData.contactEmail !== undefined &&
    snapshotData.contactEmail !== null &&
    (typeof snapshotData.contactEmail !== 'string' ||
      !AppConfigSchema.shape.contactEmail.safeParse(snapshotData.contactEmail)
        .success)
  ) {
    throw new ApiError(400, 'Invalid contactEmail in AppConfig snapshot');
  }

  for (const colorKey of ['colorPrimary', 'colorSecondary'] as const) {
    const rawColor = snapshotData[colorKey];
    if (rawColor !== undefined && rawColor !== null && rawColor !== '') {
      if (
        typeof rawColor !== 'string' ||
        !AppConfigSchema.shape[colorKey].safeParse(rawColor).success
      ) {
        throw new ApiError(400, `Invalid ${colorKey} in AppConfig snapshot`);
      }
    }
  }

  if (
    snapshotData.themePreset !== undefined &&
    snapshotData.themePreset !== null &&
    snapshotData.themePreset !== '' &&
    !AppConfigSchema.shape.themePreset.safeParse(snapshotData.themePreset)
      .success
  ) {
    throw new ApiError(400, 'Invalid themePreset in AppConfig snapshot');
  }

  if (
    snapshotData.themeTokens !== undefined &&
    snapshotData.themeTokens !== null
  ) {
    let parsedTokens: unknown = snapshotData.themeTokens;
    if (typeof parsedTokens === 'string') {
      try {
        parsedTokens = JSON.parse(parsedTokens);
      } catch {
        throw new ApiError(400, 'Invalid themeTokens in AppConfig snapshot');
      }
    }
    if (
      !parsedTokens ||
      typeof parsedTokens !== 'object' ||
      Array.isArray(parsedTokens) ||
      !AppConfigSchema.shape.themeTokens.safeParse(parsedTokens).success
    ) {
      throw new ApiError(400, 'Invalid themeTokens in AppConfig snapshot');
    }
  }

  for (const layoutKey of APP_CONFIG_STRICT_LAYOUT_KEYS) {
    const rawLayout = snapshotData[layoutKey];
    if (rawLayout !== undefined && rawLayout !== null) {
      if (
        typeof rawLayout !== 'string' ||
        !AppConfigSchema.shape[layoutKey].safeParse(rawLayout).success
      ) {
        throw new ApiError(400, `Invalid ${layoutKey} in AppConfig snapshot`);
      }
    }
  }

  for (const fontKey of ['fontHeading', 'fontBody', 'fontMono'] as const) {
    const rawFont = snapshotData[fontKey];
    if (
      rawFont !== undefined &&
      rawFont !== null &&
      !AppConfigSchema.shape[fontKey].safeParse(rawFont).success
    ) {
      throw new ApiError(400, `Invalid ${fontKey} in AppConfig snapshot`);
    }
  }

  for (const coordKey of ['latitude', 'longitude'] as const) {
    const rawCoord = snapshotData[coordKey];
    if (
      rawCoord !== undefined &&
      rawCoord !== null &&
      !coordinateSchema.safeParse(rawCoord).success
    ) {
      throw new ApiError(400, `Invalid ${coordKey} in AppConfig snapshot`);
    }
  }
}

export const POST = withApiMiddleware(
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const { id } = await params;
    const version = await prisma.snapshotVersion.findUnique({
      where: { id },
    });

    if (!version) {
      throw new ApiError(404, 'Version not found');
    }

    if (
      !version.data ||
      typeof version.data !== 'object' ||
      Array.isArray(version.data)
    ) {
      throw new ApiError(400, 'Invalid snapshot data');
    }

    const rawSnapshotData = version.data as SnapshotPayload;
    const snapshotData: SnapshotPayload =
      rawSnapshotData.deleted &&
      rawSnapshotData.previous &&
      typeof rawSnapshotData.previous === 'object' &&
      !Array.isArray(rawSnapshotData.previous)
        ? (rawSnapshotData.previous as SnapshotPayload)
        : rawSnapshotData;

    if (version.entityType === 'AppConfig') {
      if (isFeatureToggleDelta(snapshotData)) {
        const parsedFeatures = AppConfigSchema.shape.features.safeParse(
          snapshotData.current,
        );
        if (!parsedFeatures.success) {
          throw new ApiError(400, 'Invalid AppConfig features snapshot data');
        }
        await prisma.appConfig.upsert({
          where: { id: version.entityId },
          update: { features: parsedFeatures.data as Prisma.InputJsonValue },
          create: {
            id: version.entityId,
            features: parsedFeatures.data as Prisma.InputJsonValue,
          },
        });
      } else {
        validateAppConfigSnapshotFields(snapshotData);
        const translatedConfig = translateAppConfigSnapshot(
          snapshotData,
          version.entityId,
        );
        if (!translatedConfig) {
          throw new ApiError(400, 'Invalid snapshot data');
        }
        const validatedConfig = AppConfigSchema.safeParse({
          ...translatedConfig.create,
          id: version.entityId,
          themeTokens: translatedConfig.create.themeTokens ?? {},
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        if (!validatedConfig.success) {
          throw new ApiError(400, 'Invalid AppConfig snapshot data');
        }
        const updatePayload = {
          ...translatedConfig.update,
          ...(translatedConfig.update.themeTokens === null
            ? { themeTokens: Prisma.DbNull }
            : {}),
        };
        const createPayload = {
          ...translatedConfig.create,
          ...(translatedConfig.create.themeTokens === null
            ? { themeTokens: Prisma.DbNull }
            : {}),
        };
        await prisma.appConfig.upsert({
          where: { id: version.entityId },
          update: updatePayload as Prisma.AppConfigUpdateInput,
          create: createPayload as Prisma.AppConfigCreateInput,
        });
      }
    } else if (version.entityType === 'ContentNode') {
      const nodeData: Prisma.InputJsonValue = snapshotData.data || {};
      if (snapshotData.type === 'Photo') {
        const parsedPhoto = PhotoDataSchema.safeParse(nodeData);
        if (!parsedPhoto.success) {
          throw new ApiError(400, 'Invalid Photo content node snapshot data');
        }
      } else if (
        nodeData &&
        typeof nodeData === 'object' &&
        !Array.isArray(nodeData) &&
        'url' in nodeData &&
        typeof nodeData.url === 'string' &&
        !isSafeMediaOrPhotoUrl(nodeData.url)
      ) {
        throw new ApiError(400, 'Invalid URL in content node snapshot');
      }

      const data = {
        type: snapshotData.type as string,
        tags: snapshotData.tags || [],
        data: nodeData,
      };
      await prisma.contentNode.upsert({
        where: { id: version.entityId },
        update: data,
        create: { id: version.entityId, ...data },
      });
    } else if (version.entityType === 'WeddingPartyMember') {
      if (
        snapshotData.link !== undefined &&
        snapshotData.link !== null &&
        (typeof snapshotData.link !== 'string' ||
          !safeUrlSchema.safeParse(snapshotData.link).success)
      ) {
        throw new ApiError(
          400,
          'Invalid link URL in WeddingPartyMember snapshot',
        );
      }

      const resolvedPhotoId = await resolveForeignKeyId(
        snapshotData.photoId,
        prisma.media,
      );

      const data = {
        name: snapshotData.name as string,
        role: snapshotData.role as string,
        bio: snapshotData.bio as string,
        photoId: resolvedPhotoId,
        link: snapshotData.link,
        order: snapshotData.order || 0,
        ...(snapshotData.side !== undefined ? { side: snapshotData.side } : {}),
        ...(snapshotData.isSample !== undefined
          ? { isSample: Boolean(snapshotData.isSample) }
          : {}),
      };
      await prisma.weddingPartyMember.upsert({
        where: { id: version.entityId },
        update: data,
        create: { id: version.entityId, ...data },
      });
    } else if (version.entityType === 'Attraction') {
      if (
        snapshotData.website !== undefined &&
        snapshotData.website !== null &&
        (typeof snapshotData.website !== 'string' ||
          !safeUrlSchema.safeParse(snapshotData.website).success)
      ) {
        throw new ApiError(400, 'Invalid website URL in Attraction snapshot');
      }
      if (
        snapshotData.bookingUrl !== undefined &&
        snapshotData.bookingUrl !== null &&
        (typeof snapshotData.bookingUrl !== 'string' ||
          !safeUrlSchema.safeParse(snapshotData.bookingUrl).success)
      ) {
        throw new ApiError(400, 'Invalid booking URL in Attraction snapshot');
      }

      const parsedLatitude = coordinateSchema.safeParse(
        snapshotData.latitude ?? 0,
      );
      const parsedLongitude = coordinateSchema.safeParse(
        snapshotData.longitude ?? 0,
      );
      if (!parsedLatitude.success || !parsedLongitude.success) {
        throw new ApiError(400, 'Invalid coordinates in Attraction snapshot');
      }

      const resolvedImageId = await resolveForeignKeyId(
        snapshotData.imageId,
        prisma.media,
      );

      const data = {
        name: snapshotData.name as string,
        description: snapshotData.description as string,
        imageId: resolvedImageId,
        category: snapshotData.category as string,
        website: snapshotData.website as string,
        directions: snapshotData.directions as string,
        latitude: parsedLatitude.data,
        longitude: parsedLongitude.data,
        isVisible: snapshotData.isVisible !== false,
        ...(snapshotData.promoCode !== undefined
          ? { promoCode: snapshotData.promoCode }
          : {}),
        ...(snapshotData.bookingUrl !== undefined
          ? { bookingUrl: snapshotData.bookingUrl }
          : {}),
        ...(snapshotData.roomRate !== undefined
          ? { roomRate: snapshotData.roomRate }
          : {}),
        ...(snapshotData.cutoffDate !== undefined
          ? {
            cutoffDate:
              snapshotData.cutoffDate instanceof Date
                ? snapshotData.cutoffDate.toISOString()
                : snapshotData.cutoffDate === null
                  ? null
                  : String(snapshotData.cutoffDate),
          }
          : {}),
        ...(snapshotData.shuttleInfo !== undefined
          ? { shuttleInfo: snapshotData.shuttleInfo }
          : {}),
        ...(snapshotData.isSample !== undefined
          ? { isSample: Boolean(snapshotData.isSample) }
          : {}),
      };
      await prisma.attraction.upsert({
        where: { id: version.entityId },
        update: data,
        create: { id: version.entityId, ...data },
      });
    } else if (version.entityType === 'RegistryItem') {
      const translated = translateSnapshotToActive(snapshotData);
      if (!translated) {
        throw new ApiError(400, 'Invalid snapshot data');
      }
      if (
        translated.vendorUrl !== undefined &&
        translated.vendorUrl !== null &&
        (typeof translated.vendorUrl !== 'string' ||
          !safeUrlSchema.safeParse(translated.vendorUrl).success)
      ) {
        throw new ApiError(
          400,
          'Invalid vendor URL in RegistryItem snapshot',
        );
      }
      const data = {
        ...translated,
        ...(snapshotData.isSample !== undefined
          ? { isSample: Boolean(snapshotData.isSample) }
          : {}),
      };
      await prisma.registryItem.upsert({
        where: { id: version.entityId },
        update: data,
        create: { id: version.entityId, ...data },
      });
    } else if (version.entityType === 'Contributor') {
      const resolvedInvitationCodeId = await resolveForeignKeyId(
        snapshotData.invitationCodeId,
        prisma.invitationCode,
      );
      const resolvedRegistryItemId = await resolveForeignKeyId(
        snapshotData.registryItemId,
        prisma.registryItem,
      );

      const translatedContributor = translateContributorSnapshot(snapshotData, {
        entityId: version.entityId,
        registryItemId: resolvedRegistryItemId,
        invitationCodeId: resolvedInvitationCodeId,
      });
      if (!translatedContributor) {
        throw new ApiError(400, 'Invalid snapshot data');
      }
      await prisma.contributor.upsert({
        where: { id: version.entityId },
        update:
          translatedContributor.update as Prisma.ContributorUncheckedUpdateInput,
        create:
          translatedContributor.create as Prisma.ContributorUncheckedCreateInput,
      });
    } else if (version.entityType === 'Media') {
      const parsedMedia = MediaSchema.safeParse({
        id: version.entityId,
        url: snapshotData.url ?? '',
        altText: snapshotData.altText ?? null,
        isDecorative: snapshotData.isDecorative ?? false,
        createdAt: snapshotData.createdAt
          ? new Date(snapshotData.createdAt)
          : new Date(),
        updatedAt: snapshotData.updatedAt
          ? new Date(snapshotData.updatedAt)
          : new Date(),
      });
      if (!parsedMedia.success) {
        throw new ApiError(400, 'Invalid Media snapshot data');
      }
      const parsedData = parsedMedia.data;
      const data = {
        url: parsedData.url,
        altText: parsedData.altText,
        isDecorative: parsedData.isDecorative,
        ...(snapshotData.isSample !== undefined
          ? { isSample: Boolean(snapshotData.isSample) }
          : {}),
        createdAt: parsedData.createdAt,
        updatedAt: parsedData.updatedAt,
      };
      await prisma.media.upsert({
        where: { id: version.entityId },
        update: data,
        create: { id: version.entityId, ...data },
      });
    } else if (version.entityType === 'InvitationCode') {
      if (BATCH_SUMMARY_IDS.has(version.entityId)) {
        throw new ApiError(
          400,
          'Batch operation snapshots cannot be restored as a single record',
        );
      }

      const resolvedTableId = await resolveForeignKeyId<
        string | null | undefined
      >(snapshotData.tableId, prisma.seatingTable);

      if (
        (snapshotData.action === 'assignSeat' ||
          snapshotData.action === 'autoAssign') &&
        typeof snapshotData.code !== 'string'
      ) {
        await prisma.invitationCode.update({
          where: { id: version.entityId },
          data: {
            tableId: resolvedTableId ?? null,
            seatNumber: resolvedTableId
              ? (snapshotData.seatNumber ?? null)
              : null,
            plusOneSeatNumbers:
              resolvedTableId && Array.isArray(snapshotData.plusOneSeatNumbers)
                ? snapshotData.plusOneSeatNumbers.filter(
                  (n: unknown): n is number =>
                    typeof n === 'number' && Number.isInteger(n),
                )
                : [],
          },
        });
      } else {
        if (
          typeof snapshotData.code !== 'string' ||
          !snapshotData.code.trim()
        ) {
          throw new ApiError(400, 'Invalid InvitationCode snapshot data');
        }

        const data: Prisma.InvitationCodeUncheckedCreateInput = {
          id: version.entityId,
          code: snapshotData.code,
          guestName: snapshotData.guestName ?? '',
          email: snapshotData.email ?? null,
          addressLine1: snapshotData.addressLine1 ?? null,
          addressLine2: snapshotData.addressLine2 ?? null,
          city: snapshotData.city ?? null,
          state: snapshotData.state ?? null,
          zipCode: snapshotData.zipCode ?? null,
          country: snapshotData.country ?? null,
          dietaryNotes: snapshotData.dietaryNotes ?? null,
          plusOneAllocations:
            typeof snapshotData.plusOneAllocations === 'number'
              ? snapshotData.plusOneAllocations
              : 0,
          plusOneFirstName: snapshotData.plusOneFirstName ?? null,
          plusOneLastName: snapshotData.plusOneLastName ?? null,
          householdName: snapshotData.householdName ?? null,
          partyGroup: snapshotData.partyGroup ?? null,
          partyTags: Array.isArray(snapshotData.partyTags)
            ? snapshotData.partyTags
            : [],
          extraFields:
            snapshotData.extraFields === null ||
            snapshotData.extraFields === undefined
              ? Prisma.DbNull
              : (snapshotData.extraFields as Prisma.InputJsonValue),
          used: Boolean(snapshotData.used),
          usedAt: parseOptionalDate(snapshotData.usedAt),
          tableId: resolvedTableId ?? null,
          seatNumber: resolvedTableId
            ? (snapshotData.seatNumber ?? null)
            : null,
          plusOneSeatNumbers:
            resolvedTableId && Array.isArray(snapshotData.plusOneSeatNumbers)
              ? snapshotData.plusOneSeatNumbers.filter(
                (n: unknown): n is number =>
                  typeof n === 'number' && Number.isInteger(n),
              )
              : [],
          ...(snapshotData.isSample !== undefined
            ? { isSample: Boolean(snapshotData.isSample) }
            : {}),
        };

        const { id: _ignoredId, ...updateData } = data;
        await prisma.invitationCode.upsert({
          where: { id: version.entityId },
          update: updateData,
          create: data,
        });
      }
    } else if (version.entityType === 'SeatingTable') {
      if (typeof snapshotData.name !== 'string' || !snapshotData.name.trim()) {
        throw new ApiError(400, 'Invalid SeatingTable snapshot data');
      }

      const data = {
        name: snapshotData.name,
        shape: snapshotData.shape ?? 'round',
        capacity:
          typeof snapshotData.capacity === 'number' ? snapshotData.capacity : 8,
        x: typeof snapshotData.x === 'number' ? snapshotData.x : 100,
        y: typeof snapshotData.y === 'number' ? snapshotData.y : 100,
        width:
          typeof snapshotData.width === 'number' ? snapshotData.width : 120,
        height:
          typeof snapshotData.height === 'number' ? snapshotData.height : 120,
        rotation:
          typeof snapshotData.rotation === 'number' ? snapshotData.rotation : 0,
        ...(snapshotData.isSample !== undefined
          ? { isSample: Boolean(snapshotData.isSample) }
          : {}),
      };

      await prisma.seatingTable.upsert({
        where: { id: version.entityId },
        update: data,
        create: { id: version.entityId, ...data },
      });
    } else if (version.entityType === 'SubEvent') {
      if (
        typeof snapshotData.title !== 'string' ||
        !snapshotData.title.trim()
      ) {
        throw new ApiError(400, 'Invalid SubEvent snapshot data');
      }

      const data = {
        title: snapshotData.title,
        description: snapshotData.description ?? '',
        startTime: parseOptionalDate(snapshotData.startTime),
        endTime: parseOptionalDate(snapshotData.endTime),
        locationName: snapshotData.locationName ?? '',
        location: snapshotData.location ?? '',
        category: snapshotData.category ?? '',
        isPrivate: Boolean(snapshotData.isPrivate),
        ...(Array.isArray(snapshotData.mealOptions)
          ? { mealOptions: snapshotData.mealOptions as Prisma.InputJsonValue }
          : {}),
        ...(Array.isArray(snapshotData.customQuestions)
          ? {
            customQuestions:
              snapshotData.customQuestions as Prisma.InputJsonValue,
          }
          : {}),
      };

      await prisma.subEvent.upsert({
        where: { id: version.entityId },
        update: data,
        create: { id: version.entityId, ...data },
      });
    } else if (version.entityType === 'SubEventAccess') {
      if (
        typeof snapshotData.subEventId !== 'string' ||
        typeof snapshotData.invitationCodeId !== 'string'
      ) {
        throw new ApiError(400, 'Invalid SubEventAccess snapshot data');
      }

      const data = {
        subEventId: snapshotData.subEventId,
        invitationCodeId: snapshotData.invitationCodeId,
      };

      await prisma.subEventAccess.upsert({
        where: { id: version.entityId },
        update: data,
        create: { id: version.entityId, ...data },
      });
    } else if (version.entityType === 'SubEventRsvp') {
      if (
        typeof snapshotData.subEventId !== 'string' ||
        typeof snapshotData.invitationCodeId !== 'string'
      ) {
        throw new ApiError(400, 'Invalid SubEventRsvp snapshot data');
      }

      const data = {
        subEventId: snapshotData.subEventId,
        invitationCodeId: snapshotData.invitationCodeId,
        status: snapshotData.status ?? 'PENDING',
        plusOneCount:
          typeof snapshotData.plusOneCount === 'number'
            ? snapshotData.plusOneCount
            : 0,
        dietaryNotes: snapshotData.dietaryNotes ?? null,
        ...(Array.isArray(snapshotData.mealSelections)
          ? {
            mealSelections:
              snapshotData.mealSelections as Prisma.InputJsonValue,
          }
          : {}),
        ...(snapshotData.customAnswers &&
        typeof snapshotData.customAnswers === 'object' &&
        !Array.isArray(snapshotData.customAnswers)
          ? {
            customAnswers:
              snapshotData.customAnswers as Prisma.InputJsonValue,
          }
          : {}),
        ...(Array.isArray(snapshotData.plusOneNames)
          ? { plusOneNames: snapshotData.plusOneNames as Prisma.InputJsonValue }
          : {}),
      };

      await prisma.subEventRsvp.upsert({
        where: { id: version.entityId },
        update: data,
        create: { id: version.entityId, ...data },
      });
    } else if (version.entityType === 'BroadcastMessage') {
      if (typeof snapshotData.body !== 'string') {
        throw new ApiError(400, 'Invalid BroadcastMessage snapshot data');
      }

      const data: Prisma.BroadcastMessageUncheckedCreateInput = {
        id: version.entityId,
        channel: snapshotData.channel ?? 'EMAIL',
        subject: snapshotData.subject ?? null,
        body: snapshotData.body,
        targetFilters:
          snapshotData.targetFilters === null ||
          snapshotData.targetFilters === undefined
            ? Prisma.DbNull
            : (snapshotData.targetFilters as Prisma.InputJsonValue),
        status: snapshotData.status ?? 'PENDING',
        totalRecipients:
          typeof snapshotData.totalRecipients === 'number'
            ? snapshotData.totalRecipients
            : 0,
        sentCount:
          typeof snapshotData.sentCount === 'number'
            ? snapshotData.sentCount
            : 0,
        failedCount:
          typeof snapshotData.failedCount === 'number'
            ? snapshotData.failedCount
            : 0,
        scheduledFor: parseOptionalDate(snapshotData.scheduledFor),
        sentAt: parseOptionalDate(snapshotData.sentAt),
      };

      const { id: _ignoredId, ...updateData } = data;
      await prisma.broadcastMessage.upsert({
        where: { id: version.entityId },
        update: updateData,
        create: data,
      });
    } else if (version.entityType === 'BroadcastRecipient') {
      if (
        typeof snapshotData.broadcastId !== 'string' ||
        typeof snapshotData.destination !== 'string'
      ) {
        throw new ApiError(400, 'Invalid BroadcastRecipient snapshot data');
      }

      const resolvedInvitationCodeId = await resolveForeignKeyId<
        string | null | undefined
      >(snapshotData.invitationCodeId, prisma.invitationCode);

      const data = {
        broadcastId: snapshotData.broadcastId,
        invitationCodeId: resolvedInvitationCodeId ?? null,
        guestName: snapshotData.guestName ?? '',
        destination: snapshotData.destination,
        status: snapshotData.status ?? 'PENDING',
        error: snapshotData.error ?? null,
        sentAt: parseOptionalDate(snapshotData.sentAt),
      };

      await prisma.broadcastRecipient.upsert({
        where: { id: version.entityId },
        update: data,
        create: { id: version.entityId, ...data },
      });
    } else {
      throw new ApiError(400, 'Unsupported entity type');
    }

    const rollbackSnapshotPayload =
      version.entityType === 'AppConfig'
        ? stripAppConfigSecrets(rawSnapshotData)
        : rawSnapshotData;

    await createAuditSnapshot(
      version.entityType,
      version.entityId,
      rollbackSnapshotPayload,
      'Admin (Rollback)',
    );

    return NextResponse.json({ success: true, restoredTo: id });
  },
);
