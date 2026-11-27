'use client';

import { useState, useEffect, useCallback, useRef, useMemo, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { GuestPhotoDropzone, UploadedPhoto } from './GuestPhotoDropzone';
import { Icon } from '@/components/ui/Icon';
import { MediaImage } from '@/components/MediaImage';
import { Button } from '@/components/ui/Button';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';
import { useOptionalToast } from '@/components/ui/ToastProvider';
import { getOverlayTabbableElements, useModalInert } from '@/hooks/useOverlay';
import { triggerNativeExportDownload } from '@/utils/exportDownload';
import { useOptionalDemo } from '@/components/demo/DemoContext';
import { useStaticDemoPageOverrides } from '@/lib/staticDemo/runtime';

export type PhotoCategory = 'curated' | 'guest';

export interface PublicPhotoItem {
  id?: string;
  mediaId?: string;
  url: string;
  title?: string;
  caption?: string;
  uploaderName?: string;
  isGuestUpload?: boolean;
  category?: PhotoCategory;
}

interface NormalizedPhotoItem extends PublicPhotoItem {
  category: PhotoCategory;
}

export interface PhotoGalleryClientProps {
  initialPhotos: (PublicPhotoItem | string)[];
  defaultTab?: PhotoCategory;
  isAdmin?: boolean;
  defaultUploaderName?: string;
}

function normalizeInitialPhotos(items: (PublicPhotoItem | string)[]): NormalizedPhotoItem[] {
  return items
    .map((item, index): NormalizedPhotoItem | null => {
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
      const caption = item.caption?.trim() || undefined;
      const uploaderName = item.uploaderName?.trim() || undefined;
      const explicitTitle = item.title?.trim() || undefined;
      const resolvedTitle =
        explicitTitle ||
        caption ||
        (uploaderName ? `Photo by ${uploaderName}` : undefined) ||
        (isGuest ? 'Guest Photo' : `Wedding photo ${index + 1}`);
      return {
        id: item.id,
        ...(item.mediaId ? { mediaId: item.mediaId } : {}),
        url: item.url,
        title: resolvedTitle,
        ...(caption ? { caption } : {}),
        ...(uploaderName ? { uploaderName } : {}),
        isGuestUpload: isGuest,
        category: isGuest ? 'guest' : 'curated',
      };
    })
    .filter((p): p is NormalizedPhotoItem => p !== null);
}

function mapDraftContentNodesToPhotos(draftNodes: unknown[]): NormalizedPhotoItem[] {
  return draftNodes
    .map((rawNode, index): NormalizedPhotoItem | null => {
      if (!rawNode || typeof rawNode !== 'object') return null;
      const node = rawNode as {
        id?: string;
        type?: string;
        tags?: unknown;
        data?: Record<string, unknown> | null;
      };
      if (node.type !== 'Photo') return null;
      const data = node.data && typeof node.data === 'object' ? node.data : {};
      const rawStatus = typeof data.status === 'string' ? data.status.toUpperCase() : undefined;
      if (rawStatus === 'PENDING' || rawStatus === 'REJECTED') return null;
      if (data.isVisible === false) return null;

      const url =
        (typeof data.url === 'string' && data.url.trim()) ||
        (typeof data.imageUrl === 'string' && data.imageUrl.trim()) ||
        '';
      if (!url) return null;

      const tags = Array.isArray(node.tags) ? node.tags : [];
      const isGuest = tags.includes('guest-upload');
      const caption =
        typeof data.caption === 'string' && data.caption.trim() ? data.caption.trim() : undefined;
      const uploaderName =
        typeof data.uploaderName === 'string' && data.uploaderName.trim()
          ? data.uploaderName.trim()
          : undefined;
      const explicitTitle =
        typeof data.title === 'string' && data.title.trim() ? data.title.trim() : undefined;
      const explicitAlt =
        typeof data.altText === 'string' && data.altText.trim() ? data.altText.trim() : undefined;
      const resolvedTitle =
        explicitTitle ||
        caption ||
        explicitAlt ||
        (uploaderName ? `Photo by ${uploaderName}` : undefined) ||
        (isGuest ? 'Guest Photo' : `Wedding photo ${index + 1}`);

      return {
        ...(typeof node.id === 'string' ? { id: node.id } : {}),
        ...(typeof data.mediaId === 'string' && data.mediaId ? { mediaId: data.mediaId } : {}),
        url,
        title: resolvedTitle,
        ...(caption ? { caption } : {}),
        ...(uploaderName ? { uploaderName } : {}),
        isGuestUpload: isGuest,
        category: isGuest ? 'guest' : 'curated',
      };
    })
    .filter((item): item is NormalizedPhotoItem => item !== null);
}

const emptySubscribe = () => () => {};
const getClientHydratedSnapshot = () => true;
const getServerHydratedSnapshot = () => false;

export function PhotoGalleryClient({
  initialPhotos,
  defaultTab,
  isAdmin: initialIsAdmin = false,
  defaultUploaderName,
}: PhotoGalleryClientProps) {
  const toast = useOptionalToast();
  const demo = useOptionalDemo();
  const demoOverrides = useStaticDemoPageOverrides();
  const isDemoMode = Boolean(demo?.isDemoMode);
  const isAdmin = isDemoMode
    ? demo?.persona === 'admin'
    : demoOverrides
      ? demoOverrides.isAdminAuthenticated
      : initialIsAdmin;
  const [hasDraftOverride, setHasDraftOverride] = useState(false);
  const [localPhotos, setPhotos] = useState<NormalizedPhotoItem[]>(() =>
    normalizeInitialPhotos(initialPhotos),
  );

  const photos = useMemo<NormalizedPhotoItem[]>(() => {
    if (hasDraftOverride) {
      return localPhotos;
    }
    if (isDemoMode && demo) {
      return normalizeInitialPhotos(
        demo.activeDataset.photos
          .filter((p) => p.status === 'APPROVED' && p.isVisible !== false)
          .map((p) => ({
            id: p.id,
            mediaId: p.mediaId,
            url: p.url,
            title: p.title,
            ...(p.caption ? { caption: p.caption } : {}),
            ...(p.uploaderName ? { uploaderName: p.uploaderName } : {}),
            isGuestUpload: p.isGuestUpload,
            category: p.category,
          })),
      );
    }
    if (!demoOverrides) {
      return localPhotos;
    }
    return normalizeInitialPhotos(demoOverrides.galleryPhotos);
  }, [demo, demoOverrides, hasDraftOverride, isDemoMode, localPhotos]);

  const [activeTab, setActiveTab] = useState<PhotoCategory>(() => {
    if (typeof window !== 'undefined' && window.location?.search) {
      const tabParam = new URLSearchParams(window.location.search).get('tab');
      if (tabParam === 'guest' || tabParam === 'curated') {
        return tabParam;
      }
    }
    if (defaultTab) return defaultTab;
    const normalized = normalizeInitialPhotos(initialPhotos);
    return normalized.some((p) => p.category === 'curated') ? 'curated' : 'guest';
  });
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null);
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  const [isExporting, setIsExporting] = useState(false);
  const shouldFocusDropzoneRef = useRef(false);
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
  const guestDropzoneRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (activeTab === 'guest' && shouldFocusDropzoneRef.current) {
      shouldFocusDropzoneRef.current = false;
      guestDropzoneRef.current?.focus();
    }
  }, [activeTab]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const isIframe = window !== window.parent;
    const isPreviewQuery = new URLSearchParams(window.location.search).get('preview') === 'true';
    if (!isIframe && !isPreviewQuery) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (
        event.data?.type === 'DRAFT_UPDATE' &&
        event.data.draftType === 'content' &&
        Array.isArray(event.data.draftData)
      ) {
        const nextPhotos = mapDraftContentNodesToPhotos(event.data.draftData);
        setHasDraftOverride(true);
        setPhotos(nextPhotos);
        setActiveTab((prevTab) => {
          const hasCurated = nextPhotos.some((p) => p.category === 'curated');
          const hasGuest = nextPhotos.some((p) => p.category === 'guest');
          if (prevTab === 'curated' && !hasCurated && hasGuest) return 'guest';
          if (prevTab === 'guest' && !hasGuest && hasCurated) return 'curated';
          return prevTab;
        });
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

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
    const uploadedUrl = uploaded.url;
    if (uploaded.status !== 'APPROVED' || uploaded.isVisible === false || !uploadedUrl) {
      return;
    }
    const caption = uploaded.caption?.trim() || undefined;
    const uploaderName = uploaded.uploaderName?.trim() || undefined;
    const resolvedTitle =
      caption ||
      uploaded.title ||
      uploaded.altText ||
      (uploaderName ? `Photo by ${uploaderName}` : 'Guest Photo');
    setPhotos((prev) => [
      {
        id: uploaded.nodeId || uploaded.id,
        url: uploadedUrl,
        title: resolvedTitle,
        ...(caption ? { caption } : {}),
        ...(uploaderName ? { uploaderName } : {}),
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

  const handleActivateGuestUpload = () => {
    shouldFocusDropzoneRef.current = true;
    handleTabChange('guest');
  };

  const handleDownload = async (
    url: string,
    bodyPayload?: { ids?: string[]; tag?: string; category?: string },
    filename = 'guest-photos.zip'
  ) => {
    setIsExporting(true);
    try {
      await triggerNativeExportDownload({
        url,
        filename,
        payload: bodyPayload,
      });
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

  const isLightboxOpen = Boolean(currentPhoto && selectedPhotoIndex !== null);
  useModalInert(isLightboxOpen, lightboxModalRef);

  useEffect(() => {
    if (selectedPhotoIndex === null) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setSelectedPhotoIndex(null);
      } else if (e.key === 'ArrowLeft') {
        handlePrev();
      } else if (e.key === 'ArrowRight') {
        handleNext();
      } else if (e.key === 'Tab') {
        const modal = lightboxModalRef.current;
        if (!modal) return;
        const focusable = getOverlayTabbableElements(modal);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const activeEl =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;

        if (!activeEl || !modal.contains(activeEl)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
          return;
        }

        if (e.shiftKey) {
          if (activeEl === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (activeEl === last) {
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
      {/* Accessible Tab Bar and Live Slideshow Launcher */}
      <div className="flex flex-wrap items-center justify-center gap-3 border-b border-stone-200 dark:border-stone-800 pb-4 mb-6">
        <SegmentedTabs<PhotoCategory>
          variant="pills"
          aria-label="Photo gallery views"
          data-testid="photo-gallery-tabs"
          value={activeTab}
          onChange={handleTabChange}
          tabs={[
            {
              value: 'curated',
              id: 'tab-curated',
              panelId: 'tabpanel-curated',
              'data-testid': 'tab-curated',
              icon: <Icon name="Camera" className="w-4 h-4 shrink-0" />,
              label: 'Curated Album',
              count: curatedPhotos.length,
            },
            {
              value: 'guest',
              id: 'tab-guest',
              panelId: 'tabpanel-guest',
              'data-testid': 'tab-guest',
              icon: <Icon name="Upload" className="w-4 h-4 shrink-0" />,
              label: 'Guest Uploads',
              count: guestPhotos.length,
            },
          ]}
        />

        <Link
          href="/photos/slideshow"
          data-testid="launch-slideshow-link"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-100 hover:bg-stone-100 dark:hover:bg-stone-800 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring,var(--color-primary,#B91C1C))] focus-visible:ring-offset-2"
        >
          <Icon name="Monitor" className="w-4 h-4" />
          <span>Live Slideshow</span>
        </Link>
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
                <span className="text-xs text-[var(--color-muted-text,#4b5563)]">
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-bold text-stone-800 dark:text-stone-200 flex items-center gap-2">
              <Icon name="Camera" className="w-6 h-6 text-primary" />
              Curated Wedding Photos{curatedPhotos.length > 0 ? ` (${curatedPhotos.length})` : ''}
            </h2>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleActivateGuestUpload}
              data-testid="curated-upload-cta"
              className="inline-flex items-center gap-2"
            >
              <Icon name="Upload" className="w-4 h-4" />
              <span>Upload Guest Photos</span>
            </Button>
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
                      <div
                        aria-hidden="true"
                        className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3 pointer-events-none"
                      >
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
              <div className="p-3 rounded-full bg-stone-200/60 dark:bg-stone-800 text-[var(--color-muted-text,#4b5563)]">
                <Icon name="ImageOff" className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-stone-800 dark:text-stone-200">
                  No curated photos yet
                </h3>
                <p className="text-sm text-[var(--color-muted-text,#4b5563)] mt-1 max-w-sm">
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
            <GuestPhotoDropzone
              onUploadSuccess={handleUploadSuccess}
              defaultUploaderName={defaultUploaderName}
              dropzoneRef={guestDropzoneRef}
            />
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
                  const primaryLabel = photo.caption || photo.title || 'Guest Photo';
                  const uploaderLabel =
                    photo.uploaderName && primaryLabel !== `Photo by ${photo.uploaderName}`
                      ? `Photo by ${photo.uploaderName}`
                      : undefined;
                  const hasCustomAttribution = Boolean(photo.caption || photo.uploaderName);
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
                      </button>

                      <div
                        aria-hidden="true"
                        className={`absolute inset-x-0 bottom-0 z-10 bg-stone-950/90 px-3 py-2 pointer-events-none transition-opacity ${
                          hasCustomAttribution
                            ? 'opacity-100'
                            : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
                        }`}
                      >
                        <p className="text-xs font-medium text-white truncate">
                          {primaryLabel}
                        </p>
                        {uploaderLabel && (
                          <p
                            className="text-[11px] text-stone-200 truncate"
                            data-testid={`guest-photo-uploader-${index}`}
                          >
                            {uploaderLabel}
                          </p>
                        )}
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
                <div className="p-3 rounded-full bg-stone-200/60 dark:bg-stone-800 text-[var(--color-muted-text,#4b5563)]">
                  <Icon name="ImageOff" className="w-8 h-8" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-stone-800 dark:text-stone-200">
                    No guest photos yet
                  </h3>
                  <p className="text-sm text-[var(--color-muted-text,#4b5563)] mt-1 max-w-sm">
                    Be the first to share your favorite memories from the celebration using the upload section above!
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {/* Lightbox Modal */}
      {currentPhoto &&
        selectedPhotoIndex !== null &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={lightboxModalRef}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto select-none"
            onClick={() => setSelectedPhotoIndex(null)}
            role="dialog"
            aria-modal="true"
            aria-label="Photo Preview"
          >
            <div
              className="relative max-w-4xl max-h-[calc(100vh-2rem)] w-full h-full flex items-center justify-center"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Position Counter Indicator */}
              <div
                role="status"
                aria-live="polite"
                aria-atomic="true"
                className="absolute top-4 left-4 z-10 px-3 py-1.5 rounded-full bg-stone-950/90 text-white text-sm font-medium tracking-wide"
                data-testid="lightbox-counter"
              >
                <span aria-hidden="true">
                  {selectedPhotoIndex + 1} / {visiblePhotos.length}
                </span>
                <span className="sr-only">
                  {`Photo ${selectedPhotoIndex + 1} of ${visiblePhotos.length}${
                    currentPhoto.caption || currentPhoto.title
                      ? `: ${currentPhoto.caption || currentPhoto.title}`
                      : ''
                  }`}
                </span>
              </div>

              {/* Close Button */}
              <button
                ref={closeBtnRef}
                type="button"
                onClick={() => setSelectedPhotoIndex(null)}
                className="absolute top-4 right-4 z-10 p-2 rounded-full bg-stone-950/90 text-white hover:bg-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white transition"
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
                className="absolute left-2 sm:left-4 z-10 p-2 rounded-full bg-stone-950/90 text-white hover:bg-stone-900 disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white transition"
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
                className="absolute right-2 sm:right-4 z-10 p-2 rounded-full bg-stone-950/90 text-white hover:bg-stone-900 disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white transition"
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
                className="max-h-[calc(100vh-3rem)] max-w-full object-contain rounded-lg"
                data-testid="lightbox-image"
              />

              {(currentPhoto.caption || currentPhoto.title) && (
                <div
                  aria-hidden="true"
                  className="absolute bottom-4 left-1/2 -translate-x-1/2 text-center bg-stone-950/90 border border-white/10 px-4 py-2 rounded-2xl max-w-md pointer-events-none shadow-lg"
                  data-testid="lightbox-caption"
                >
                  <p className="text-white text-sm font-medium truncate">
                    {currentPhoto.caption || currentPhoto.title}
                  </p>
                  {currentPhoto.uploaderName &&
                    (currentPhoto.caption || currentPhoto.title) !==
                      `Photo by ${currentPhoto.uploaderName}` && (
                    <p
                      className="text-stone-200 text-xs mt-0.5 truncate"
                      data-testid="lightbox-uploader"
                    >
                      Photo by {currentPhoto.uploaderName}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
