'use client';

import React, { forwardRef } from 'react';
import { Button } from '@/components/ui/Button';
import type { ControlRegion, SlideshowDuration } from './slideshowLayout';

interface SlideshowControlDockProps {
  controlsBottomClass: string;
  shouldShowControls: boolean;
  isPlaying: boolean;
  isFullscreen: boolean;
  duration: SlideshowDuration;
  showQrCode: boolean;
  areShortcutsEnabled: boolean;
  onTogglePlayback: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleFullscreen: () => void;
  onSelectDuration: (duration: SlideshowDuration) => void;
  onToggleQrOverlay: () => void;
  onToggleShortcuts: () => void;
  onRegionEnter: (region: ControlRegion, pointerType?: string) => void;
  onRegionLeave: (region: ControlRegion) => void;
}

const DURATION_OPTIONS: readonly SlideshowDuration[] = [5, 8, 10];

export const SlideshowControlDock = forwardRef<HTMLDivElement, SlideshowControlDockProps>(
  function SlideshowControlDock(
    {
      controlsBottomClass,
      shouldShowControls,
      isPlaying,
      isFullscreen,
      duration,
      showQrCode,
      areShortcutsEnabled,
      onTogglePlayback,
      onPrev,
      onNext,
      onToggleFullscreen,
      onSelectDuration,
      onToggleQrOverlay,
      onToggleShortcuts,
      onRegionEnter,
      onRegionLeave,
    },
    ref
  ) {
    return (
      <div
        ref={ref}
        role="toolbar"
        aria-label="Slideshow Controls"
        onMouseEnter={() => onRegionEnter('toolbar')}
        onMouseLeave={() => onRegionLeave('toolbar')}
        onPointerEnter={(e) => onRegionEnter('toolbar', e.pointerType)}
        onPointerLeave={() => onRegionLeave('toolbar')}
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
          onClick={onTogglePlayback}
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
              <button
                type="button"
                onClick={onPrev}
                className="cursor-pointer w-9 h-9 rounded-full bg-white/10 md:bg-transparent hover:bg-white/20 text-stone-100 hover:text-white flex items-center justify-center border border-white/10 md:border-transparent transition focus:outline-none focus:ring-2 focus:ring-white"
                aria-label="Previous photo"
                data-testid="slideshow-prev-btn"
              >
                <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>

              <button
                type="button"
                onClick={onNext}
                className="cursor-pointer w-9 h-9 rounded-full bg-white/10 md:bg-transparent hover:bg-white/20 text-stone-100 hover:text-white flex items-center justify-center border border-white/10 md:border-transparent transition focus:outline-none focus:ring-2 focus:ring-white"
                aria-label="Next photo"
                data-testid="slideshow-next-btn"
              >
                <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>

            <button
              type="button"
              onClick={onToggleFullscreen}
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
            <div
              className="flex items-center gap-0.5 sm:gap-1 bg-stone-800/85 rounded-full p-0.5 sm:p-1 border border-white/10"
              role="group"
              aria-label="Cycle speed duration"
            >
              {DURATION_OPTIONS.map((s) => {
                const isSelected = duration === s;
                return (
                  <Button
                    key={s}
                    type="button"
                    variant="ghost"
                    size="sm"
                    pressed={isSelected}
                    srContext={`cycle photo every ${s} seconds`}
                    onClick={() => onSelectDuration(s)}
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
              <button
                type="button"
                onClick={onToggleQrOverlay}
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

              <button
                type="button"
                onClick={onToggleShortcuts}
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
    );
  }
);
