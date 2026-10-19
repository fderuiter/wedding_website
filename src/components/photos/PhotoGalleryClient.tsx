'use client';

import { useState } from 'react';
import { GuestPhotoDropzone, UploadedPhoto } from './GuestPhotoDropzone';
import { Icon } from '@/components/ui/Icon';
import { MediaImage } from '@/components/MediaImage';

interface PhotoItem {
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

  const handleUploadSuccess = (uploaded: UploadedPhoto) => {
    setPhotos((prev) => [
      {
        url: uploaded.url,
        title: uploaded.altText || 'Guest Photo',
        isGuestUpload: true,
      },
      ...prev,
    ]);
  };

  return (
    <div className="space-y-10">
      {/* Upload Dropzone */}
      <section className="max-w-2xl mx-auto" aria-label="Upload Photos">
        <GuestPhotoDropzone onUploadSuccess={handleUploadSuccess} />
      </section>

      {/* Guest Uploaded Photos Grid / Gallery Section */}
      <section className="space-y-4" data-testid="guest-photos-section">
        <h2 className="text-2xl font-bold text-stone-800 dark:text-stone-200 flex items-center gap-2">
          <Icon name="Camera" className="w-6 h-6 text-primary" />
          Guest Shared Photos
        </h2>

        {photos.some((p) => p.isGuestUpload) ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4" data-testid="guest-photos-grid">
            {photos
              .filter((p) => p.isGuestUpload)
              .map((photo, index) => (
                <div
                  key={index}
                  onClick={() => setSelectedPhoto(photo.url)}
                  className="group relative aspect-square rounded-2xl overflow-hidden cursor-pointer shadow-md border border-stone-200 dark:border-stone-800 bg-stone-100 dark:bg-stone-900 transition-transform hover:scale-[1.02]"
                >
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
              ))}
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

      {/* Fullscreen Photo Lightbox Modal */}
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
