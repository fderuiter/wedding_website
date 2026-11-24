import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { qualifyPostgresTable } from '@/lib/postgres-url.js';
import { MediaDTO, MediaSchema } from './schemas';
import { executeInTransaction } from '@/lib/transaction';
import { createAuditSnapshot, createBatchAuditSnapshots } from '@/lib/audit';
import { buildArchetypeSeedData, isStaticExportBuild } from '@/lib/sampleData/builder';
import { logger } from '@/lib/logger';

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

type MediaWriteInput = Omit<
  MediaDTO,
  'id' | 'createdAt' | 'updatedAt' | 'isSample' | 'caption' | 'uploaderName'
> & {
  isSample?: boolean;
  publishToGallery?: boolean;
  caption?: string;
  uploaderName?: string;
};

interface PhotoMetadataOverrides {
  caption?: string;
  uploaderName?: string;
}

function applyPhotoMetadataOverrides(
  baseData: Record<string, any>,
  overrides?: PhotoMetadataOverrides
): Record<string, any> {
  const next = { ...baseData };
  if (!overrides) {
    return next;
  }
  if (overrides.caption !== undefined) {
    const trimmed = overrides.caption.trim();
    if (trimmed) {
      next.caption = trimmed;
    } else {
      delete next.caption;
    }
  }
  if (overrides.uploaderName !== undefined) {
    const trimmed = overrides.uploaderName.trim();
    if (trimmed) {
      next.uploaderName = trimmed;
    } else {
      delete next.uploaderName;
    }
  }
  return next;
}

function buildGalleryPhotoData(
  media: { id: string; url: string; altText: string | null; isDecorative: boolean },
  existingData?: Record<string, any>,
  overrides?: PhotoMetadataOverrides
): Record<string, any> {
  const withMetadata = applyPhotoMetadataOverrides(existingData || {}, overrides);
  const effectiveCaption =
    typeof withMetadata.caption === 'string' && withMetadata.caption.trim()
      ? withMetadata.caption.trim()
      : undefined;
  const effectiveUploader =
    typeof withMetadata.uploaderName === 'string' && withMetadata.uploaderName.trim()
      ? withMetadata.uploaderName.trim()
      : undefined;
  const effectiveLabel = !media.isDecorative && media.altText ? media.altText : undefined;
  const fallbackGuestLabel =
    effectiveCaption || (effectiveUploader ? `Photo by ${effectiveUploader}` : undefined);

  return {
    ...withMetadata,
    url: media.url,
    title:
      effectiveLabel ??
      (media.isDecorative ? undefined : fallbackGuestLabel ?? withMetadata.title),
    altText: effectiveLabel ?? (media.isDecorative ? undefined : fallbackGuestLabel),
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

function isManagedStorageAssetUrl(rawUrl: string | null | undefined): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return false;
  }
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.startsWith('data:')) {
    return false;
  }
  if (trimmed.startsWith('/uploads/') || trimmed.startsWith('uploads/')) {
    return true;
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.pathname.startsWith('/uploads/')) {
        return true;
      }
      const s3PublicUrl = process.env.S3_PUBLIC_URL?.trim().replace(/\/$/, '');
      if (s3PublicUrl && (trimmed === s3PublicUrl || trimmed.startsWith(`${s3PublicUrl}/`))) {
        return true;
      }
      const s3Bucket = process.env.S3_BUCKET?.trim();
      if (s3Bucket) {
        if (
          parsed.hostname.toLowerCase().startsWith(`${s3Bucket.toLowerCase()}.`) ||
          parsed.pathname.startsWith(`/${s3Bucket}/`)
        ) {
          return true;
        }
      }
      const s3Endpoint = process.env.S3_ENDPOINT?.trim().replace(/\/$/, '');
      if (s3Endpoint && trimmed.startsWith(`${s3Endpoint}/`)) {
        return true;
      }
    } catch {
      return false;
    }
  }
  return false;
}

const STORAGE_DELETE_CONCURRENCY = 8;

interface DeleteMediaBatchOptions {
  tx?: any;
  skipLinkedNodeCleanup?: boolean;
  skipStorageCleanup?: boolean;
}

