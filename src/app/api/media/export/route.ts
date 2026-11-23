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
import { PathContainmentError, resolveContainedExistingPath } from '@/utils/pathContainment';
import { isAdminRequest } from '@/core/auth/auth.server';
import { MediaExportSchema } from '@/utils/validation';

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

const STORED_IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.avif',
  '.heic',
  '.heif',
]);

function shouldStoreEntry(entryName: string): boolean {
  return STORED_IMAGE_EXTENSIONS.has(path.extname(entryName).toLowerCase());
}

function isTruthyPreflight(rawPreflight: unknown): boolean {
  if (typeof rawPreflight === 'boolean') return rawPreflight;
  if (typeof rawPreflight === 'string') {
    const normalized = rawPreflight.trim().toLowerCase();
    return normalized === 'true' || normalized === '1';
  }
  return false;
}

function sanitizeExportFilename(rawFilename?: string): string {
  if (!rawFilename || typeof rawFilename !== 'string') {
    return 'wedding-photos.zip';
  }
  const baseSegment = rawFilename.trim().split(/[\\/]/).pop() ?? '';
  const withoutZip = baseSegment.replace(/\.zip$/i, '');
  const cleaned = withoutZip
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/\.+/g, '.')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, 100);
  if (!cleaned) {
    return 'wedding-photos.zip';
  }
  return `${cleaned}.zip`;
}

function validatePostExportOrigin(req: NextRequest): void {
  const secFetchSite = req.headers.get('sec-fetch-site')?.trim().toLowerCase();
  if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
    throw new ApiError(403, 'Cross-origin export request blocked');
  }

  const originHeader = req.headers.get('origin')?.trim();
  const refererHeader = !originHeader ? req.headers.get('referer')?.trim() : undefined;
  const sourceUrlString = originHeader || refererHeader;
  if (!sourceUrlString) {
    return;
  }

  let parsedSource: URL;
  try {
    parsedSource = new URL(sourceUrlString);
  } catch {
    throw new ApiError(403, 'Invalid request origin');
  }

  const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const hostHeader = forwardedHost || req.headers.get('host');
  let expectedOrigin = req.nextUrl?.origin?.toLowerCase() ?? '';
  if (hostHeader) {
    const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
    const fallbackProto = (req.nextUrl?.protocol || 'http:').replace(/:$/, '').toLowerCase();
    const proto =
      forwardedProto === 'https' || forwardedProto === 'http' ? forwardedProto : fallbackProto;
    expectedOrigin = `${proto}://${hostHeader.trim().toLowerCase()}`;
  }

  if (!expectedOrigin || parsedSource.origin.toLowerCase() !== expectedOrigin) {
    throw new ApiError(403, 'Cross-origin export request blocked');
  }
}

type ArchiveBatchEntry =
  | { type: 'file'; filePath: string; name: string; stats: fs.Stats }
  | { type: 'buffer'; buffer: Buffer; name: string };

