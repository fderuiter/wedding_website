'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';

import { useTheme } from '@/components/ThemeProvider';
import { useOptionalDemo } from '@/components/demo/DemoContext';
import { Button, BUTTON_DEFAULT_STYLE, getButtonClassName } from '@/components/ui/Button';
import type { PerformanceTier } from './components/HeartScene';

const HeartScene = dynamic(() => import('./components/HeartScene'), {
  ssr: false,
  loading: () => null,
});

type TestableWindow = Window & {
  __mockWebGLSupport?: boolean;
};

let cachedWebGL2Support: boolean | null = null;

const subscribeToWebGLSupport = () => () => {};
const getServerWebGLSnapshot = (): boolean | null => null;

export function isWebGLAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  if (process.env.NODE_ENV === 'test') {
    const testWindow = window as TestableWindow;
    if (testWindow.__mockWebGLSupport !== undefined) {
      return Boolean(testWindow.__mockWebGLSupport);
    }
    if (!('WebGL2RenderingContext' in window)) {
      return true;
    }
  } else if (cachedWebGL2Support !== null) {
    return cachedWebGL2Support;
  }

  try {
    const canvas = document.createElement('canvas');
    const gl = window.WebGL2RenderingContext ? canvas.getContext('webgl2') : null;
    const supported = Boolean(gl);
    if (gl && typeof gl.getExtension === 'function') {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    if (process.env.NODE_ENV !== 'test') {
      cachedWebGL2Support = supported;
    }
    return supported;
  } catch {
    if (process.env.NODE_ENV !== 'test') {
      cachedWebGL2Support = false;
    }
    return false;
  }
}

