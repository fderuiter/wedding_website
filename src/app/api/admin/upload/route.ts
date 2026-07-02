import { NextRequest, NextResponse } from 'next/server';
import { DynamicSchema } from '@/utils/validation';
import { writeFile } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';

export const POST = withApiMiddleware(async (req: NextRequest) => {
  const formData = await req.formData();
  DynamicSchema.safeParse(formData);
  const file = formData.get('file') as File | null;

  if (!file) {
    throw new ApiError(400, 'No file provided');
  }

  if (file.size > 5 * 1024 * 1024) {
    throw new ApiError(400, 'File size exceeds 5MB limit');
  }

  const validTypes = ['image/jpeg', 'image/png', 'image/x-icon', 'image/vnd.microsoft.icon'];
  if (!validTypes.includes(file.type)) {
    throw new ApiError(400, 'Invalid file format. Only JPG, PNG, and ICO are supported');
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const hash = crypto.randomBytes(8).toString('hex');
  const ext = file.name.substring(file.name.lastIndexOf('.'));
  const filename = `${hash}${ext}`;
  
  const filePath = path.join(process.cwd(), 'public', 'uploads', filename);
  await writeFile(filePath, buffer);

  return NextResponse.json({ url: `/uploads/${filename}` });
});
