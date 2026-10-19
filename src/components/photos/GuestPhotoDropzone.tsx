'use client';

import { useState, useRef, useCallback } from 'react';
import { Icon } from '@/components/ui/Icon';
import { MAX_GUEST_PHOTO_SIZE, GUEST_PHOTO_ACCEPTED_TYPES, GUEST_PHOTO_ALLOWED_EXTENSIONS, getFileExtension } from '@/utils/validation';

export interface UploadedPhoto {
  id: string;
  url: string;
  altText?: string | null;
  createdAt?: string | Date;
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
}

interface GuestPhotoDropzoneProps {
  onUploadSuccess?: (photo: UploadedPhoto) => void;
  className?: string;
}

export function GuestPhotoDropzone({ onUploadSuccess, className }: GuestPhotoDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadStatus[]>([]);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateFile = useCallback((file: File): string | null => {
    if (file.size > MAX_GUEST_PHOTO_SIZE) {
      return `"${file.name}" exceeds the 10 MB limit (${(file.size / (1024 * 1024)).toFixed(1)} MB).`;
    }
    const ext = getFileExtension(file.name);
    if (!GUEST_PHOTO_ACCEPTED_TYPES.includes(file.type) || !GUEST_PHOTO_ALLOWED_EXTENSIONS.includes(ext)) {
      return `"${file.name}" is an unsupported format. Please upload JPEG, PNG, or WebP images.`;
    }
    return null;
  }, []);

  const uploadFile = useCallback(async (file: File, uploadId: string) => {
    setUploads((prev) =>
      prev.map((item) =>
        item.id === uploadId ? { ...item, status: 'uploading', progress: 30 } : item
      )
    );

    try {
      const formData = new FormData();
      formData.append('file', file);

      setUploads((prev) =>
        prev.map((item) =>
          item.id === uploadId ? { ...item, progress: 60 } : item
        )
      );

      const response = await fetch('/api/guest/photos/upload', {
        method: 'POST',
        body: formData,
      });

      const json = await response.json();

      if (!response.ok || !json.success) {
        const errorMsg = json.error || 'Failed to upload photo';
        setUploads((prev) =>
          prev.map((item) =>
            item.id === uploadId
              ? { ...item, status: 'error', progress: 0, errorMessage: errorMsg }
              : item
          )
        );
        return;
      }

      setUploads((prev) =>
        prev.map((item) =>
          item.id === uploadId
            ? {
              ...item,
              status: 'success',
              progress: 100,
              url: json.data?.url,
            }
            : item
        )
      );

      if (onUploadSuccess && json.data) {
        onUploadSuccess({
          id: json.data.id,
          url: json.data.url,
          altText: json.data.altText,
          createdAt: json.data.createdAt,
        });
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Network error during upload';
      setUploads((prev) =>
        prev.map((item) =>
          item.id === uploadId
            ? {
              ...item,
              status: 'error',
              progress: 0,
              errorMessage,
            }
            : item
        )
      );
    }
  }, [onUploadSuccess]);

  const handleFiles = useCallback((files: FileList | File[]) => {
    setGlobalError(null);
    const fileArray = Array.from(files);

    if (fileArray.length === 0) return;

    const newStatuses: UploadStatus[] = [];
    const validFilesToUpload: { file: File; id: string }[] = [];

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
        });
      } else {
        newStatuses.push({
          id,
          filename: file.name,
          size: file.size,
          progress: 0,
          status: 'pending',
          file,
        });
        validFilesToUpload.push({ file, id });
      }
    });

    setUploads((prev) => [...newStatuses, ...prev]);

    validFilesToUpload.forEach(({ file, id }) => {
      uploadFile(file, id);
    });
  }, [validateFile, uploadFile]);

  const handleRetry = useCallback((uploadId: string) => {
    const item = uploads.find((u) => u.id === uploadId);
    if (!item || !item.file) return;

    const validationError = validateFile(item.file);
    if (validationError) {
      setUploads((prev) =>
        prev.map((u) =>
          u.id === uploadId
            ? { ...u, status: 'error', progress: 0, errorMessage: validationError }
            : u
        )
      );
      return;
    }

    uploadFile(item.file, uploadId);
  }, [uploads, validateFile, uploadFile]);

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
    setUploads((prev) => prev.filter((item) => item.id !== id));
  };

  return (
    <div className={className}>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileInputChange}
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        data-testid="guest-photo-file-input"
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
        className={`relative border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/50 ${
          isDragging
            ? 'border-primary bg-primary/10 scale-[1.01]'
            : 'border-stone-300 dark:border-stone-700 bg-stone-50/60 dark:bg-stone-900/40 hover:border-primary/60 hover:bg-stone-100/80 dark:hover:bg-stone-900/80'
        }`}
      >
        <div className="flex flex-col items-center justify-center space-y-3">
          <div className="p-4 rounded-full bg-primary/10 text-primary">
            <Icon name="Upload" className="w-8 h-8" />
          </div>
          <div>
            <p className="text-lg font-semibold text-stone-800 dark:text-stone-200">
              {isDragging ? 'Drop your photos here!' : 'Share Your Wedding Photos'}
            </p>
            <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">
              Drag and drop image files here, or <span className="text-primary font-medium underline">browse files</span>
            </p>
          </div>
          <p className="text-xs text-stone-400 dark:text-stone-500">
            Supports JPEG, PNG, and WebP (up to 10 MB per file)
          </p>
        </div>
      </div>

      {globalError && (
        <div
          role="alert"
          className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-sm flex items-center gap-2"
        >
          <Icon name="AlertTriangle" className="w-4 h-4 shrink-0" />
          <span>{globalError}</span>
        </div>
      )}

      {uploads.length > 0 && (
        <div className="mt-6 space-y-3" data-testid="upload-progress-container">
          <h4 className="text-sm font-semibold text-stone-700 dark:text-stone-300 flex items-center justify-between">
            <span>Upload Status</span>
            <button
              type="button"
              onClick={() => setUploads([])}
              className="text-xs text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
            >
              Clear status
            </button>
          </h4>

          <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
            {uploads.map((item) => (
              <div
                key={item.id}
                data-testid={`upload-status-item-${item.id}`}
                className="p-3 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 shadow-sm flex flex-col gap-2"
              >
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 truncate pr-2">
                    <Icon name="Image" className="w-4 h-4 text-stone-400 shrink-0" />
                    <span className="font-medium text-stone-700 dark:text-stone-300 truncate">
                      {item.filename}
                    </span>
                    <span className="text-xs text-stone-400 shrink-0">
                      ({(item.size / (1024 * 1024)).toFixed(1)} MB)
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {item.status === 'uploading' && (
                      <span className="text-xs text-primary flex items-center gap-1 font-medium">
                        <Icon name="Loader2" className="w-3.5 h-3.5 animate-spin" />
                        Uploading...
                      </span>
                    )}
                    {item.status === 'success' && (
                      <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1 font-medium" data-testid="upload-success-badge">
                        <Icon name="Check" className="w-3.5 h-3.5" />
                        Uploaded (Pending Review)
                      </span>
                    )}
                    {item.status === 'error' && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1 font-medium" data-testid="upload-error-badge">
                          <Icon name="AlertTriangle" className="w-3.5 h-3.5" />
                          Failed
                        </span>
                        {item.file && (
                          <button
                            type="button"
                            onClick={() => handleRetry(item.id)}
                            data-testid={`retry-upload-${item.id}`}
                            className="text-xs px-2 py-0.5 rounded bg-red-100 hover:bg-red-200 dark:bg-red-900/40 dark:hover:bg-red-900/60 text-red-700 dark:text-red-300 font-medium transition-colors flex items-center gap-1"
                          >
                            <Icon name="RotateCw" className="w-3 h-3" />
                            Retry
                          </button>
                        )}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeUploadItem(item.id)}
                      className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 p-0.5 rounded"
                      aria-label="Remove item"
                    >
                      <Icon name="X" className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {item.status === 'uploading' && (
                  <div className="w-full bg-stone-100 dark:bg-stone-800 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-primary h-1.5 rounded-full transition-all duration-300"
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                )}

                {item.status === 'success' && (
                  <p className="text-xs text-amber-700 dark:text-amber-300 font-medium bg-amber-500/10 p-2 rounded-lg border border-amber-500/20 flex items-center gap-1.5" data-testid="upload-pending-notice">
                    <Icon name="Info" className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <span>Uploaded! Your photo is waiting for couple approval before appearing in the public gallery.</span>
                  </p>
                )}

                {item.status === 'error' && item.errorMessage && (
                  <p className="text-xs text-red-600 dark:text-red-400 font-medium" data-testid="upload-error-message">
                    {item.errorMessage}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
