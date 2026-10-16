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
  const fileData = formData.get('file');

  const parsed = GuestPhotoUploadSchema.safeParse({ file: fileData });
  if (!parsed.success) {
    const errorMessage = parsed.error.issues[0]?.message || 'Validation failed';
    throw new ApiError(400, errorMessage);
  }

  const file = parsed.data.file as File;
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
      isVisible: true,
      title: file.name || 'Guest Photo',
    },
  }, 'Guest');

  return NextResponse.json(
    {
      success: true,
      data: {
        id: media.id,
        url: storageResult.url,
        altText: media.altText,
        createdAt: media.createdAt,
        nodeId: photoNode.id,
      },
    },
    { status: 201 }
  );
});
