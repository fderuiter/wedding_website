import { NextRequest, NextResponse } from 'next/server';
import { writeFile } from 'fs/promises';
import path from 'path';
import { verifyAdminToken } from '@/utils/adminAuth.server';
import crypto from 'crypto';

/**
 * Handle an authenticated file upload, validate and store the file, and return its public URL.
 *
 * On success, responds with a JSON object containing the uploaded file's public URL.
 * On failure, responds with a JSON error object and an appropriate HTTP status:
 * - 401 if the admin authentication token is missing or invalid
 * - 400 for missing file, file too large (> 5 MB), or unsupported MIME type
 * - 500 for unexpected server errors during processing
 *
 * @returns A NextResponse with `{ url: '/uploads/<filename>' }` on success; otherwise a NextResponse with `{ error: string }` and the corresponding HTTP status code.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('admin_auth')?.value;
  if (!token || !(await verifyAdminToken(token))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'File size exceeds 5MB limit' }, { status: 400 });
    }

    const validTypes = ['image/jpeg', 'image/png', 'image/x-icon', 'image/vnd.microsoft.icon'];
    if (!validTypes.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid file format. Only JPG, PNG, and ICO are supported' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    
    // Generate unique filename to avoid caching issues and collisions
    const hash = crypto.randomBytes(8).toString('hex');
    const ext = file.name.substring(file.name.lastIndexOf('.'));
    const filename = `${hash}${ext}`;
    
    const filePath = path.join(process.cwd(), 'public', 'uploads', filename);
    await writeFile(filePath, buffer);

    return NextResponse.json({ url: `/uploads/${filename}` });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
