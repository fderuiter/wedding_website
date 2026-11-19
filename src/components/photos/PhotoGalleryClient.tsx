'use client';

import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react';
import { GuestPhotoDropzone, UploadedPhoto } from './GuestPhotoDropzone';
import { Icon } from '@/components/ui/Icon';
import { MediaImage } from '@/components/MediaImage';
import { Button } from '@/components/ui/Button';
import { useOptionalToast } from '@/components/ui/ToastProvider';

export type PhotoCategory = 'curated' | 'guest';

export interface PhotoItem {
  id?: string;
  url: string;
  title?: string;
  isGuestUpload?: boolean;
  category: PhotoCategory;
}

export interface PhotoGalleryClientProps {
  initialPhotos: (PhotoItem | string)[];
  defaultTab?: PhotoCategory;
  isAdmin?: boolean;
}

function normalizeInitialPhotos(items: (PhotoItem | string)[]): PhotoItem[] {
  return items
    .map((item, index): PhotoItem | null => {
      if (typeof item === 'string') {
        if (!item) return null;
        return {
          url: item,
          title: `Wedding photo ${index + 1}`,
          isGuestUpload: false,
          category: 'curated',
        };
      }
      if (!item?.url) return null;
      const isGuest = Boolean(item.isGuestUpload || item.category === 'guest');
      return {
        id: item.id,
        url: item.url,
        title: item.title || (isGuest ? 'Guest Photo' : `Wedding photo ${index + 1}`),
        isGuestUpload: isGuest,
        category: isGuest ? 'guest' : 'curated',
      };
    })
    .filter((p): p is PhotoItem => p !== null);
}

const emptySubscribe = () => () => {};
const getClientHydratedSnapshot = () => true;
const getServerHydratedSnapshot = () => false;

