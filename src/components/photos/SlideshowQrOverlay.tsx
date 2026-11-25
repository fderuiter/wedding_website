'use client';

import { forwardRef, useEffect, useRef } from 'react';
import { ThemedQRCode } from '@/components/ui/ThemedQRCode';
import type { ControlRegion } from './slideshowLayout';

interface SlideshowQrOverlayProps {
  isRenderedAsChip: boolean;
  isCompactViewport: boolean;
  qrOverlayBottomClass: string;
  qrOverlayMaxHeightClass: string;
  resolvedUploadUrl: string;
  onExpandChip: () => void;
  onDismiss: () => void;
  onRegionEnter: (region: ControlRegion, pointerType?: string) => void;
  onRegionLeave: (region: ControlRegion) => void;
}

export const SlideshowQrOverlay = forwardRef<HTMLElement, SlideshowQrOverlayProps>(
  function SlideshowQrOverlay(
    {
      isRenderedAsChip,
      isCompactViewport,
      qrOverlayBottomClass,
      qrOverlayMaxHeightClass,
      resolvedUploadUrl,
      onExpandChip,
      onDismiss,
      onRegionEnter,
      onRegionLeave,
    },
    ref
  ) {
    const closeBtnRef = useRef<HTMLButtonElement | null>(null);
    const pendingFocusOnExpandRef = useRef(false);

    useEffect(() => {
      if (!isRenderedAsChip && pendingFocusOnExpandRef.current) {
        pendingFocusOnExpandRef.current = false;
        closeBtnRef.current?.focus();
      }
    }, [isRenderedAsChip]);

    return (
      <aside
        ref={ref}
        aria-label="Guest Photo Upload QR Code"
        onMouseEnter={() => onRegionEnter('qr')}
        onMouseLeave={() => onRegionLeave('qr')}
        onPointerEnter={(e) => onRegionEnter('qr', e.pointerType)}
        onPointerLeave={() => onRegionLeave('qr')}
        className={
          isRenderedAsChip
            ? `fixed ${qrOverlayBottomClass} right-3 sm:right-6 z-40`
            : `fixed ${qrOverlayBottomClass} ${qrOverlayMaxHeightClass} right-3 sm:right-6 left-3 sm:left-auto mx-auto sm:mx-0 z-40 sm:w-80 md:w-96 max-w-[290px] sm:max-w-[calc(100vw-1.5rem)] overflow-y-auto overscroll-contain rounded-2xl p-3.5 sm:p-5 bg-stone-900/95 text-white shadow-2xl backdrop-blur-md border border-white/15 animate-fade-in motion-reduce:animate-none`
        }
        data-testid="slideshow-qr-overlay"
      >
        {isRenderedAsChip ? (
          <button
            type="button"
            onClick={() => {
              pendingFocusOnExpandRef.current = true;
              onExpandChip();
            }}
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
                ref={closeBtnRef}
                type="button"
                onClick={onDismiss}
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
                className="mt-2 max-w-full truncate text-[11px] font-mono font-medium text-stone-700 text-center"
                data-testid="slideshow-upload-url"
              >
                {resolvedUploadUrl}
              </span>
            </div>
          </>
        )}
      </aside>
    );
  }
);
