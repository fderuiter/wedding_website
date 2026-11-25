'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { FormGroup, Input, Label } from '@/components/ui/forms';
import { Icon } from '@/components/ui/Icon';
import {
  UploadAlert,
  UploadProgressBar,
  UploadStatusNotice,
} from '@/components/ui/UploadStatus';
import {
  MAX_GUEST_PHOTO_SIZE,
  GUEST_PHOTO_ACCEPTED_TYPES,
  GUEST_PHOTO_ALLOWED_EXTENSIONS,
  getFileExtension,
  isHeicExtension,
} from '@/utils/validation';
import { withBasePath } from '@/lib/basePath';

const MAX_CONCURRENT_UPLOADS = 2;
const MAX_FILES_PER_BATCH = 10;

export interface UploadedPhoto {
  id: string;
  url?: string;
  title?: string;
  altText?: string | null;
  uploaderName?: string;
  caption?: string;
  createdAt?: string | Date;
  nodeId?: string;
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';
  isVisible?: boolean;
}

export interface UploadStatus {
  id: string;
  filename: string;
  size: number;
  progress: number;
  status: 'staged' | 'pending' | 'uploading' | 'success' | 'error';
  errorMessage?: string;
  url?: string;
  previewUrl?: string;
  isHeic?: boolean;
  previewFailed?: boolean;
  formatLabel?: string;
  file?: File;
  order?: number;
  uploaderName?: string;
  caption?: string;
  publishedLive?: boolean;
}

interface ActiveBatchState {
  controller: AbortController;
  itemIds: Set<string>;
}

interface GuestPhotoDropzoneProps {
  onUploadSuccess?: (photo: UploadedPhoto) => void;
  defaultUploaderName?: string;
  dropzoneRef?: React.Ref<HTMLDivElement>;
  className?: string;
}

function resolveFormatLabel(filename: string): string {
  const ext = getFileExtension(filename).replace(/^\./, '').toUpperCase();
  if (!ext) return 'IMG';
  if (ext === 'JPEG') return 'JPG';
  if (ext === 'HEIF') return 'HEIC';
  return ext;
}

