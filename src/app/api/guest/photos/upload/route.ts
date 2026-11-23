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
  const autoApprove = Boolean(config.autoApproveGuestPhotos);
  const photoStatus = autoApprove ? 'APPROVED' : 'PENDING';
  const photoVisible = autoApprove;
  const statusMessage = autoApprove
    ? 'Photo uploaded and published live to the gallery!'
    : 'Photo submitted successfully. It will be reviewed by the couple before appearing in the gallery.';
  const uploadedPhotos = [];

  for (const file of files) {
    const originalFilename = file.name || undefined;
    const sanitizedFile = await sanitizeImage(file);

    const storageResult = await getStorageProvider().upload(sanitizedFile, { folder: 'uploads/photos' });

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
        ...(caption ? { caption } : {}),
        ...(originalFilename ? { originalFilename } : {}),
      },
    }, actorName);

    uploadedPhotos.push({
      id: media.id,
      url: storageResult.url,
      altText: media.altText,
      title: publicTitle,
      ...(uploaderName ? { uploaderName } : {}),
      ...(caption ? { caption } : {}),
      ...(originalFilename ? { originalFilename } : {}),
      createdAt: media.createdAt,
      nodeId: photoNode.id,
      status: photoStatus,
      isVisible: photoVisible,
      message: statusMessage,
    });
  }

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
}, { limit: 15, windowMs: 60 * 1000, keyPrefix: 'guest-photo-upload' });
