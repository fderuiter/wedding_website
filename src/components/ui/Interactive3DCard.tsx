'use client';

import React, { useRef, useEffect, ElementType, ComponentPropsWithoutRef } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { useReducedMotion } from '../../hooks/useReducedMotion';

export type Interactive3DCardProps<T extends ElementType> = {
  as?: T;
  children: React.ReactNode;
  className?: string;
  onClick?: (e: React.MouseEvent<any>) => void;
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'children' | 'className' | 'onClick'>;

export function Interactive3DCard<T extends ElementType = 'div'>({
  as,
  children,
  className = '',
  onClick,
  ...props
}: Interactive3DCardProps<T>) {
  const ref = useRef<HTMLElement>(null);

  const x = useMotionValue(0);
  const y = useMotionValue(0);

  // Smooth the motion values using springs
  const mouseXSpring = useSpring(x, { stiffness: 300, damping: 20 });
  const mouseYSpring = useSpring(y, { stiffness: 300, damping: 20 });

  // Transform mouse position to rotation
  const rotateX = useTransform(mouseYSpring, [-0.5, 0.5], ['10deg', '-10deg']);
  const rotateY = useTransform(mouseXSpring, [-0.5, 0.5], ['-10deg', '10deg']);

  const handleMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const { width, height, left, top } = rect;
    if (width === 0 || height === 0) return;
    const mouseX = e.clientX - left;
    const mouseY = e.clientY - top;
    const xPct = Math.max(-0.5, Math.min(0.5, mouseX / width - 0.5));
    const yPct = Math.max(-0.5, Math.min(0.5, mouseY / height - 0.5));

    x.set(xPct);
    y.set(yPct);
  };

  const handleMouseLeave = () => {
    x.set(0);
    y.set(0);
  };
  
  const handleTouchMove = (e: React.TouchEvent<HTMLElement>) => {
    if (!ref.current || !e.touches[0]) return;
    const rect = ref.current.getBoundingClientRect();
    const { width, height, left, top } = rect;
    if (width === 0 || height === 0) return;
    const touch = e.touches[0];
    const mouseX = touch.clientX - left;
    const mouseY = touch.clientY - top;
    const xPct = Math.max(-0.5, Math.min(0.5, mouseX / width - 0.5));
    const yPct = Math.max(-0.5, Math.min(0.5, mouseY / height - 0.5));

    x.set(xPct);
    y.set(yPct);
  };

  const handleTouchEnd = () => {
    x.set(0);
    y.set(0);
  };

  const Component = as || 'div';
  const isInteractive = Component === 'button' || Component === 'a';

  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    const step = 0.25;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      x.set(Math.max(-0.5, x.get() - step));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      x.set(Math.min(0.5, x.get() + step));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      y.set(Math.max(-0.5, y.get() - step));
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      y.set(Math.min(0.5, y.get() + step));
    } else if (e.key === 'Enter' || e.key === ' ') {
      // Provide an accessible trigger for standard clickable cards if not caught inside
      // If it's a semantic element like button, the browser handles the click event natively
      if (onClick && !isInteractive) {
        e.preventDefault();
        onClick(e as any);
      }
    }
    
    if (props.onKeyDown) {
        (props.onKeyDown as any)(e);
    }
  };

  const handleFocus = (e: React.FocusEvent<HTMLElement>) => {
    // Reset or give a slight tilt when focused to show activity
    x.set(0.15);
    y.set(-0.15);
    
    if (props.onFocus) {
        (props.onFocus as any)(e);
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLElement>) => {
    x.set(0);
    y.set(0);
    
    if (props.onBlur) {
        (props.onBlur as any)(e);
    }
  };
  
  const reduceMotion = useReducedMotion();
  
  const onMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    if (!reduceMotion) handleMouseMove(e);
    if (props.onMouseMove) (props.onMouseMove as any)(e);
  };
  
  const onMouseLeave = (e: React.MouseEvent<HTMLElement>) => {
    if (!reduceMotion) handleMouseLeave();
    if (props.onMouseLeave) (props.onMouseLeave as any)(e);
  };
  
  const onTouchMove = (e: React.TouchEvent<HTMLElement>) => {
    if (!reduceMotion) handleTouchMove(e);
    if (props.onTouchMove) (props.onTouchMove as any)(e);
  };
  
  const onTouchEnd = (e: React.TouchEvent<HTMLElement>) => {
    if (!reduceMotion) handleTouchEnd();
    if (props.onTouchEnd) (props.onTouchEnd as any)(e);
  };

useEffect(() => {
    if (process.env.NODE_ENV !== 'production' && ref.current && isInteractive) {
      const interactiveChildren = ref.current.querySelectorAll('button, a, input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (interactiveChildren.length > 0) {
        console.warn(`Interactive3DCard warning: The card is rendered as an interactive element ('${Component}'), but contains nested interactive elements. This creates invalid HTML and breaks screen readers. Please review your usage.`);
      }
    }
  }, [Component, isInteractive]);

  const MotionComponent = (motion as any).create ? (motion as any).create(Component) : (motion as any)(Component);

  return (
    <MotionComponent
      ref={ref}
      {...(props as any)}
      className={className}
      onClick={onClick}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      onBlur={handleBlur}
      style={{
        transformPerspective: 1000,
        rotateX: reduceMotion ? '0deg' : rotateX,
        rotateY: reduceMotion ? '0deg' : rotateY,
        transformStyle: 'preserve-3d',
        willChange: 'transform',
        ...((props as any).style || {})
      }}
    >
      {children}
    </MotionComponent>
  );
}
