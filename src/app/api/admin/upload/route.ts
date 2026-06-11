import { NextRequest, NextResponse } from 'next/server';
import { writeFile } from 'fs/promises';
import path from 'path';
import { verifyAdminToken } from '@/utils/adminAuth.server';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
  const token = req.cookies.get('admin_auth')?.value;
  let isAuthorized = false;

  if (token) {
    const payload = await verifyAdminToken(token);
    if (payload && payload.isAdmin === true) {
      const now = Date.now();
      let valid = true;
      if (payload.iat && payload.iat > now) valid = false;
      if (payload.exp && payload.exp < now) valid = false;
      if (!payload.exp && payload.iat && payload.iat + 60 * 60 * 8 * 1000 < now) valid = false;
      isAuthorized = valid;
    }
  }

  if (!isAuthorized) {
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
