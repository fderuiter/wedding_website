import { useSyncExternalStore } from 'react';

export type ControlRegion = 'header' | 'toolbar' | 'qr';
export type SlideshowDuration = 5 | 8 | 10;

const COMPACT_VIEWPORT_MEDIA_QUERY = '(max-width: 767.98px), (max-height: 499.98px)';
const getServerFalse = () => false;

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

export function useCompactSlideshowViewport(): boolean {
  return useSyncExternalStore(
    subscribeCompactViewport,
    getCompactViewportSnapshot,
    getServerFalse
  );
}

export function getSlideshowOverlayOffsets(options: {
  hasExpandedDemoToolbar: boolean;
  hasCollapsedDemoToolbar: boolean;
}) {
  const { hasExpandedDemoToolbar, hasCollapsedDemoToolbar } = options;

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

  return {
    controlsBottomClass,
    qrOverlayBottomClass,
    qrOverlayMaxHeightClass,
  };
}
