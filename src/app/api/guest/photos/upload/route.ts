import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { GuestPhotoUploadSchema } from '@/utils/validation';
import { getStorageProvider } from '@/utils/storage';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { sanitizeImage } from '@/utils/imageProcessor';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { mediaRepository } from '@/features/media';
import { contentRepository } from '@/features/content';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';

const BATCH_SANITIZE_CONCURRENCY = 4;
const BATCH_PERSIST_CONCURRENCY = 4;

interface GuestPhotoUploadResponseItem {
  id: string;
  url?: string;
  altText: string | null;
  title: string;
  uploaderName?: string;
  caption?: string;
  originalFilename?: string;
  createdAt?: string | Date;
  nodeId: string;
  status: 'APPROVED' | 'PENDING';
  isVisible: boolean;
  message: string;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (_item: T, _index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let aborted = false;

  const runWorker = async (): Promise<void> => {
    while (!aborted) {
      const currentIndex = nextIndex++;
      if (currentIndex >= items.length) {
        return;
      }
      try {
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      } catch (err) {
        aborted = true;
        throw err;
      }
    }
  };

  await Promise.all(Array.from({ length: limit }, () => runWorker()));
  return results;
}

export const POST = withApiMiddleware(async (req: NextRequest) => {
  const config = await getAppConfig();
  if (!isFeatureEnabled('gallery', config.modules)) {
    throw new ApiError(404, "Feature 'gallery' is disabled");
  }

  const formData = await req.formData();
  let rawFiles: any[] = [];
  if (typeof formData.getAll === 'function') {
    const filesList = formData.getAll('files');
    const singleFileList = formData.getAll('file');
    rawFiles = [...filesList, ...singleFileList].filter(Boolean);
  } else if (typeof formData.get === 'function') {
    const f = formData.get('files') ?? formData.get('file');
    if (f) rawFiles = [f];
  }

  const rawUploaderName = typeof formData.get === 'function' ? formData.get('uploaderName') : undefined;
  const rawCaption = typeof formData.get === 'function' ? formData.get('caption') : undefined;
  let rawCaptions: unknown[] = [];
  if (typeof formData.getAll === 'function') {
    rawCaptions = formData.getAll('captions');
  } else if (typeof formData.get === 'function') {
    const singleCaptionsEntry = formData.get('captions');
    if (singleCaptionsEntry !== null && singleCaptionsEntry !== undefined) {
      rawCaptions = [singleCaptionsEntry];
    }
  }

  const parsed = GuestPhotoUploadSchema.safeParse({
    files: rawFiles,
    uploaderName: rawUploaderName,
    caption: rawCaption,
    ...(rawCaptions.length > 0 ? { captions: rawCaptions } : {}),
  });
  if (!parsed.success) {
    const errorMessage = parsed.error.issues[0]?.message || 'Validation failed';
    throw new ApiError(400, errorMessage);
  }

  const files = parsed.data.files as File[];
  let sessionUploaderName: string | undefined;
  if (!parsed.data.uploaderName) {
    try {
      const inviteSession = await getGuestInviteSession(req);
      sessionUploaderName = inviteSession?.guestName?.trim() || undefined;
    } catch {
      sessionUploaderName = undefined;
    }
  }
  const uploaderName = parsed.data.uploaderName || sessionUploaderName;
  const fallbackCaption = parsed.data.caption;
  const perFileCaptions = parsed.data.captions;
  const actorName = uploaderName || 'Guest';
  const autoApprove = Boolean(config.autoApproveGuestPhotos);
  const photoStatus = autoApprove ? 'APPROVED' : 'PENDING';
  const photoVisible = autoApprove;
  const statusMessage = autoApprove
    ? 'Photo uploaded and published live to the gallery!'
    : 'Photo submitted successfully. It will be reviewed by the couple before appearing in the gallery.';

  const sanitizedBatch = await mapWithConcurrency(
    files,
    BATCH_SANITIZE_CONCURRENCY,
    async (file, index) => {
      const indexedCaption =
        perFileCaptions && index < perFileCaptions.length
          ? perFileCaptions[index]?.trim() || undefined
          : undefined;
      return {
        originalFilename: file.name || undefined,
        itemCaption: indexedCaption ?? fallbackCaption,
        sanitizedFile: await sanitizeImage(file),
      };
    }
  );

  const storage = getStorageProvider();
  const uploadedPhotos: GuestPhotoUploadResponseItem[] = await mapWithConcurrency(
    sanitizedBatch,
    BATCH_PERSIST_CONCURRENCY,
    async ({ originalFilename, itemCaption, sanitizedFile }) => {
      const publicTitle =
        itemCaption || (uploaderName ? `Photo by ${uploaderName}` : 'Guest Photo');
      const storageResult = await storage.upload(sanitizedFile, { folder: 'uploads/photos' });

      // Record in Media table
      const media = await mediaRepository.createMedia({
        url: storageResult.url,
        altText: publicTitle,
        isDecorative: false,
      }, actorName);

      // Record as ContentNode of type 'Photo' for public gallery feeds
      const photoNode = await contentRepository.createNode({
        type: 'Photo',
        tags: ['gallery', 'guest-upload'],
        data: {
          url: storageResult.url,
          ...(autoApprove
            ? { isVisible: true, status: 'APPROVED' as const }
            : { isVisible: false, status: 'PENDING' as const }),
          title: publicTitle,
          altText: publicTitle,
          mediaId: media.id,
          ...(uploaderName ? { uploaderName } : {}),
          ...(itemCaption ? { caption: itemCaption } : {}),
          ...(originalFilename ? { originalFilename } : {}),
        },
      }, actorName);

      return {
        id: media.id,
        ...(autoApprove ? { url: storageResult.url } : {}),
        altText: media.altText,
        title: publicTitle,
        ...(uploaderName ? { uploaderName } : {}),
        ...(itemCaption ? { caption: itemCaption } : {}),
        ...(originalFilename ? { originalFilename } : {}),
        createdAt: media.createdAt,
        nodeId: photoNode.id,
        status: photoStatus,
        isVisible: photoVisible,
        message: statusMessage,
      };
    }
  );

  if (autoApprove && uploadedPhotos.length > 0) {
    try {
      revalidatePath('/photos');
      revalidatePath('/photos/slideshow');
    } catch {
      // Ignore outside Next.js request context (e.g. unit tests)
    }
  }

  return NextResponse.json(
    {
      success: true,
      data: uploadedPhotos,
    },
    { status: 201 }
  );
}, { limit: 15, ipLimit: 20, windowMs: 60 * 1000, keyPrefix: 'guest-photo-upload' });