export function GuestPhotoDropzone({
  onUploadSuccess,
  defaultUploaderName,
  dropzoneRef,
  className,
}: GuestPhotoDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadStatus[]>([]);
  const [uploaderName, setUploaderName] = useState(() => defaultUploaderName?.trim() ?? '');
  const hasEditedUploaderNameRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const trimmedDefault = defaultUploaderName?.trim() ?? '';
    if (trimmedDefault && !hasEditedUploaderNameRef.current) {
      setUploaderName(trimmedDefault);
    }
  }, [defaultUploaderName]);

  const activeBatchesRef = useRef<Map<string, ActiveBatchState>>(new Map());
  const inFlightItemIdsRef = useRef<Set<string>>(new Set());
  const previewUrlsRef = useRef<Map<string, string>>(new Map());
  const uploadsRef = useRef<UploadStatus[]>(uploads);
  const isMountedRef = useRef(true);
  const uploadCounterRef = useRef(0);
  const batchCounterRef = useRef(0);
  const processQueueRef = useRef<() => void>(() => {});

  const revokePreviewForId = useCallback((id: string) => {
    const existingUrl = previewUrlsRef.current.get(id);
    if (existingUrl) {
      if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        try {
          URL.revokeObjectURL(existingUrl);
        } catch {
          // Ignore environments without revokeObjectURL implementation
        }
      }
      previewUrlsRef.current.delete(id);
    }
  }, []);

  const revokeAllPreviews = useCallback(() => {
    previewUrlsRef.current.forEach((previewUrl) => {
      if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        try {
          URL.revokeObjectURL(previewUrl);
        } catch {
          // Ignore environments without revokeObjectURL implementation
        }
      }
    });
    previewUrlsRef.current.clear();
  }, []);

  const validateFile = useCallback((file: File): string | null => {
    if (file.size > MAX_GUEST_PHOTO_SIZE) {
      return `"${file.name}" exceeds the 10 MB limit (${(file.size / (1024 * 1024)).toFixed(1)} MB).`;
    }
    const ext = getFileExtension(file.name);
    const mime = (file.type || '').toLowerCase();
    const isAllowedHeicFallback =
      isHeicExtension(ext) && (mime === '' || mime === 'application/octet-stream');
    if (
      (!GUEST_PHOTO_ACCEPTED_TYPES.includes(mime) && !isAllowedHeicFallback) ||
      !GUEST_PHOTO_ALLOWED_EXTENSIONS.includes(ext)
    ) {
      return `"${file.name}" is an unsupported format. Please upload JPEG, PNG, WebP, or HEIC images.`;
    }
    return null;
  }, []);

  const uploadBatch = useCallback(
    async (batchItems: UploadStatus[]) => {
      if (batchItems.length === 0) return;

      const batchId = `batch-${++batchCounterRef.current}`;
      const controller = new AbortController();
      const batchItemIds = new Set(batchItems.map((item) => item.id));
      activeBatchesRef.current.set(batchId, {
        controller,
        itemIds: new Set(batchItemIds),
      });
      batchItemIds.forEach((id) => inFlightItemIdsRef.current.add(id));

      setUploads((prev) => {
        const next = prev.map((item) =>
          batchItemIds.has(item.id)
            ? { ...item, status: 'uploading' as const, progress: 30 }
            : item
        );
        uploadsRef.current = next;
        return next;
      });

      try {
        const formData = new FormData();
        const trimmedUploaderName = batchItems[0]?.uploaderName?.trim();
        if (trimmedUploaderName) {
          formData.append('uploaderName', trimmedUploaderName);
        }

        batchItems.forEach((item) => {
          if (item.file) {
            formData.append('files', item.file);
            formData.append('captions', item.caption?.trim() ?? '');
          }
        });

        if (batchItems.length === 1) {
          const singleCaption = batchItems[0]?.caption?.trim();
          if (singleCaption) {
            formData.append('caption', singleCaption);
          }
        }

        setUploads((prev) => {
          const next = prev.map((item) =>
            batchItemIds.has(item.id) ? { ...item, progress: 60 } : item
          );
          uploadsRef.current = next;
          return next;
        });

        const response = await fetch(withBasePath('/api/guest/photos/upload'), {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        });

        const json = await response.json();

        const activeBatch = activeBatchesRef.current.get(batchId);
        const remainingIds = activeBatch ? new Set(activeBatch.itemIds) : batchItemIds;

        if (!response.ok || !json.success) {
          const errorMsg = json.error || 'Failed to upload photo';
          if (isMountedRef.current) {
            setUploads((prev) => {
              const next = prev.map((item) =>
                remainingIds.has(item.id)
                  ? { ...item, status: 'error' as const, progress: 0, errorMessage: errorMsg }
                  : item
              );
              uploadsRef.current = next;
              return next;
            });
          }
          return;
        }

        const dataItems: UploadedPhoto[] = Array.isArray(json.data)
          ? json.data
          : json.data
            ? [json.data]
            : [];

        const resultByItemId = new Map<string, UploadedPhoto | undefined>();
        batchItems.forEach((item, index) => {
          resultByItemId.set(item.id, dataItems[index] ?? dataItems[0]);
        });

        if (isMountedRef.current) {
          setUploads((prev) => {
            const next = prev.map((item) => {
              if (!remainingIds.has(item.id)) return item;
              const matchedPhoto = resultByItemId.get(item.id);
              const publishedLive = Boolean(
                matchedPhoto &&
                  matchedPhoto.status === 'APPROVED' &&
                  matchedPhoto.isVisible !== false
              );
              return {
                ...item,
                status: 'success' as const,
                progress: 100,
                url: matchedPhoto?.url,
                publishedLive,
              };
            });
            uploadsRef.current = next;
            return next;
          });
        }

        if (onUploadSuccess && dataItems.length > 0) {
          const isApprovedUpload = (
            photo: UploadedPhoto | null | undefined
          ): photo is UploadedPhoto =>
            Boolean(
              photo && photo.status === 'APPROVED' && photo.isVisible !== false && photo.url
            );
          const mapApprovedPhoto = (photo: UploadedPhoto): UploadedPhoto => ({
            id: photo.nodeId || photo.id,
            url: photo.url,
            title: photo.title,
            altText: photo.altText,
            uploaderName: photo.uploaderName,
            caption: photo.caption,
            createdAt: photo.createdAt,
            nodeId: photo.nodeId,
            status: photo.status,
            isVisible: photo.isVisible,
          });

          batchItems.forEach((item, index) => {
            if (!remainingIds.has(item.id)) return;
            const photo = dataItems[index] ?? (batchItems.length === 1 ? dataItems[0] : undefined);
            if (isApprovedUpload(photo)) {
              onUploadSuccess(mapApprovedPhoto(photo));
            }
          });
        }
      } catch (err: unknown) {
        const isAbort =
          (err instanceof Error && err.name === 'AbortError') ||
          (typeof err === 'object' &&
            err !== null &&
            (err as { name?: string }).name === 'AbortError');

        const activeBatch = activeBatchesRef.current.get(batchId);
        const remainingIds = activeBatch ? new Set(activeBatch.itemIds) : new Set<string>();

        if (isAbort) {
          if (isMountedRef.current && remainingIds.size > 0) {
            setUploads((prev) => {
              const next = prev.filter((item) => {
                if (remainingIds.has(item.id)) {
                  revokePreviewForId(item.id);
                  return false;
                }
                return true;
              });
              uploadsRef.current = next;
              return next;
            });
          }
          return;
        }

        if (!isMountedRef.current) return;
        const errorMessage = err instanceof Error ? err.message : 'Network error during upload';
        setUploads((prev) => {
          const next = prev.map((item) =>
            remainingIds.has(item.id)
              ? {
                ...item,
                status: 'error' as const,
                progress: 0,
                errorMessage,
              }
              : item
          );
          uploadsRef.current = next;
          return next;
        });
      } finally {
        activeBatchesRef.current.delete(batchId);
        batchItemIds.forEach((id) => inFlightItemIdsRef.current.delete(id));
        processQueueRef.current();
      }
    },
    [onUploadSuccess, revokePreviewForId]
  );

  const processQueue = useCallback(() => {
    const activeCount = activeBatchesRef.current.size;
    if (activeCount >= MAX_CONCURRENT_UPLOADS) {
      return;
    }

    const availableSlots = MAX_CONCURRENT_UPLOADS - activeCount;
    const currentUploads = uploadsRef.current;

    const pendingItems = currentUploads
      .filter(
        (item) =>
          item.status === 'pending' &&
          Boolean(item.file) &&
          !inFlightItemIdsRef.current.has(item.id)
      )
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    if (pendingItems.length === 0) {
      return;
    }

    let cursor = 0;
    for (let slot = 0; slot < availableSlots && cursor < pendingItems.length; slot += 1) {
      const chunk = pendingItems.slice(cursor, cursor + MAX_FILES_PER_BATCH);
      cursor += chunk.length;
      if (chunk.length > 0) {
        void uploadBatch(chunk);
      }
    }
  }, [uploadBatch]);

  useEffect(() => {
    uploadsRef.current = uploads;
    processQueueRef.current = processQueue;
    processQueue();
  }, [uploads, processQueue]);

  useEffect(() => {
    isMountedRef.current = true;
    const batches = activeBatchesRef.current;
    const inFlightIds = inFlightItemIdsRef.current;
    return () => {
      isMountedRef.current = false;
      batches.forEach((batch) => {
        batch.controller.abort();
      });
      batches.clear();
      inFlightIds.clear();
      revokeAllPreviews();
    };
  }, [revokeAllPreviews]);

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      if (fileArray.length === 0) return;

      const newStatuses: UploadStatus[] = [];

      fileArray.forEach((file) => {
        const id = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const validationError = validateFile(file);
        const ext = getFileExtension(file.name);
        const heic = isHeicExtension(ext);
        const formatLabel = resolveFormatLabel(file.name);

        let previewUrl: string | undefined;
        if (
          !validationError &&
          !heic &&
          typeof URL !== 'undefined' &&
          typeof URL.createObjectURL === 'function'
        ) {
          try {
            previewUrl = URL.createObjectURL(file);
            previewUrlsRef.current.set(id, previewUrl);
          } catch {
            previewUrl = undefined;
          }
        }

        if (validationError) {
          newStatuses.push({
            id,
            filename: file.name,
            size: file.size,
            progress: 0,
            status: 'error',
            errorMessage: validationError,
            isHeic: heic,
            formatLabel,
            file,
            order: uploadCounterRef.current++,
          });
        } else {
          newStatuses.push({
            id,
            filename: file.name,
            size: file.size,
            progress: 0,
            status: 'staged',
            previewUrl,
            isHeic: heic,
            formatLabel,
            caption: '',
            file,
            order: uploadCounterRef.current++,
          });
        }
      });

      setUploads((prev) => {
        const next = [...prev, ...newStatuses];
        uploadsRef.current = next;
        return next;
      });
    },
    [validateFile]
  );

  const handleItemCaptionChange = useCallback((uploadId: string, nextCaption: string) => {
    setUploads((prev) => {
      const next = prev.map((item) =>
        item.id === uploadId ? { ...item, caption: nextCaption } : item
      );
      uploadsRef.current = next;
      return next;
    });
  }, []);

  const handlePreviewError = useCallback(
    (uploadId: string) => {
      revokePreviewForId(uploadId);
      setUploads((prev) => {
        const next = prev.map((item) =>
          item.id === uploadId
            ? { ...item, previewUrl: undefined, previewFailed: true }
            : item
        );
        uploadsRef.current = next;
        return next;
      });
    },
    [revokePreviewForId]
  );

  const handleConfirmStagedUploads = useCallback(() => {
    const confirmedUploaderName = uploaderName.trim() || undefined;

    setUploads((prev) => {
      const next = prev.map((item) =>
        item.status === 'staged'
          ? {
            ...item,
            status: 'pending' as const,
            uploaderName: confirmedUploaderName,
            caption: item.caption?.trim() || undefined,
          }
          : item
      );
      uploadsRef.current = next;
      return next;
    });

    processQueueRef.current();
  }, [uploaderName]);

  const handleRetry = useCallback(
    (uploadId: string) => {
      const item = uploadsRef.current.find((u) => u.id === uploadId);
      if (!item || !item.file) return;

      const validationError = validateFile(item.file);
      if (validationError) {
        setUploads((prev) => {
          const next = prev.map((u) =>
            u.id === uploadId
              ? { ...u, status: 'error' as const, progress: 0, errorMessage: validationError }
              : u
          );
          uploadsRef.current = next;
          return next;
        });
        return;
      }

      const updatedUploaderName = uploaderName.trim() || item.uploaderName;
      const updatedCaption = item.caption?.trim() || undefined;

      setUploads((prev) => {
        const next = prev.map((u) =>
          u.id === uploadId
            ? {
              ...u,
              status: 'pending' as const,
              progress: 0,
              errorMessage: undefined,
              order: uploadCounterRef.current++,
              uploaderName: updatedUploaderName,
              caption: updatedCaption,
            }
            : u
        );
        uploadsRef.current = next;
        return next;
      });

      processQueueRef.current();
    },
    [validateFile, uploaderName]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles]
  );

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
      e.target.value = '';
    }
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const removeUploadItem = (id: string) => {
    revokePreviewForId(id);

    activeBatchesRef.current.forEach((batch, batchId) => {
      if (batch.itemIds.has(id)) {
        batch.itemIds.delete(id);
        if (batch.itemIds.size === 0) {
          batch.controller.abort();
          activeBatchesRef.current.delete(batchId);
        }
      }
    });
    inFlightItemIdsRef.current.delete(id);

    setUploads((prev) => {
      const next = prev.filter((item) => item.id !== id);
      uploadsRef.current = next;
      return next;
    });
    processQueueRef.current();
  };

  const handleClearStatus = () => {
    activeBatchesRef.current.forEach((batch) => {
      batch.controller.abort();
    });
    activeBatchesRef.current.clear();
    inFlightItemIdsRef.current.clear();
    revokeAllPreviews();
    setUploads(() => {
      uploadsRef.current = [];
      return [];
    });
  };

  const stagedItems = uploads.filter((item) => item.status === 'staged');
  const stagedCount = stagedItems.length;
  const stagedBatchCount = Math.ceil(stagedCount / MAX_FILES_PER_BATCH);

  return (
    <div className={className}>
      <div className="mb-4">
        <FormGroup>
          <Label
            htmlFor="guest-photo-uploader-name"
            className="font-medium text-stone-800 dark:text-stone-200 mb-1"
          >
            Your Name{' '}
            <span className="text-[var(--color-muted-text,#4b5563)] dark:text-stone-300 font-normal">
              (optional)
            </span>
          </Label>
          <Input
            id="guest-photo-uploader-name"
            name="uploaderName"
            type="text"
            autoComplete="name"
            maxLength={100}
            value={uploaderName}
            onChange={(e) => {
              hasEditedUploaderNameRef.current = true;
              setUploaderName(e.target.value);
            }}
            placeholder="e.g. Aunt Clara"
            data-testid="guest-photo-uploader-name"
            style={{ borderRadius: '0.75rem' }}
            className="rounded-xl bg-white dark:bg-stone-900 px-3.5 py-2 text-stone-900 dark:text-stone-100 placeholder:text-[var(--color-muted-text,#4b5563)]"
          />
        </FormGroup>
      </div>

      <label htmlFor="guest-photo-file-input" className="sr-only">
        Upload wedding photos
      </label>
      <input
        type="file"
        id="guest-photo-file-input"
        ref={fileInputRef}
        onChange={handleFileInputChange}
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
        multiple
        className="hidden"
        data-testid="guest-photo-file-input"
        aria-label="Upload wedding photos"
      />

      <div
        ref={dropzoneRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={openFilePicker}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openFilePicker();
          }
        }}
        data-testid="guest-photo-dropzone"
        className={`relative border-2 border-dashed rounded-2xl p-6 sm:p-8 text-center cursor-pointer transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring,var(--color-primary,#B91C1C))] focus-visible:ring-offset-2 focus-visible:forced-colors:outline focus-visible:forced-colors:outline-2 ${
          isDragging
            ? 'border-[var(--color-primary,#B91C1C)] bg-primary/10 scale-[1.01]'
            : 'border-[var(--color-surface-border,#6b7280)] bg-stone-50/60 dark:bg-stone-900/40 hover:border-[var(--color-primary,#B91C1C)] hover:bg-stone-100/80 dark:hover:bg-stone-900/80'
        }`}
      >
        <div className="flex flex-col items-center justify-center space-y-3">
          <div className="p-3.5 rounded-full bg-primary/10 text-primary">
            <Icon name="Upload" className="w-7 h-7" />
          </div>
          <div>
            <p className="text-lg font-semibold text-stone-800 dark:text-stone-100">
              {isDragging
                ? 'Drop your photos here!'
                : stagedCount > 0
                  ? 'Tap to add more photos'
                  : 'Share Your Wedding Photos'}
            </p>
            <p className="text-sm text-stone-700 dark:text-stone-200 mt-1">
              Drag and drop image files here, or{' '}
              <span className="text-primary font-semibold underline">browse files</span>
            </p>
          </div>
          <p className="text-xs text-[var(--color-muted-text,#4b5563)] dark:text-stone-300">
            Supports JPEG, PNG, WebP, and HEIC (up to 10 MB per file)
          </p>
        </div>
      </div>

      {uploads.length > 0 && (
        <div className="mt-6 space-y-3" data-testid="upload-progress-container">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-semibold text-stone-800 dark:text-stone-200">
                Upload Status
              </h2>
              {stagedCount > 0 && (
                <span
                  data-testid="staged-batch-pill"
                  className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-[var(--color-primary-text,var(--color-primary,#B91C1C))]"
                >
                  {`${stagedCount} · ${stagedBatchCount} ${stagedBatchCount === 1 ? 'Batch' : 'Batches'}`}
                </span>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClearStatus}
              className="text-[var(--color-muted-text,#4b5563)] dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100"
              data-testid="clear-status-button"
            >
              Clear status
            </Button>
          </div>

          <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1" data-testid="staged-photo-list">
            {uploads.map((item) => {
              const showCaptionInput =
                item.status === 'staged' || (item.status === 'error' && Boolean(item.file));
              const showHeicBadge = Boolean(item.isHeic) || (!item.previewUrl && Boolean(item.previewFailed));

              return (
                <div
                  key={item.id}
                  data-testid={`upload-status-item-${item.id}`}
                  className="p-3 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 shadow-sm flex flex-col gap-2"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-14 h-14 rounded-lg overflow-hidden shrink-0 bg-stone-100 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 flex items-center justify-center">
                      {item.previewUrl && !item.isHeic ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={item.previewUrl}
                          alt={`Preview of ${item.filename}`}
                          data-testid="upload-thumbnail-preview"
                          onError={() => handlePreviewError(item.id)}
                          className="w-full h-full object-cover"
                        />
                      ) : showHeicBadge ? (
                        <div
                          data-testid="upload-heic-badge"
                          className="flex flex-col items-center justify-center text-[var(--color-muted-text,#4b5563)] dark:text-stone-200 px-1"
                        >
                          <Icon name="Image" className="w-4 h-4 mb-0.5 shrink-0" aria-hidden="true" />
                          <span className="text-[10px] font-bold tracking-wider uppercase">
                            HEIC
                          </span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center text-[var(--color-muted-text,#4b5563)] dark:text-stone-200 px-1">
                          <Icon name="Image" className="w-4 h-4 mb-0.5 shrink-0" aria-hidden="true" />
                          <span className="text-[10px] font-bold tracking-wider uppercase">
                            {item.formatLabel || 'IMG'}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-semibold text-sm text-stone-800 dark:text-stone-100 truncate">
                            {item.filename}
                          </span>
                          <span className="text-xs text-[var(--color-muted-text,#4b5563)] dark:text-stone-300 shrink-0">
                            ({(item.size / (1024 * 1024)).toFixed(1)} MB)
                          </span>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {item.status === 'staged' && (
                            <span
                              className="text-xs text-[var(--color-primary-text,var(--color-primary,#B91C1C))] flex items-center gap-1 font-medium"
                              data-testid="upload-staged-badge"
                            >
                              Ready to upload
                            </span>
                          )}
                          {item.status === 'pending' && (
                            <span
                              role="status"
                              aria-live="polite"
                              className="text-xs text-[var(--color-muted-text,#4b5563)] dark:text-stone-300 flex items-center gap-1 font-medium"
                              data-testid="upload-pending-badge"
                            >
                              <span className="sr-only">{`${item.filename}: `}</span>
                              <span>Queued</span>
                            </span>
                          )}
                          {item.status === 'uploading' && (
                            <span className="text-xs text-primary flex items-center gap-1 font-medium">
                              <Icon name="Loader2" className="w-3.5 h-3.5 animate-spin" />
                              <span>Uploading...</span>
                            </span>
                          )}
                          {item.status === 'success' &&
                            (item.publishedLive ? (
                              <span
                                className="text-xs text-[var(--color-status-success-text,#166534)] flex items-center gap-1 font-medium"
                                data-testid="upload-success-badge"
                              >
                                <Icon
                                  name="Check"
                                  className="w-3.5 h-3.5 shrink-0"
                                  aria-hidden="true"
                                />
                                <span>Published Live</span>
                              </span>
                            ) : (
                              <span
                                className="text-xs text-[var(--color-warning-text,#78350f)] flex items-center gap-1 font-medium"
                                data-testid="upload-success-badge"
                              >
                                <Icon
                                  name="Check"
                                  className="w-3.5 h-3.5 shrink-0"
                                  aria-hidden="true"
                                />
                                <span>Uploaded (Pending Review)</span>
                              </span>
                            ))}
                          {item.status === 'error' && (
                            <div className="flex items-center gap-2">
                              <span
                                className="text-xs text-[var(--color-error-text,#dc2626)] flex items-center gap-1 font-medium"
                                data-testid="upload-error-badge"
                              >
                                <Icon name="AlertTriangle" className="w-3.5 h-3.5 shrink-0" />
                                <span>Failed</span>
                              </span>
                              {item.file && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleRetry(item.id)}
                                  data-testid={`retry-upload-${item.id}`}
                                  srContext={`upload for ${item.filename}`}
                                  className="gap-1 px-2.5 border-[var(--color-error-text,#dc2626)] text-[var(--color-error-text,#dc2626)] hover:bg-red-50 dark:hover:bg-red-950/40"
                                >
                                  <Icon name="RotateCw" className="w-3.5 h-3.5 shrink-0" />
                                  <span>Retry</span>
                                </Button>
                              )}
                            </div>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeUploadItem(item.id)}
                            className="w-8 px-0 text-[var(--color-muted-text,#4b5563)] dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100 shrink-0"
                            aria-label={`Remove ${item.filename}`}
                          >
                            <Icon name="X" className="w-4 h-4 shrink-0" />
                          </Button>
                        </div>
                      </div>

                      <p className="text-[11px] uppercase font-medium text-[var(--color-muted-text,#4b5563)] dark:text-stone-300 mt-0.5">
                        {item.formatLabel || 'IMG'}
                      </p>

                      {showCaptionInput ? (
                        <div className="mt-1.5">
                          <label htmlFor={`guest-photo-caption-${item.id}`} className="sr-only">
                            {`Caption for ${item.filename}`}
                          </label>
                          <Input
                            id={`guest-photo-caption-${item.id}`}
                            name={`caption-${item.id}`}
                            type="text"
                            maxLength={500}
                            value={item.caption ?? ''}
                            onChange={(e) => handleItemCaptionChange(item.id, e.target.value)}
                            placeholder="Add a caption (optional)..."
                            data-testid="guest-photo-caption-input"
                            className="w-full text-xs py-1.5 px-2.5 rounded-lg bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-800 dark:text-stone-100 placeholder:text-[var(--color-muted-text,#4b5563)]"
                          />
                        </div>
                      ) : item.caption ? (
                        <p className="mt-1 text-xs text-stone-700 dark:text-stone-300 italic truncate">
                          &ldquo;{item.caption}&rdquo;
                        </p>
                      ) : null}
                    </div>
                  </div>

                  {item.status === 'uploading' && (
                    <UploadProgressBar value={item.progress} filename={item.filename} />
                  )}

                  {item.status === 'success' &&
                    (item.publishedLive ? (
                      <div
                        role="status"
                        aria-live="polite"
                        data-testid="upload-live-notice"
                        className="text-xs font-medium bg-emerald-500/10 text-[var(--color-status-success-text,#166534)] p-2 rounded-lg border border-emerald-500/30 flex items-center gap-1.5"
                      >
                        <Icon name="Check" className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>
                          <span className="sr-only">{`${item.filename}: `}</span>
                          <span>
                            Published live! Your photo is now visible in the gallery and reception
                            slideshow.
                          </span>
                        </span>
                      </div>
                    ) : (
                      <UploadStatusNotice data-testid="upload-pending-notice">
                        <span className="sr-only">{`${item.filename}: `}</span>
                        <span>
                          Uploaded! Your photo is waiting for couple approval before appearing in
                          the public gallery.
                        </span>
                      </UploadStatusNotice>
                    ))}

                  {item.status === 'error' && item.errorMessage && (
                    <UploadAlert data-testid="upload-error-message">
                      {!item.errorMessage.includes(item.filename) && (
                        <span className="sr-only">{`${item.filename}: `}</span>
                      )}
                      <span>{item.errorMessage}</span>
                    </UploadAlert>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {stagedCount > 0 && (
        <div
          className="mt-4 p-4 rounded-xl border border-[var(--color-surface-border,#6b7280)] bg-stone-50 dark:bg-stone-900 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
          data-testid="staged-uploads-bar"
        >
          <div className="text-sm text-stone-800 dark:text-stone-100">
            <p className="font-semibold">
              {stagedCount === 1
                ? '1 photo staged and ready to upload'
                : `${stagedCount} photos staged and ready to upload`}
            </p>
            <p className="text-xs text-[var(--color-muted-text,#4b5563)] dark:text-stone-300 mt-0.5">
              {stagedBatchCount > 1
                ? `Uploads automatically in ${stagedBatchCount} batches of up to ${MAX_FILES_PER_BATCH} photos.`
                : 'Add optional per-photo captions above before uploading.'}
            </p>
          </div>
          <Button
            type="button"
            variant="primary"
            onClick={handleConfirmStagedUploads}
            data-testid="confirm-upload-btn"
            className="gap-2 shrink-0 w-full sm:w-auto justify-center"
          >
            <Icon name="Upload" className="w-4 h-4 shrink-0" />
            <span>
              {stagedCount === 1 ? 'Upload 1 Photo' : `Upload ${stagedCount} Photos`}
            </span>
          </Button>
        </div>
      )}
    </div>
  );
}
