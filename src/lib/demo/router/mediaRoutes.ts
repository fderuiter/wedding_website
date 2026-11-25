import type { MediaDTO } from '@/features/media';
import { withBasePath } from '@/lib/basePath';
import type { DemoPhotoRecord } from '../demoSeed';
import {
  encodeDemoUploadedFile,
  getActiveArchetypeDataset,
  getDemoState,
  mutateActiveDataset,
  recordDemoAuditVersion,
} from '../demoStore';
import {
  type DemoRouteContext,
  binaryResponse,
  buildPaginationHeaders,
  createMinimalZipBytes,
  jsonResponse,
  nextDemoId,
  parseFormData,
  parseJsonBody,
} from './http';

let demoPhotoQrTokenVersion = 1;

function extractUploadedFiles(formData: FormData | null): File[] {
  if (!formData) return [];
  const collected: File[] = [];
  for (const key of ['file', 'files', 'photo', 'photos', 'image']) {
    const entries = formData.getAll(key);
    for (const entry of entries) {
      if (typeof Blob !== 'undefined' && entry instanceof Blob) {
        const fileObj =
          typeof File !== 'undefined' && entry instanceof File
            ? entry
            : new File([entry], 'upload.jpg', { type: entry.type || 'image/jpeg' });
        collected.push(fileObj);
      }
    }
  }
  return collected;
}

function toModerationDto(photo: DemoPhotoRecord) {
  return {
    id: photo.id,
    nodeId: photo.nodeId,
    mediaId: photo.mediaId,
    url: photo.url,
    title: photo.title,
    caption: photo.caption,
    altText: photo.altText,
    uploaderName: photo.uploaderName ?? 'Wedding Guest',
    originalFilename: `${photo.id}.jpg`,
    status: photo.status,
    isVisible: photo.isVisible,
    createdAt: photo.createdAt,
    updatedAt: photo.updatedAt,
    data: {
      mediaId: photo.mediaId,
      url: photo.url,
      title: photo.title,
      caption: photo.caption,
      altText: photo.altText,
      uploaderName: photo.uploaderName ?? 'Wedding Guest',
      status: photo.status,
      isVisible: photo.isVisible,
    },
  };
}

