import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { toPublicAppConfig } from '@/lib/config';

export const EXPORT_CHUNK_SIZE = 100;

interface ModelExportConfig {
  key: string;
  fetchChunks: (cursor?: string) => Promise<any[]>;
  sanitize?: (item: any) => any;
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
      sanitize: (config) => toPublicAppConfig(config),
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
      key: 'snapshotVersion',
      fetchChunks: (cursor) =>
        prisma.snapshotVersion.findMany({
          take: EXPORT_CHUNK_SIZE,
          orderBy: { id: 'asc' },
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
    },
  ];

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      try {
        const headerJson = `{"version":"1.0","schemaVersion":"1.0","exportedAt":${JSON.stringify(
          new Date().toISOString()
        )}`;
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
            if (!lastId || lastId === cursor) {
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
