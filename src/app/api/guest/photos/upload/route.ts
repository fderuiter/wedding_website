import { NextRequest, NextResponse } from 'next/server';
import { GuestPhotoUploadSchema } from '@/utils/validation';
import { getStorageProvider } from '@/utils/storage';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { sanitizeImage } from '@/utils/imageProcessor';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { mediaRepository } from '@/features/media';
import { contentRepository } from '@/features/content';

const BATCH_SANITIZE_CONCURRENCY = 4;
const BATCH_PERSIST_CONCURRENCY = 4;

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

  const parsed = GuestPhotoUploadSchema.safeParse({
    files: rawFiles,
    uploaderName: rawUploaderName,
    caption: rawCaption,
  });
  if (!parsed.success) {
    const errorMessage = parsed.error.issues[0]?.message || 'Validation failed';
    throw new ApiError(400, errorMessage);
  }

  const files = parsed.data.files as File[];
  const uploaderName = parsed.data.uploaderName;
  const caption = parsed.data.caption;
  const publicTitle = caption || (uploaderName ? `Photo by ${uploaderName}` : 'Guest Photo');
  const actorName = uploaderName || 'Guest';

  const sanitizedBatch = await mapWithConcurrency(
    files,
    BATCH_SANITIZE_CONCURRENCY,
    async (file) => ({
      originalFilename: file.name || undefined,
      sanitizedFile: await sanitizeImage(file),
    })
  );

  const storage = getStorageProvider();
  const uploadedPhotos = await mapWithConcurrency(
    sanitizedBatch,
    BATCH_PERSIST_CONCURRENCY,
    async ({ originalFilename, sanitizedFile }) => {
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
          isVisible: false,
          status: 'PENDING',
          title: publicTitle,
          altText: publicTitle,
          mediaId: media.id,
          ...(uploaderName ? { uploaderName } : {}),
          ...(caption ? { caption } : {}),
          ...(originalFilename ? { originalFilename } : {}),
        },
      }, actorName);

      return {
        id: media.id,
        url: storageResult.url,
        altText: media.altText,
        title: publicTitle,
        ...(uploaderName ? { uploaderName } : {}),
        ...(caption ? { caption } : {}),
        ...(originalFilename ? { originalFilename } : {}),
        createdAt: media.createdAt,
        nodeId: photoNode.id,
        status: 'PENDING',
        isVisible: false,
        message: 'Photo submitted successfully. It will be reviewed by the couple before appearing in the gallery.',
      };
    }
  );

  return NextResponse.json(
    {
      success: true,
      data: uploadedPhotos,
    },
    { status: 201 }
  );
});
