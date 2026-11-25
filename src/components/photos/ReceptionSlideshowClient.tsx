/* eslint-disable @next/next/no-img-element */
'use client';

import { useState, useEffect, useCallback, useRef, useMemo, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { MainLandmark } from '@/components/ui/Layout';
import { ThemedQRCode } from '@/components/ui/ThemedQRCode';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { withBasePath } from '@/lib/basePath';
import { useOptionalDemo } from '@/components/demo/DemoContext';

export interface SlideshowPhoto {
  id?: string;
  url: string;
  title?: string;
  altText?: string;
  caption?: string;
  uploaderName?: string;
  isGuestUpload?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface ReceptionSlideshowClientProps {
  initialPhotos?: (SlideshowPhoto | string)[];
  uploadUrl?: string;
}

type ControlRegion = 'header' | 'toolbar' | 'qr';

const COMPACT_VIEWPORT_MEDIA_QUERY = '(max-width: 767.98px), (max-height: 499.98px)';

function normalizePhotos(items?: (SlideshowPhoto | string)[]): SlideshowPhoto[] {
  if (!items || items.length === 0) {
    return [];
  }
  return items
    .map((item, idx) => {
      if (typeof item === 'string') {
        return {
          id: `initial-${idx}`,
          url: item,
          title: `Wedding Photo ${idx + 1}`,
        };
      }
      return item;
    })
    .filter((p) => Boolean(p.url));
}

function getCompactViewportSnapshot(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const byDimensions =
    typeof window.innerWidth === 'number' &&
    typeof window.innerHeight === 'number' &&
    window.innerWidth > 0 &&
    window.innerHeight > 0 &&
    (window.innerWidth < 768 || window.innerHeight < 500);
  const byMedia =
    typeof window.matchMedia === 'function' &&
    Boolean(window.matchMedia(COMPACT_VIEWPORT_MEDIA_QUERY)?.matches);
  return byDimensions || byMedia;
}

function subscribeCompactViewport(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }
  window.addEventListener('resize', onStoreChange);
  const mediaQuery =
    typeof window.matchMedia === 'function'
      ? window.matchMedia(COMPACT_VIEWPORT_MEDIA_QUERY)
      : null;
  mediaQuery?.addEventListener?.('change', onStoreChange);

  return () => {
    window.removeEventListener('resize', onStoreChange);
    mediaQuery?.removeEventListener?.('change', onStoreChange);
  };
}

const getServerFalse = () => false;

export function ReceptionSlideshowClient({
  initialPhotos,
  uploadUrl,
}: ReceptionSlideshowClientProps) {
  const demo = useOptionalDemo();
  const hasExpandedDemoToolbar = Boolean(demo?.isDemoMode && !demo.isToolbarCollapsed);
  const hasCollapsedDemoToolbar = Boolean(demo?.isDemoMode && demo.isToolbarCollapsed);

  const controlsBottomClass = hasExpandedDemoToolbar
    ? 'bottom-20'
    : hasCollapsedDemoToolbar
      ? 'bottom-16'
      : 'bottom-2 md:bottom-6';

  const qrOverlayBottomClass = hasExpandedDemoToolbar
    ? 'bottom-36 max-md:bottom-48'
    : hasCollapsedDemoToolbar
      ? 'bottom-32 max-md:bottom-44'
      : 'bottom-[6.75rem] md:bottom-24';

  const qrOverlayMaxHeightClass = hasExpandedDemoToolbar
    ? 'max-h-[calc(100vh-15.5rem)] md:max-h-[calc(100vh-12.5rem)]'
    : hasCollapsedDemoToolbar
      ? 'max-h-[calc(100vh-14.5rem)] md:max-h-[calc(100vh-11.5rem)]'
      : 'max-h-[calc(100vh-10rem)] md:max-h-[calc(100vh-9.5rem)]';

  const prefersReducedMotion = useReducedMotion();
  const subscribeNoop = useCallback(() => () => {}, []);
  const isHydrated = useSyncExternalStore(subscribeNoop, () => true, getServerFalse);
  const isCompactViewport = useSyncExternalStore(
    subscribeCompactViewport,
    getCompactViewportSnapshot,
    getServerFalse
  );

  const [photos, setPhotos] = useState<SlideshowPhoto[]>(() => normalizePhotos(initialPhotos));
  const [failedUrls, setFailedUrls] = useState<Set<string>>(() => new Set());
  const failedUrlsRef = useRef<Set<string>>(new Set());
  const [currentIndex, setCurrentIndex] = useState(0);

  const [playbackOverride, setPlaybackOverride] = useState<boolean | null>(null);
  const [prevReducedMotion, setPrevReducedMotion] = useState(prefersReducedMotion);
  if (prevReducedMotion !== prefersReducedMotion) {
    setPrevReducedMotion(prefersReducedMotion);
    if (prefersReducedMotion) {
      setPlaybackOverride(false);
    }
  }
  const isPlaying = playbackOverride ?? (isHydrated ? !prefersReducedMotion : true);

  const [duration, setDuration] = useState<5 | 8 | 10>(8);
  const [showQrCode, setShowQrCode] = useState(true);
  const [isQrExpandedOnCompact, setIsQrExpandedOnCompact] = useState(false);
  const [areControlsVisible, setAreControlsVisible] = useState(true);
  const [areShortcutsEnabled, setAreShortcutsEnabled] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isControlsFocused, setIsControlsFocused] = useState(false);
  const [isControlsHovered, setIsControlsHovered] = useState(false);

  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isControlsFocusedRef = useRef(false);
  const hoveredRegionsRef = useRef<Set<ControlRegion>>(new Set());
  const lastTouchTimeRef = useRef(0);
  const wasPlayingRef = useRef(isPlaying);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const qrOverlayRef = useRef<HTMLElement | null>(null);

  const togglePlayback = useCallback(() => {
    setPlaybackOverride((prev) => {
      const current = prev ?? !prefersReducedMotion;
      return !current;
    });
  }, [prefersReducedMotion]);

  // Derive initial timestamp cursor from provided initial photos (preferring updatedAt over createdAt)
  const initialLatestTimestamp = useMemo(() => {
    if (!initialPhotos || !Array.isArray(initialPhotos)) return null;
    let maxMs = -Infinity;
    let maxIso: string | null = null;
    for (const item of initialPhotos) {
      if (typeof item !== 'string') {
        const cursorValue = item.updatedAt || item.createdAt;
        if (cursorValue) {
          const ms = new Date(cursorValue).getTime();
          if (!isNaN(ms) && ms > maxMs) {
            maxMs = ms;
            maxIso = cursorValue;
          }
        }
      }
    }
    return maxIso;
  }, [initialPhotos]);

  const latestTimestampRef = useRef<string | null>(initialLatestTimestamp);

  useEffect(() => {
    if (initialLatestTimestamp) {
      const currentMs = latestTimestampRef.current
        ? new Date(latestTimestampRef.current).getTime()
        : -Infinity;
      const initialMs = new Date(initialLatestTimestamp).getTime();
      if (initialMs > currentMs) {
        latestTimestampRef.current = initialLatestTimestamp;
      }
    }
  }, [initialLatestTimestamp]);

  const clientOrigin = useSyncExternalStore(
    subscribeNoop,
    () => (typeof window !== 'undefined' && window.location?.origin ? window.location.origin : ''),
    () => ''
  );

  // Derive resolved upload URL (upgrading relative signed QR paths and basePath-prefixed fallbacks after hydration)
  const resolvedUploadUrl = useMemo(() => {
    if (uploadUrl) {
      if (uploadUrl.startsWith('/')) {
        const prefixed = withBasePath(uploadUrl);
        return clientOrigin ? `${clientOrigin}${prefixed}` : prefixed;
      }
      return uploadUrl;
    }
    const photosPath = withBasePath('/photos?tab=guest');
    if (clientOrigin) {
      return `${clientOrigin}${photosPath}`;
    }
    return photosPath;
  }, [uploadUrl, clientOrigin]);

  // Helper to determine whether an element is an interactive control in the slideshow
  const isInteractiveControl = useCallback((node: Node | null): boolean => {
    if (!node || !(node instanceof Element)) return false;
    if (
      controlsRef.current?.contains(node) ||
      headerRef.current?.contains(node) ||
      qrOverlayRef.current?.contains(node)
    ) {
      return true;
    }
    if (
      containerRef.current?.contains(node) &&
      ((node as HTMLElement).isContentEditable ||
        node.closest(
          'button, a, input, select, textarea, [contenteditable="true"], [contenteditable=""], [tabindex]:not([tabindex="-1"])'
        ))
    ) {
      return true;
    }
    return false;
  }, []);

  // Handle broken image URLs by skipping immediately and clearing to empty state if all fail
  const handlePhotoError = useCallback((failedUrl: string) => {
    failedUrlsRef.current.add(failedUrl);
    setFailedUrls((prev) => {
      const next = new Set(prev);
      next.add(failedUrl);
      return next;
    });

    setPhotos((currentList) => currentList.filter((p) => p.url !== failedUrl));
  }, []);

  // Activity detection for auto-hiding controls & cursor
  const handleUserActivity = useCallback(() => {
    setAreControlsVisible(true);
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
    if (!isControlsFocusedRef.current && hoveredRegionsRef.current.size === 0) {
      inactivityTimerRef.current = setTimeout(() => {
        setAreControlsVisible(false);
      }, 3000);
    }
  }, []);

  const handleRegionEnter = useCallback(
    (region: ControlRegion, pointerType?: string) => {
      if (pointerType === 'touch') {
        lastTouchTimeRef.current = Date.now();
        return;
      }
      if (!pointerType && Date.now() - lastTouchTimeRef.current < 500) {
        return;
      }
      hoveredRegionsRef.current.add(region);
      setIsControlsHovered(true);
      handleUserActivity();
    },
    [handleUserActivity]
  );

  const handleRegionLeave = useCallback(
    (region: ControlRegion) => {
      if (hoveredRegionsRef.current.delete(region)) {
        const stillHovered = hoveredRegionsRef.current.size > 0;
        setIsControlsHovered(stillHovered);
        handleUserActivity();
      }
    },
    [handleUserActivity]
  );

  useEffect(() => {
    if (typeof document !== 'undefined' && isInteractiveControl(document.activeElement)) {
      isControlsFocusedRef.current = true;
    } else {
      inactivityTimerRef.current = setTimeout(() => {
        setAreControlsVisible(false);
      }, 3000);
    }

    const onActivity = () => handleUserActivity();
    const onTouchStart = () => {
      lastTouchTimeRef.current = Date.now();
      handleUserActivity();
    };

    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as Node | null;
      if (isInteractiveControl(target)) {
        isControlsFocusedRef.current = true;
        setIsControlsFocused(true);
        handleUserActivity();
      } else if (isControlsFocusedRef.current) {
        isControlsFocusedRef.current = false;
        setIsControlsFocused(false);
        handleUserActivity();
      }
    };

    const handleFocusOut = (e: FocusEvent) => {
      const nextTarget = e.relatedTarget as Node | null;
      if (!isInteractiveControl(nextTarget)) {
        isControlsFocusedRef.current = false;
        setIsControlsFocused(false);
        handleUserActivity();
      }
    };

    window.addEventListener('mousemove', onActivity);
    window.addEventListener('pointermove', onActivity);
    window.addEventListener('touchstart', onTouchStart);
    window.addEventListener('keydown', onActivity);
    window.addEventListener('focusin', handleFocusIn);
    window.addEventListener('focusout', handleFocusOut);

    return () => {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
      window.removeEventListener('mousemove', onActivity);
      window.removeEventListener('pointermove', onActivity);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('focusin', handleFocusIn);
      window.removeEventListener('focusout', handleFocusOut);
    };
  }, [handleUserActivity, isInteractiveControl]);

  useEffect(() => {
    if (isPlaying && !wasPlayingRef.current) {
      handleUserActivity();
    }
    wasPlayingRef.current = isPlaying;
  }, [isPlaying, handleUserActivity]);

  // Slideshow navigation handlers
  const goToNext = useCallback(() => {
    setPhotos((currentList) => {
      if (currentList.length > 0) {
        setCurrentIndex((prev) => ((prev % currentList.length) + 1) % currentList.length);
      }
      return currentList;
    });
  }, []);

  const goToPrev = useCallback(() => {
    setPhotos((currentList) => {
      if (currentList.length > 0) {
        setCurrentIndex((prev) => ((prev % currentList.length) - 1 + currentList.length) % currentList.length);
      }
      return currentList;
    });
  }, []);

  // Automatic cycling timer based on duration (pauses when controls are focused or hovered)
  const shouldAutoAdvance = isPlaying && !isControlsFocused && !isControlsHovered;
  useEffect(() => {
    if (!shouldAutoAdvance || photos.length <= 1) return;

    const intervalMs = duration * 1000;
    const intervalTimer = setInterval(() => {
      goToNext();
    }, intervalMs);

    return () => clearInterval(intervalTimer);
  }, [shouldAutoAdvance, duration, photos.length, goToNext]);

  // Periodic polling for approved public photos (every 30 seconds, even when visual cycling is paused)
  const pollPublicPhotos = useCallback(async () => {
    try {
      const cursor = latestTimestampRef.current;
      const endpoint = cursor ? `/api/photos?since=${encodeURIComponent(cursor)}` : '/api/photos';
      const response = await fetch(withBasePath(endpoint));
      if (!response.ok) return;

      const data = await response.json();
      if (data?.photos && Array.isArray(data.photos) && data.photos.length > 0) {
        for (const p of data.photos as SlideshowPhoto[]) {
          const cursorValue = p.updatedAt || p.createdAt;
          if (cursorValue) {
            const ms = new Date(cursorValue).getTime();
            if (!isNaN(ms)) {
              const currentMs = latestTimestampRef.current
                ? new Date(latestTimestampRef.current).getTime()
                : -Infinity;
              if (ms > currentMs) {
                latestTimestampRef.current = cursorValue;
              }
            }
          }
        }

        const mapPolledSlide = (p: SlideshowPhoto): SlideshowPhoto => {
          const caption = p.caption?.trim() || undefined;
          const uploaderName = p.uploaderName?.trim() || undefined;
          const explicitTitle = p.title?.trim() || undefined;
          const explicitAltText = p.altText?.trim() || undefined;
          return {
            id: p.id,
            url: p.url,
            title:
              explicitTitle ||
              caption ||
              explicitAltText ||
              (uploaderName ? `Photo by ${uploaderName}` : 'Reception Photo'),
            altText: explicitAltText || caption || explicitTitle,
            ...(caption ? { caption } : {}),
            ...(uploaderName ? { uploaderName } : {}),
            isGuestUpload: Boolean(p.isGuestUpload),
            createdAt: p.createdAt,
            ...(p.updatedAt ? { updatedAt: p.updatedAt } : {}),
          };
        };

        setPhotos((prev) => {
          const incomingById = new Map<string, SlideshowPhoto>();
          const incomingByUrl = new Map<string, SlideshowPhoto>();

          for (const raw of data.photos as SlideshowPhoto[]) {
            if (!raw?.url || failedUrls.has(raw.url) || failedUrlsRef.current.has(raw.url)) {
              continue;
            }
            const normalized = mapPolledSlide(raw);
            if (normalized.id) {
              incomingById.set(normalized.id, normalized);
            }
            incomingByUrl.set(normalized.url, normalized);
          }

          let didUpdateExisting = false;
          const refreshedPrev = prev.map((existing) => {
            const updated =
              (existing.id ? incomingById.get(existing.id) : undefined) ||
              incomingByUrl.get(existing.url);
            if (!updated) {
              return existing;
            }
            didUpdateExisting = true;
            return {
              ...existing,
              ...updated,
              caption: updated.caption,
              uploaderName: updated.uploaderName,
            };
          });

          const existingIds = new Set(
            refreshedPrev.map((p) => p.id).filter((id): id is string => Boolean(id))
          );
          const existingUrls = new Set(refreshedPrev.map((p) => p.url));

          const newPhotos: SlideshowPhoto[] = (data.photos as SlideshowPhoto[])
            .filter(
              (p) =>
                p?.url &&
                (!p.id || !existingIds.has(p.id)) &&
                !existingUrls.has(p.url) &&
                !failedUrls.has(p.url) &&
                !failedUrlsRef.current.has(p.url)
            )
            .map(mapPolledSlide);

          if (didUpdateExisting || newPhotos.length > 0) {
            return [...refreshedPrev, ...newPhotos];
          }
          return prev;
        });
      }
    } catch (err) {
      // Network disconnection or failure handled gracefully without crashing
      console.warn('Unable to fetch latest photos from API, continuing with cached photos:', err);
    }
  }, [failedUrls]);

  useEffect(() => {
    // 30 seconds background polling to conserve server resources
    const pollInterval = setInterval(pollPublicPhotos, 30000);
    return () => clearInterval(pollInterval);
  }, [pollPublicPhotos]);

  // Fullscreen support
  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        if (document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
          setIsFullscreen(true);
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
          setIsFullscreen(false);
        }
      }
    } catch (err) {
      console.warn('Fullscreen request failed:', err);
    }
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const clearQrControlInteraction = useCallback(() => {
    hoveredRegionsRef.current.delete('qr');
    setIsControlsHovered(hoveredRegionsRef.current.size > 0);
    if (
      typeof document !== 'undefined' &&
      qrOverlayRef.current?.contains(document.activeElement)
    ) {
      isControlsFocusedRef.current = false;
      setIsControlsFocused(false);
      handleUserActivity();
    }
  }, [handleUserActivity]);

  const handleDismissQrOverlay = useCallback(() => {
    clearQrControlInteraction();
    setShowQrCode(false);
    setIsQrExpandedOnCompact(false);
  }, [clearQrControlInteraction]);

  const handleToggleQrOverlay = useCallback(() => {
    setShowQrCode((prev) => {
      const next = !prev;
      if (!next) {
        clearQrControlInteraction();
        setIsQrExpandedOnCompact(false);
      }
      return next;
    });
  }, [clearQrControlInteraction]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }

      const target = e.target instanceof Element ? e.target : null;
      const isEditableOrInput = Boolean(
        target &&
          ((target as HTMLElement).isContentEditable ||
            target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'))
      );

      // Don't trigger shortcuts if focus is inside an input or editable field
      if (isEditableOrInput) {
        return;
      }

      const isInteractiveTarget = Boolean(
        target &&
          (isInteractiveControl(target) ||
            target.closest('button, a, [role="button"], [role="link"]'))
      );

      if (e.key === 'Escape' && showQrCode) {
        handleDismissQrOverlay();
      } else if (areShortcutsEnabled && !isInteractiveTarget) {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          goToNext();
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          goToPrev();
        } else if (e.key === ' ' || e.key === 'Space' || e.code === 'Space') {
          e.preventDefault();
          togglePlayback();
        } else if (e.key === 'f' || e.key === 'F') {
          e.preventDefault();
          toggleFullscreen();
        } else if (e.key === 'q' || e.key === 'Q') {
          e.preventDefault();
          handleToggleQrOverlay();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    areShortcutsEnabled,
    goToNext,
    goToPrev,
    handleDismissQrOverlay,
    handleToggleQrOverlay,
    isInteractiveControl,
    showQrCode,
    toggleFullscreen,
    togglePlayback,
  ]);

  const safeIndex = photos.length > 0 ? currentIndex % photos.length : 0;
  const activePhoto = photos.length > 0 ? (photos[safeIndex] || photos[0]) : null;
  const activeHeadline =
    activePhoto?.caption ||
    activePhoto?.title ||
    (activePhoto?.uploaderName ? `Photo by ${activePhoto.uploaderName}` : undefined);
  const activeAttribution =
    activePhoto?.uploaderName && activeHeadline !== `Photo by ${activePhoto.uploaderName}`
      ? `Shared by ${activePhoto.uploaderName}`
      : undefined;
  const shouldShowControls = areControlsVisible || !isPlaying;
  const isQrRenderedAsChip = isCompactViewport && !isQrExpandedOnCompact;

  return (
    <div
      ref={containerRef}
      className={`fixed inset-0 z-50 bg-stone-950 text-white overflow-hidden flex flex-col justify-between select-none ${
        shouldShowControls ? 'cursor-default' : 'cursor-none'
      }`}
      data-testid="slideshow-container"
    >
      {/* Ambient Blurred Background of Current Photo */}
      {activePhoto && (
        <div
          className="absolute inset-0 bg-cover bg-center filter blur-3xl opacity-25 scale-110 pointer-events-none transition-all duration-1000 ease-in-out motion-reduce:transition-none"
          style={{ backgroundImage: `url(${withBasePath(activePhoto.url)})` }}
          aria-hidden="true"
        />
      )}

      {/* Subtle Vignette Gradient Overlay */}
      <div
        className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/60 pointer-events-none"
        aria-hidden="true"
      />

      <MainLandmark
        aria-label="Live Wedding Reception Slideshow"
        className="relative z-10 flex-1 flex flex-col justify-between min-h-0"
      >
        {/* Screen reader live update announcement */}
        <div
          className="sr-only"
          aria-live={isPlaying ? 'off' : 'polite'}
          aria-atomic="true"
          data-testid="slideshow-live-region"
        >
          Photo {photos.length > 0 ? safeIndex + 1 : 0} of {photos.length}: {activeHeadline || 'Wedding Photo'}
          {activeAttribution ? ` (${activeAttribution})` : ''}
        </div>

        {/* Top Header Information Overlay */}
        <div
          ref={headerRef}
          onMouseEnter={() => handleRegionEnter('header')}
          onMouseLeave={() => handleRegionLeave('header')}
          onPointerEnter={(e) => handleRegionEnter('header', e.pointerType)}
          onPointerLeave={() => handleRegionLeave('header')}
          className={`relative z-30 flex items-center justify-between gap-2 px-3 py-1.5 sm:px-6 sm:py-4 transition-opacity duration-500 motion-reduce:transition-none focus-within:opacity-100 focus-within:pointer-events-auto ${
            shouldShowControls ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
          data-testid="slideshow-top-header"
        >
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Link
              href="/photos"
              className="shrink-0 inline-flex items-center gap-1.5 min-h-8 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/15 text-xs sm:text-sm font-medium text-white transition focus:outline-none focus:ring-2 focus:ring-white"
              aria-label="Exit slideshow and return to photos gallery"
              data-testid="slideshow-back-link"
            >
              <svg
                className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Gallery
            </Link>
            <h1 className="text-[11px] sm:text-xs uppercase tracking-wider font-semibold text-stone-200 drop-shadow-md truncate">
              Live Reception Slideshow
            </h1>
          </div>

          <div className="shrink-0 flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full bg-black/50 backdrop-blur-md border border-white/10 text-xs font-medium text-stone-200 tabular-nums">
            <span>{photos.length > 0 ? safeIndex + 1 : 0}</span>
            <span className="text-stone-300">/</span>
            <span>{photos.length}</span>
          </div>
        </div>

        {/* Main Active Photo Presentation Stage */}
        <div
          className="relative z-10 flex-1 min-h-0 flex flex-col items-center justify-center px-3 py-1 sm:p-4 md:p-8 pb-28 md:pb-24"
          data-testid="slideshow-stage"
        >
          {activePhoto ? (
            <div className="relative max-w-full max-h-full min-h-0 flex flex-col items-center justify-center">
              <img
                key={activePhoto.url}
                src={withBasePath(activePhoto.url)}
                alt={activePhoto.altText || activePhoto.title || `Reception photo ${safeIndex + 1}`}
                className="max-h-[calc(100vh-11rem)] md:max-h-[72vh] max-w-[90vw] object-contain rounded-2xl shadow-2xl transition-opacity duration-700 ease-in-out motion-reduce:transition-none"
                data-testid="slideshow-image"
                onError={() => handlePhotoError(activePhoto.url)}
              />
              {activeHeadline && (
                <div className="mt-2 sm:mt-3 px-3.5 sm:px-4 py-1.5 rounded-2xl bg-black/75 backdrop-blur-md border border-white/10 text-center max-w-2xl">
                  <p
                    className="text-xs sm:text-sm md:text-base font-medium text-stone-100 drop-shadow line-clamp-2"
                    data-testid="slideshow-photo-title"
                  >
                    {activeHeadline}
                  </p>
                  {activeAttribution && (
                    <p
                      className="text-[11px] sm:text-xs md:text-sm text-stone-300 mt-0.5"
                      data-testid="slideshow-photo-attribution"
                    >
                      {activeAttribution}
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div
              data-testid="slideshow-empty-state"
              className="max-w-md rounded-2xl border border-white/15 bg-stone-900/80 backdrop-blur-md p-6 sm:p-8 text-center space-y-2 sm:space-y-3 shadow-2xl"
            >
              <h2 className="text-lg sm:text-xl font-bold text-white">No photos published yet</h2>
              <p className="text-xs sm:text-sm text-stone-300">
                Approved guest uploads and published gallery photos will appear here automatically.
              </p>
            </div>
          )}
        </div>

        {/* Bottom Responsive Wrapping Control Dock */}
        <div
          ref={controlsRef}
          role="toolbar"
          aria-label="Slideshow Controls"
          onMouseEnter={() => handleRegionEnter('toolbar')}
          onMouseLeave={() => handleRegionLeave('toolbar')}
          onPointerEnter={(e) => handleRegionEnter('toolbar', e.pointerType)}
          onPointerLeave={() => handleRegionLeave('toolbar')}
          className={`group fixed ${controlsBottomClass} left-1/2 -translate-x-1/2 z-50 w-[calc(100vw-1.5rem)] max-w-md md:w-auto md:max-w-[calc(100vw-2rem)] flex flex-col md:flex-row md:flex-wrap items-stretch md:items-center gap-1.5 md:gap-2.5 p-2 md:px-5 md:py-2.5 rounded-2xl md:rounded-full border text-white transition-all duration-500 motion-reduce:transition-none focus-within:bg-stone-900/90 focus-within:backdrop-blur-xl focus-within:border-white/15 focus-within:shadow-2xl ${
            shouldShowControls
              ? 'bg-stone-900/90 backdrop-blur-xl border-white/15 shadow-2xl'
              : 'bg-transparent border-transparent shadow-none'
          }`}
          data-testid="slideshow-controls"
        >
          {/* Play / Pause Button (persistently visible and operable per WCAG 2.2 SC 2.2.2) */}
          <button
            type="button"
            onClick={togglePlayback}
            className="cursor-pointer max-md:absolute max-md:left-2 max-md:top-2 z-10 shrink-0 w-9 h-9 rounded-full bg-white text-stone-900 hover:bg-stone-200 flex items-center justify-center transition focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-stone-900 focus:ring-white shadow-md"
            aria-label={isPlaying ? 'Pause slideshow' : 'Play slideshow'}
            data-testid="slideshow-play-pause-btn"
          >
            {isPlaying ? (
              <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          {/* Secondary Toolbar Controls (fade after 3s of inactivity during auto-play) */}
          <div
            className={`flex flex-col md:flex-row md:flex-wrap items-stretch md:items-center gap-1.5 md:gap-2.5 transition-opacity duration-500 motion-reduce:transition-none focus-within:opacity-100 focus-within:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto ${
              shouldShowControls ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
            }`}
            data-testid="slideshow-secondary-controls"
          >
            {/* Top Row on Compact / Leading Transport Group on Desktop */}
            <div className="flex flex-wrap items-center justify-between gap-1.5 pl-11 md:pl-0 md:justify-start md:gap-2">
              <div className="flex items-center gap-1.5 md:gap-2">
                {/* Previous Button */}
                <button
                  type="button"
                  onClick={goToPrev}
                  className="cursor-pointer w-9 h-9 rounded-full bg-white/10 md:bg-transparent hover:bg-white/20 text-stone-100 hover:text-white flex items-center justify-center border border-white/10 md:border-transparent transition focus:outline-none focus:ring-2 focus:ring-white"
                  aria-label="Previous photo"
                  data-testid="slideshow-prev-btn"
                >
                  <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>

                {/* Next Button */}
                <button
                  type="button"
                  onClick={goToNext}
                  className="cursor-pointer w-9 h-9 rounded-full bg-white/10 md:bg-transparent hover:bg-white/20 text-stone-100 hover:text-white flex items-center justify-center border border-white/10 md:border-transparent transition focus:outline-none focus:ring-2 focus:ring-white"
                  aria-label="Next photo"
                  data-testid="slideshow-next-btn"
                >
                  <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>

              {/* Fullscreen Toggle */}
              <button
                type="button"
                onClick={toggleFullscreen}
                className="cursor-pointer w-9 h-9 rounded-full bg-white/10 md:bg-transparent hover:bg-white/20 text-stone-100 hover:text-white flex items-center justify-center border border-white/10 md:border-transparent transition focus:outline-none focus:ring-2 focus:ring-white"
                aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                data-testid="slideshow-fullscreen-btn"
              >
                {isFullscreen ? (
                  <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
                    />
                  </svg>
                )}
              </button>
            </div>

            <div className="h-5 w-px bg-white/20 mx-0.5 hidden md:block" aria-hidden="true" />

            {/* Bottom Row on Compact / Trailing Speed & Utility Group on Desktop */}
            <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1.5 border-t border-white/10 md:pt-0 md:border-t-0 md:justify-start md:gap-2">
              {/* Duration / Speed Switcher (5s, 8s, 10s) */}
              <div
                className="flex items-center gap-0.5 sm:gap-1 bg-stone-800/85 rounded-full p-0.5 sm:p-1 border border-white/10"
                role="group"
                aria-label="Cycle speed duration"
              >
                {([5, 8, 10] as const).map((s) => {
                  const isSelected = duration === s;
                  return (
                    <Button
                      key={s}
                      type="button"
                      variant="ghost"
                      size="sm"
                      pressed={isSelected}
                      srContext={`cycle photo every ${s} seconds`}
                      onClick={() => setDuration(s)}
                      data-testid={`slideshow-duration-${s}s-btn`}
                      style={
                        {
                          '--btn-ghost-bg': isSelected ? '#ffffff' : 'transparent',
                          '--btn-ghost-text': isSelected ? '#1c1917' : '#d6d3d1',
                          '--btn-ghost-hover-bg': isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.1)',
                          borderRadius: '9999px',
                          fontWeight: 600,
                        } as React.CSSProperties
                      }
                      className={`!h-auto min-h-7 min-w-8 !px-2 sm:!px-2.5 !py-1 rounded-full !ring-offset-0 focus-visible:!ring-white focus-visible:!ring-offset-0 ${
                        isSelected ? 'shadow-sm' : 'hover:!text-white'
                      }`}
                    >
                      {s}s
                    </Button>
                  );
                })}
              </div>

              <div className="h-5 w-px bg-white/20 mx-0.5 hidden md:block" aria-hidden="true" />

              <div className="flex items-center gap-1.5 md:gap-2">
                {/* QR Code Overlay Toggle */}
                <button
                  type="button"
                  onClick={handleToggleQrOverlay}
                  className={`cursor-pointer w-8 h-8 md:w-9 md:h-9 rounded-full flex items-center justify-center border transition focus:outline-none focus:ring-2 focus:ring-white ${
                    showQrCode
                      ? 'bg-white/20 text-white border-white/15'
                      : 'bg-white/10 md:bg-transparent text-stone-200 hover:text-white hover:bg-white/15 border-white/10 md:border-transparent'
                  }`}
                  aria-label={showQrCode ? 'Hide QR upload overlay' : 'Show QR upload overlay'}
                  aria-pressed={showQrCode}
                  data-testid="slideshow-qr-toggle-btn"
                >
                  <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="3" y="3" width="7" height="7" rx="1" strokeWidth={2} />
                    <rect x="14" y="3" width="7" height="7" rx="1" strokeWidth={2} />
                    <rect x="14" y="14" width="7" height="7" rx="1" strokeWidth={2} />
                    <rect x="3" y="14" width="7" height="7" rx="1" strokeWidth={2} />
                  </svg>
                </button>

                {/* Keyboard Shortcuts Toggle */}
                <button
                  type="button"
                  onClick={() => setAreShortcutsEnabled((prev) => !prev)}
                  className={`cursor-pointer w-8 h-8 md:w-9 md:h-9 rounded-full flex items-center justify-center border transition focus:outline-none focus:ring-2 focus:ring-white ${
                    areShortcutsEnabled
                      ? 'bg-white/20 text-white border-white/15'
                      : 'bg-white/10 md:bg-transparent text-stone-200 hover:text-white hover:bg-white/15 border-white/10 md:border-transparent'
                  }`}
                  aria-label="Keyboard shortcuts (Arrow keys, Space, F, Q)"
                  aria-pressed={areShortcutsEnabled}
                  title={
                    areShortcutsEnabled
                      ? 'Disable keyboard shortcuts (Arrow keys, Space, F, Q)'
                      : 'Enable keyboard shortcuts (Arrow keys, Space, F, Q)'
                  }
                  data-testid="slideshow-shortcuts-toggle-btn"
                >
                  <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="2" y="5" width="20" height="14" rx="2" strokeWidth={2} />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M9 13h6"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </MainLandmark>

      {/* Toggleable QR Code Overlay for Reception Guests (compact chip below 768px width or 500px height) */}
      {showQrCode && (
        <aside
          ref={qrOverlayRef}
          aria-label="Guest Photo Upload QR Code"
          onMouseEnter={() => handleRegionEnter('qr')}
          onMouseLeave={() => handleRegionLeave('qr')}
          onPointerEnter={(e) => handleRegionEnter('qr', e.pointerType)}
          onPointerLeave={() => handleRegionLeave('qr')}
          className={
            isQrRenderedAsChip
              ? `fixed ${qrOverlayBottomClass} right-3 sm:right-6 z-40`
              : `fixed ${qrOverlayBottomClass} ${qrOverlayMaxHeightClass} right-3 sm:right-6 left-3 sm:left-auto z-40 sm:w-80 md:w-96 max-w-[calc(100vw-1.5rem)] overflow-y-auto overscroll-contain rounded-2xl p-3.5 sm:p-5 bg-stone-900/95 text-white shadow-2xl backdrop-blur-md border border-white/15 animate-fade-in motion-reduce:animate-none`
          }
          data-testid="slideshow-qr-overlay"
        >
          {isQrRenderedAsChip ? (
            <button
              type="button"
              onClick={() => setIsQrExpandedOnCompact(true)}
              aria-expanded={false}
              data-testid="slideshow-qr-chip-btn"
              className="cursor-pointer min-h-8 py-1.5 px-3.5 rounded-full bg-stone-900/95 hover:bg-stone-800 text-white border border-white/20 shadow-xl backdrop-blur-md flex items-center gap-2 transition focus:outline-none focus:ring-2 focus:ring-white"
            >
              <svg
                className="w-3.5 h-3.5 text-amber-400 shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <svg
                className="w-3 h-3 text-stone-200 shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <rect x="3" y="3" width="7" height="7" rx="1" strokeWidth={2} />
                <rect x="14" y="3" width="7" height="7" rx="1" strokeWidth={2} />
                <rect x="3" y="14" width="7" height="7" rx="1" strokeWidth={2} />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 14h3v3h-3zM17 17h4v4h-4zM14 20h3v1h-3z" />
              </svg>
              <span className="text-xs font-semibold text-white tracking-wide">Upload Photos</span>
            </button>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <h2 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                    <svg
                      className="w-4 h-4 sm:w-5 sm:h-5 text-amber-400 shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                      />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Upload Your Photos
                  </h2>
                  <p className="text-xs text-stone-300 mt-0.5">
                    Scan with your phone to display your photos on screen!
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleDismissQrOverlay}
                  className="cursor-pointer shrink-0 w-8 h-8 rounded-full text-stone-200 hover:text-white hover:bg-white/15 flex items-center justify-center transition focus:outline-none focus:ring-2 focus:ring-white"
                  aria-label="Dismiss QR code overlay"
                  data-testid="slideshow-qr-close-btn"
                >
                  <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="flex flex-col items-center justify-center p-3 rounded-xl bg-white text-stone-900 shadow-inner">
                <ThemedQRCode
                  value={resolvedUploadUrl}
                  size={isCompactViewport ? 128 : 148}
                  fgColor="#000000"
                  bgColor="#ffffff"
                  aria-label="QR Code linking directly to guest photo upload"
                />
                <span
                  className="mt-2 text-[11px] font-mono font-medium text-stone-700 text-center break-all"
                  data-testid="slideshow-upload-url"
                >
                  {resolvedUploadUrl}
                </span>
              </div>
            </>
          )}
        </aside>
      )}
    </div>
  );
}