function normalizeRawRecordDates<T extends Record<string, any>>(record: T): T {
  if (!record || typeof record !== 'object') {
    return record;
  }
  return {
    ...record,
    ...(record.createdAt !== undefined && !(record.createdAt instanceof Date)
      ? { createdAt: new Date(record.createdAt) }
      : {}),
    ...(record.updatedAt !== undefined && !(record.updatedAt instanceof Date)
      ? { updatedAt: new Date(record.updatedAt) }
      : {}),
  };
}

export async function unlinkManagedStorageUrls(
  urls: Iterable<string | null | undefined>,
  logContext: string = 'MediaRepository.deleteMediaBatch'
): Promise<void> {
  const uniqueUrls: string[] = [];
  const seen = new Set<string>();
  for (const rawUrl of urls) {
    if (typeof rawUrl !== 'string') {
      continue;
    }
    const trimmed = rawUrl.trim();
    if (!trimmed || seen.has(trimmed) || !isManagedStorageAssetUrl(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    uniqueUrls.push(trimmed);
  }

  if (uniqueUrls.length === 0) {
    return;
  }

  let storageProvider: Awaited<ReturnType<typeof import('@/utils/storage')['getStorageProvider']>>;
  try {
    const { getStorageProvider } = await import('@/utils/storage');
    storageProvider = getStorageProvider();
  } catch (err) {
    logger.warn(`[${logContext}] Storage provider initialization failed after DB commit`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const workerCount = Math.min(STORAGE_DELETE_CONCURRENCY, uniqueUrls.length);
  let cursor = 0;

  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < uniqueUrls.length) {
      const index = cursor;
      cursor += 1;
      const url = uniqueUrls[index]!;
      try {
        await storageProvider.delete(url);
      } catch (err) {
        logger.warn(`[${logContext}] Storage cleanup failed after DB commit`, {
          url,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  });

  await Promise.all(workers);
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

    if (isStaticExportBuild()) {
      const seedMedia = buildArchetypeSeedData('classic').media;
      const total = seedMedia.length;
      const data = seedMedia
        .slice(skip, skip + take)
        .map((item) => MediaSchema.parse(item));
      const totalPages = total > 0 ? Math.ceil(total / limit) : 0;
      return {
        data,
        total,
        page,
        limit,
        totalPages,
      };
    }

    const [total, mediaList] = await Promise.all([
      this.client.media.count(),
      this.client.media.findMany({
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const publishedMediaIds = new Set<string>();
    const metadataByMediaId = new Map<string, { caption?: string; uploaderName?: string }>();
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
        if (nodeData?.mediaId) {
          const mediaIdStr = String(nodeData.mediaId);
          if (isNodePublishedToGallery(nodeData)) {
            publishedMediaIds.add(mediaIdStr);
          }
          const caption =
            typeof nodeData.caption === 'string' && nodeData.caption.trim()
              ? nodeData.caption.trim()
              : undefined;
          const uploaderName =
            typeof nodeData.uploaderName === 'string' && nodeData.uploaderName.trim()
              ? nodeData.uploaderName.trim()
              : undefined;
          if (caption || uploaderName) {
            metadataByMediaId.set(mediaIdStr, { caption, uploaderName });
          }
        }
      }
    }

    const hasContentNodeLookup = typeof this.client.contentNode?.findMany === 'function';
    const data = mediaList.map((m: any) => {
      const photoMeta = metadataByMediaId.get(m.id);
      return MediaSchema.parse({
        ...m,
        ...(hasContentNodeLookup ? { publishToGallery: publishedMediaIds.has(m.id) } : {}),
        ...(photoMeta?.caption ? { caption: photoMeta.caption } : {}),
        ...(photoMeta?.uploaderName ? { uploaderName: photoMeta.uploaderName } : {}),
      });
    });
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
    const { publishToGallery, caption, uploaderName, ...mediaData } = data;
    const trimmedCaption = caption?.trim() || undefined;
    const trimmedUploader = uploaderName?.trim() || undefined;

    return executeInTransaction(this.client, async (tx) => {
      const media = await tx.media.create({ data: mediaData });
      await createAuditSnapshot('Media', media.id, media, author, tx);

      if (publishToGallery === true && tx.contentNode?.create) {
        const photoNode = await tx.contentNode.create({
          data: {
            type: 'Photo',
            tags: ['gallery', 'curated'],
            data: buildGalleryPhotoData(media, undefined, { caption, uploaderName }),
          },
        });
        await createAuditSnapshot('ContentNode:Photo', photoNode.id, photoNode, author, tx);
      }

      return MediaSchema.parse({
        ...media,
        ...(publishToGallery !== undefined ? { publishToGallery } : {}),
        ...(trimmedCaption ? { caption: trimmedCaption } : {}),
        ...(trimmedUploader ? { uploaderName: trimmedUploader } : {}),
      });
    });
  }

  async updateMedia(id: string, data: Partial<MediaWriteInput>, author: string = 'System') {
    const { publishToGallery, caption, uploaderName, ...mediaData } = data;
    const hasMetadataOverrides = caption !== undefined || uploaderName !== undefined;

    return executeInTransaction(this.client, async (tx) => {
      let media =
        Object.keys(mediaData).length > 0
          ? await tx.media.update({ where: { id }, data: mediaData })
          : await tx.media.findUniqueOrThrow({ where: { id } });
      await createAuditSnapshot('Media', id, media, author, tx);

      let resolvedPublishState = publishToGallery;
      let resolvedCaption: string | undefined = caption?.trim() || undefined;
      let resolvedUploaderName: string | undefined = uploaderName?.trim() || undefined;

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
                data: buildGalleryPhotoData(media, undefined, { caption, uploaderName }),
              },
            });
            await createAuditSnapshot('ContentNode:Photo', createdNode.id, createdNode, author, tx);
          } else {
            for (const existingNode of linkedNodes) {
              const existingData = (existingNode.data as Record<string, any>) || {};
              const existingTags = Array.isArray(existingNode.tags) ? existingNode.tags : [];
              const nextTags = existingTags.includes('gallery')
                ? existingTags
                : ['gallery', ...existingTags];

              let mediaForSync = media;
              if (hasMetadataOverrides && !media.isDecorative) {
                const previousAutoLabel =
                  existingData.caption ||
                  (existingData.uploaderName
                    ? `Photo by ${existingData.uploaderName}`
                    : 'Guest Photo');
                const altWasAutoDerived =
                  media.altText === existingData.title || media.altText === previousAutoLabel;
                const callerDidNotChangeAlt =
                  data.altText === undefined || data.altText === existingData.altText;
                if (altWasAutoDerived && callerDidNotChangeAlt) {
                  const nextAutoAlt =
                    caption?.trim() ||
                    (uploaderName?.trim() ? `Photo by ${uploaderName.trim()}` : 'Guest Photo');
                  media = await tx.media.update({
                    where: { id },
                    data: { altText: nextAutoAlt },
                  });
                  mediaForSync = media;
                }
              }

              const nextNodeData = buildGalleryPhotoData(mediaForSync, existingData, {
                caption,
                uploaderName,
              });
              resolvedCaption =
                typeof nextNodeData.caption === 'string' && nextNodeData.caption.trim()
                  ? nextNodeData.caption.trim()
                  : undefined;
              resolvedUploaderName =
                typeof nextNodeData.uploaderName === 'string' && nextNodeData.uploaderName.trim()
                  ? nextNodeData.uploaderName.trim()
                  : undefined;

              const updatedNode = await tx.contentNode.update({
                where: { id: existingNode.id },
                data: {
                  tags: nextTags,
                  data: nextNodeData,
                },
              });
              await createAuditSnapshot('ContentNode:Photo', updatedNode.id, updatedNode, author, tx);
            }
          }
        } else if (publishToGallery === false) {
          resolvedCaption = undefined;
          resolvedUploaderName = undefined;
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
            const withMetadata = applyPhotoMetadataOverrides(
              existingData,
              hasMetadataOverrides ? { caption, uploaderName } : undefined
            );
            const effectiveCaption =
              typeof withMetadata.caption === 'string' && withMetadata.caption.trim()
                ? withMetadata.caption.trim()
                : undefined;
            const effectiveUploader =
              typeof withMetadata.uploaderName === 'string' && withMetadata.uploaderName.trim()
                ? withMetadata.uploaderName.trim()
                : undefined;

            const previousAutoLabel =
              existingData.caption ||
              (existingData.uploaderName ? `Photo by ${existingData.uploaderName}` : 'Guest Photo');
            const altWasAutoDerived =
              media.altText === existingData.title || media.altText === previousAutoLabel;
            const callerDidNotChangeAlt =
              data.altText === undefined || data.altText === existingData.altText;

            if (hasMetadataOverrides && !media.isDecorative && altWasAutoDerived && callerDidNotChangeAlt) {
              const nextAutoAlt =
                effectiveCaption ||
                (effectiveUploader ? `Photo by ${effectiveUploader}` : 'Guest Photo');
              media = await tx.media.update({
                where: { id },
                data: { altText: nextAutoAlt },
              });
            }

            const effectiveLabel = !media.isDecorative && media.altText ? media.altText : undefined;
            const syncedData = {
              ...withMetadata,
              url: media.url,
              altText: effectiveLabel,
              ...(effectiveLabel !== undefined
                ? { title: effectiveLabel }
                : media.isDecorative
                  ? { title: undefined }
                  : {}),
            };
            resolvedCaption = effectiveCaption;
            resolvedUploaderName = effectiveUploader;

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
        ...(resolvedCaption ? { caption: resolvedCaption } : {}),
        ...(resolvedUploaderName ? { uploaderName: resolvedUploaderName } : {}),
      });
    });
  }

  async deleteMedia(id: string, author: string = 'System') {
    const deletedNodeIds: string[] = [];
    const deletedMedia = await executeInTransaction(this.client, async (tx) => {
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
          deletedNodeIds.push(node.id);
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
      const parsedMedia = MediaSchema.parse(media);
      Object.defineProperty(parsedMedia, 'deletedNodeIds', {
        value: deletedNodeIds,
        enumerable: false,
      });
      return parsedMedia;
    });

    if (isManagedStorageAssetUrl(deletedMedia.url)) {
      try {
        const { getStorageProvider } = await import('@/utils/storage');
        await getStorageProvider().delete(deletedMedia.url);
      } catch (err) {
        logger.warn('[MediaRepository.deleteMedia] Storage cleanup failed after DB commit', {
          mediaId: id,
          url: deletedMedia.url,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return deletedMedia;
  }

  async deleteMediaBatch(
    ids: string[],
    author: string = 'System',
    options: DeleteMediaBatchOptions = {}
  ): Promise<MediaDTO[]> {
    const uniqueIds = Array.from(
      new Set((ids || []).filter((id): id is string => typeof id === 'string' && id.length > 0))
    );
    if (uniqueIds.length === 0) {
      return [];
    }

    const runInTx = async (tx: any): Promise<MediaDTO[]> => {
      if (!options.skipLinkedNodeCleanup) {
        let deletedLinkedNodes: any[] = [];
        if (typeof tx.$queryRaw === 'function') {
          const contentNodeTable = Prisma.raw(qualifyPostgresTable('ContentNode'));
          const rawNodes = await tx.$queryRaw(Prisma.sql`
            DELETE FROM ${contentNodeTable}
            WHERE "type" = 'Photo'
              AND ("data"->>'mediaId') = ANY(${uniqueIds}::text[])
            RETURNING "id", "type", "tags", "data", "createdAt", "updatedAt"
          `);
          deletedLinkedNodes = Array.isArray(rawNodes)
            ? rawNodes.map((node) => normalizeRawRecordDates(node))
            : [];
        } else if (typeof tx.contentNode?.findMany === 'function') {
          const linkedNodes = await tx.contentNode.findMany({
            where: {
              type: 'Photo',
              OR: uniqueIds.map((mediaId) => ({
                data: {
                  path: ['mediaId'],
                  equals: mediaId,
                },
              })),
            },
          });
          if (Array.isArray(linkedNodes) && linkedNodes.length > 0) {
            const linkedIds = linkedNodes.map((node: { id: string }) => node.id);
            if (typeof tx.contentNode.deleteMany === 'function') {
              await tx.contentNode.deleteMany({
                where: { id: { in: linkedIds } },
              });
            } else if (typeof tx.contentNode.delete === 'function') {
              for (const linkedId of linkedIds) {
                await tx.contentNode.delete({ where: { id: linkedId } });
              }
            }
            deletedLinkedNodes = linkedNodes;
          }
        }

        if (deletedLinkedNodes.length > 0) {
          await createBatchAuditSnapshots(
            'ContentNode:Photo',
            deletedLinkedNodes.map((node) => ({ deleted: true, ...node })),
            author,
            tx
          );
        }
      }

      let rawDeletedMedia: any[] = [];
      if (typeof tx.$queryRaw === 'function') {
        const mediaTable = Prisma.raw(qualifyPostgresTable('Media'));
        const weddingPartyMemberTable = Prisma.raw(qualifyPostgresTable('WeddingPartyMember'));
        const attractionTable = Prisma.raw(qualifyPostgresTable('Attraction'));
        const registryItemTable = Prisma.raw(qualifyPostgresTable('RegistryItem'));
        const contentNodeTable = Prisma.raw(qualifyPostgresTable('ContentNode'));

        const rows = await tx.$queryRaw(Prisma.sql`
          DELETE FROM ${mediaTable} AS m
          WHERE m."id" = ANY(${uniqueIds}::text[])
            AND NOT EXISTS (
              SELECT 1 FROM ${weddingPartyMemberTable} AS wpm WHERE wpm."photoId" = m."id"
            )
            AND NOT EXISTS (
              SELECT 1 FROM ${attractionTable} AS a WHERE a."imageId" = m."id"
            )
            AND NOT EXISTS (
              SELECT 1 FROM ${registryItemTable} AS ri WHERE ri."imageId" = m."id"
            )
            AND NOT EXISTS (
              SELECT 1 FROM ${contentNodeTable} AS cn
              WHERE cn."type" = 'Photo' AND (cn."data"->>'mediaId') = m."id"
            )
          RETURNING m."id", m."url", m."altText", m."isDecorative", m."isSample", m."createdAt", m."updatedAt"
        `);
        rawDeletedMedia = Array.isArray(rows)
          ? rows.map((row) => normalizeRawRecordDates(row))
          : [];
      } else if (typeof tx.media?.findMany === 'function') {
        const candidateMedia = await tx.media.findMany({
          where: {
            id: { in: uniqueIds },
            weddingPartyMembers: { none: {} },
            attractions: { none: {} },
            registryItems: { none: {} },
          },
        });
        if (Array.isArray(candidateMedia) && candidateMedia.length > 0) {
          const deletableIds = candidateMedia.map((m: { id: string }) => m.id);
          if (typeof tx.media.deleteMany === 'function') {
            await tx.media.deleteMany({
              where: { id: { in: deletableIds } },
            });
          } else if (typeof tx.media.delete === 'function') {
            for (const mediaId of deletableIds) {
              await tx.media.delete({ where: { id: mediaId } });
            }
          }
          rawDeletedMedia = candidateMedia;
        }
      }

      const parsedDeletedMedia = rawDeletedMedia.map((media) => MediaSchema.parse(media));
      if (parsedDeletedMedia.length > 0) {
        await createBatchAuditSnapshots(
          'Media',
          parsedDeletedMedia.map((media) => ({ deleted: true, ...media })),
          author,
          tx
        );
      }

      return parsedDeletedMedia;
    };

    if (options.tx) {
      return await runInTx(options.tx);
    }

    const deletedMedia = await executeInTransaction(this.client, runInTx);
    if (!options.skipStorageCleanup && deletedMedia.length > 0) {
      await unlinkManagedStorageUrls(
        deletedMedia.map((media) => media.url),
        'MediaRepository.deleteMediaBatch'
      );
    }

    return deletedMedia;
  }
}

export const mediaRepository = new MediaRepository();
