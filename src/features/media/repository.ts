import { prisma } from '@/lib/prisma';
import { MediaDTO, MediaSchema } from './schemas';
import { executeInTransaction } from '@/lib/transaction';
import { createAuditSnapshot } from '@/lib/audit';
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
}

export const mediaRepository = new MediaRepository();
