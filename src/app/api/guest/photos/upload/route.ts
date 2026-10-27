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

  const parsed = GuestPhotoUploadSchema.safeParse({ files: rawFiles });
  if (!parsed.success) {
    const errorMessage = parsed.error.issues[0]?.message || 'Validation failed';
    throw new ApiError(400, errorMessage);
  }

  const files = parsed.data.files as File[];
  const uploadedPhotos = [];

  for (const file of files) {
    const sanitizedFile = await sanitizeImage(file);

    const storageResult = await getStorageProvider().upload(sanitizedFile, { folder: 'uploads/photos' });

    // Record in Media table
    const media = await mediaRepository.createMedia({
      url: storageResult.url,
      altText: file.name || 'Guest Photo',
      isDecorative: false,
    }, 'Guest');

    // Record as ContentNode of type 'Photo' for public gallery feeds
    const photoNode = await contentRepository.createNode({
      type: 'Photo',
      tags: ['gallery', 'guest-upload'],
      data: {
        url: storageResult.url,
        isVisible: false,
        status: 'PENDING',
        title: file.name || 'Guest Photo',
        mediaId: media.id,
      },
    }, 'Guest');

    uploadedPhotos.push({
      id: media.id,
      url: storageResult.url,
      altText: media.altText,
      createdAt: media.createdAt,
      nodeId: photoNode.id,
      status: 'PENDING',
      isVisible: false,
      message: 'Photo submitted successfully. It will be reviewed by the couple before appearing in the gallery.',
    });
  }

  return NextResponse.json(
    {
      success: true,
      data: uploadedPhotos,
    },
    { status: 201 }
  );
});
