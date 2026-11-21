import { ImportBackupSchema, formatZodError } from '@/utils/validation';
import { DatabaseBackupSchema, reviveDates } from '@/utils/backupValidation';
export { reviveDates };
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { pruneSnapshotsBulk } from '@/lib/audit';
import { logger } from '@/lib/logger';
import { APP_CONFIG_SECRET_KEYS, sanitizeAppConfigForBackup } from '@/lib/config';
import { resolveModuleConfig } from '@/lib/modules';

function hasNonEmptySecret(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeOptionalDate(value: Date | string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function serializeDatesForJson(value: unknown): Prisma.InputJsonValue {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => serializeDatesForJson(entry));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, Prisma.InputJsonValue> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) {
        out[k] = serializeDatesForJson(v);
      }
    }
    return out;
  }
  return value as Prisma.InputJsonValue;
}

export const POST = withApiMiddleware(async (request: NextRequest) => {
  const rawData = await request.json();
  ImportBackupSchema.parse(rawData);
  const revivedData = reviveDates(rawData);

  if (!revivedData.appConfig || !revivedData.registryItem) {
    throw new ApiError(400, 'Invalid backup file structure');
  }

  let data: z.infer<typeof DatabaseBackupSchema>;
  try {
    data = DatabaseBackupSchema.parse(revivedData);
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      throw new ApiError(400, `Validation Error: ${formatZodError(err)}`);
    }
    throw err;
  }

  const validTableIds = new Set((data.seatingTable ?? []).map((t) => t.id));
  const validInvitationIds = new Set((data.invitationCode ?? []).map((ic) => ic.id));
  const validRegistryItemIds = new Set((data.registryItem ?? []).map((ri) => ri.id));
  const validSubEventIds = new Set((data.subEvent ?? []).map((se) => se.id));
  const validBroadcastIds = new Set((data.broadcastMessage ?? []).map((bm) => bm.id));

  const normalizedSeatingTables: Prisma.SeatingTableCreateManyInput[] = (data.seatingTable ?? []).map((table) => {
    const { createdAt, updatedAt, ...rest } = table;
    const normalizedCreated = normalizeOptionalDate(createdAt);
    const normalizedUpdated = normalizeOptionalDate(updatedAt);
    return {
      ...rest,
      ...(normalizedCreated ? { createdAt: normalizedCreated } : {}),
      ...(normalizedUpdated ? { updatedAt: normalizedUpdated } : {}),
    };
  });

  const normalizedInvitationCodes: Prisma.InvitationCodeCreateManyInput[] = (data.invitationCode ?? []).map((inv) => {
    const { extraFields, tableId, seatNumber, ...rest } = inv;
    const resolvedTableId = tableId && validTableIds.has(tableId) ? tableId : tableId === null ? null : undefined;
    const shouldClearOrphanTable = Boolean(tableId && !validTableIds.has(tableId));
    return {
      ...rest,
      ...(extraFields !== undefined && extraFields !== null
        ? { extraFields: serializeDatesForJson(extraFields) }
        : {}),
      ...(shouldClearOrphanTable
        ? { tableId: null, seatNumber: null }
        : {
          ...(resolvedTableId !== undefined ? { tableId: resolvedTableId } : {}),
          ...(seatNumber !== undefined ? { seatNumber } : {}),
        }),
    };
  });

  const normalizedAttractions: Prisma.AttractionCreateManyInput[] = (data.attraction ?? []).map((att) => {
    const { cutoffDate, website, ...rest } = att;
    const normalizedCutoff =
      cutoffDate instanceof Date ? cutoffDate.toISOString() : cutoffDate;
    return {
      ...rest,
      website: website ?? '',
      ...(normalizedCutoff !== undefined ? { cutoffDate: normalizedCutoff } : {}),
    };
  });

  const normalizedRegistryItems: Prisma.RegistryItemCreateManyInput[] = (data.registryItem ?? []).map(
    (item) => ({
      ...item,
      description: item.description ?? '',
    }),
  );

  const normalizedContributors: Prisma.ContributorCreateManyInput[] = (data.contributor ?? []).map((contrib) => {
    const { invitationCodeId, registryItemId, ...rest } = contrib;
    const resolvedInvitationId =
      invitationCodeId === undefined
        ? undefined
        : invitationCodeId && validInvitationIds.has(invitationCodeId)
          ? invitationCodeId
          : null;
    const resolvedRegistryItemId =
      registryItemId === undefined
        ? undefined
        : registryItemId && validRegistryItemIds.has(registryItemId)
          ? registryItemId
          : null;
    return {
      ...rest,
      ...(resolvedRegistryItemId !== undefined ? { registryItemId: resolvedRegistryItemId } : {}),
      ...(resolvedInvitationId !== undefined ? { invitationCodeId: resolvedInvitationId } : {}),
    };
  });

  const normalizedSubEvents: Prisma.SubEventCreateManyInput[] = (data.subEvent ?? []).map((evt) => {
    const { mealOptions, customQuestions, ...rest } = evt;
    return {
      ...rest,
      ...(mealOptions !== undefined ? { mealOptions: serializeDatesForJson(mealOptions) } : {}),
      ...(customQuestions !== undefined ? { customQuestions: serializeDatesForJson(customQuestions) } : {}),
    };
  });

  const normalizedSubEventAccess: Prisma.SubEventAccessCreateManyInput[] = (data.subEventAccess ?? []).filter(
    (entry) => validSubEventIds.has(entry.subEventId) && validInvitationIds.has(entry.invitationCodeId),
  );

  const normalizedSubEventRsvps: Prisma.SubEventRsvpCreateManyInput[] = (data.subEventRsvp ?? [])
    .filter((entry) => validSubEventIds.has(entry.subEventId) && validInvitationIds.has(entry.invitationCodeId))
    .map((rsvp) => {
      const { mealSelections, customAnswers, plusOneNames, ...rest } = rsvp;
      return {
        ...rest,
        ...(mealSelections !== undefined ? { mealSelections: serializeDatesForJson(mealSelections) } : {}),
        ...(customAnswers !== undefined ? { customAnswers: serializeDatesForJson(customAnswers) } : {}),
        ...(plusOneNames !== undefined ? { plusOneNames: serializeDatesForJson(plusOneNames) } : {}),
      };
    });

  const normalizedBroadcastMessages: Prisma.BroadcastMessageCreateManyInput[] = (data.broadcastMessage ?? []).map(
    (msg) => {
      const { targetFilters, ...rest } = msg;
      return {
        ...rest,
        ...(targetFilters !== undefined && targetFilters !== null
          ? { targetFilters: serializeDatesForJson(targetFilters) }
          : {}),
      };
    },
  );

  const normalizedBroadcastRecipients: Prisma.BroadcastRecipientCreateManyInput[] = (data.broadcastRecipient ?? [])
    .filter((rec) => validBroadcastIds.has(rec.broadcastId))
    .map((rec) => {
      const { invitationCodeId, ...rest } = rec;
      const resolvedInvitationId =
        invitationCodeId === undefined
          ? undefined
          : invitationCodeId && validInvitationIds.has(invitationCodeId)
            ? invitationCodeId
            : null;
      return {
        ...rest,
        ...(resolvedInvitationId !== undefined ? { invitationCodeId: resolvedInvitationId } : {}),
      };
    });

  const normalizedContentNodes: Prisma.ContentNodeCreateManyInput[] = (data.contentNode ?? []).map((node) => ({
    ...node,
    data: serializeDatesForJson(node.data),
  }));

  const normalizedSnapshotVersions: Prisma.SnapshotVersionCreateManyInput[] = (data.snapshotVersion ?? []).map(
    (snap) => {
      const sanitizedPayload =
        snap.entityType === 'AppConfig' && snap.data && typeof snap.data === 'object' && !Array.isArray(snap.data)
          ? sanitizeAppConfigForBackup(snap.data as Record<string, unknown>)
          : snap.data;
      return {
        id: snap.id,
        entityType: snap.entityType,
        entityId: snap.entityId,
        data: serializeDatesForJson(sanitizedPayload),
        createdAt: snap.createdAt,
        ...(typeof snap.author === 'string' && snap.author.length > 0 ? { author: snap.author } : {}),
      };
    },
  );

  await prisma.$transaction(async (tx) => {
    const existingConfigs =
      typeof tx.appConfig?.findMany === 'function' ? await tx.appConfig.findMany() : [];
    const existingById = new Map(existingConfigs.map((cfg) => [cfg.id, cfg]));
    const fallbackGlobal = existingById.get('global') ?? existingConfigs[0];

    const normalizedAppConfigs: Prisma.AppConfigCreateManyInput[] = (data.appConfig ?? []).map((cfg) => {
      const {
        themeTokens,
        features,
        modules,
        smtpPass,
        resendApiKey,
        sendgridApiKey,
        twilioAuthToken,
        ...rest
      } = cfg;
      const existing = existingById.get(cfg.id) ?? (cfg.id === 'global' ? fallbackGlobal : undefined);
      const rawSecrets = { smtpPass, resendApiKey, sendgridApiKey, twilioAuthToken };
      const mergedSecrets: Partial<Record<(typeof APP_CONFIG_SECRET_KEYS)[number], string>> = {};

      for (const secretKey of APP_CONFIG_SECRET_KEYS) {
        const incomingSecret = rawSecrets[secretKey];
        if (hasNonEmptySecret(incomingSecret)) {
          mergedSecrets[secretKey] = incomingSecret;
        } else if (existing && hasNonEmptySecret(existing[secretKey])) {
          mergedSecrets[secretKey] = existing[secretKey];
        }
      }

      const resolvedImportModules =
        modules !== undefined
          ? resolveModuleConfig(modules)
          : rest.showCountdown !== undefined || rest.showAddToCalendar !== undefined
            ? resolveModuleConfig({
              ...(rest.showCountdown !== undefined ? { countdown: rest.showCountdown } : {}),
              ...(rest.showAddToCalendar !== undefined ? { addToCalendar: rest.showAddToCalendar } : {}),
            })
            : undefined;

      return {
        ...rest,
        ...(modules !== undefined
          ? {
            showCountdown: resolvedImportModules!.countdown,
            showAddToCalendar: resolvedImportModules!.addToCalendar,
          }
          : {}),
        ...(themeTokens !== undefined && themeTokens !== null
          ? { themeTokens: serializeDatesForJson(themeTokens) }
          : {}),
        ...(features !== undefined ? { features: serializeDatesForJson(features) } : {}),
        ...(resolvedImportModules !== undefined ? { modules: serializeDatesForJson(resolvedImportModules) } : {}),
        ...mergedSecrets,
      };
    });

    // Delete child tables before parent tables to satisfy foreign-key constraints
    if (tx.broadcastRecipient?.deleteMany) await tx.broadcastRecipient.deleteMany();
    if (tx.broadcastMessage?.deleteMany) await tx.broadcastMessage.deleteMany();
    if (tx.subEventRsvp?.deleteMany) await tx.subEventRsvp.deleteMany();
    if (tx.subEventAccess?.deleteMany) await tx.subEventAccess.deleteMany();
    if (tx.subEvent?.deleteMany) await tx.subEvent.deleteMany();
    await tx.contributor.deleteMany();
    await tx.registryItem.deleteMany();
    if (tx.invitationCode?.deleteMany) await tx.invitationCode.deleteMany();
    if (tx.seatingTable?.deleteMany) await tx.seatingTable.deleteMany();
    await tx.attraction.deleteMany();
    await tx.weddingPartyMember.deleteMany();
    await tx.media.deleteMany();
    await tx.contentNode.deleteMany();
    await tx.appConfig.deleteMany();

    // Insert parent tables before child tables to satisfy foreign-key constraints
    if (normalizedAppConfigs.length) await tx.appConfig.createMany({ data: normalizedAppConfigs });
    if (normalizedContentNodes.length) await tx.contentNode.createMany({ data: normalizedContentNodes });
    if (data.media?.length) await tx.media.createMany({ data: data.media });
    if (normalizedSeatingTables.length && tx.seatingTable?.createMany) {
      await tx.seatingTable.createMany({ data: normalizedSeatingTables });
    }
    if (normalizedInvitationCodes.length && tx.invitationCode?.createMany) {
      await tx.invitationCode.createMany({ data: normalizedInvitationCodes });
    }
    if (data.weddingPartyMember?.length) {
      await tx.weddingPartyMember.createMany({ data: data.weddingPartyMember });
    }
    if (normalizedAttractions.length) await tx.attraction.createMany({ data: normalizedAttractions });
    if (normalizedRegistryItems.length) await tx.registryItem.createMany({ data: normalizedRegistryItems });
    if (normalizedContributors.length) await tx.contributor.createMany({ data: normalizedContributors });
    if (normalizedSubEvents.length && tx.subEvent?.createMany) {
      await tx.subEvent.createMany({ data: normalizedSubEvents });
    }
    if (normalizedSubEventAccess.length && tx.subEventAccess?.createMany) {
      await tx.subEventAccess.createMany({ data: normalizedSubEventAccess });
    }
    if (normalizedSubEventRsvps.length && tx.subEventRsvp?.createMany) {
      await tx.subEventRsvp.createMany({ data: normalizedSubEventRsvps });
    }
    if (normalizedBroadcastMessages.length && tx.broadcastMessage?.createMany) {
      await tx.broadcastMessage.createMany({ data: normalizedBroadcastMessages });
    }
    if (normalizedBroadcastRecipients.length && tx.broadcastRecipient?.createMany) {
      await tx.broadcastRecipient.createMany({ data: normalizedBroadcastRecipients });
    }
    if (normalizedSnapshotVersions.length && tx.snapshotVersion?.createMany) {
      await tx.snapshotVersion.createMany({
        data: normalizedSnapshotVersions,
        skipDuplicates: true,
      });
    }
  });

  // Track mass changes in background
  void (async () => {
    try {
      const snapshotsToCreate: Prisma.SnapshotVersionCreateManyInput[] = [];
      const entitiesToPrune: { entityType: string; entityId: string }[] = [];

      const pushBulkSnapshots = (
        entityType: string,
        items: Array<{ id: string } & Record<string, unknown>> | undefined,
        sanitizeItem?: (item: Record<string, unknown>) => Record<string, unknown>,
      ) => {
        if (!items?.length) return;
        for (const item of items) {
          const payload = sanitizeItem ? sanitizeItem(item) : item;
          snapshotsToCreate.push({
            entityType,
            entityId: item.id,
            data: payload as Prisma.InputJsonValue,
            author: 'Admin/BulkImport',
          });
          entitiesToPrune.push({ entityType, entityId: item.id });
        }
      };

      pushBulkSnapshots('AppConfig', data.appConfig, sanitizeAppConfigForBackup);
      pushBulkSnapshots('ContentNode', data.contentNode);
      pushBulkSnapshots('WeddingPartyMember', data.weddingPartyMember);
      pushBulkSnapshots('Attraction', normalizedAttractions as Array<{ id: string } & Record<string, unknown>>);
      pushBulkSnapshots('RegistryItem', normalizedRegistryItems as Array<{ id: string } & Record<string, unknown>>);
      pushBulkSnapshots('SeatingTable', normalizedSeatingTables as Array<{ id: string } & Record<string, unknown>>);
      pushBulkSnapshots('InvitationCode', normalizedInvitationCodes as Array<{ id: string } & Record<string, unknown>>);
      pushBulkSnapshots('SubEvent', data.subEvent);
      pushBulkSnapshots('BroadcastMessage', normalizedBroadcastMessages as Array<{ id: string } & Record<string, unknown>>);

      if (snapshotsToCreate.length > 0) {
        await prisma.snapshotVersion.createMany({ data: snapshotsToCreate });
        await pruneSnapshotsBulk(entitiesToPrune);
      }
    } catch (e) {
      logger.error('Error during bulk import audit snapshot creation:', e);
    }
  })();

  return NextResponse.json({ success: true });
});