export async function handleMediaAndPhotoRoutes(
  ctx: DemoRouteContext
): Promise<Response | null> {
  const { url, path, method, init, rawInput } = ctx;

  // 1. Guest & Public Photo Uploads (FormData <=512KB base64 / >512KB blob URL)
  if (
    (path === '/api/guest/photos/upload' || path === '/api/photos/upload') &&
    method === 'POST'
  ) {
    const formData = await parseFormData(init, rawInput);
    const body = formData ? {} : await parseJsonBody(init, rawInput);
    const files = extractUploadedFiles(formData);

    const session = getDemoState().guestSession;
    const rawUploader =
      (formData ? String(formData.get('uploaderName') ?? '') : String(body.uploaderName ?? ''))
        .trim() ||
      session?.guestName ||
      'Wedding Guest';
    const rawCaption = (
      formData ? String(formData.get('caption') ?? '') : String(body.caption ?? '')
    ).trim();
    const rawCaptions = formData
      ? formData.getAll('captions').map((entry) => String(entry ?? '').trim())
      : Array.isArray(body.captions)
        ? body.captions.map((entry: unknown) => String(entry ?? '').trim())
        : [];

    if (files.length === 0 && typeof body.url !== 'string' && !formData) {
      return jsonResponse({ success: false, error: 'Please attach at least one photo file.' }, 400);
    }

    const activeDataset = getActiveArchetypeDataset();
    const autoApprove = Boolean(activeDataset.siteConfig.autoApproveGuestPhotos);
    const initialStatus: DemoPhotoRecord['status'] = autoApprove ? 'APPROVED' : 'PENDING';
    const now = new Date();
    const nowIso = now.toISOString();

    const createdPhotos: DemoPhotoRecord[] = [];
    const createdMedia: MediaDTO[] = [];

    if (files.length > 0) {
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const title = file.name ? file.name.replace(/\.[^.]+$/, '') : `Guest Upload ${i + 1}`;
        const itemCaption = (i < rawCaptions.length ? rawCaptions[i] : '') || rawCaption;
        const encoded = await encodeDemoUploadedFile(file, title);
        const photoId = nextDemoId('demo-guest-photo');
        const mediaId = `${photoId}-media`;
        createdMedia.push({
          id: mediaId,
          url: encoded.url,
          altText: itemCaption || `${title} uploaded by ${rawUploader}`,
          isDecorative: false,
          isSample: false,
          createdAt: now,
          updatedAt: now,
        });
        createdPhotos.push({
          id: photoId,
          nodeId: photoId,
          mediaId,
          url: encoded.url,
          title: itemCaption || title,
          caption: itemCaption || `Shared by ${rawUploader}`,
          altText: itemCaption || `${title} uploaded by ${rawUploader}`,
          category: 'guest',
          source: 'guest-upload',
          status: initialStatus,
          isVisible: autoApprove,
          isGuestUpload: true,
          uploaderName: rawUploader,
          sizeBytes: encoded.sizeBytes,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      }
    } else {
      const fallbackTitle = String(body.title ?? 'Guest Photo').trim() || 'Guest Photo';
      const fallbackBlob = new Blob(['demo-image'], { type: 'image/png' });
      const encoded =
        typeof body.url === 'string' && body.url.trim()
          ? {
            url: body.url.trim(),
            persistentUrl: body.url.trim(),
            isSessionBlob: body.url.trim().startsWith('blob:'),
            sizeBytes: 128,
            mimeType: 'image/png',
          }
          : await encodeDemoUploadedFile(fallbackBlob, fallbackTitle);
      const photoId = nextDemoId('demo-guest-photo');
      const mediaId = `${photoId}-media`;
      createdMedia.push({
        id: mediaId,
        url: encoded.url,
        altText: rawCaption || `${fallbackTitle} uploaded by ${rawUploader}`,
        isDecorative: false,
        isSample: false,
        createdAt: now,
        updatedAt: now,
      });
      createdPhotos.push({
        id: photoId,
        nodeId: photoId,
        mediaId,
        url: encoded.url,
        title: fallbackTitle,
        caption: rawCaption || `Shared by ${rawUploader}`,
        altText: rawCaption || `${fallbackTitle} uploaded by ${rawUploader}`,
        category: 'guest',
        source: 'guest-upload',
        status: initialStatus,
        isVisible: autoApprove,
        isGuestUpload: true,
        uploaderName: rawUploader,
        sizeBytes: encoded.sizeBytes,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }

    mutateActiveDataset((current) => ({
      ...current,
      media: [...createdMedia, ...current.media],
      photos: [...createdPhotos, ...current.photos],
    }));

    recordDemoAuditVersion(
      'Photo',
      createdPhotos[0].id,
      'UPLOAD',
      `Guest ${rawUploader} uploaded ${createdPhotos.length} photo(s) (${initialStatus})`,
      { count: createdPhotos.length, status: initialStatus },
      rawUploader
    );

    const primary = createdPhotos[0];
    return jsonResponse(
      {
        success: true,
        status: initialStatus,
        autoApproved: autoApprove,
        photo: primary,
        photos: createdPhotos,
        uploadedCount: createdPhotos.length,
        data: createdPhotos.length > 1 ? createdPhotos : primary,
      },
      201
    );
  }

  // 2. Admin File Upload
  if ((path === '/api/admin/upload' || path === '/api/admin/media') && method === 'POST') {
    const formData = await parseFormData(init, rawInput);
    const body = formData ? {} : await parseJsonBody(init, rawInput);
    const files = extractUploadedFiles(formData);
    const file = files[0] ?? new Blob(['admin-demo-upload'], { type: 'image/png' });

    const rawAlt = formData
      ? String(formData.get('altText') ?? formData.get('title') ?? '').trim()
      : String(body.altText ?? body.title ?? '').trim();
    const fallbackName =
      files[0]?.name ? files[0].name.replace(/\.[^.]+$/, '') : 'Uploaded Media';
    const altText = rawAlt || fallbackName;

    const encoded = await encodeDemoUploadedFile(file, altText);
    const now = new Date();
    const nowIso = now.toISOString();
    const mediaId = nextDemoId('demo-media');
    const photoId = `${mediaId}-photo`;

    const createdMedia: MediaDTO = {
      id: mediaId,
      url: encoded.url,
      altText,
      isDecorative: false,
      isSample: false,
      createdAt: now,
      updatedAt: now,
    };
    const createdPhoto: DemoPhotoRecord = {
      id: photoId,
      nodeId: photoId,
      mediaId,
      url: encoded.url,
      title: altText,
      caption: altText,
      altText,
      category: 'curated',
      source: 'curated',
      status: 'APPROVED',
      isVisible: true,
      isGuestUpload: false,
      sizeBytes: encoded.sizeBytes,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    mutateActiveDataset((current) => ({
      ...current,
      media: [createdMedia, ...current.media],
      photos: [createdPhoto, ...current.photos],
    }));

    recordDemoAuditVersion('Media', createdMedia.id, 'UPLOAD', `Uploaded media "${altText}"`, {
      id: createdMedia.id,
      url: encoded.persistentUrl,
      altText,
    });

    return jsonResponse(
      {
        success: true,
        ...createdMedia,
        data: createdMedia,
      },
      201
    );
  }

  // 3. Media Library CRUD & ZIP Export
  if (path === '/api/media') {
    if (method === 'GET') {
      const dataset = getActiveArchetypeDataset();
      const search = (url.searchParams.get('search') || '').trim().toLowerCase();
      const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
      const limit = Math.max(1, parseInt(url.searchParams.get('limit') || '24', 10) || 24);

      let items = dataset.media;
      if (search) {
        items = items.filter(
          (m) =>
            (m.altText || '').toLowerCase().includes(search) ||
            m.url.toLowerCase().includes(search)
        );
      }

      const total = items.length;
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const paged = items.slice((page - 1) * limit, page * limit);
      return jsonResponse(
        {
          data: paged,
          items: paged,
          total,
          page,
          limit,
          totalPages,
        },
        200,
        buildPaginationHeaders(total, page, limit)
      );
    }

    if (method === 'POST') {
      const body = await parseJsonBody(init, rawInput);
      const now = new Date();
      const media: MediaDTO = {
        id: nextDemoId('demo-media'),
        url:
          typeof body.url === 'string' && body.url.trim()
            ? body.url.trim()
            : withBasePath('/images/placeholder.png'),
        altText: typeof body.altText === 'string' ? body.altText : 'Media Asset',
        isDecorative: Boolean(body.isDecorative),
        isSample: false,
        createdAt: now,
        updatedAt: now,
      };
      mutateActiveDataset((current) => ({
        ...current,
        media: [media, ...current.media],
      }));
      return jsonResponse({ success: true, data: media, ...media }, 201);
    }
  }

  if (path === '/api/media/export' && (method === 'GET' || method === 'POST')) {
    const dataset = getActiveArchetypeDataset();
    const manifest = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        totalAssets: dataset.media.length,
        media: dataset.media.map((m) => ({
          id: m.id,
          altText: m.altText,
          url: m.url.startsWith('data:') ? '[embedded-data-uri]' : m.url,
        })),
      },
      null,
      2
    );
    const zipBytes = createMinimalZipBytes('media-manifest.json', manifest);
    return binaryResponse(zipBytes, 'application/zip', 'wedding-media-export.zip');
  }

  if (path.startsWith('/api/media/')) {
    const mediaId = decodeURIComponent(path.slice('/api/media/'.length));
    const existing = getActiveArchetypeDataset().media.find((m) => m.id === mediaId);
    if (!existing) {
      return jsonResponse({ success: false, error: 'Media asset not found.' }, 404);
    }

    if (method === 'GET') {
      return jsonResponse({ success: true, data: existing, ...existing });
    }

    if (method === 'PUT' || method === 'PATCH') {
      const body = await parseJsonBody(init, rawInput);
      const now = new Date();
      const updated: MediaDTO = {
        ...existing,
        ...(body.altText === null || typeof body.altText === 'string'
          ? { altText: body.altText }
          : {}),
        ...(typeof body.isDecorative === 'boolean' ? { isDecorative: body.isDecorative } : {}),
        ...(typeof body.url === 'string' && body.url.trim() ? { url: body.url.trim() } : {}),
        updatedAt: now,
      };
      mutateActiveDataset((current) => ({
        ...current,
        media: current.media.map((m) => (m.id === mediaId ? updated : m)),
        photos: current.photos.map((p) =>
          p.mediaId === mediaId
            ? {
              ...p,
              altText: updated.altText || p.altText,
              caption: updated.altText || p.caption,
              updatedAt: now.toISOString(),
            }
            : p
        ),
      }));
      return jsonResponse({ success: true, data: updated, ...updated });
    }

    if (method === 'DELETE') {
      mutateActiveDataset((current) => ({
        ...current,
        media: current.media.filter((m) => m.id !== mediaId),
        photos: current.photos.filter((p) => p.mediaId !== mediaId && p.id !== mediaId),
      }));
      return jsonResponse({ success: true, deletedId: mediaId });
    }
  }

  // 4. Admin Photo Moderation & QR Management
  if (path === '/api/admin/photos/moderation') {
    if (method === 'GET') {
      const statusParam = (url.searchParams.get('status') || 'PENDING').trim().toUpperCase();
      const photos = getActiveArchetypeDataset()
        .photos.filter((p) => (statusParam === 'ALL' ? true : p.status === statusParam))
        .map(toModerationDto);
      return jsonResponse({
        success: true,
        items: photos,
        photos,
        pendingCount: photos.length,
        count: photos.length,
        total: photos.length,
        data: photos,
        pagination: { page: 1, limit: 50, total: photos.length, totalPages: 1 },
      });
    }

    if (method === 'PATCH' || method === 'POST') {
      const body = await parseJsonBody(init, rawInput);
      const targetId = String(body.id ?? body.photoId ?? '').trim();
      const action = String(body.action ?? body.status ?? 'approve')
        .trim()
        .toLowerCase();
      if (!targetId) {
        return jsonResponse({ success: false, error: 'Photo ID is required.' }, 400);
      }

      const nowIso = new Date().toISOString();
      let updatedPhoto: DemoPhotoRecord | null = null;
      let rejected = false;

      mutateActiveDataset((current) => {
        if (action === 'reject' || action === 'rejected' || action === 'delete') {
          const target = current.photos.find((p) => p.id === targetId || p.nodeId === targetId);
          if (!target) return current;
          rejected = true;
          return {
            ...current,
            photos: current.photos.filter((p) => p.id !== target.id),
            media: current.media.filter((m) => m.id !== target.mediaId),
          };
        }

        const nextStatus: DemoPhotoRecord['status'] =
          action === 'pending' ? 'PENDING' : 'APPROVED';
        const nextPhotos = current.photos.map((p) => {
          if (p.id !== targetId && p.nodeId !== targetId) return p;
          updatedPhoto = {
            ...p,
            status: nextStatus,
            isVisible: nextStatus === 'APPROVED',
            ...(typeof body.caption === 'string' ? { caption: body.caption } : {}),
            ...(typeof body.uploaderName === 'string' ? { uploaderName: body.uploaderName } : {}),
            updatedAt: nowIso,
          };
          return updatedPhoto;
        });
        return {
          ...current,
          photos: nextPhotos,
        };
      });

      if (!updatedPhoto && !rejected) {
        return jsonResponse({ success: false, error: 'Photo not found.' }, 404);
      }

      recordDemoAuditVersion(
        'Photo',
        targetId,
        rejected ? 'REJECT' : 'APPROVE',
        rejected ? `Rejected guest photo ${targetId}` : `Approved guest photo ${targetId}`,
        { id: targetId, action }
      );

      return jsonResponse({
        success: true,
        id: targetId,
        action,
        photo: updatedPhoto ? toModerationDto(updatedPhoto) : null,
        data: {
          id: targetId,
          action,
          photo: updatedPhoto ? toModerationDto(updatedPhoto) : null,
        },
      });
    }
  }

  if (
    path === '/api/admin/photos/moderation/batch' &&
    (method === 'POST' || method === 'PATCH')
  ) {
    const body = await parseJsonBody(init, rawInput);
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((id): id is string => typeof id === 'string')
      : [];
    const action = String(body.action ?? 'approve')
      .trim()
      .toLowerCase();
    const pendingEditsMap =
      body.pendingEdits && typeof body.pendingEdits === 'object' && !Array.isArray(body.pendingEdits)
        ? (body.pendingEdits as Record<string, { caption?: unknown; uploaderName?: unknown }>)
        : {};
    const idSet = new Set(ids);
    const nowIso = new Date().toISOString();
    let count = 0;

    mutateActiveDataset((current) => {
      if (action === 'reject' || action === 'delete') {
        const removedMediaIds = new Set<string>();
        const remaining = current.photos.filter((p) => {
          if (idSet.has(p.id) || idSet.has(p.nodeId)) {
            count += 1;
            removedMediaIds.add(p.mediaId);
            return false;
          }
          return true;
        });
        return {
          ...current,
          photos: remaining,
          media: current.media.filter((m) => !removedMediaIds.has(m.id)),
        };
      }
      return {
        ...current,
        photos: current.photos.map((p) => {
          if (!idSet.has(p.id) && !idSet.has(p.nodeId)) return p;
          count += 1;
          const edit = pendingEditsMap[p.id] ?? pendingEditsMap[p.nodeId];
          const nextCaption =
            edit && typeof edit.caption === 'string' ? edit.caption.trim() : p.caption;
          const nextUploader =
            edit && typeof edit.uploaderName === 'string'
              ? edit.uploaderName.trim()
              : p.uploaderName;
          return {
            ...p,
            status: 'APPROVED',
            isVisible: true,
            caption: nextCaption,
            uploaderName: nextUploader,
            ...(nextCaption ? { title: nextCaption, altText: nextCaption } : {}),
            updatedAt: nowIso,
          };
        }),
      };
    });

    return jsonResponse({
      success: true,
      count,
      updatedCount: count,
      data: { count, updatedCount: count },
    });
  }

  if (path === '/api/admin/photos/qr') {
    if (method === 'POST') {
      const body = await parseJsonBody(init, rawInput);
      if (typeof body.autoApproveGuestPhotos === 'boolean') {
        const nextAuto = body.autoApproveGuestPhotos;
        mutateActiveDataset((current) => ({
          ...current,
          siteConfig: {
            ...current.siteConfig,
            autoApproveGuestPhotos: nextAuto,
          },
        }));
      }
      if (body.action === 'rotate') {
        demoPhotoQrTokenVersion += 1;
      }
    }
    if (method === 'GET' || method === 'POST') {
      const dataset = getActiveArchetypeDataset();
      const autoApprove = Boolean(dataset.siteConfig.autoApproveGuestPhotos);
      const activeUploadUrl = `${url.origin}${withBasePath('/photos')}?tab=guest&v=${demoPhotoQrTokenVersion}`;
      const configuredBase = (dataset.siteConfig.baseUrl || url.origin).trim().replace(/\/+$/, '');
      const configuredUploadUrl = `${configuredBase}${withBasePath('/photos')}?tab=guest&v=${demoPhotoQrTokenVersion}`;
      return jsonResponse({
        success: true,
        uploadUrl: configuredUploadUrl,
        activeUploadUrl,
        configuredUploadUrl,
        tokenVersion: demoPhotoQrTokenVersion,
        autoApproveGuestPhotos: autoApprove,
        data: {
          uploadUrl: configuredUploadUrl,
          activeUploadUrl,
          configuredUploadUrl,
          tokenVersion: demoPhotoQrTokenVersion,
          autoApproveGuestPhotos: autoApprove,
        },
      });
    }
  }

  if (path.startsWith('/api/admin/photos/')) {
    const photoId = decodeURIComponent(path.slice('/api/admin/photos/'.length));
    const existing = getActiveArchetypeDataset().photos.find(
      (p) => p.id === photoId || p.nodeId === photoId
    );
    if (!existing) {
      return jsonResponse({ success: false, error: 'Photo not found.' }, 404);
    }

    if (method === 'PATCH' || method === 'PUT') {
      const body = await parseJsonBody(init, rawInput);
      const nextStatus =
        body.status === 'APPROVED' || body.status === 'PENDING' || body.status === 'REJECTED'
          ? body.status
          : existing.status;
      const nextVisible =
        typeof body.isVisible === 'boolean'
          ? body.isVisible
          : nextStatus === 'APPROVED'
            ? true
            : existing.isVisible;
      const updated: DemoPhotoRecord = {
        ...existing,
        ...(typeof body.caption === 'string' ? { caption: body.caption } : {}),
        ...(typeof body.title === 'string' ? { title: body.title } : {}),
        ...(typeof body.altText === 'string' ? { altText: body.altText } : {}),
        isVisible: nextVisible,
        status: nextStatus,
        updatedAt: new Date().toISOString(),
      };
      mutateActiveDataset((current) => ({
        ...current,
        photos: current.photos.map((p) => (p.id === existing.id ? updated : p)),
      }));
      return jsonResponse({ success: true, data: updated, photo: updated });
    }

    if (method === 'DELETE') {
      mutateActiveDataset((current) => ({
        ...current,
        photos: current.photos.filter((p) => p.id !== existing.id),
      }));
      return jsonResponse({ success: true, deletedId: existing.id });
    }
  }

  return null;
}
