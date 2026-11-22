import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { sanitizeAppConfigForBackup, sanitizeSnapshotForBackup } from '@/lib/backupPersistence';

const EXPORT_CHUNK_SIZE = 100;
const BACKUP_SCHEMA_VERSION = '2.0';

interface ExportChunkDelegate {
  findMany: (_args: {
    take: number;
    orderBy: { id: 'asc' };
    cursor?: { id: string };
    skip?: number;
  }) => Promise<Record<string, unknown>[]>;
}

interface ModelExportConfig {
  key: string;
  fetchChunks: (cursor?: string) => Promise<Record<string, unknown>[]>;
  sanitize?: (item: Record<string, unknown>) => Record<string, unknown>;
}

function createChunkFetcher(
  delegate: ExportChunkDelegate,
): (_cursor?: string) => Promise<Record<string, unknown>[]> {
  return (cursor) =>
    delegate.findMany({
      take: EXPORT_CHUNK_SIZE,
      orderBy: { id: 'asc' },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
}

export const GET = withApiMiddleware(async (_request: NextRequest) => {
  const models: ModelExportConfig[] = [
    {
      key: 'appConfig',
      fetchChunks: createChunkFetcher(prisma.appConfig),
      sanitize: sanitizeAppConfigForBackup,
    },
    { key: 'contentNode', fetchChunks: createChunkFetcher(prisma.contentNode) },
    { key: 'media', fetchChunks: createChunkFetcher(prisma.media) },
    { key: 'seatingTable', fetchChunks: createChunkFetcher(prisma.seatingTable) },
    { key: 'invitationCode', fetchChunks: createChunkFetcher(prisma.invitationCode) },
    { key: 'weddingPartyMember', fetchChunks: createChunkFetcher(prisma.weddingPartyMember) },
    { key: 'attraction', fetchChunks: createChunkFetcher(prisma.attraction) },
    { key: 'registryItem', fetchChunks: createChunkFetcher(prisma.registryItem) },
    { key: 'contributor', fetchChunks: createChunkFetcher(prisma.contributor) },
    { key: 'subEvent', fetchChunks: createChunkFetcher(prisma.subEvent) },
    { key: 'subEventAccess', fetchChunks: createChunkFetcher(prisma.subEventAccess) },
    { key: 'subEventRsvp', fetchChunks: createChunkFetcher(prisma.subEventRsvp) },
    { key: 'broadcastMessage', fetchChunks: createChunkFetcher(prisma.broadcastMessage) },
    { key: 'broadcastRecipient', fetchChunks: createChunkFetcher(prisma.broadcastRecipient) },
    {
      key: 'snapshotVersion',
      fetchChunks: createChunkFetcher(prisma.snapshotVersion),
      sanitize: sanitizeSnapshotForBackup,
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
