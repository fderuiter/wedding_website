import { useRef, useCallback, useEffect, useState } from 'react';
import { useReducedMotion } from './useReducedMotion';
import { use3DInteraction, Use3DInteractionOptions } from './use3DInteraction';

// For physics body toggling
import { RigidBodyType } from '@dimforge/rapier3d-compat';

export interface UseUnified3DInputOptions {
  // DOM element for bounding box (if DOM-based)
  domRef?: React.RefObject<HTMLElement>;
  // R3F support
  r3f?: {
    size: { width: number; height: number };
    viewport: { width: number; height: number };
  };
  
  // Physics body for automatic state toggling
  physicsBodyRef?: React.RefObject<any>; // RapierRigidBody
  
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

export function useUnified3DInput(options: UseUnified3DInputOptions) {
  const reduceMotion = useReducedMotion();
  const [isDestroyed, setIsDestroyed] = useState(false);
  
  // 3D interaction hook injection
  const a11y = use3DInteraction(options.accessibility || {
    instructions: '',
    labels: {},
  });
  
  const dragState = useRef({
    active: false,
    lastTime: 0,
    lastX: 0,
    lastY: 0,
    vx: 0,
    vy: 0,
  });

  const getNormalizedCoords = (clientX: number, clientY: number) => {
    let xNorm = 0;
    let yNorm = 0;
    
    if (options.domRef && options.domRef.current) {
      const rect = options.domRef.current.getBoundingClientRect();
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
  };

  const handlePointerDown = useCallback((e: any) => {
    if (isDestroyed || reduceMotion) return;
    
    if (e.stopPropagation) e.stopPropagation();
    
    const target = e.target as any;
    if (target.setPointerCapture && e.pointerId !== undefined) {
      try { target.setPointerCapture(e.pointerId); } catch(err) {}
    }

    if (options.physicsBodyRef?.current) {
      options.physicsBodyRef.current.setBodyType(RigidBodyType.KinematicPositionBased, true);
    }
    
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

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

  const handlePointerMove = useCallback((e: any) => {
    if (!dragState.current.active || isDestroyed || reduceMotion) return;
    if (e.stopPropagation) e.stopPropagation();

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

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
  }, [options, reduceMotion, isDestroyed]);

  const handlePointerUp = useCallback((e: any) => {
    if (!dragState.current.active) return;
    if (e.stopPropagation) e.stopPropagation();
    
    const target = e.target as any;
    if (target.releasePointerCapture && e.pointerId !== undefined) {
      try { target.releasePointerCapture(e.pointerId); } catch (err) {}
    }

    dragState.current.active = false;
    let { vx, vy } = dragState.current;

    if (performance.now() - dragState.current.lastTime > 50) {
      vx = 0;
      vy = 0;
    }

    if (options.physicsBodyRef?.current) {
      options.physicsBodyRef.current.setBodyType(RigidBodyType.Dynamic, true);
    }
    
    if (options.onDragEnd) {
      options.onDragEnd({ vx, vy });
    }
  }, [options]);

  const handlePointerLeave = useCallback((e: any) => {
    if (dragState.current.active) {
      handlePointerUp(e);
    }
  }, [handlePointerUp]);

  const destroy = useCallback(() => {
    if (isDestroyed) return;
    setIsDestroyed(true);
    dragState.current.active = false;
    if (options.physicsBodyRef?.current) {
      options.physicsBodyRef.current.setBodyType(RigidBodyType.Dynamic, true);
    }
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
  const interactiveProps = a11y.getInteractiveProps(pointerHandlers as any);

  return {
    handlers: pointerHandlers, // Just pointer events
    getInteractiveProps: a11y.getInteractiveProps, // Just keyboard/focus + optional injected
    mixedHandlers: interactiveProps, // Both combined (useful for DOM elements)
    AccessibleElements: a11y.AccessibleElements,
    reduceMotion,
    lifecycle: {
      isDestroyed,
      destroy,
      reconstruct
    }
  };
}
