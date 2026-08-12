import { NextRequest, NextResponse } from 'next/server';
import { AdminUploadSchema } from '@/utils/validation';
import { getStorageProvider } from '@/utils/storage';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { sanitizeImage } from '@/utils/imageProcessor';

export const POST = withApiMiddleware(async (req: NextRequest) => {
  const formData = await req.formData();
  const fileData = formData.get('file');
  
  const parsed = AdminUploadSchema.safeParse({ file: fileData });
  if (!parsed.success) {
    const errorMessage = parsed.error.issues[0]?.message || 'Validation failed';
    throw new ApiError(400, errorMessage);
  }

  const file = parsed.data.file as File;
  const sanitizedFile = await sanitizeImage(file);

  const result = await getStorageProvider().uploadFile(sanitizedFile);

  return NextResponse.json({ url: result.url });
});
