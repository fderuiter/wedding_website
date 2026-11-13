import { NextRequest, NextResponse } from 'next/server';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const archiverPkg = require('archiver');
function getArchiver(format: string, options?: any) {
  if (typeof archiverPkg === 'function') {
    return archiverPkg(format, options);
  }
  if (archiverPkg && typeof archiverPkg.default === 'function') {
    return archiverPkg.default(format, options);
  }
  if (archiverPkg && typeof archiverPkg.create === 'function') {
    return archiverPkg.create(format, options);
  }
  if (archiverPkg && typeof archiverPkg.archiver === 'function') {
    return archiverPkg.archiver(format, options);
  }
  if (archiverPkg && archiverPkg.ZipArchive) {
    return new archiverPkg.ZipArchive(options);
  }
  throw new Error('Archiver factory function not found');
}
import path from 'path';
import fs from 'fs';
import { prisma } from '@/lib/prisma';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { safeFetch } from '@/utils/safeFetch';

export interface ExportMediaItem {
  id?: string;
  url: string;
  title?: string;
  altText?: string;
}

export async function processExportRequest(
  ids?: string[],
  tag?: string,
  _category?: string
): Promise<ExportMediaItem[]> {
  const items: ExportMediaItem[] = [];
  const seenUrls = new Set<string>();

  // Filter by explicit IDs if provided
  if (ids && ids.length > 0) {
    const [mediaList, contentNodeList] = await Promise.all([
      prisma.media.findMany({
        where: { id: { in: ids } },
        select: { id: true, url: true, altText: true },
      }),
      prisma.contentNode.findMany({
        where: { id: { in: ids } },
        select: { id: true, data: true },
      }),
    ]);

    for (const m of mediaList) {
      if (m.url && !seenUrls.has(m.url)) {
        seenUrls.add(m.url);
        items.push({
          id: m.id,
          url: m.url,
          altText: m.altText || undefined,
        });
      }
    }

    for (const n of contentNodeList) {
      const data = n.data as Record<string, any> | null;
      const url = data?.url;
      if (url && typeof url === 'string' && !seenUrls.has(url)) {
        seenUrls.add(url);
        items.push({
          id: n.id,
          url,
          title: data?.title || data?.altText || undefined,
        });
      }
    }

    return items;
  }

  // Filter by tag if provided
  if (tag) {
    const nodes = await prisma.contentNode.findMany({
      where: {
        type: 'Photo',
        tags: { has: tag },
      },
      select: { id: true, data: true },
    });

    for (const n of nodes) {
      const data = n.data as Record<string, any> | null;
      const url = data?.url;
      if (url && typeof url === 'string' && !seenUrls.has(url)) {
        seenUrls.add(url);
        items.push({
          id: n.id,
          url,
          title: data?.title || data?.altText || undefined,
        });
      }
    }

    // Also check Media entries if tag is guest-upload
    if (items.length === 0 && tag === 'guest-upload') {
      const allMedia = await prisma.media.findMany({
        select: { id: true, url: true, altText: true },
      });
      for (const m of allMedia) {
        if (m.url && m.url.includes('/uploads/photos') && !seenUrls.has(m.url)) {
          seenUrls.add(m.url);
          items.push({
            id: m.id,
            url: m.url,
            altText: m.altText || 'Guest Photo',
          });
        }
      }
    }

    return items;
  }

  // Otherwise export all available photos from ContentNodes and Media
  const [nodes, mediaRecords] = await Promise.all([
    prisma.contentNode.findMany({
      where: { type: 'Photo' },
      select: { id: true, data: true },
    }),
    prisma.media.findMany({
      select: { id: true, url: true, altText: true },
    }),
  ]);

  for (const n of nodes) {
    const data = n.data as Record<string, any> | null;
    const url = data?.url;
    if (url && typeof url === 'string' && !seenUrls.has(url)) {
      seenUrls.add(url);
      items.push({
        id: n.id,
        url,
        title: data?.title || data?.altText || undefined,
      });
    }
  }

  for (const m of mediaRecords) {
    if (m.url && !seenUrls.has(m.url)) {
      seenUrls.add(m.url);
      items.push({
        id: m.id,
        url: m.url,
        altText: m.altText || undefined,
      });
    }
  }

  return items;
}

