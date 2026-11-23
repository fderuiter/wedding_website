import { useRef, useCallback, useEffect, useState } from 'react';
import { useReducedMotion } from './useReducedMotion';
import { use3DInteraction, Use3DInteractionOptions } from './use3DInteraction';

interface UseUnified3DInputOptions {
  // DOM element for bounding box (if DOM-based)
  domRef?: React.RefObject<HTMLElement>;
  // R3F support
  r3f?: {
    size: { width: number; height: number };
    viewport: { width: number; height: number };
  };
  
  // Pointer Callbacks
  onDragStart?: () => void;
  onDragMove?: (normalized: { x: number; y: number }, rawVelocity: { vx: number; vy: number }) => void;
  onDragEnd?: (rawVelocity: { vx: number; vy: number }) => void;
  
  // Lifecycle
  reconstructTimeout?: number; // ms until auto-reconstruct
  onDestroy?: () => void;
  onReconstruct?: () => void;
  
  // Accessibility
  accessibility?: Use3DInteractionOptions;
}

const EMPTY_ACCESSIBILITY_OPTIONS: Use3DInteractionOptions = {
  instructions: '',
  labels: {},
};

interface Unified3DPointerTarget {
  setPointerCapture?: (pointerId: number) => void;
  releasePointerCapture?: (pointerId: number) => void;
}

export interface Unified3DInputEvent {
  clientX?: number;
  clientY?: number;
  pointerId?: number;
  target?: unknown;
  touches?: ArrayLike<{ clientX: number; clientY: number }>;
  stopPropagation?: () => void;
}

