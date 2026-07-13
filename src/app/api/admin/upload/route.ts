import { NextRequest, NextResponse } from 'next/server';
import { AdminUploadSchema } from '@/utils/validation';
import { writeFile } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';

export const POST = withApiMiddleware(async (req: NextRequest) => {
  const formData = await req.formData();
  const fileData = formData.get('file');
  
  const parsed = AdminUploadSchema.safeParse({ file: fileData });
  if (!parsed.success) {
    const errorMessage = parsed.error.issues[0]?.message || 'Validation failed';
    throw new ApiError(400, errorMessage);
  }

  const file = parsed.data.file as File;

  const buffer = Buffer.from(await file.arrayBuffer());
  const hash = crypto.randomBytes(8).toString('hex');
  const ext = file.name.substring(file.name.lastIndexOf('.'));
  const filename = `${hash}${ext}`;
  
  const filePath = path.join(process.cwd(), 'public', 'uploads', filename);
  await writeFile(filePath, buffer);

  return NextResponse.json({ url: `/uploads/${filename}` });
});