async function handleExport(req: NextRequest) {
  if (!(await isAdminRequest(req))) {
    throw new ApiError(401, 'Unauthorized');
  }
  const config = await getAppConfig();
  if (!isFeatureEnabled('gallery', config.modules)) {
    throw new ApiError(404, "Feature 'gallery' is disabled");
  }

  let ids: string[] | undefined;
  let tag: string | undefined;
  let category: string | undefined;
  let rawFilename: string | undefined;
  let preflight = false;

  if (req.method === 'POST') {
    validatePostExportOrigin(req);
    try {
      const contentType = req.headers.get('content-type')?.toLowerCase() ?? '';
      let body: unknown;
      if (contentType.includes('application/x-www-form-urlencoded')) {
        const fallbackBody = (req as unknown as { body?: unknown }).body;
        const rawText =
          typeof req.text === 'function'
            ? await req.text()
            : typeof fallbackBody === 'string'
              ? fallbackBody
              : '';
        const formParams = new URLSearchParams(rawText);
        const rawIds = formParams.getAll('ids');
        body = {
          ...(rawIds.length > 0 ? { ids: rawIds.length === 1 ? rawIds[0] : rawIds } : {}),
          ...(formParams.get('tag') ? { tag: formParams.get('tag') ?? undefined } : {}),
          ...(formParams.get('category') ? { category: formParams.get('category') ?? undefined } : {}),
          ...(formParams.get('filename') ? { filename: formParams.get('filename') ?? undefined } : {}),
          ...(formParams.get('preflight') ? { preflight: formParams.get('preflight') ?? undefined } : {}),
        };
      } else {
        body = await req.json();
      }

      const parsed = MediaExportSchema.safeParse(body);
      if (parsed.success) {
        const data = parsed.data;
        if (Array.isArray(data.ids)) {
          ids = data.ids.map((s) => String(s).trim()).filter(Boolean);
        } else if (typeof data.ids === 'string') {
          const trimmedIds = data.ids.trim();
          ids = trimmedIds.startsWith('data:')
            ? [trimmedIds]
            : trimmedIds
              .split(',')
              .map((s: string) => s.trim())
              .filter(Boolean);
        }
        if (typeof data.tag === 'string' && data.tag.trim()) tag = data.tag.trim();
        if (typeof data.category === 'string' && data.category.trim()) category = data.category.trim();
        if (typeof data.filename === 'string') rawFilename = data.filename;
        preflight = isTruthyPreflight(data.preflight);
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

    const filenameParam = searchParams.get('filename');
    if (filenameParam) rawFilename = filenameParam;

    const preflightParam = searchParams.get('preflight');
    if (preflightParam) preflight = isTruthyPreflight(preflightParam);
  }

  const items = await processExportRequest(ids, tag, category);

  if (items.length === 0) {
    throw new ApiError(404, 'No media items found matching export criteria');
  }

  const exportFilename = sanitizeExportFilename(rawFilename);

  if (preflight) {
    return NextResponse.json({
      ready: true,
      count: items.length,
      filename: exportFilename,
    });
  }

  const archive = getArchiver('zip', { zlib: { level: 5 }, highWaterMark: 64 * 1024 });
  const exportAbortController = new AbortController();
  const requestSignal = (req as { signal?: AbortSignal }).signal;

  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  let streamClosed = false;
  let pullWaiters: Array<() => void> = [];

  const notifyPullWaiters = () => {
    const waiters = pullWaiters;
    pullWaiters = [];
    for (const resolve of waiters) {
      resolve();
    }
  };

  const abortExport = () => {
    streamClosed = true;
    if (!exportAbortController.signal.aborted) {
      exportAbortController.abort();
    }
    if (typeof archive.abort === 'function') {
      archive.abort();
    }
    if (typeof archive.destroy === 'function') {
      archive.destroy();
    }
    notifyPullWaiters();
  };

  if (requestSignal) {
    if (requestSignal.aborted) {
      abortExport();
    } else {
      requestSignal.addEventListener('abort', abortExport, { once: true });
    }
  }

  if (typeof archive.pause === 'function') {
    archive.pause();
  }

  const webStream = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        streamController = controller;
        archive.on('data', (chunk: Buffer) => {
          if (streamClosed || exportAbortController.signal.aborted) {
            return;
          }
          controller.enqueue(new Uint8Array(chunk));
          if (
            controller.desiredSize !== null &&
            controller.desiredSize <= 0 &&
            typeof archive.pause === 'function'
          ) {
            archive.pause();
          }
        });
        archive.on('end', () => {
          if (!streamClosed) {
            streamClosed = true;
            controller.close();
          }
          notifyPullWaiters();
        });
        archive.on('error', (err: unknown) => {
          if (!streamClosed && !exportAbortController.signal.aborted) {
            streamClosed = true;
            controller.error(err);
          }
          notifyPullWaiters();
        });
      },
      pull() {
        if (!streamClosed && !exportAbortController.signal.aborted) {
          if (typeof archive.resume === 'function') {
            archive.resume();
          }
        }
        notifyPullWaiters();
      },
      cancel() {
        abortExport();
      },
    },
    { highWaterMark: 1 }
  );

  const waitForBatchDrain = (expectedEntries: number): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      if (expectedEntries === 0 || streamClosed || exportAbortController.signal.aborted) {
        resolve();
        return;
      }

      let processed = 0;

      const cleanup = () => {
        archive.off('entry', onEntry);
        archive.off('error', onError);
        exportAbortController.signal.removeEventListener('abort', onAbort);
      };

      const checkCompleted = () => {
        if (streamClosed || exportAbortController.signal.aborted) {
          cleanup();
          resolve();
          return;
        }
        if (processed >= expectedEntries) {
          const isBackpressured =
            (streamController !== null &&
              streamController.desiredSize !== null &&
              streamController.desiredSize <= 0) ||
            (typeof archive.isPaused === 'function' && archive.isPaused());

          if (isBackpressured) {
            pullWaiters.push(() => {
              cleanup();
              resolve();
            });
            return;
          }
          cleanup();
          resolve();
        }
      };

      const onEntry = () => {
        processed++;
        checkCompleted();
      };

      const onError = (err: unknown) => {
        cleanup();
        reject(err);
      };

      const onAbort = () => {
        cleanup();
        resolve();
      };

      archive.on('entry', onEntry);
      archive.on('error', onError);
      exportAbortController.signal.addEventListener('abort', onAbort, { once: true });
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

    const publicRoot = path.resolve(process.cwd(), 'public');
    let canonicalPublicRootPromise: Promise<string | undefined> | null = null;
    const getCanonicalPublicRoot = (): Promise<string | undefined> => {
      if (!canonicalPublicRootPromise) {
        canonicalPublicRootPromise = fs.promises
          .realpath(publicRoot)
          .catch(() => undefined);
      }
      return canonicalPublicRootPromise;
    };

    for (let i = 0; i < mediaTasks.length; i += CONCURRENCY_LIMIT) {
      if (exportAbortController.signal.aborted || streamClosed) {
        break;
      }

      const batch = mediaTasks.slice(i, i + CONCURRENCY_LIMIT);
      const batchResults = await Promise.all(
        batch.map(async ({ item, filename }): Promise<ArchiveBatchEntry[]> => {
          if (exportAbortController.signal.aborted || streamClosed) {
            return [];
          }

          try {
            if (item.url.startsWith('data:')) {
              const matches = item.url.match(/^data:([^;]+);base64,(.+)$/);
              if (matches && matches[2]) {
                const buffer = Buffer.from(matches[2], 'base64');
                return [{ type: 'buffer', buffer, name: filename }];
              }
              return [];
            }

            if (item.url.startsWith('http://') || item.url.startsWith('https://')) {
              try {
                const res = await safeFetch(item.url, {
                  signal: exportAbortController.signal,
                });
                if (exportAbortController.signal.aborted || streamClosed) {
                  return [];
                }
                if (res.ok) {
                  const buffer = Buffer.from(await res.arrayBuffer());
                  if (exportAbortController.signal.aborted || streamClosed) {
                    return [];
                  }
                  return [{ type: 'buffer', buffer, name: filename }];
                } else {
                  return [
                    {
                      type: 'buffer',
                      buffer: Buffer.from(`Failed to download resource: HTTP ${res.status}`),
                      name: `error_${filename}.txt`,
                    },
                  ];
                }
              } catch (fetchErr: unknown) {
                if (exportAbortController.signal.aborted || streamClosed) {
                  return [];
                }
                const message = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
                return [
                  {
                    type: 'buffer',
                    buffer: Buffer.from(`Fetch error: ${message}`),
                    name: `error_${filename}.txt`,
                  },
                ];
              }
            }

            try {
              const canonicalPublicRoot = await getCanonicalPublicRoot();
              const target = await resolveContainedExistingPath(item.url, {
                baseDir: publicRoot,
                containmentRoot: publicRoot,
                canonicalRoot: canonicalPublicRoot,
              });

              if (!target.exists) {
                return [
                  {
                    type: 'buffer',
                    buffer: Buffer.from(`Local asset file not found at ${target.cleanKey}`),
                    name: `missing_${filename}.txt`,
                  },
                ];
              }

              const stat = await fs.promises.stat(target.realPath);
              if (!stat.isFile()) {
                return [
                  {
                    type: 'buffer',
                    buffer: Buffer.from(`Local asset file not found at ${target.cleanKey}`),
                    name: `missing_${filename}.txt`,
                  },
                ];
              }

              return [{ type: 'file', filePath: target.realPath, name: filename, stats: stat }];
            } catch (fsErr: unknown) {
              if (fsErr instanceof PathContainmentError) {
                return [
                  {
                    type: 'buffer',
                    buffer: Buffer.from('Path traversal attempt detected'),
                    name: `error_${filename}.txt`,
                  },
                ];
              }
              const code =
                fsErr && typeof fsErr === 'object' && 'code' in fsErr
                  ? (fsErr as { code?: string }).code
                  : undefined;
              if (code === 'ENOENT') {
                return [
                  {
                    type: 'buffer',
                    buffer: Buffer.from(`Local asset file not found at ${item.url}`),
                    name: `missing_${filename}.txt`,
                  },
                ];
              }
              return [
                {
                  type: 'buffer',
                  buffer: Buffer.from(
                    `Local asset access error: ${fsErr instanceof Error ? fsErr.message : String(fsErr)}`
                  ),
                  name: `error_${filename}.txt`,
                },
              ];
            }
          } catch (err) {
            if (!exportAbortController.signal.aborted && !streamClosed) {
              console.error(`Error archiving media ${item.url}:`, err);
            }
            return [];
          }
        })
      );

      if (exportAbortController.signal.aborted || streamClosed) {
        break;
      }

      const flattenedEntries = batchResults.flat();
      const drainPromise = waitForBatchDrain(flattenedEntries.length);

      for (const entry of flattenedEntries) {
        const store = shouldStoreEntry(entry.name);
        if (entry.type === 'file') {
          archive.file(entry.filePath, {
            name: entry.name,
            stats: entry.stats,
            store,
          });
        } else {
          archive.append(entry.buffer, {
            name: entry.name,
            store,
          });
        }
      }

      await drainPromise;
    }

    if (!exportAbortController.signal.aborted && !streamClosed) {
      await archive.finalize();
    }
  })().catch((err: unknown) => {
    if (!exportAbortController.signal.aborted && !streamClosed) {
      console.error('Fatal error building ZIP archive:', err);
      archive.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  });

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${exportFilename || 'wedding-photos.zip'}"`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}

export const GET = withApiMiddleware(handleExport);
export const POST = withApiMiddleware(handleExport);
