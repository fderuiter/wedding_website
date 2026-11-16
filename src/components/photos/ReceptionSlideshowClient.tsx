/* eslint-disable @next/next/no-img-element */
'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import { ThemedQRCode } from '@/components/ui/ThemedQRCode';

export interface SlideshowPhoto {
  id?: string;
  url: string;
  title?: string;
  altText?: string;
  isGuestUpload?: boolean;
  createdAt?: string;
}

interface ReceptionSlideshowClientProps {
  initialPhotos?: (SlideshowPhoto | string)[];
  uploadUrl?: string;
}

export const DEFAULT_FALLBACK_PHOTOS: SlideshowPhoto[] = [
  {
    id: 'fallback-1',
    url: 'https://lh3.googleusercontent.com/pw/AP1GczNPp0Rk6pvvMtymS3RUx7F6cAyOkFaovF20N5_FkaDupk3QkgjNWfTiMxZbgtnyO-Ny0tH3JPkT6Vld35Pg8xFq1AAcZcxnHdTQ3DfHKsNLKpA59mEw=w1920-h1080',
    title: 'Wedding Celebration',
  },
  {
    id: 'fallback-2',
    url: 'https://lh3.googleusercontent.com/pw/AP1GczODgnqdtUHWdCR_PDvAcDDm-RlYv0HE_oJtRCDTKF9nCREFVhZRl_020THVphEdxLAjgYfUdz0KYgCBw1sqmaF1GC7RBh0u3CZmUgBtwD7Z-bEkPm5A=w1920-h1080',
    title: 'Happy Memories',
  },
  {
    id: 'fallback-3',
    url: 'https://lh3.googleusercontent.com/pw/AP1GczPzyrWDTfT2ofwHN6_wBKO8luOfDy2xpvoQNOiOw1cSoO1yUaLPW3mPbTBCUFGoCqI1hB0udanXyfM55PXEMYtmkkTSqQhoUVqQnBmz5qnYUYU_NnhB=w1920-h1080',
    title: 'Reception Moments',
  },
];

