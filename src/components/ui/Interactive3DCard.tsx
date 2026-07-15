'use client';

import React, { useRef, useEffect, ElementType, ComponentPropsWithoutRef } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { useUnified3DInput } from '../../hooks/useUnified3DInput';

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

  const Component = as || 'div';
  const isInteractive = Component === 'button' || Component === 'a';

  const step = 0.25;
  const { mixedHandlers, AccessibleElements, reduceMotion } = useUnified3DInput({
    domRef: ref as any,
    onDragMove: (norm) => {
      x.set(norm.x);
      y.set(norm.y);
    },
    onDragEnd: () => {
      x.set(0);
      y.set(0);
    },
    accessibility: {
      instructions: 'Use arrow keys to tilt the card.',
      labels: {
        up: 'Tilted up',
        down: 'Tilted down',
        left: 'Tilted left',
        right: 'Tilted right',
      },
      onUp: () => y.set(Math.max(-0.5, y.get() - step)),
      onDown: () => y.set(Math.min(0.5, y.get() + step)),
      onLeft: () => x.set(Math.max(-0.5, x.get() - step)),
      onRight: () => x.set(Math.min(0.5, x.get() + step)),
      onAction: (e: any) => {
        if (onClick) {
          e.preventDefault();
          onClick(e as any);
        }
      },
    }
  });

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
      {...mixedHandlers}
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
      {AccessibleElements}
      {children}
    </MotionComponent>
  );
}