function WebGLFallback({
  partner1Name,
  partner2Name,
  brideName,
  groomName,
  primaryColor,
  secondaryColor,
  accentColor,
  isPaused = false,
}: {
  partner1Name?: string;
  partner2Name?: string;
  brideName?: string;
  groomName?: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  isPaused?: boolean;
}) {
  const { glowFilter } = useTheme();
  const p1 = partner1Name || brideName || '';
  const p2 = partner2Name || groomName || '';
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const positionStart = useRef({ x: 0, y: 0 });
  const [announcement, setAnnouncement] = useState('');

  const getEventCoordinates = (e: React.PointerEvent) => {
    if (typeof e.clientX === 'number' && !isNaN(e.clientX)) {
      return { x: e.clientX, y: e.clientY };
    }
    const native = e.nativeEvent;
    if (native) {
      if (typeof native.clientX === 'number' && !isNaN(native.clientX)) {
        return { x: native.clientX, y: native.clientY };
      }
    }
    return { x: 0, y: 0 };
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    setIsDragging(true);
    const coords = getEventCoordinates(e);
    dragStart.current = { x: coords.x, y: coords.y };
    positionStart.current = { ...position };
    if (typeof e.currentTarget.setPointerCapture === 'function') {
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const coords = getEventCoordinates(e);
    const dx = coords.x - dragStart.current.x;
    const dy = coords.y - dragStart.current.y;
    setPosition({
      x: positionStart.current.x + dx,
      y: positionStart.current.y + dy,
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    if (typeof e.currentTarget.releasePointerCapture === 'function') {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const step = 20;
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setPosition((prev) => ({ ...prev, y: prev.y - step }));
      setAnnouncement('Moved up');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setPosition((prev) => ({ ...prev, y: prev.y + step }));
      setAnnouncement('Moved down');
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setPosition((prev) => ({ ...prev, x: prev.x - step }));
      setAnnouncement('Moved left');
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setPosition((prev) => ({ ...prev, x: prev.x + step }));
      setAnnouncement('Moved right');
    }
  };

  return (
    <div className="flex items-center justify-center h-full w-full relative overflow-hidden bg-black text-white">
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
      <div
        data-testid="webgl-fallback-heart"
        tabIndex={0}
        role="button"
        aria-label={`Interactive 2D Heart: ${p1} and ${p2}. Use arrow keys to move, or drag with mouse/touch.`}
        className="absolute cursor-grab active:cursor-grabbing focus:outline-none focus:ring-4 focus:ring-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white rounded-full p-4 transition-transform duration-75 select-none"
        style={{
          transform: `translate(${position.x}px, ${position.y}px)`,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={handleKeyDown}
      >
        <svg
          width="200"
          height="200"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          role="img"
          className={isPaused ? 'animate-none' : 'animate-pulse motion-reduce:animate-none'}
          style={{ filter: glowFilter || `drop-shadow(0 0 10px ${accentColor})` }}
        >
          <path
            d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
            fill={primaryColor || '#ffa0e0'}
            stroke={secondaryColor || '#ffffff'}
            strokeWidth="1"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none font-bold select-none text-white text-sm">
          <span>{p1}</span>
          <span className="text-xs font-normal opacity-80">&amp;</span>
          <span>{p2}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * @page HeartPage
 * @description An interactive, physics-based 3D heart page using `@react-three/fiber` and `@react-three/rapier`.
 *
 * This page features a large, draggable 3D heart in the center of the screen. Users can
 * fling the heart around, and it will bounce off the edges of the screen. Colliding too
 * hard will cause the heart to "break" into two pieces, which then reform. The scene
 * includes a starry background, post-processing effects, and a reset button.
 *
 * @returns {JSX.Element} The rendered HeartPage component.
 */
export default function HeartClient({
  partner1Name,
  partner2Name,
  brideName,
  groomName,
}: {
  partner1Name?: string;
  partner2Name?: string;
  brideName?: string;
  groomName?: string;
}) {
  const p1 = partner1Name || brideName || '';
  const p2 = partner2Name || groomName || '';
  const { themePrimary, themeSecondary, themeAccent, lighting } = useTheme();
  const demo = useOptionalDemo();
  const hasExpandedDemoToolbar = Boolean(demo?.isDemoMode && !demo.isToolbarCollapsed);
  const hasCollapsedDemoToolbar = Boolean(demo?.isDemoMode && demo.isToolbarCollapsed);
  const hintBottomClass = hasExpandedDemoToolbar
    ? 'bottom-20'
    : hasCollapsedDemoToolbar
      ? 'bottom-16'
      : 'bottom-6';
  const [interacted, setInteracted] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [scale, setScale] = useState(0.6);
  const [resetKey, setResetKey] = useState(0);
  const [sceneReady, setSceneReady] = useState(false);
  const webglSupported = useSyncExternalStore(
    subscribeToWebGLSupport,
    isWebGLAvailable,
    getServerWebGLSnapshot,
  );
  const [performanceTier, setPerformanceTier] = useState<PerformanceTier>('high');
  const markSceneReady = useCallback(() => {
    setSceneReady(true);
  }, []);
  const handleInteract = useCallback(() => {
    setInteracted(true);
  }, []);
  const handleTogglePause = useCallback(() => {
    setIsPaused((prev) => !prev);
  }, []);

  const handleReset = () => {
    setInteracted(false);
    setPerformanceTier('high');
    setResetKey((prevKey) => prevKey + 1);
  };

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setScale(mobile ? 0.4 : 0.6);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const pageHeading =
    p1 && p2 ? `Interactive 3D Heart — ${p1} & ${p2}` : 'Interactive 3D Heart';

  if (webglSupported === false) {
    return (
      <div className="fixed inset-0 bg-black select-none" data-testid="webgl-fallback-container">
        <h1 className="sr-only">{pageHeading}</h1>
        <div className="absolute top-0 right-0 z-[60] m-4 flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="inverse"
            size="sm"
            pressed={isPaused}
            onClick={handleTogglePause}
          >
            {isPaused ? 'Resume Animation' : 'Pause Animation'}
          </Button>
          <Button
            type="button"
            variant="inverse"
            size="sm"
            onClick={handleReset}
            aria-label="Reset heart"
          >
            Reset
          </Button>
          <Link
            href="/"
            className={getButtonClassName({ variant: 'inverse', size: 'sm' })}
            style={BUTTON_DEFAULT_STYLE}
          >
            Back Home
          </Link>
        </div>
        <WebGLFallback
          key={resetKey}
          partner1Name={p1}
          partner2Name={p2}
          primaryColor={themePrimary}
          secondaryColor={themeSecondary}
          accentColor={themeAccent}
          isPaused={isPaused}
        />
        <div
          data-testid="heart-keyboard-hint"
          className={`pointer-events-none absolute ${hintBottomClass} left-1/2 z-20 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-full border border-white/15 bg-stone-900/90 px-4 py-1.5 text-center text-xs tracking-wide text-stone-100 shadow-lg backdrop-blur-md`}
        >
          Use arrow keys to move the heart
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black select-none">
      <h1 className="sr-only">{pageHeading}</h1>
      <div className="absolute top-0 right-0 z-[60] m-4 flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="inverse"
          size="sm"
          pressed={isPaused}
          onClick={handleTogglePause}
        >
          {isPaused ? 'Resume Animation' : 'Pause Animation'}
        </Button>
        <Button
          type="button"
          variant="inverse"
          size="sm"
          onClick={handleReset}
          aria-label="Reset heart"
        >
          Reset
        </Button>
        <Link
          href="/"
          className={getButtonClassName({ variant: 'inverse', size: 'sm' })}
          style={BUTTON_DEFAULT_STYLE}
        >
          Back Home
        </Link>
      </div>
      {!sceneReady && (
        <div
          data-testid="heart-loading-overlay"
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-sm text-white"
        >
          Loading…
        </div>
      )}
      {webglSupported && (
        <HeartScene
          scale={scale}
          interacted={interacted}
          onInteract={handleInteract}
          isPaused={isPaused}
          performanceTier={performanceTier}
          onTierChange={setPerformanceTier}
          resetKey={resetKey}
          onReady={markSceneReady}
          primaryColor={themePrimary}
          secondaryColor={themeSecondary}
          accentColor={themeAccent}
          lighting={lighting}
          partner1Name={p1}
          partner2Name={p2}
        />
      )}
      <div
        data-testid="heart-keyboard-hint"
        className={`pointer-events-none absolute ${hintBottomClass} left-1/2 z-20 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-full border border-white/15 bg-stone-900/90 px-4 py-1.5 text-center text-xs tracking-wide text-stone-100 shadow-lg backdrop-blur-md`}
      >
        Use arrow keys to move the heart, Space or Enter to break it
      </div>
    </div>
  );
}
