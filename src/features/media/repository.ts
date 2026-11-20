import { prisma } from '@/lib/prisma';
import { MediaDTO, MediaSchema } from './schemas';
import { executeInTransaction } from '@/lib/transaction';
import { createAuditSnapshot } from '@/lib/audit';

export interface MediaPaginationOptions {
  page?: number;
  limit?: number;
}

export interface PaginatedMediaResult {
  data: MediaDTO[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

type MediaWriteInput = Omit<MediaDTO, 'id' | 'createdAt' | 'updatedAt' | 'isSample'> & {
  isSample?: boolean;
  publishToGallery?: boolean;
};

function buildGalleryPhotoData(
  media: { id: string; url: string; altText: string | null; isDecorative: boolean },
  existingData?: Record<string, any>
) {
  const effectiveLabel = !media.isDecorative && media.altText ? media.altText : undefined;
  return {
    ...(existingData || {}),
    url: media.url,
    title: effectiveLabel ?? (media.isDecorative ? undefined : existingData?.title),
    altText: effectiveLabel,
    status: 'APPROVED' as const,
    isVisible: true,
    mediaId: media.id,
    publishToGallery: true,
  };
}

function isNodePublishedToGallery(nodeData: Record<string, any> | null | undefined): boolean {
  if (!nodeData) return false;
  if (nodeData.status === 'PENDING' || nodeData.status === 'REJECTED') {
    return false;
  }
  return nodeData.isVisible !== false;
}

export class MediaRepository {
  constructor(public client: any = prisma) {}

  async getAllMedia(options: MediaPaginationOptions = {}): Promise<PaginatedMediaResult> {
    let page = Math.floor(Number(options.page));
    if (isNaN(page) || page < 1) {
      page = 1;
    }

    let limit = Math.floor(Number(options.limit));
    if (isNaN(limit) || limit < 1) {
      limit = 20;
    }
    if (limit > 100) {
      limit = 100;
    }

    const skip = (page - 1) * limit;
    const take = limit;

    const [total, mediaList] = await Promise.all([
      this.client.media.count(),
      this.client.media.findMany({
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const publishedMediaIds = new Set<string>();
    if (mediaList.length > 0 && typeof this.client.contentNode?.findMany === 'function') {
      const linkedNodes = await this.client.contentNode.findMany({
        where: {
          type: 'Photo',
          OR: mediaList.map((m: { id: string }) => ({
            data: {
              path: ['mediaId'],
              equals: m.id,
            },
          })),
        },
        select: { data: true },
      });

      for (const node of linkedNodes) {
        const nodeData = node.data as Record<string, any> | null;
        if (nodeData?.mediaId && isNodePublishedToGallery(nodeData)) {
          publishedMediaIds.add(String(nodeData.mediaId));
        }
      }
    }

    const hasContentNodeLookup = typeof this.client.contentNode?.findMany === 'function';
    const data = mediaList.map((m: any) =>
      MediaSchema.parse({
        ...m,
        ...(hasContentNodeLookup ? { publishToGallery: publishedMediaIds.has(m.id) } : {}),
      })
    );
    const totalPages = total > 0 ? Math.ceil(total / limit) : 0;

    return {
      data,
      total,
      page,
      limit,
      totalPages,
    };
  }

  async createMedia(data: MediaWriteInput, author: string = 'System') {
    const { publishToGallery, ...mediaData } = data;
    return executeInTransaction(this.client, async (tx) => {
      const media = await tx.media.create({ data: mediaData });
      await createAuditSnapshot('Media', media.id, media, author, tx);

      if (publishToGallery === true && tx.contentNode?.create) {
        const photoNode = await tx.contentNode.create({
          data: {
            type: 'Photo',
            tags: ['gallery', 'curated'],
            data: buildGalleryPhotoData(media),
          },
        });
        await createAuditSnapshot('ContentNode:Photo', photoNode.id, photoNode, author, tx);
      }

      return MediaSchema.parse({
        ...media,
        ...(publishToGallery !== undefined ? { publishToGallery } : {}),
      });
    });
  }

  async updateMedia(id: string, data: Partial<MediaWriteInput>, author: string = 'System') {
    const { publishToGallery, ...mediaData } = data;
    return executeInTransaction(this.client, async (tx) => {
      const media =
        Object.keys(mediaData).length > 0
          ? await tx.media.update({ where: { id }, data: mediaData })
          : await tx.media.findUniqueOrThrow({ where: { id } });
      await createAuditSnapshot('Media', id, media, author, tx);

      let resolvedPublishState = publishToGallery;

      if (tx.contentNode?.findMany) {
        const linkedNodes = await tx.contentNode.findMany({
          where: {
            type: 'Photo',
            data: {
              path: ['mediaId'],
              equals: id,
            },
          },
        });

        if (publishToGallery === true) {
          if (linkedNodes.length === 0) {
            const createdNode = await tx.contentNode.create({
              data: {
                type: 'Photo',
                tags: ['gallery', 'curated'],
                data: buildGalleryPhotoData(media),
              },
            });
            await createAuditSnapshot('ContentNode:Photo', createdNode.id, createdNode, author, tx);
          } else {
            for (const existingNode of linkedNodes) {
              const existingTags = Array.isArray(existingNode.tags) ? existingNode.tags : [];
              const nextTags = existingTags.includes('gallery')
                ? existingTags
                : ['gallery', ...existingTags];
              const updatedNode = await tx.contentNode.update({
                where: { id: existingNode.id },
                data: {
                  tags: nextTags,
                  data: buildGalleryPhotoData(media, (existingNode.data as Record<string, any>) || {}),
                },
              });
              await createAuditSnapshot('ContentNode:Photo', updatedNode.id, updatedNode, author, tx);
            }
          }
        } else if (publishToGallery === false) {
          for (const existingNode of linkedNodes) {
            await tx.contentNode.delete({ where: { id: existingNode.id } });
            await createAuditSnapshot(
              'ContentNode:Photo',
              existingNode.id,
              { deleted: true, ...existingNode },
              author,
              tx
            );
          }
        } else if (linkedNodes.length > 0) {
          resolvedPublishState = linkedNodes.some((n: any) =>
            isNodePublishedToGallery(n.data as Record<string, any> | null)
          );
          for (const existingNode of linkedNodes) {
            const existingData = (existingNode.data as Record<string, any>) || {};
            const effectiveLabel = !media.isDecorative && media.altText ? media.altText : undefined;
            const syncedData = {
              ...existingData,
              url: media.url,
              altText: effectiveLabel,
              ...(effectiveLabel !== undefined
                ? { title: effectiveLabel }
                : media.isDecorative
                  ? { title: undefined }
                  : {}),
            };
            const updatedNode = await tx.contentNode.update({
              where: { id: existingNode.id },
              data: { data: syncedData },
            });
            await createAuditSnapshot('ContentNode:Photo', updatedNode.id, updatedNode, author, tx);
          }
        }
      }

      return MediaSchema.parse({
        ...media,
        ...(resolvedPublishState !== undefined ? { publishToGallery: resolvedPublishState } : {}),
      });
    });
  }

  async deleteMedia(id: string, author: string = 'System') {
    return executeInTransaction(this.client, async (tx) => {
      if (tx.contentNode?.findMany) {
        const linkedNodes = await tx.contentNode.findMany({
          where: {
            type: 'Photo',
            data: {
              path: ['mediaId'],
              equals: id,
            },
          },
        });
        for (const node of linkedNodes) {
          await tx.contentNode.delete({ where: { id: node.id } });
          await createAuditSnapshot(
            'ContentNode:Photo',
            node.id,
            { deleted: true, ...node },
            author,
            tx
          );
        }
      }

      const media = await tx.media.delete({ where: { id } });
      await createAuditSnapshot('Media', id, { deleted: true, ...media }, author, tx);
      return MediaSchema.parse(media);
    });
  }
}

export const mediaRepository = new MediaRepository();
