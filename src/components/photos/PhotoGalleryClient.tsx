'use client';

import { useState } from 'react';
import { GuestPhotoDropzone, UploadedPhoto } from './GuestPhotoDropzone';
import { Icon } from '@/components/ui/Icon';
import { MediaImage } from '@/components/MediaImage';
import { Button } from '@/components/ui/Button';

interface PhotoItem {
  id?: string;
  url: string;
  title?: string;
  isGuestUpload?: boolean;
}

interface PhotoGalleryClientProps {
  initialPhotos: string[];
}

export function PhotoGalleryClient({ initialPhotos }: PhotoGalleryClientProps) {
  const [photos, setPhotos] = useState<PhotoItem[]>(() =>
    initialPhotos.map((url) => ({ url }))
  );
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  const [isExporting, setIsExporting] = useState(false);

  const handleUploadSuccess = (uploaded: UploadedPhoto) => {
    setPhotos((prev) => [
      {
        id: uploaded.id,
        url: uploaded.url,
        title: uploaded.altText || 'Guest Photo',
        isGuestUpload: true,
      },
      ...prev,
    ]);
  };

  const toggleSelect = (url: string) => {
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      if (next.has(url)) {
        next.delete(url);
      } else {
        next.add(url);
      }
      return next;
    });
  };

  const guestPhotos = photos.filter((p) => p.isGuestUpload);
  const allDisplayPhotos = photos;

  const toggleSelectAll = () => {
    if (selectedUrls.size === allDisplayPhotos.length) {
      setSelectedUrls(new Set());
    } else {
      setSelectedUrls(new Set(allDisplayPhotos.map((p) => p.url)));
    }
  };

  const handleDownload = async (url: string, bodyPayload?: object, filename = 'guest-photos.zip') => {
    setIsExporting(true);
    try {
      let response: Response;
      if (bodyPayload) {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyPayload),
        });
      } else {
        response = await fetch(url);
      }

      if (!response.ok) {
        throw new Error(`Export failed with HTTP ${response.status}`);
      }

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('Failed to export photos archive:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const exportAllGuestPhotos = () => {
    handleDownload('/api/media/export?tag=guest-upload', undefined, 'guest-photos.zip');
  };

  const exportSelectedPhotos = () => {
    if (selectedUrls.size === 0) return;
    const selectedList = Array.from(selectedUrls);
    // Find matching photo items
    const ids = photos
      .filter((p) => selectedUrls.has(p.url) && p.id)
      .map((p) => p.id!);

    if (ids.length > 0) {
      handleDownload('/api/media/export', { ids }, 'selected-photos.zip');
    } else {
      handleDownload('/api/media/export', { ids: selectedList }, 'selected-photos.zip');
    }
  };

  return (
    <div className="space-y-10">
      {/* Upload Dropzone */}
      <section className="max-w-2xl mx-auto" aria-label="Upload Photos">
        <GuestPhotoDropzone onUploadSuccess={handleUploadSuccess} />
      </section>

      {/* Main Bulk Export Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-700/60 shadow-sm" data-testid="gallery-export-toolbar">
        <div className="flex items-center gap-3">
          <Button
            onClick={exportAllGuestPhotos}
            disabled={isExporting}
            variant="primary"
            data-testid="export-all-guest-photos-btn"
            className="flex items-center gap-2"
          >
            <Icon name="Download" className="w-4 h-4" />
            {isExporting ? 'Preparing Archive...' : 'Export All Guest Photos (.zip)'}
          </Button>

          {selectedUrls.size > 0 && (
            <Button
              onClick={exportSelectedPhotos}
              disabled={isExporting}
              variant="secondary"
              data-testid="export-selected-photos-btn"
              className="flex items-center gap-2"
            >
              <Icon name="Download" className="w-4 h-4" />
              Export Selected ({selectedUrls.size}) (.zip)
            </Button>
          )}
        </div>

        {allDisplayPhotos.length > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleSelectAll}
              data-testid="toggle-select-all-photos-btn"
            >
              {selectedUrls.size === allDisplayPhotos.length ? 'Deselect All' : 'Select All Photos'}
            </Button>
            {selectedUrls.size > 0 && (
              <span className="text-xs text-stone-500 dark:text-stone-400">
                ({selectedUrls.size} of {allDisplayPhotos.length} selected)
              </span>
            )}
          </div>
        )}
      </div>

      {/* Guest Uploaded Photos Grid / Gallery Section */}
      <section className="space-y-4" data-testid="guest-photos-section">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-stone-800 dark:text-stone-200 flex items-center gap-2">
            <Icon name="Camera" className="w-6 h-6 text-primary" />
            Guest Shared Photos{guestPhotos.length > 0 ? ` (${guestPhotos.length})` : ''}
          </h2>
        </div>

        {guestPhotos.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4" data-testid="guest-photos-grid">
            {guestPhotos.map((photo, index) => {
              const isSelected = selectedUrls.has(photo.url);
              return (
                <div
                  key={index}
                  className={`group relative aspect-square rounded-2xl overflow-hidden cursor-pointer shadow-md border ${
                    isSelected
                      ? 'border-primary ring-2 ring-primary/50'
                      : 'border-stone-200 dark:border-stone-800'
                  } bg-stone-100 dark:bg-stone-900 transition-all hover:scale-[1.02]`}
                >
                  {/* Selection Checkbox */}
                  <div
                    className="absolute top-2 left-2 z-20 p-1 bg-black/40 backdrop-blur-sm rounded-md"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(photo.url)}
                      aria-label={`Select guest photo ${index + 1}`}
                      data-testid={`photo-checkbox-${index}`}
                      className="w-4 h-4 rounded border-stone-300 text-primary focus:ring-primary cursor-pointer"
                    />
                  </div>

                  <div onClick={() => setSelectedPhoto(photo.url)} className="w-full h-full">
                    <MediaImage
                      src={photo.url}
                      alt={photo.title || `Guest photo ${index + 1}`}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
                      <span className="text-xs font-medium text-white truncate">
                        {photo.title || 'Guest Photo'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div
            data-testid="guest-photos-empty-state"
            className="rounded-2xl border border-dashed border-stone-300 dark:border-stone-700 bg-stone-50/50 dark:bg-stone-900/30 p-8 text-center flex flex-col items-center justify-center space-y-3"
          >
            <div className="p-3 rounded-full bg-stone-200/60 dark:bg-stone-800 text-stone-500 dark:text-stone-400">
              <Icon name="ImageOff" className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-stone-800 dark:text-stone-200">
                No guest photos yet
              </h3>
              <p className="text-sm text-stone-500 dark:text-stone-400 mt-1 max-w-sm">
                Be the first to share your favorite memories from the celebration using the upload section above!
              </p>
            </div>
          </div>
        )}
      </section>

      {/* Lightbox Modal */}
      {selectedPhoto && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setSelectedPhoto(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Photo Preview"
        >
          <div className="relative max-w-4xl max-h-[90vh] w-full h-full flex items-center justify-center">
            <button
              onClick={() => setSelectedPhoto(null)}
              className="absolute top-4 right-4 z-10 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition"
              aria-label="Close photo preview"
            >
              <Icon name="X" className="w-6 h-6" />
            </button>
            <MediaImage
              src={selectedPhoto}
              alt="Photo preview"
              width={1200}
              height={800}
              className="max-h-[85vh] max-w-full object-contain rounded-lg"
            />
          </div>
        </div>
      )}
    </div>
  );
}