export function PhotoGalleryClient({
  initialPhotos,
  defaultTab,
  isAdmin = false,
}: PhotoGalleryClientProps) {
  const toast = useOptionalToast();
  const [photos, setPhotos] = useState<PhotoItem[]>(() => normalizeInitialPhotos(initialPhotos));

  const [activeTab, setActiveTab] = useState<PhotoCategory>(() => {
    if (defaultTab) return defaultTab;
    const normalized = normalizeInitialPhotos(initialPhotos);
    return normalized.some((p) => p.category === 'curated') ? 'curated' : 'guest';
  });
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null);
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  const [isExporting, setIsExporting] = useState(false);
  const isHydrated = useSyncExternalStore(
    emptySubscribe,
    getClientHydratedSnapshot,
    getServerHydratedSnapshot
  );

  const triggerButtonRef = useRef<HTMLElement | null>(null);
  const triggerIndexRef = useRef<number | null>(null);
  const prevSelectedPhotoIndexRef = useRef<number | null>(null);
  const gallerySectionRef = useRef<HTMLElement | null>(null);
  const galleryGridRef = useRef<HTMLDivElement | null>(null);
  const lightboxModalRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  const tabCuratedRef = useRef<HTMLButtonElement | null>(null);
  const tabGuestRef = useRef<HTMLButtonElement | null>(null);

  const curatedPhotos = photos.filter((p) => p.category === 'curated');
  const guestPhotos = photos.filter((p) => p.category === 'guest' || p.isGuestUpload);
  const visiblePhotos = activeTab === 'curated' ? curatedPhotos : guestPhotos;

  const visibleSelectedUrls = visiblePhotos.filter((p) => selectedUrls.has(p.url));
  const visibleSelectedCount = visibleSelectedUrls.length;
  const isAllSelectedInView = visiblePhotos.length > 0 && visibleSelectedCount === visiblePhotos.length;

  const openLightbox = (index: number, element?: HTMLElement) => {
    triggerIndexRef.current = index;
    triggerButtonRef.current = element || (document.activeElement as HTMLElement) || null;
    setSelectedPhotoIndex(index);
  };

  const handleUploadSuccess = (uploaded: UploadedPhoto) => {
    if (uploaded.status !== 'APPROVED' || uploaded.isVisible === false) {
      return;
    }
    setPhotos((prev) => [
      {
        id: uploaded.nodeId || uploaded.id,
        url: uploaded.url,
        title: uploaded.altText || 'Guest Photo',
        isGuestUpload: true,
        category: 'guest',
      },
      ...prev,
    ]);
    setActiveTab('guest');
    setSelectedPhotoIndex((prev) => (prev !== null ? prev + 1 : null));
    if (triggerIndexRef.current !== null) {
      triggerIndexRef.current += 1;
    }
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

  const toggleSelectAll = () => {
    if (isAllSelectedInView) {
      setSelectedUrls((prev) => {
        const next = new Set(prev);
        visiblePhotos.forEach((p) => next.delete(p.url));
        return next;
      });
    } else {
      setSelectedUrls((prev) => {
        const next = new Set(prev);
        visiblePhotos.forEach((p) => next.add(p.url));
        return next;
      });
    }
  };

  const handleTabChange = (tab: PhotoCategory) => {
    setActiveTab(tab);
    setSelectedPhotoIndex(null);
  };

  const handleTabKeyDown = (e: React.KeyboardEvent, currentTab: PhotoCategory) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const nextTab: PhotoCategory = currentTab === 'curated' ? 'guest' : 'curated';
      handleTabChange(nextTab);
      if (nextTab === 'curated') {
        tabCuratedRef.current?.focus();
      } else {
        tabGuestRef.current?.focus();
      }
    } else if (e.key === 'Home') {
      e.preventDefault();
      handleTabChange('curated');
      tabCuratedRef.current?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      handleTabChange('guest');
      tabGuestRef.current?.focus();
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
      toast?.addToast('Failed to export photos. Please retry the download.', 'error');
    } finally {
      setIsExporting(false);
    }
  };

  const exportAllGuestPhotos = () => {
    handleDownload('/api/media/export?tag=guest-upload', undefined, 'guest-photos.zip');
  };

  const exportSelectedPhotos = () => {
    if (visibleSelectedCount === 0) return;
    const selectedVisible = visiblePhotos.filter((p) => selectedUrls.has(p.url));
    const ids = selectedVisible
      .filter((p) => p.id)
      .map((p) => p.id!);

    if (ids.length > 0) {
      handleDownload('/api/media/export', { ids }, 'selected-photos.zip');
    } else {
      const urls = selectedVisible.map((p) => p.url);
      handleDownload('/api/media/export', { ids: urls }, 'selected-photos.zip');
    }
  };

  const hasMultiplePhotos = visiblePhotos.length > 1;
  const currentPhoto =
    selectedPhotoIndex !== null &&
    selectedPhotoIndex >= 0 &&
    selectedPhotoIndex < visiblePhotos.length
      ? visiblePhotos[selectedPhotoIndex]
      : null;

  const handlePrev = useCallback(() => {
    if (!hasMultiplePhotos) return;
    setSelectedPhotoIndex((prev) => {
      if (prev === null) return null;
      return prev === 0 ? visiblePhotos.length - 1 : prev - 1;
    });
  }, [hasMultiplePhotos, visiblePhotos.length]);

  const handleNext = useCallback(() => {
    if (!hasMultiplePhotos) return;
    setSelectedPhotoIndex((prev) => {
      if (prev === null) return null;
      return prev === visiblePhotos.length - 1 ? 0 : prev + 1;
    });
  }, [hasMultiplePhotos, visiblePhotos.length]);

  useEffect(() => {
    if (selectedPhotoIndex !== null) {
      if (triggerIndexRef.current === null) {
        triggerIndexRef.current = selectedPhotoIndex;
      }
      if (!triggerButtonRef.current && typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
        triggerButtonRef.current = document.activeElement;
      }
      closeBtnRef.current?.focus();
    } else if (prevSelectedPhotoIndexRef.current !== null && selectedPhotoIndex === null) {
      const targetIndex = triggerIndexRef.current;
      let targetElement: HTMLElement | null = null;

      if (targetIndex !== null) {
        targetElement = document.querySelector<HTMLElement>(`[data-testid="photo-thumbnail-${targetIndex}"]`);
      }

      if (!targetElement && triggerButtonRef.current && triggerButtonRef.current.isConnected) {
        targetElement = triggerButtonRef.current;
      }

      if (targetElement && targetElement.isConnected) {
        targetElement.focus();
      } else if (galleryGridRef.current && galleryGridRef.current.isConnected) {
        galleryGridRef.current.focus();
      } else if (gallerySectionRef.current && gallerySectionRef.current.isConnected) {
        gallerySectionRef.current.focus();
      } else {
        const fallback =
          document.querySelector<HTMLElement>('[data-testid="curated-photos-grid"]') ||
          document.querySelector<HTMLElement>('[data-testid="guest-photos-grid"]') ||
          document.querySelector<HTMLElement>('[data-testid="curated-photos-section"]') ||
          document.querySelector<HTMLElement>('[data-testid="guest-photos-section"]');
        fallback?.focus();
      }

      triggerButtonRef.current = null;
      triggerIndexRef.current = null;
    }

    prevSelectedPhotoIndexRef.current = selectedPhotoIndex;
  }, [selectedPhotoIndex]);

  useEffect(() => {
    if (selectedPhotoIndex === null) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedPhotoIndex(null);
      } else if (e.key === 'ArrowLeft') {
        handlePrev();
      } else if (e.key === 'ArrowRight') {
        handleNext();
      } else if (e.key === 'Tab') {
        const modal = lightboxModalRef.current;
        if (!modal) return;
        const focusable = Array.from(
          modal.querySelectorAll<HTMLElement>(
            'button:not(:disabled), [tabindex]:not([tabindex="-1"]):not(:disabled)'
          )
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedPhotoIndex, handlePrev, handleNext]);

  return (
    <div className="space-y-8" data-hydrated={isHydrated}>
      {/* Accessible Tab Bar */}
      <div
        role="tablist"
        aria-label="Photo gallery views"
        data-testid="photo-gallery-tabs"
        className="flex items-center justify-center gap-3 border-b border-stone-200 dark:border-stone-800 pb-4 mb-6"
      >
        <button
          ref={tabCuratedRef}
          id="tab-curated"
          role="tab"
          type="button"
          aria-selected={activeTab === 'curated'}
          aria-controls="tabpanel-curated"
          tabIndex={activeTab === 'curated' ? 0 : -1}
          onClick={() => handleTabChange('curated')}
          onKeyDown={(e) => handleTabKeyDown(e, 'curated')}
          data-testid="tab-curated"
          className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
            activeTab === 'curated'
              ? 'bg-primary text-white shadow-md'
              : 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700 hover:text-stone-900 dark:hover:text-white'
          }`}
        >
          <Icon name="Camera" className="w-4 h-4" />
          <span>Curated Album</span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              activeTab === 'curated'
                ? 'bg-white/25 text-white'
                : 'bg-stone-200 dark:bg-stone-700 text-stone-700 dark:text-stone-300'
            }`}
          >
            {curatedPhotos.length}
          </span>
        </button>

        <button
          ref={tabGuestRef}
          id="tab-guest"
          role="tab"
          type="button"
          aria-selected={activeTab === 'guest'}
          aria-controls="tabpanel-guest"
          tabIndex={activeTab === 'guest' ? 0 : -1}
          onClick={() => handleTabChange('guest')}
          onKeyDown={(e) => handleTabKeyDown(e, 'guest')}
          data-testid="tab-guest"
          className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
            activeTab === 'guest'
              ? 'bg-primary text-white shadow-md'
              : 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700 hover:text-stone-900 dark:hover:text-white'
          }`}
        >
          <Icon name="Upload" className="w-4 h-4" />
          <span>Guest Uploads</span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              activeTab === 'guest'
                ? 'bg-white/25 text-white'
                : 'bg-stone-200 dark:bg-stone-700 text-stone-700 dark:text-stone-300'
            }`}
          >
            {guestPhotos.length}
          </span>
        </button>
      </div>

      {/* Main Bulk Export Toolbar (Admin Only) */}
      {isAdmin && (
        <div
          className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-700/60 shadow-sm"
          data-testid="gallery-export-toolbar"
        >
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

            {visibleSelectedCount > 0 && (
              <Button
                onClick={exportSelectedPhotos}
                disabled={isExporting}
                variant="secondary"
                data-testid="export-selected-photos-btn"
                className="flex items-center gap-2"
              >
                <Icon name="Download" className="w-4 h-4" />
                Export Selected ({visibleSelectedCount}) (.zip)
              </Button>
            )}
          </div>

          {visiblePhotos.length > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleSelectAll}
                data-testid="toggle-select-all-photos-btn"
              >
                {isAllSelectedInView ? 'Deselect All' : 'Select All Photos'}
              </Button>
              {visibleSelectedCount > 0 && (
                <span className="text-xs text-stone-500 dark:text-stone-400">
                  ({visibleSelectedCount} of {visiblePhotos.length} selected)
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Curated Photos Tab Panel */}
      {activeTab === 'curated' && (
        <section
          ref={gallerySectionRef}
          tabIndex={-1}
          id="tabpanel-curated"
          role="tabpanel"
          aria-labelledby="tab-curated"
          className="space-y-4 focus:outline-none"
          data-testid="curated-photos-section"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-stone-800 dark:text-stone-200 flex items-center gap-2">
              <Icon name="Camera" className="w-6 h-6 text-primary" />
              Curated Wedding Photos{curatedPhotos.length > 0 ? ` (${curatedPhotos.length})` : ''}
            </h2>
          </div>

          {curatedPhotos.length > 0 ? (
            <div
              ref={galleryGridRef}
              tabIndex={-1}
              className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 focus:outline-none"
              data-testid="curated-photos-grid"
            >
              {curatedPhotos.map((photo, index) => {
                const isSelected = selectedUrls.has(photo.url);
                return (
                  <div
                    key={photo.id || index}
                    data-category={photo.category}
                    className={`group relative aspect-square rounded-2xl overflow-hidden cursor-pointer shadow-md border ${
                      isSelected
                        ? 'border-primary ring-2 ring-primary/50'
                        : 'border-stone-200 dark:border-stone-800'
                    } bg-stone-100 dark:bg-stone-900 transition-all hover:scale-[1.02]`}
                  >
                    {/* Selection Checkbox (Admin Only) */}
                    {isAdmin && (
                      <div
                        className="absolute top-2 left-2 z-20 p-1 bg-black/40 backdrop-blur-sm rounded-md"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(photo.url)}
                          aria-label={`Select curated photo ${index + 1}`}
                          data-testid={`photo-checkbox-${index}`}
                          className="w-4 h-4 rounded border-stone-300 text-primary focus:ring-primary cursor-pointer"
                        />
                      </div>
                    )}

                    <button
                      type="button"
                      data-category={photo.category}
                      onClick={(e) => openLightbox(index, e.currentTarget)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openLightbox(index, e.currentTarget);
                        }
                      }}
                      className="w-full h-full cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
                      aria-label={photo.title ? `View ${photo.title}` : `View curated photo ${index + 1}`}
                      data-testid={`photo-thumbnail-${index}`}
                    >
                      <MediaImage
                        src={photo.url}
                        alt={photo.title || `Curated photo ${index + 1}`}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3 pointer-events-none">
                        <span className="text-xs font-medium text-white truncate">
                          {photo.title || `Curated photo ${index + 1}`}
                        </span>
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div
              data-testid="curated-photos-empty-state"
              className="rounded-2xl border border-dashed border-stone-300 dark:border-stone-700 bg-stone-50/50 dark:bg-stone-900/30 p-8 text-center flex flex-col items-center justify-center space-y-3"
            >
              <div className="p-3 rounded-full bg-stone-200/60 dark:bg-stone-800 text-stone-500 dark:text-stone-400">
                <Icon name="ImageOff" className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-stone-800 dark:text-stone-200">
                  No curated photos yet
                </h3>
                <p className="text-sm text-stone-500 dark:text-stone-400 mt-1 max-w-sm">
                  Curated wedding photos will appear here once published.
                </p>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Guest Photos Tab Panel */}
      {activeTab === 'guest' && (
        <div
          id="tabpanel-guest"
          role="tabpanel"
          aria-labelledby="tab-guest"
          className="space-y-8"
        >
          {/* Upload Dropzone */}
          <section className="max-w-2xl mx-auto" aria-label="Upload Photos">
            <GuestPhotoDropzone onUploadSuccess={handleUploadSuccess} />
          </section>

          {/* Guest Uploaded Photos Grid / Gallery Section */}
          <section
            ref={gallerySectionRef}
            tabIndex={-1}
            className="space-y-4 focus:outline-none"
            data-testid="guest-photos-section"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-stone-800 dark:text-stone-200 flex items-center gap-2">
                <Icon name="Camera" className="w-6 h-6 text-primary" />
                Guest Shared Photos{guestPhotos.length > 0 ? ` (${guestPhotos.length})` : ''}
              </h2>
            </div>

            {guestPhotos.length > 0 ? (
              <div
                ref={galleryGridRef}
                tabIndex={-1}
                className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 focus:outline-none"
                data-testid="guest-photos-grid"
              >
                {guestPhotos.map((photo, index) => {
                  const isSelected = selectedUrls.has(photo.url);
                  return (
                    <div
                      key={photo.id || index}
                      data-category={photo.category}
                      className={`group relative aspect-square rounded-2xl overflow-hidden cursor-pointer shadow-md border ${
                        isSelected
                          ? 'border-primary ring-2 ring-primary/50'
                          : 'border-stone-200 dark:border-stone-800'
                      } bg-stone-100 dark:bg-stone-900 transition-all hover:scale-[1.02]`}
                    >
                      {/* Selection Checkbox (Admin Only) */}
                      {isAdmin && (
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
                      )}

                      <button
                        type="button"
                        data-category={photo.category}
                        onClick={(e) => openLightbox(index, e.currentTarget)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            openLightbox(index, e.currentTarget);
                          }
                        }}
                        className="w-full h-full cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
                        aria-label={photo.title ? `View ${photo.title}` : `View guest photo ${index + 1}`}
                        data-testid={`photo-thumbnail-${index}`}
                      >
                        <MediaImage
                          src={photo.url}
                          alt={photo.title || `Guest photo ${index + 1}`}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3 pointer-events-none">
                          <span className="text-xs font-medium text-white truncate">
                            {photo.title || 'Guest Photo'}
                          </span>
                        </div>
                      </button>
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
        </div>
      )}

      {/* Lightbox Modal */}
      {currentPhoto && selectedPhotoIndex !== null && (
        <div
          ref={lightboxModalRef}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 select-none"
          onClick={() => setSelectedPhotoIndex(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Photo Preview"
        >
          <div
            className="relative max-w-4xl max-h-[90vh] w-full h-full flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Position Counter Indicator */}
            <div
              className="absolute top-4 left-4 z-10 px-3 py-1.5 rounded-full bg-black/50 text-white text-sm font-medium tracking-wide"
              data-testid="lightbox-counter"
              aria-live="polite"
              aria-label={`Photo ${selectedPhotoIndex + 1} of ${visiblePhotos.length}`}
            >
              {selectedPhotoIndex + 1} / {visiblePhotos.length}
            </div>

            {/* Close Button */}
            <button
              ref={closeBtnRef}
              type="button"
              onClick={() => setSelectedPhotoIndex(null)}
              className="absolute top-4 right-4 z-10 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-white transition"
              aria-label="Close photo preview"
              data-testid="lightbox-close-btn"
            >
              <Icon name="X" className="w-6 h-6" />
            </button>

            {/* Previous Navigation Button */}
            <button
              type="button"
              onClick={handlePrev}
              disabled={!hasMultiplePhotos}
              className="absolute left-2 sm:left-4 z-10 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-white transition"
              aria-label="Previous photo"
              data-testid="lightbox-prev-btn"
            >
              <Icon name="ChevronLeft" className="w-6 h-6" />
            </button>

            {/* Next Navigation Button */}
            <button
              type="button"
              onClick={handleNext}
              disabled={!hasMultiplePhotos}
              className="absolute right-2 sm:right-4 z-10 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-white transition"
              aria-label="Next photo"
              data-testid="lightbox-next-btn"
            >
              <Icon name="ChevronRight" className="w-6 h-6" />
            </button>

            <MediaImage
              src={currentPhoto.url}
              alt={currentPhoto.title || 'Photo preview'}
              width={1200}
              height={800}
              className="max-h-[85vh] max-w-full object-contain rounded-lg"
              data-testid="lightbox-image"
            />

            {currentPhoto.title && (
              <div
                className="absolute bottom-4 left-1/2 -translate-x-1/2 text-center text-white/90 text-sm font-medium bg-black/50 px-3 py-1 rounded-full truncate max-w-md pointer-events-none"
                data-testid="lightbox-caption"
              >
                {currentPhoto.title}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