async function handleExport(req: NextRequest) {
  const config = await getAppConfig();
  if (!isFeatureEnabled('gallery', config.modules)) {
    throw new ApiError(404, "Feature 'gallery' is disabled");
  }

  let ids: string[] | undefined;
  let tag: string | undefined;
  let category: string | undefined;

  if (req.method === 'POST') {
    try {
      const body = await req.json();
      if (body && typeof body === 'object') {
        if (Array.isArray(body.ids)) {
          ids = body.ids.map(String).filter(Boolean);
        } else if (typeof body.ids === 'string') {
          ids = body.ids.split(',').map((s: string) => s.trim()).filter(Boolean);
        }
        if (typeof body.tag === 'string') tag = body.tag.trim();
        if (typeof body.category === 'string') category = body.category.trim();
      }
    } catch {
      // Body parsing failed or empty
    }
  } else {
    const { searchParams } = req.nextUrl;
    const idsParam = searchParams.get('ids');
    if (idsParam) {
      ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean);
    }
    const tagParam = searchParams.get('tag');
    if (tagParam) tag = tagParam.trim();

    const catParam = searchParams.get('category');
    if (catParam) category = catParam.trim();
  }

  const items = await processExportRequest(ids, tag, category);

  if (items.length === 0) {
    throw new ApiError(404, 'No media items found matching export criteria');
  }

  const archive = getArchiver('zip', { zlib: { level: 5 } });

  const webStream = new ReadableStream({
    start(controller) {
      archive.on('data', (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      archive.on('end', () => {
        controller.close();
      });
      archive.on('error', (err: unknown) => {
        controller.error(err);
      });
    },
  });

  const CONCURRENCY_LIMIT = 8;

  (async () => {
    const usedNames = new Set<string>();

    const mediaTasks = items
      .map((item, index) => {
        if (!item.url) return null;

        const rawTitle = item.title || item.altText || `photo_${index + 1}`;

        let urlPath = '';
        try {
          urlPath = new URL(item.url, 'http://localhost').pathname;
        } catch {
          urlPath = item.url;
        }

        let ext = path.extname(urlPath) || '.jpg';
        if (!ext || ext.length > 5 || ext.includes('?')) ext = '.jpg';

        let cleanBase = path
          .basename(rawTitle, path.extname(rawTitle))
          .replace(/[^a-zA-Z0-9_\-]/g, '_')
          .replace(/^_+|_+$/g, '');

        if (!cleanBase) cleanBase = `photo_${index + 1}`;

        let filename = `${cleanBase}${ext}`;
        let counter = 1;
        while (usedNames.has(filename)) {
          filename = `${cleanBase}_${counter}${ext}`;
          counter++;
        }
        usedNames.add(filename);

        return { item, filename };
      })
      .filter((task): task is { item: ExportMediaItem; filename: string } => task !== null);

    for (let i = 0; i < mediaTasks.length; i += CONCURRENCY_LIMIT) {
      const batch = mediaTasks.slice(i, i + CONCURRENCY_LIMIT);
      const batchResults = await Promise.all(
        batch.map(async ({ item, filename }) => {
          try {
            if (item.url.startsWith('data:')) {
              const matches = item.url.match(/^data:([^;]+);base64,(.+)$/);
              if (matches && matches[2]) {
                const buffer = Buffer.from(matches[2], 'base64');
                return [{ type: 'buffer' as const, buffer, name: filename }];
              }
              return [];
            }

            if (item.url.startsWith('http://') || item.url.startsWith('https://')) {
              try {
                const res = await safeFetch(item.url);
                if (res.ok) {
                  const buffer = Buffer.from(await res.arrayBuffer());
                  return [{ type: 'buffer' as const, buffer, name: filename }];
                } else {
                  return [
                    {
                      type: 'buffer' as const,
                      buffer: Buffer.from(`Failed to download resource: HTTP ${res.status}`),
                      name: `error_${filename}.txt`,
                    },
                  ];
                }
              } catch (fetchErr: unknown) {
                const message = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
                return [
                  {
                    type: 'buffer' as const,
                    buffer: Buffer.from(`Fetch error: ${message}`),
                    name: `error_${filename}.txt`,
                  },
                ];
              }
            }

            const cleanKey = item.url.replace(/^\/+/, '');
            const filePath = path.join(process.cwd(), 'public', cleanKey);
            try {
              await fs.promises.stat(filePath);
              return [{ type: 'file' as const, filePath, name: filename }];
            } catch {
              return [
                {
                  type: 'buffer' as const,
                  buffer: Buffer.from(`Local asset file not found at ${cleanKey}`),
                  name: `missing_${filename}.txt`,
                },
              ];
            }
          } catch (err) {
            console.error(`Error archiving media ${item.url}:`, err);
            return [];
          }
        })
      );

      for (const entries of batchResults) {
        for (const entry of entries) {
          if (entry.type === 'file') {
            archive.file(entry.filePath, { name: entry.name });
          } else {
            archive.append(entry.buffer, { name: entry.name });
          }
        }
      }
    }

    await archive.finalize();
  })().catch((err: unknown) => {
    console.error('Fatal error building ZIP archive:', err);
    archive.destroy(err instanceof Error ? err : new Error(String(err)));
  });

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="wedding-photos.zip"',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}

export const GET = withApiMiddleware(handleExport);
export const POST = withApiMiddleware(handleExport);
