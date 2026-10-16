'use client';

import React, { useState, useRef, useId } from 'react';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/utils/cn';
import { apiClient } from '@/lib/apiClient';
import {
  MAX_UPLOAD_SIZE,
  ACCEPTED_IMAGE_TYPES,
  ALLOWED_EXTENSIONS,
  getFileExtension,
} from '@/utils/validation';

interface DropzoneProps extends React.HTMLAttributes<HTMLDivElement> {
  uploadUrl?: string;
  maxSize?: number;
  acceptTypes?: string[];
  allowedExtensions?: string[];
  onUploadSuccess?: (url: string, file: File) => void;
  onUploadError?: (error: string) => void;
  onFileSelect?: (file: File) => void;
  label?: string;
  hint?: string;
  disabled?: boolean;
  className?: string;
}

const Dropzone = React.forwardRef<HTMLDivElement, DropzoneProps>(
  (
    {
      uploadUrl = '/api/admin/upload',
      maxSize = MAX_UPLOAD_SIZE,
      acceptTypes = ACCEPTED_IMAGE_TYPES,
      allowedExtensions = ALLOWED_EXTENSIONS,
      onUploadSuccess,
      onUploadError,
      onFileSelect,
      label = 'Drag and drop an image file here, or click to browse',
      hint = 'Supports JPG, PNG, and ICO files up to 5MB',
      disabled = false,
      className,
      ...props
    },
    ref
  ) => {
    const [isDragActive, setIsDragActive] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const errorId = useId();

    const validateFile = (file: File): string | null => {
      if (file.size > maxSize) {
        return 'File size exceeds 5MB limit';
      }

      const ext = getFileExtension(file.name);
      const isTypeValid = acceptTypes.includes(file.type);
      const isExtValid = allowedExtensions.includes(ext);

      if (!isTypeValid && !isExtValid) {
        return 'Invalid file format. Only JPG, PNG, and ICO are supported';
      }

      return null;
    };

    const handleFile = async (file: File) => {
      setError(null);

      const validationError = validateFile(file);
      if (validationError) {
        setError(validationError);
        if (onUploadError) {
          onUploadError(validationError);
        }
        return;
      }

      if (onFileSelect) {
        onFileSelect(file);
      }

      setIsUploading(true);
      try {
        const formData = new FormData();
        formData.append('file', file);

        const data = await apiClient.post<{ url: string }>(uploadUrl, formData);
        if (onUploadSuccess) {
          onUploadSuccess(data.url, file);
        }
      } catch (err: any) {
        const errorMsg = err.message || 'Upload failed. Please try again.';
        setError(errorMsg);
        if (onUploadError) {
          onUploadError(errorMsg);
        }
      } finally {
        setIsUploading(false);
      }
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled && !isUploading) {
        setIsDragActive(true);
      }
    };

    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragActive(false);
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragActive(false);

      if (disabled || isUploading) return;

      const droppedFiles = e.dataTransfer.files;
      if (droppedFiles && droppedFiles.length > 0) {
        handleFile(droppedFiles[0]);
      }
    };

    const handleClick = () => {
      if (!disabled && !isUploading && fileInputRef.current) {
        fileInputRef.current.click();
      }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      if ((e.key === 'Enter' || e.key === ' ') && !disabled && !isUploading) {
        e.preventDefault();
        handleClick();
      }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = e.target.files;
      if (selectedFiles && selectedFiles.length > 0) {
        handleFile(selectedFiles[0]);
      }
      // Reset input value so re-selecting the same file triggers onChange
      e.target.value = '';
    };

    return (
      <div className="w-full">
        <div
          ref={ref}
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled || isUploading}
          aria-describedby={error ? errorId : undefined}
          aria-label="File upload dropzone"
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            'relative flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-xl transition-colors cursor-pointer text-center select-none focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2',
            isDragActive
              ? 'border-rose-500 bg-rose-50/50 dark:bg-rose-950/20'
              : 'border-gray-300 dark:border-gray-700 hover:border-rose-400 dark:hover:border-rose-500 bg-gray-50/50 dark:bg-gray-800/50',
            (disabled || isUploading) && 'opacity-60 cursor-not-allowed pointer-events-none',
            error && 'border-red-500 dark:border-red-500 bg-red-50/30 dark:bg-red-950/20',
            className
          )}
          {...props}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={allowedExtensions.join(',')}
            onChange={handleInputChange}
            disabled={disabled || isUploading}
            className="hidden"
            data-testid="dropzone-file-input"
          />

          <Icon
            name={isUploading ? 'Loader2' : 'UploadCloud'}
            className={cn(
              'h-10 w-10 mb-2 text-gray-400 dark:text-gray-500',
              isUploading && 'animate-spin text-rose-500'
            )}
          />

          <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {isUploading ? 'Uploading image...' : label}
          </p>

          {hint && !isUploading && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{hint}</p>
          )}
        </div>

        {error && (
          <p id={errorId} role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
    );
  }
);

Dropzone.displayName = 'Dropzone';

export default Dropzone;
