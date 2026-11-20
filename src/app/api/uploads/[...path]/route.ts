import { NextRequest, NextResponse } from 'next/server';
import { LocalStorageProvider, type LocalUploadStreamResult } from '@/utils/storage';
import { PathContainmentError } from '@/utils/pathContainment';

export const runtime = 'nodejs';

const BASE_SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
};

function createErrorResponse(status: number, message: string, headOnly: boolean): NextResponse {
  if (headOnly) {
    return new NextResponse(null, {
      status,
      headers: BASE_SECURITY_HEADERS,
    });
  }
  return NextResponse.json(
    { error: message },
    {
      status,
      headers: BASE_SECURITY_HEADERS,
    }
  );
}

function validateRawRequestPathname(rawUrl: string): void {
  const pathname = new URL(rawUrl).pathname;
  if (
    pathname.includes('\0') ||
    pathname.includes('\\') ||
    /%(?:00|2e|2f|5c)/i.test(pathname) ||
    pathname.includes('//')
  ) {
    throw new PathContainmentError('Upload path contains disallowed or encoded traversal sequences');
  }

  const rawSegments = pathname.split('/').filter(Boolean);
  for (const segment of rawSegments) {
    if (segment === '.' || segment === '..') {
      throw new PathContainmentError('Upload path traversal segment is forbidden');
    }
  }
}

function buildUploadKey(pathSegments: string[] | undefined): string {
  if (!Array.isArray(pathSegments) || pathSegments.length === 0) {
    throw new PathContainmentError('Upload asset path is required');
  }

  for (const segment of pathSegments) {
    if (
      typeof segment !== 'string' ||
      segment.length === 0 ||
      segment === '.' ||
      segment === '..' ||
      segment.includes('/') ||
      segment.includes('\\') ||
      segment.includes('\0')
    ) {
      throw new PathContainmentError('Invalid upload path segment');
    }
  }

  return `uploads/${pathSegments.join('/')}`;
}

async function handleUploadRequest(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> | { path: string[] } },
  headOnly: boolean
): Promise<NextResponse> {
  try {
    validateRawRequestPathname(request.url);
    const resolvedParams = await Promise.resolve(context.params);
    const storageKey = buildUploadKey(resolvedParams?.path);

    const provider = new LocalStorageProvider();
    const asset: LocalUploadStreamResult | null = await provider.openReadStream(storageKey, {
      headOnly,
    });

    if (!asset) {
      return createErrorResponse(404, 'Not Found', headOnly);
    }

    const headers: Record<string, string> = {
      ...BASE_SECURITY_HEADERS,
      'Content-Type': asset.mimeType,
      'Content-Length': String(asset.size),
      'Last-Modified': asset.updatedAt.toUTCString(),
      'Cache-Control': 'public, max-age=31536000, immutable',
    };

    if (headOnly || !asset.stream) {
      return new NextResponse(null, { status: 200, headers });
    }

    return new NextResponse(asset.stream, { status: 200, headers });
  } catch (error: unknown) {
    if (error instanceof PathContainmentError) {
      return createErrorResponse(400, 'Invalid upload path', headOnly);
    }
    return createErrorResponse(500, 'Internal Server Error', headOnly);
  }
}

/**
 * Streams locally stored uploaded files dynamically at /uploads/* in standalone server mode.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> | { path: string[] } }
): Promise<NextResponse> {
  return handleUploadRequest(request, context, false);
}

/**
 * Returns upload metadata headers without body payload for /uploads/* requests.
 */
export async function HEAD(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> | { path: string[] } }
): Promise<NextResponse> {
  return handleUploadRequest(request, context, true);
}
