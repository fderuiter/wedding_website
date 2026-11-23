'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
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

export interface UploadedPhoto {
  id: string;
  url: string;
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
  status: 'pending' | 'uploading' | 'success' | 'error';
  errorMessage?: string;
  url?: string;
  file?: File;
  order?: number;
  uploaderName?: string;
  caption?: string;
}

interface GuestPhotoDropzoneProps {
  onUploadSuccess?: (photo: UploadedPhoto) => void;
  className?: string;
}

export function GuestPhotoDropzone({ onUploadSuccess, className }: GuestPhotoDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadStatus[]>([]);
  const [uploaderName, setUploaderName] = useState('');
  const [caption, setCaption] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const uploadsRef = useRef<UploadStatus[]>(uploads);
  const isMountedRef = useRef(true);
  const uploadCounterRef = useRef(0);
  const processQueueRef = useRef<() => void>(() => {});

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

  const uploadFile = useCallback(async (
    file: File,
    uploadId: string,
    metadata?: { uploaderName?: string; caption?: string }
  ) => {
    const controller = new AbortController();
    abortControllersRef.current.set(uploadId, controller);

    setUploads((prev) => {
      const next = prev.map((item) =>
        item.id === uploadId ? { ...item, status: 'uploading' as const, progress: 30 } : item
      );
      uploadsRef.current = next;
      return next;
    });

    try {
      const formData = new FormData();
      formData.append('file', file);
      const trimmedUploaderName = metadata?.uploaderName?.trim();
      const trimmedCaption = metadata?.caption?.trim();
      if (trimmedUploaderName) {
        formData.append('uploaderName', trimmedUploaderName);
      }
      if (trimmedCaption) {
        formData.append('caption', trimmedCaption);
      }

      setUploads((prev) => {
        const next = prev.map((item) =>
          item.id === uploadId ? { ...item, progress: 60 } : item
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

      if (!response.ok || !json.success) {
        const errorMsg = json.error || 'Failed to upload photo';
        if (isMountedRef.current) {
          setUploads((prev) => {
            const next = prev.map((item) =>
              item.id === uploadId
                ? { ...item, status: 'error' as const, progress: 0, errorMessage: errorMsg }
                : item
            );
            uploadsRef.current = next;
            return next;
          });
        }
        return;
      }

      const firstPhoto = Array.isArray(json.data) ? json.data[0] : json.data;

      if (isMountedRef.current) {
        setUploads((prev) => {
          const next = prev.map((item) =>
            item.id === uploadId
              ? {
                ...item,
                status: 'success' as const,
                progress: 100,
                url: firstPhoto?.url,
              }
              : item
          );
          uploadsRef.current = next;
          return next;
        });
      }

      if (onUploadSuccess && json.data) {
        const isApprovedUpload = (photo: UploadedPhoto | null | undefined): photo is UploadedPhoto =>
          Boolean(photo && photo.status === 'APPROVED' && photo.isVisible !== false);
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

        if (Array.isArray(json.data)) {
          json.data.forEach((photo: UploadedPhoto) => {
            if (isApprovedUpload(photo)) {
              onUploadSuccess(mapApprovedPhoto(photo));
            }
          });
        } else if (isApprovedUpload(json.data)) {
          onUploadSuccess(mapApprovedPhoto(json.data));
        }
      }
    } catch (err: unknown) {
      const isAbort =
        (err instanceof Error && err.name === 'AbortError') ||
        (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AbortError');

      if (isAbort) {
        if (isMountedRef.current) {
          setUploads((prev) => {
            const next = prev.filter((item) => item.id !== uploadId);
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
          item.id === uploadId
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
      abortControllersRef.current.delete(uploadId);
      processQueueRef.current();
    }
  }, [onUploadSuccess]);

  const processQueue = useCallback(() => {
    const activeCount = abortControllersRef.current.size;
    if (activeCount >= MAX_CONCURRENT_UPLOADS) {
      return;
    }

    const availableSlots = MAX_CONCURRENT_UPLOADS - activeCount;
    const currentUploads = uploadsRef.current;

    const pendingItems = currentUploads
      .filter((item) => item.status === 'pending' && item.file && !abortControllersRef.current.has(item.id))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    if (pendingItems.length === 0) {
      return;
    }

    const itemsToStart = pendingItems.slice(0, availableSlots);
    itemsToStart.forEach((item) => {
      if (item.file) {
        uploadFile(item.file, item.id, {
          uploaderName: item.uploaderName,
          caption: item.caption,
        });
      }
    });
  }, [uploadFile]);

  useEffect(() => {
    uploadsRef.current = uploads;
    processQueueRef.current = processQueue;
    processQueue();
  }, [uploads, processQueue]);

  useEffect(() => {
    isMountedRef.current = true;
    const controllers = abortControllersRef.current;
    return () => {
      isMountedRef.current = false;
      controllers.forEach((controller) => {
        controller.abort();
      });
      controllers.clear();
    };
  }, []);

  const handleFiles = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files);

    if (fileArray.length === 0) return;

    const capturedUploaderName = uploaderName.trim() || undefined;
    const capturedCaption = caption.trim() || undefined;
    const newStatuses: UploadStatus[] = [];

    fileArray.forEach((file) => {
      const id = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const validationError = validateFile(file);

      if (validationError) {
        newStatuses.push({
          id,
          filename: file.name,
          size: file.size,
          progress: 0,
          status: 'error',
          errorMessage: validationError,
          file,
          order: uploadCounterRef.current++,
          uploaderName: capturedUploaderName,
          caption: capturedCaption,
        });
      } else {
        newStatuses.push({
          id,
          filename: file.name,
          size: file.size,
          progress: 0,
          status: 'pending',
          file,
          order: uploadCounterRef.current++,
          uploaderName: capturedUploaderName,
          caption: capturedCaption,
        });
      }
    });

    setUploads((prev) => {
      const next = [...newStatuses, ...prev];
      uploadsRef.current = next;
      return next;
    });

    processQueueRef.current();
  }, [validateFile, uploaderName, caption]);

  const handleRetry = useCallback((uploadId: string) => {
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
    const updatedCaption = caption.trim() || item.caption;

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
  }, [validateFile, uploaderName, caption]);

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

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
      e.target.value = ''; // Reset input
    }
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const removeUploadItem = (id: string) => {
    const controller = abortControllersRef.current.get(id);
    if (controller) {
      controller.abort();
      abortControllersRef.current.delete(id);
    }
    setUploads((prev) => {
      const next = prev.filter((item) => item.id !== id);
      uploadsRef.current = next;
      return next;
    });
    processQueueRef.current();
  };

  const handleClearStatus = () => {
    abortControllersRef.current.forEach((controller) => {
      controller.abort();
    });
    abortControllersRef.current.clear();
    setUploads(() => {
      uploadsRef.current = [];
      return [];
    });
  };

  return (
    <div className={className}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div>
          <label
            htmlFor="guest-photo-uploader-name"
            className="block text-sm font-medium text-stone-800 dark:text-stone-200 mb-1"
          >
            Your Name{' '}
            <span className="text-[var(--color-muted-text,#4b5563)] font-normal">
              (optional)
            </span>
          </label>
          <input
            id="guest-photo-uploader-name"
            name="uploaderName"
            type="text"
            maxLength={100}
            value={uploaderName}
            onChange={(e) => setUploaderName(e.target.value)}
            placeholder="e.g. Aunt Clara"
            data-testid="guest-photo-uploader-name"
            className="w-full rounded-xl border border-[var(--color-surface-border,#6b7280)] bg-white dark:bg-stone-900 px-3.5 py-2 text-sm text-stone-900 dark:text-stone-100 placeholder:text-[var(--color-muted-text,#4b5563)] focus:border-[var(--color-focus-ring,var(--color-primary,#B91C1C))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring,var(--color-primary,#B91C1C))] focus-visible:ring-offset-2"
          />
        </div>
        <div>
          <label
            htmlFor="guest-photo-caption"
            className="block text-sm font-medium text-stone-800 dark:text-stone-200 mb-1"
          >
            Caption or Note{' '}
            <span className="text-[var(--color-muted-text,#4b5563)] font-normal">
              (optional)
            </span>
          </label>
          <input
            id="guest-photo-caption"
            name="caption"
            type="text"
            maxLength={500}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="e.g. Sparkler exit!"
            data-testid="guest-photo-caption"
            className="w-full rounded-xl border border-[var(--color-surface-border,#6b7280)] bg-white dark:bg-stone-900 px-3.5 py-2 text-sm text-stone-900 dark:text-stone-100 placeholder:text-[var(--color-muted-text,#4b5563)] focus:border-[var(--color-focus-ring,var(--color-primary,#B91C1C))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring,var(--color-primary,#B91C1C))] focus-visible:ring-offset-2"
          />
        </div>
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
        className={`relative border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring,var(--color-primary,#B91C1C))] focus-visible:ring-offset-2 focus-visible:forced-colors:outline focus-visible:forced-colors:outline-2 ${
          isDragging
            ? 'border-[var(--color-primary,#B91C1C)] bg-primary/10 scale-[1.01]'
            : 'border-[var(--color-surface-border,#6b7280)] bg-stone-50/60 dark:bg-stone-900/40 hover:border-[var(--color-primary,#B91C1C)] hover:bg-stone-100/80 dark:hover:bg-stone-900/80'
        }`}
      >
        <div className="flex flex-col items-center justify-center space-y-3">
          <div className="p-4 rounded-full bg-primary/10 text-primary">
            <Icon name="Upload" className="w-8 h-8" />
          </div>
          <div>
            <p className="text-lg font-semibold text-stone-800 dark:text-stone-100">
              {isDragging ? 'Drop your photos here!' : 'Share Your Wedding Photos'}
            </p>
            <p className="text-sm text-stone-700 dark:text-stone-200 mt-1">
              Drag and drop image files here, or{' '}
              <span className="text-primary font-semibold underline">browse files</span>
            </p>
          </div>
          <p className="text-xs text-[var(--color-muted-text,#4b5563)]">
            Supports JPEG, PNG, WebP, and HEIC (up to 10 MB per file)
          </p>
        </div>
      </div>

      {uploads.length > 0 && (
        <div className="mt-6 space-y-3" data-testid="upload-progress-container">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-stone-800 dark:text-stone-200">
              Upload Status
            </h2>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClearStatus}
              className="text-[var(--color-muted-text,#4b5563)] hover:text-stone-900 dark:hover:text-stone-100"
              data-testid="clear-status-button"
            >
              Clear status
            </Button>
          </div>

          <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
            {uploads.map((item) => (
              <div
                key={item.id}
                data-testid={`upload-status-item-${item.id}`}
                className="p-3 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 shadow-sm flex flex-col gap-2"
              >
                <div className="flex items-center justify-between text-sm gap-2">
                  <div className="flex items-center gap-2 min-w-0 pr-2">
                    <Icon
                      name="Image"
                      className="w-4 h-4 text-[var(--color-muted-text,#4b5563)] shrink-0"
                    />
                    <span className="font-medium text-stone-800 dark:text-stone-100 truncate">
                      {item.filename}
                    </span>
                    <span className="text-xs text-[var(--color-muted-text,#4b5563)] shrink-0">
                      ({(item.size / (1024 * 1024)).toFixed(1)} MB)
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {item.status === 'pending' && (
                      <span
                        role="status"
                        aria-live="polite"
                        className="text-xs text-[var(--color-muted-text,#4b5563)] flex items-center gap-1 font-medium"
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
                    {item.status === 'success' && (
                      <span
                        className="text-xs text-[var(--color-warning-text,#78350f)] flex items-center gap-1 font-medium"
                        data-testid="upload-success-badge"
                      >
                        <Icon name="Check" className="w-3.5 h-3.5 shrink-0" />
                        <span>Uploaded (Pending Review)</span>
                      </span>
                    )}
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
                      className="w-8 px-0 text-[var(--color-muted-text,#4b5563)] hover:text-stone-900 dark:hover:text-stone-100 shrink-0"
                      aria-label={`Remove ${item.filename}`}
                    >
                      <Icon name="X" className="w-4 h-4 shrink-0" />
                    </Button>
                  </div>
                </div>

                {item.status === 'uploading' && (
                  <UploadProgressBar value={item.progress} filename={item.filename} />
                )}

                {item.status === 'success' && (
                  <UploadStatusNotice data-testid="upload-pending-notice">
                    <span className="sr-only">{`${item.filename}: `}</span>
                    <span>
                      Uploaded! Your photo is waiting for couple approval before appearing in the public gallery.
                    </span>
                  </UploadStatusNotice>
                )}

                {item.status === 'error' && item.errorMessage && (
                  <UploadAlert data-testid="upload-error-message">
                    {!item.errorMessage.includes(item.filename) && (
                      <span className="sr-only">{`${item.filename}: `}</span>
                    )}
                    <span>{item.errorMessage}</span>
                  </UploadAlert>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