function normalizePhotos(items?: (SlideshowPhoto | string)[]): SlideshowPhoto[] {
  if (!items || items.length === 0) {
    return DEFAULT_FALLBACK_PHOTOS;
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
}: ReceptionSlideshowClientProps) {
  const [photos, setPhotos] = useState<SlideshowPhoto[]>(() => normalizePhotos(initialPhotos));
  const [failedUrls, setFailedUrls] = useState<Set<string>>(() => new Set());
  const failedUrlsRef = useRef<Set<string>>(new Set());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [duration, setDuration] = useState<5 | 8 | 10>(8);
  const [showQrCode, setShowQrCode] = useState(true);
  const [areControlsVisible, setAreControlsVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isControlsFocusedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const controlsRef = useRef<HTMLElement | null>(null);

  // Derive initial timestamp cursor from provided initial photos
  const initialLatestTimestamp = useMemo(() => {
    if (!initialPhotos || !Array.isArray(initialPhotos)) return null;
    let maxMs = -Infinity;
    let maxIso: string | null = null;
    for (const item of initialPhotos) {
      if (typeof item !== 'string' && item.createdAt) {
        const ms = new Date(item.createdAt).getTime();
        if (!isNaN(ms) && ms > maxMs) {
          maxMs = ms;
          maxIso = item.createdAt;
        }
      }
    }
    return maxIso;
  }, [initialPhotos]);

  const latestTimestampRef = useRef<string | null>(initialLatestTimestamp);

  useEffect(() => {
    if (initialLatestTimestamp) {
      const currentMs = latestTimestampRef.current ? new Date(latestTimestampRef.current).getTime() : -Infinity;
      const initialMs = new Date(initialLatestTimestamp).getTime();
      if (initialMs > currentMs) {
        latestTimestampRef.current = initialLatestTimestamp;
      }
    }
  }, [initialLatestTimestamp]);

  // Derive resolved upload URL
  const resolvedUploadUrl = useMemo(() => {
    if (uploadUrl) return uploadUrl;
    if (typeof window !== 'undefined' && window.location?.origin) {
      return `${window.location.origin}/photos`;
    }
    return '/photos';
  }, [uploadUrl]);

  // Helper to determine whether an element is an interactive control in the slideshow
  const isInteractiveControl = useCallback((node: Node | null): boolean => {
    if (!node || !(node instanceof Element)) return false;
    if (controlsRef.current?.contains(node) || headerRef.current?.contains(node)) {
      return true;
    }
    if (containerRef.current?.contains(node) && node.closest('button, a, input, select, textarea, [tabindex]')) {
      return true;
    }
    return false;
  }, []);

  // Keep currentIndex in bounds when photos queue size shrinks
  useEffect(() => {
    if (photos.length > 0 && currentIndex >= photos.length) {
      setCurrentIndex((prev) => (photos.length > 0 ? prev % photos.length : 0));
    } else if (photos.length === 0 && currentIndex !== 0) {
      setCurrentIndex(0);
    }
  }, [photos.length, currentIndex]);

  // Handle broken image URLs by skipping immediately and falling back to default photos if all fail
  const handlePhotoError = useCallback((failedUrl: string) => {
    failedUrlsRef.current.add(failedUrl);
    setFailedUrls((prev) => {
      const next = new Set(prev);
      next.add(failedUrl);
      return next;
    });

    setPhotos((currentList) => {
      const remaining = currentList.filter((p) => p.url !== failedUrl);

      if (remaining.length > 0) {
        return remaining;
      }

      // All photos in current list failed: recover with default fallback photos that haven't failed.
      // Guard against infinite loops if fallback photos also fail.
      const availableFallbacks = DEFAULT_FALLBACK_PHOTOS.filter(
        (p) => p.url !== failedUrl && !failedUrlsRef.current.has(p.url)
      );

      if (availableFallbacks.length > 0) {
        return availableFallbacks.length === DEFAULT_FALLBACK_PHOTOS.length
          ? DEFAULT_FALLBACK_PHOTOS
          : availableFallbacks;
      }

      return [];
    });
  }, []);

  // Activity detection for auto-hiding controls & cursor
  const handleUserActivity = useCallback(() => {
    setAreControlsVisible(true);
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
    if (!isControlsFocusedRef.current) {
      inactivityTimerRef.current = setTimeout(() => {
        setAreControlsVisible(false);
      }, 3000);
    }
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined' && isInteractiveControl(document.activeElement)) {
      isControlsFocusedRef.current = true;
    }
    handleUserActivity();

    const onActivity = () => handleUserActivity();

    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as Node | null;
      if (isInteractiveControl(target)) {
        isControlsFocusedRef.current = true;
        handleUserActivity();
      } else if (isControlsFocusedRef.current) {
        isControlsFocusedRef.current = false;
        handleUserActivity();
      }
    };

    const handleFocusOut = (e: FocusEvent) => {
      const nextTarget = e.relatedTarget as Node | null;
      if (!isInteractiveControl(nextTarget)) {
        isControlsFocusedRef.current = false;
        handleUserActivity();
      }
    };

    window.addEventListener('mousemove', onActivity);
    window.addEventListener('pointermove', onActivity);
    window.addEventListener('touchstart', onActivity);
    window.addEventListener('keydown', onActivity);
    window.addEventListener('focusin', handleFocusIn);
    window.addEventListener('focusout', handleFocusOut);

    return () => {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
      window.removeEventListener('mousemove', onActivity);
      window.removeEventListener('pointermove', onActivity);
      window.removeEventListener('touchstart', onActivity);
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('focusin', handleFocusIn);
      window.removeEventListener('focusout', handleFocusOut);
    };
  }, [handleUserActivity, isInteractiveControl]);

  // Slideshow navigation handlers
  const goToNext = useCallback(() => {
    setPhotos((currentList) => {
      if (currentList.length > 0) {
        setCurrentIndex((prev) => (prev + 1) % currentList.length);
      }
      return currentList;
    });
  }, []);

  const goToPrev = useCallback(() => {
    setPhotos((currentList) => {
      if (currentList.length > 0) {
        setCurrentIndex((prev) => (prev - 1 + currentList.length) % currentList.length);
      }
      return currentList;
    });
  }, []);

  // Automatic cycling timer based on duration
  useEffect(() => {
    if (!isPlaying || photos.length <= 1) return;

    const intervalMs = duration * 1000;
    const intervalTimer = setInterval(() => {
      goToNext();
    }, intervalMs);

    return () => clearInterval(intervalTimer);
  }, [isPlaying, duration, photos.length, goToNext]);

  // Periodic polling for approved public photos (every 30 seconds)
  const pollPublicPhotos = useCallback(async () => {
    try {
      const cursor = latestTimestampRef.current;
      const endpoint = cursor ? `/api/photos?since=${encodeURIComponent(cursor)}` : '/api/photos';
      const response = await fetch(endpoint);
      if (!response.ok) return;

      const data = await response.json();
      if (data?.photos && Array.isArray(data.photos) && data.photos.length > 0) {
        for (const p of data.photos) {
          if (p.createdAt) {
            const ms = new Date(p.createdAt).getTime();
            if (!isNaN(ms)) {
              const currentMs = latestTimestampRef.current ? new Date(latestTimestampRef.current).getTime() : -Infinity;
              if (ms > currentMs) {
                latestTimestampRef.current = p.createdAt;
              }
            }
          }
        }

        setPhotos((prev) => {
          const existingUrls = new Set(prev.map((p) => p.url));
          const newPhotos: SlideshowPhoto[] = data.photos
            .filter(
              (p: SlideshowPhoto) =>
                p.url &&
                !existingUrls.has(p.url) &&
                !failedUrls.has(p.url) &&
                !failedUrlsRef.current.has(p.url)
            )
            .map((p: SlideshowPhoto) => ({
              id: p.id,
              url: p.url,
              title: p.title || p.altText || 'Reception Photo',
              altText: p.altText || p.title,
              isGuestUpload: Boolean(p.isGuestUpload),
              createdAt: p.createdAt,
            }));

          if (newPhotos.length > 0) {
            // Append newly approved photos to the slideshow queue
            return [...prev, ...newPhotos];
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

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts if focus is inside an input or editable field
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if (e.key === 'ArrowRight' || e.key === 'Space' || e.code === 'Space') {
        if (e.key === ' ' || e.code === 'Space') {
          e.preventDefault();
          setIsPlaying((prev) => !prev);
        } else {
          e.preventDefault();
          goToNext();
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goToPrev();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === 'q' || e.key === 'Q') {
        e.preventDefault();
        setShowQrCode((prev) => !prev);
      } else if (e.key === 'Escape' && showQrCode) {
        setShowQrCode(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goToNext, goToPrev, toggleFullscreen, showQrCode]);

  const safeIndex = photos.length > 0 ? currentIndex % photos.length : 0;
  const activePhoto = photos.length > 0 ? (photos[safeIndex] || photos[0]) : null;

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label="Live Wedding Reception Slideshow"
      aria-roledescription="carousel"
      className={`fixed inset-0 z-50 bg-stone-950 text-white overflow-hidden flex flex-col justify-between select-none ${
        areControlsVisible ? 'cursor-default' : 'cursor-none'
      }`}
      data-testid="slideshow-container"
    >
      {/* Screen reader live update announcement */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        Photo {photos.length > 0 ? safeIndex + 1 : 0} of {photos.length}: {activePhoto?.title || 'Wedding Photo'}
      </div>

      {/* Ambient Blurred Background of Current Photo */}
      {activePhoto && (
        <div
          className="absolute inset-0 bg-cover bg-center filter blur-3xl opacity-25 scale-110 pointer-events-none transition-all duration-1000 ease-in-out"
          style={{ backgroundImage: `url(${activePhoto.url})` }}
          aria-hidden="true"
        />
      )}

      {/* Subtle Vignette Gradient Overlay */}
      <div
        className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/60 pointer-events-none"
        aria-hidden="true"
      />

      {/* Top Header Information Overlay */}
      <header
        ref={headerRef}
        className={`relative z-20 flex items-center justify-between p-6 transition-opacity duration-500 focus-within:opacity-100 focus-within:pointer-events-auto ${
          areControlsVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        data-testid="slideshow-top-header"
      >
        <div className="flex items-center gap-3">
          <Link
            href="/photos"
            className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/15 text-sm font-medium text-white transition focus:outline-none focus:ring-2 focus:ring-white"
            aria-label="Exit slideshow and return to photos gallery"
            data-testid="slideshow-back-link"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Gallery
          </Link>
          <span className="text-xs uppercase tracking-wider font-semibold text-stone-300 drop-shadow-md">
            Live Reception Slideshow
          </span>
        </div>

        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/40 backdrop-blur-md border border-white/10 text-xs font-medium text-stone-200">
          <span>{photos.length > 0 ? safeIndex + 1 : 0}</span>
          <span className="text-stone-500">/</span>
          <span>{photos.length}</span>
        </div>
      </header>

      {/* Main Active Photo Presentation Stage */}
      <main
        className="relative z-10 flex-1 flex flex-col items-center justify-center p-4 md:p-8"
        data-testid="slideshow-stage"
      >
        {activePhoto && (
          <div className="relative max-w-full max-h-full flex flex-col items-center justify-center">
            <img
              key={activePhoto.url}
              src={activePhoto.url}
              alt={activePhoto.altText || activePhoto.title || `Reception photo ${safeIndex + 1}`}
              className="max-h-[75vh] max-w-[90vw] object-contain rounded-2xl shadow-2xl transition-opacity duration-700 ease-in-out"
              data-testid="slideshow-image"
              onError={() => handlePhotoError(activePhoto.url)}
            />
            {activePhoto.title && (
              <p
                className="mt-3 px-4 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-sm md:text-base font-medium text-stone-100 drop-shadow text-center"
                data-testid="slideshow-photo-title"
              >
                {activePhoto.title}
              </p>
            )}
          </div>
        )}
      </main>

      {/* Toggleable QR Code Overlay for Reception Guests */}
      {showQrCode && (
        <aside
          role="complementary"
          aria-label="Guest Photo Upload QR Code"
          className="fixed bottom-24 right-6 z-40 max-w-xs md:max-w-sm rounded-2xl p-5 bg-stone-900/90 text-white shadow-2xl backdrop-blur-md border border-white/15 animate-fade-in"
          data-testid="slideshow-qr-overlay"
        >
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <svg
                  className="w-5 h-5 text-amber-400"
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
              </h3>
              <p className="text-xs text-stone-300 mt-0.5">
                Scan with your phone to display your photos on screen!
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowQrCode(false)}
              className="p-1 rounded-full text-stone-400 hover:text-white hover:bg-white/10 transition focus:outline-none focus:ring-2 focus:ring-white"
              aria-label="Dismiss QR code overlay"
              data-testid="slideshow-qr-close-btn"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex flex-col items-center justify-center p-3 rounded-xl bg-white text-stone-900 shadow-inner">
            <ThemedQRCode
              value={resolvedUploadUrl}
              size={148}
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
        </aside>
      )}

      {/* Bottom Floating Control Bar */}
      <footer
        ref={controlsRef}
        role="toolbar"
        aria-label="Slideshow Controls"
        className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 sm:gap-3 px-4 sm:px-6 py-2.5 sm:py-3 rounded-full bg-stone-900/85 backdrop-blur-md border border-white/15 shadow-2xl text-white transition-opacity duration-500 focus-within:opacity-100 focus-within:pointer-events-auto ${
          areControlsVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        data-testid="slideshow-controls"
      >
        {/* Previous Button */}
        <button
          type="button"
          onClick={goToPrev}
          className="p-2 rounded-full hover:bg-white/15 text-stone-200 hover:text-white transition focus:outline-none focus:ring-2 focus:ring-white"
          aria-label="Previous photo"
          data-testid="slideshow-prev-btn"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Play / Pause Button */}
        <button
          type="button"
          onClick={() => setIsPlaying((prev) => !prev)}
          className="p-2.5 rounded-full bg-white text-stone-900 hover:bg-stone-200 transition focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-white shadow-md"
          aria-label={isPlaying ? 'Pause slideshow' : 'Play slideshow'}
          data-testid="slideshow-play-pause-btn"
        >
          {isPlaying ? (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {/* Next Button */}
        <button
          type="button"
          onClick={goToNext}
          className="p-2 rounded-full hover:bg-white/15 text-stone-200 hover:text-white transition focus:outline-none focus:ring-2 focus:ring-white"
          aria-label="Next photo"
          data-testid="slideshow-next-btn"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <div className="h-5 w-px bg-white/20 mx-1 hidden sm:block" aria-hidden="true" />

        {/* Duration / Speed Switcher (5s, 8s, 10s) */}
        <div
          className="flex items-center gap-1 bg-stone-800/80 rounded-full p-1 border border-white/10"
          role="group"
          aria-label="Cycle speed duration"
        >
          {([5, 8, 10] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setDuration(s)}
              data-testid={`slideshow-duration-${s}s-btn`}
              aria-pressed={duration === s}
              className={`px-2.5 py-1 text-xs font-semibold rounded-full transition focus:outline-none focus:ring-2 focus:ring-white ${
                duration === s
                  ? 'bg-white text-stone-900 shadow-sm'
                  : 'text-stone-300 hover:text-white hover:bg-white/10'
              }`}
              aria-label={`Cycle photo every ${s} seconds`}
            >
              {s}s
            </button>
          ))}
        </div>

        <div className="h-5 w-px bg-white/20 mx-1 hidden sm:block" aria-hidden="true" />

        {/* QR Code Overlay Toggle */}
        <button
          type="button"
          onClick={() => setShowQrCode((prev) => !prev)}
          className={`p-2 rounded-full transition focus:outline-none focus:ring-2 focus:ring-white ${
            showQrCode
              ? 'bg-white/20 text-white'
              : 'text-stone-300 hover:text-white hover:bg-white/10'
          }`}
          aria-label={showQrCode ? 'Hide QR upload overlay' : 'Show QR upload overlay'}
          aria-pressed={showQrCode}
          data-testid="slideshow-qr-toggle-btn"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" rx="1" strokeWidth={2} />
            <rect x="14" y="3" width="7" height="7" rx="1" strokeWidth={2} />
            <rect x="14" y="14" width="7" height="7" rx="1" strokeWidth={2} />
            <rect x="3" y="14" width="7" height="7" rx="1" strokeWidth={2} />
          </svg>
        </button>

        {/* Fullscreen Toggle */}
        <button
          type="button"
          onClick={toggleFullscreen}
          className="p-2 rounded-full hover:bg-white/15 text-stone-200 hover:text-white transition focus:outline-none focus:ring-2 focus:ring-white"
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          data-testid="slideshow-fullscreen-btn"
        >
          {isFullscreen ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
              />
            </svg>
          )}
        </button>
      </footer>
    </div>
  );
}