export function useUnified3DInput(options: UseUnified3DInputOptions) {
  const reduceMotion = useReducedMotion();
  const [isDestroyed, setIsDestroyed] = useState(false);
  const hasAccessibility = Boolean(options.accessibility);

  // 3D interaction hook injection (called unconditionally to preserve Rules of Hooks)
  const a11y = use3DInteraction(options.accessibility || EMPTY_ACCESSIBILITY_OPTIONS);
  
  const dragState = useRef({
    active: false,
    lastTime: 0,
    lastX: 0,
    lastY: 0,
    vx: 0,
    vy: 0,
  });

  const cachedRectRef = useRef<{ width: number; height: number; left: number; top: number } | DOMRect | null>(null);

  const getNormalizedCoords = useCallback((clientX: number, clientY: number) => {
    let xNorm = 0;
    let yNorm = 0;
    
    let rect = cachedRectRef.current;
    if (!rect && options.domRef && options.domRef.current) {
      rect = options.domRef.current.getBoundingClientRect();
    }

    if (rect) {
      const { width, height, left, top } = rect;
      if (width > 0 && height > 0) {
        xNorm = Math.max(-0.5, Math.min(0.5, (clientX - left) / width - 0.5));
        yNorm = Math.max(-0.5, Math.min(0.5, (clientY - top) / height - 0.5));
      }
    } else if (options.r3f) {
      xNorm = (clientX / options.r3f.size.width) - 0.5;
      yNorm = (clientY / options.r3f.size.height) - 0.5;
    }
    
    return { x: xNorm, y: yNorm };
  }, [options]);

  const handlePointerDown = useCallback((e: Unified3DInputEvent) => {
    if (isDestroyed || reduceMotion) return;
    
    if (e.stopPropagation) e.stopPropagation();

    if (options.domRef && options.domRef.current) {
      cachedRectRef.current = options.domRef.current.getBoundingClientRect();
    }
    
    const target =
      typeof e?.target === 'object' && e.target !== null
        ? (e.target as Unified3DPointerTarget)
        : null;
    if (target?.setPointerCapture && e?.pointerId !== undefined) {
      try { target.setPointerCapture(e.pointerId); } catch {}
    }

    const touch = e.touches && e.touches.length > 0 ? e.touches[0] : undefined;
    const clientX = touch ? touch.clientX : (e.clientX ?? 0);
    const clientY = touch ? touch.clientY : (e.clientY ?? 0);

    dragState.current = {
      active: true,
      lastTime: performance.now(),
      lastX: clientX,
      lastY: clientY,
      vx: 0,
      vy: 0,
    };
    
    if (options.onDragStart) {
      options.onDragStart();
    }
  }, [options, reduceMotion, isDestroyed]);

  const handlePointerMove = useCallback((e: Unified3DInputEvent) => {
    if (!dragState.current.active || isDestroyed || reduceMotion) return;
    if (e.stopPropagation) e.stopPropagation();

    const touch = e.touches && e.touches.length > 0 ? e.touches[0] : undefined;
    const clientX = touch ? touch.clientX : (e.clientX ?? 0);
    const clientY = touch ? touch.clientY : (e.clientY ?? 0);

    const now = performance.now();
    const dt = now - dragState.current.lastTime;
    
    if (dt > 0) {
      dragState.current.vx = (clientX - dragState.current.lastX) / dt;
      dragState.current.vy = (clientY - dragState.current.lastY) / dt;
    }
    
    dragState.current.lastTime = now;
    dragState.current.lastX = clientX;
    dragState.current.lastY = clientY;

    if (options.onDragMove) {
      const norm = getNormalizedCoords(clientX, clientY);
      options.onDragMove(norm, { vx: dragState.current.vx, vy: dragState.current.vy });
    }
  }, [options, reduceMotion, isDestroyed, getNormalizedCoords]);

  const handlePointerUp = useCallback((e: Unified3DInputEvent) => {
    cachedRectRef.current = null;
    if (!dragState.current.active) return;
    if (e.stopPropagation) e.stopPropagation();
    
    const target =
      typeof e?.target === 'object' && e.target !== null
        ? (e.target as Unified3DPointerTarget)
        : null;
    if (target?.releasePointerCapture && e?.pointerId !== undefined) {
      try { target.releasePointerCapture(e.pointerId); } catch {}
    }

    dragState.current.active = false;
    let { vx, vy } = dragState.current;

    if (performance.now() - dragState.current.lastTime > 50) {
      vx = 0;
      vy = 0;
    }

    if (options.onDragEnd) {
      options.onDragEnd({ vx, vy });
    }
  }, [options]);

  const handlePointerLeave = useCallback((e: Unified3DInputEvent) => {
    cachedRectRef.current = null;
    if (dragState.current.active) {
      handlePointerUp(e);
    }
  }, [handlePointerUp]);

  const destroy = useCallback(() => {
    if (isDestroyed) return;
    setIsDestroyed(true);
    cachedRectRef.current = null;
    dragState.current.active = false;
    if (options.onDestroy) options.onDestroy();
  }, [isDestroyed, options]);

  const reconstruct = useCallback(() => {
    if (!isDestroyed) return;
    setIsDestroyed(false);
    if (options.onReconstruct) options.onReconstruct();
  }, [isDestroyed, options]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isDestroyed && options.reconstructTimeout) {
      timer = setTimeout(() => {
        reconstruct();
      }, options.reconstructTimeout);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [isDestroyed, options.reconstructTimeout, reconstruct]);

  const pointerHandlers = {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerUp,
    onPointerLeave: handlePointerLeave,
    onTouchStart: handlePointerDown,
    onTouchMove: handlePointerMove,
    onTouchEnd: handlePointerUp,
    onTouchCancel: handlePointerUp,
  };

  // Combine accessibility props with pointer events if both are needed on the same element
  // (like DOM elements in Framer Motion). But for R3F, they might be separated.
  const getInteractiveProps = (originalProps: React.HTMLAttributes<HTMLElement> = {}) =>
    hasAccessibility ? a11y.getInteractiveProps(originalProps) : { ...originalProps };

  const a11yProps = hasAccessibility ? a11y.getInteractiveProps() : {};
  const interactiveProps = {
    ...pointerHandlers,
    ...a11yProps,
  };

  return {
    handlers: pointerHandlers, // Just pointer events
    getInteractiveProps, // Just keyboard/focus + optional injected
    mixedHandlers: interactiveProps, // Both combined (useful for DOM elements)
    AccessibleElements: hasAccessibility ? a11y.AccessibleElements : null,
    reduceMotion,
    lifecycle: {
      isDestroyed,
      destroy,
      reconstruct
    }
  };
}
