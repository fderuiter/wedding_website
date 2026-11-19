import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { sanitizeAppConfigForBackup } from '@/lib/config';

const EXPORT_CHUNK_SIZE = 100;
const BACKUP_SCHEMA_VERSION = '2.0';

interface ModelExportConfig {
  key: string;
  fetchChunks: (cursor?: string) => Promise<Record<string, unknown>[]>;
  sanitize?: (item: Record<string, unknown>) => Record<string, unknown>;
}

function sanitizeSnapshotForExport(snapshot: Record<string, unknown>): Record<string, unknown> {
  if (
    snapshot?.entityType === 'AppConfig' &&
    snapshot.data &&
    typeof snapshot.data === 'object' &&
    !Array.isArray(snapshot.data)
  ) {
    return {
      ...snapshot,
      data: sanitizeAppConfigForBackup(snapshot.data as Record<string, unknown>),
    };
  }
  return snapshot;
}

export const GET = withApiMiddleware(async (_request: NextRequest) => {
  const models: ModelExportConfig[] = [
    {
      key: 'appConfig',
      fetchChunks: (cursor) =>
        prisma.appConfig.findMany({
          take: EXPORT_CHUNK_SIZE,
          orderBy: { id: 'asc' },
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
      sanitize: (config) => sanitizeAppConfigForBackup(config),
    },
    {
      key: 'contentNode',
      fetchChunks: (cursor) =>
        prisma.contentNode.findMany({
          take: EXPORT_CHUNK_SIZE,
          orderBy: { id: 'asc' },
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
    },
    {
      key: 'media',
      fetchChunks: (cursor) =>
        prisma.media.findMany({
          take: EXPORT_CHUNK_SIZE,
          orderBy: { id: 'asc' },
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
    },
    {
      key: 'seatingTable',
      fetchChunks: (cursor) =>
        prisma.seatingTable.findMany({
          take: EXPORT_CHUNK_SIZE,
          orderBy: { id: 'asc' },
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
    },
    {
      key: 'invitationCode',
      fetchChunks: (cursor) =>
        prisma.invitationCode.findMany({
          take: EXPORT_CHUNK_SIZE,
          orderBy: { id: 'asc' },
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
    },
    {
      key: 'weddingPartyMember',
      fetchChunks: (cursor) =>
        prisma.weddingPartyMember.findMany({
          take: EXPORT_CHUNK_SIZE,
          orderBy: { id: 'asc' },
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
    },
    {
      key: 'attraction',
      fetchChunks: (cursor) =>
        prisma.attraction.findMany({
          take: EXPORT_CHUNK_SIZE,
          orderBy: { id: 'asc' },
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
    },
    {
      key: 'registryItem',
      fetchChunks: (cursor) =>
        prisma.registryItem.findMany({
          take: EXPORT_CHUNK_SIZE,
          orderBy: { id: 'asc' },
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
    },
    {
      key: 'contributor',
      fetchChunks: (cursor) =>
        prisma.contributor.findMany({
          take: EXPORT_CHUNK_SIZE,
          orderBy: { id: 'asc' },
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
    },
    {
      key: 'subEvent',
      fetchChunks: (cursor) =>
        prisma.subEvent.findMany({
          take: EXPORT_CHUNK_SIZE,
          orderBy: { id: 'asc' },
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
    },
    {
      key: 'subEventAccess',
      fetchChunks: (cursor) =>
        prisma.subEventAccess.findMany({
          take: EXPORT_CHUNK_SIZE,
          orderBy: { id: 'asc' },
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
    },
    {
      key: 'subEventRsvp',
      fetchChunks: (cursor) =>
        prisma.subEventRsvp.findMany({
          take: EXPORT_CHUNK_SIZE,
          orderBy: { id: 'asc' },
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
    },
    {
      key: 'broadcastMessage',
      fetchChunks: (cursor) =>
        prisma.broadcastMessage.findMany({
          take: EXPORT_CHUNK_SIZE,
          orderBy: { id: 'asc' },
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
    },
    {
      key: 'broadcastRecipient',
      fetchChunks: (cursor) =>
        prisma.broadcastRecipient.findMany({
          take: EXPORT_CHUNK_SIZE,
          orderBy: { id: 'asc' },
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
    },
    {
      key: 'snapshotVersion',
      fetchChunks: (cursor) =>
        prisma.snapshotVersion.findMany({
          take: EXPORT_CHUNK_SIZE,
          orderBy: { id: 'asc' },
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
      sanitize: sanitizeSnapshotForExport,
    },
  ];

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      try {
        const headerJson = `{"version":${JSON.stringify(BACKUP_SCHEMA_VERSION)},"schemaVersion":${JSON.stringify(
          BACKUP_SCHEMA_VERSION,
        )},"exportedAt":${JSON.stringify(new Date().toISOString())}`;
        controller.enqueue(encoder.encode(headerJson));

        for (const modelConfig of models) {
          controller.enqueue(encoder.encode(`,"${modelConfig.key}":[`));

          let cursor: string | undefined = undefined;
          let isFirstItem = true;

          while (true) {
            const chunk = await modelConfig.fetchChunks(cursor);
            if (!chunk || chunk.length === 0) {
              break;
            }

            for (const rawItem of chunk) {
              const item = modelConfig.sanitize ? modelConfig.sanitize(rawItem) : rawItem;
              const jsonStr = (isFirstItem ? '' : ',') + JSON.stringify(item);
              controller.enqueue(encoder.encode(jsonStr));
              isFirstItem = false;
            }

            if (chunk.length < EXPORT_CHUNK_SIZE) {
              break;
            }

            const lastId = chunk[chunk.length - 1]?.id;
            if (typeof lastId !== 'string' || !lastId || lastId === cursor) {
              break;
            }
            cursor = lastId;
          }

          controller.enqueue(encoder.encode(']'));
        }

        controller.enqueue(encoder.encode('}'));
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="wedding-backup-${new Date().toISOString().split('T')[0]}.json"`,
    },
  });
});
