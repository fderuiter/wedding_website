/* eslint-disable @next/next/no-img-element */
'use client';

import { useState, useEffect, useCallback, useRef, useMemo, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { MainLandmark } from '@/components/ui/Layout';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { withBasePath } from '@/lib/basePath';
import { useOptionalDemo } from '@/components/demo/DemoContext';
import { SlideshowControlDock } from './SlideshowControlDock';
import { SlideshowQrOverlay } from './SlideshowQrOverlay';
import {
  getSlideshowOverlayOffsets,
  useCompactSlideshowViewport,
  type ControlRegion,
  type SlideshowDuration,
} from './slideshowLayout';

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
  activeUploadUrl?: string;
  configuredUploadUrl?: string | null;
}

const getServerFalse = () => false;

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

export function ReceptionSlideshowClient({
  initialPhotos,
  uploadUrl,
  activeUploadUrl,
  configuredUploadUrl,
}: ReceptionSlideshowClientProps) {
  const demo = useOptionalDemo();
  const hasExpandedDemoToolbar = Boolean(demo?.isDemoMode && !demo.isToolbarCollapsed);
  const hasCollapsedDemoToolbar = Boolean(demo?.isDemoMode && demo.isToolbarCollapsed);
  const {
    controlsBottomClass,
    qrOverlayBottomClass,
    qrOverlayMaxHeightClass,
  } = getSlideshowOverlayOffsets({
    hasExpandedDemoToolbar,
    hasCollapsedDemoToolbar,
  });

  const prefersReducedMotion = useReducedMotion();
  const subscribeNoop = useCallback(() => () => {}, []);
  const isHydrated = useSyncExternalStore(subscribeNoop, () => true, getServerFalse);
  const isCompactViewport = useCompactSlideshowViewport();

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

  const [duration, setDuration] = useState<SlideshowDuration>(8);
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

  // Derive resolved upload URL (preferring activeUploadUrl when its origin matches clientOrigin, and upgrading relative paths)
  const resolvedUploadUrl = useMemo(() => {
    const normalizeCandidate = (candidate?: string | null): string => {
      if (!candidate) return '';
      if (candidate.startsWith('/')) {
        const prefixed = withBasePath(candidate);
        return clientOrigin ? `${clientOrigin}${prefixed}` : prefixed;
      }
      return candidate;
    };

    const normalizedActive = normalizeCandidate(activeUploadUrl);
    if (normalizedActive && clientOrigin) {
      try {
        if (new URL(normalizedActive).origin === clientOrigin) {
          return normalizedActive;
        }
      } catch {
        // Ignore unparseable candidate URL
      }
    }

    const primaryUrl = normalizeCandidate(uploadUrl ?? configuredUploadUrl);
    if (primaryUrl) {
      return primaryUrl;
    }

    const photosPath = withBasePath('/photos?tab=guest');
    if (clientOrigin) {
      return `${clientOrigin}${photosPath}`;
    }
    return photosPath;
  }, [activeUploadUrl, clientOrigin, configuredUploadUrl, uploadUrl]);

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
      const polledPhotos: SlideshowPhoto[] = Array.isArray(data?.photos) ? data.photos : [];
      const activeIdSet: Set<string> | null = Array.isArray(data?.activeIds)
        ? new Set(
          (data.activeIds as unknown[]).filter((id): id is string => typeof id === 'string')
        )
        : null;

      if (polledPhotos.length > 0) {
        for (const p of polledPhotos) {
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
      }

      if (polledPhotos.length > 0 || activeIdSet !== null) {
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
          let didEvict = false;
          const retainedPrev =
            activeIdSet !== null
              ? prev.filter((existing) => {
                if (!existing.id || existing.id.startsWith('initial-')) {
                  return true;
                }
                const keep = activeIdSet.has(existing.id);
                if (!keep) {
                  didEvict = true;
                }
                return keep;
              })
              : prev;

          const incomingById = new Map<string, SlideshowPhoto>();
          const incomingByUrl = new Map<string, SlideshowPhoto>();

          for (const raw of polledPhotos) {
            if (!raw?.url || failedUrls.has(raw.url) || failedUrlsRef.current.has(raw.url)) {
              continue;
            }
            if (activeIdSet !== null && raw.id && !activeIdSet.has(raw.id)) {
              continue;
            }
            const normalized = mapPolledSlide(raw);
            if (normalized.id) {
              incomingById.set(normalized.id, normalized);
            }
            incomingByUrl.set(normalized.url, normalized);
          }

          let didUpdateExisting = false;
          const refreshedPrev = retainedPrev.map((existing) => {
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

          const newPhotos: SlideshowPhoto[] = polledPhotos
            .filter(
              (p) =>
                p?.url &&
                (!activeIdSet || !p.id || activeIdSet.has(p.id)) &&
                (!p.id || !existingIds.has(p.id)) &&
                !existingUrls.has(p.url) &&
                !failedUrls.has(p.url) &&
                !failedUrlsRef.current.has(p.url)
            )
            .map(mapPolledSlide);

          if (didEvict || didUpdateExisting || newPhotos.length > 0) {
            const nextList = [...refreshedPrev, ...newPhotos];
            setCurrentIndex((prevIdx) =>
              nextList.length === 0 ? 0 : Math.min(prevIdx, nextList.length - 1)
            );
            return nextList;
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
      const qrToggleBtn = controlsRef.current?.querySelector<HTMLButtonElement>(
        '[data-testid="slideshow-qr-toggle-btn"]'
      );
      if (qrToggleBtn) {
        qrToggleBtn.focus();
      } else {
        isControlsFocusedRef.current = false;
        setIsControlsFocused(false);
      }
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

        <SlideshowControlDock
          ref={controlsRef}
          controlsBottomClass={controlsBottomClass}
          shouldShowControls={shouldShowControls}
          isPlaying={isPlaying}
          isFullscreen={isFullscreen}
          duration={duration}
          showQrCode={showQrCode}
          areShortcutsEnabled={areShortcutsEnabled}
          onTogglePlayback={togglePlayback}
          onPrev={goToPrev}
          onNext={goToNext}
          onToggleFullscreen={toggleFullscreen}
          onSelectDuration={setDuration}
          onToggleQrOverlay={handleToggleQrOverlay}
          onToggleShortcuts={() => setAreShortcutsEnabled((prev) => !prev)}
          onRegionEnter={handleRegionEnter}
          onRegionLeave={handleRegionLeave}
        />
      </MainLandmark>

      {showQrCode && (
        <SlideshowQrOverlay
          ref={qrOverlayRef}
          isRenderedAsChip={isQrRenderedAsChip}
          isCompactViewport={isCompactViewport}
          qrOverlayBottomClass={qrOverlayBottomClass}
          qrOverlayMaxHeightClass={qrOverlayMaxHeightClass}
          resolvedUploadUrl={resolvedUploadUrl}
          onExpandChip={() => setIsQrExpandedOnCompact(true)}
          onDismiss={handleDismissQrOverlay}
          onRegionEnter={handleRegionEnter}
          onRegionLeave={handleRegionLeave}
        />
      )}
    </div>
  );
}
