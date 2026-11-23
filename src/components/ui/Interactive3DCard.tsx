'use client';

import React, { useRef, useEffect, useCallback, ElementType, ComponentPropsWithRef } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { useUnified3DInput } from '../../hooks/useUnified3DInput';
import { useTheme } from '../ThemeProvider';
import { getPresetTokens } from '@/lib/theme/presets';
import { cn } from '@/utils/cn';

const motionComponentCache = new Map<ElementType, any>();

function getMotionComponent(Component: ElementType) {
  if (!motionComponentCache.has(Component)) {
    const MotionComponent = (motion as any).create ? (motion as any).create(Component) : (motion as any)(Component);
    motionComponentCache.set(Component, MotionComponent);
  }
  return motionComponentCache.get(Component);
}

type MotionComponentWrapperProps<T extends ElementType = ElementType> =
  ComponentPropsWithRef<T> & {
    asComponent: T;
  };

function MotionComponentWrapper<T extends ElementType = ElementType>({
  asComponent,
  children,
  ref,
  ...rest
}: MotionComponentWrapperProps<T>) {
  const holder = {
    C: getMotionComponent(asComponent),
  };
  return (
    <holder.C ref={ref} {...rest}>
      {children}
    </holder.C>
  );
}

type Interactive3DCardProps<T extends ElementType = 'div'> = {
  as?: T;
  children?: React.ReactNode;
  className?: string;
  onClick?: (e: React.MouseEvent<any>) => void;
  ref?: ComponentPropsWithRef<T>['ref'];
} & Omit<ComponentPropsWithRef<T>, 'as' | 'children' | 'className' | 'onClick' | 'ref'>;

export function Interactive3DCard<T extends ElementType = 'div'>({
  as,
  children,
  className,
  onClick,
  ref: forwardedRef,
  ...props
}: Interactive3DCardProps<T>) {
  const internalRef = useRef<HTMLElement>(null);

  const setRef = useCallback(
    (node: HTMLElement | null) => {
      internalRef.current = node;
      const targetRef = forwardedRef as React.Ref<HTMLElement> | undefined;
      if (typeof targetRef === 'function') {
        targetRef(node);
      } else if (targetRef) {
        (targetRef as React.MutableRefObject<HTMLElement | null>).current = node;
      }
    },
    [forwardedRef]
  );

  const {
    cardPerspective = 1000,
    cardMaxRotation = 10,
    cardSpringStiffness = 300,
    cardSpringDamping = 20,
    themePreset,
  } = useTheme();

  const presetTokens = getPresetTokens(themePreset);
  const stiffness = parseFloat(presetTokens['--motion-spring-stiffness']) || cardSpringStiffness;
  const damping = parseFloat(presetTokens['--motion-spring-damping']) || cardSpringDamping;
  const tiltMaxDeg = parseFloat(presetTokens['--motion-tilt-max-deg']) || cardMaxRotation;

  const x = useMotionValue(0);
  const y = useMotionValue(0);

  // Smooth the motion values using springs driven by theme tokens
  const mouseXSpring = useSpring(x, { stiffness, damping });
  const mouseYSpring = useSpring(y, { stiffness, damping });

  useEffect(() => {
    if ((mouseXSpring as any).setOptions) {
      (mouseXSpring as any).setOptions({ stiffness, damping });
    }
    if ((mouseYSpring as any).setOptions) {
      (mouseYSpring as any).setOptions({ stiffness, damping });
    }
  }, [stiffness, damping, mouseXSpring, mouseYSpring]);

  // Transform mouse position to rotation using theme tilt limit
  const rotateX = useTransform(mouseYSpring, [-0.5, 0.5], [`${tiltMaxDeg}deg`, `-${tiltMaxDeg}deg`]);
  const rotateY = useTransform(mouseXSpring, [-0.5, 0.5], [`-${tiltMaxDeg}deg`, `${tiltMaxDeg}deg`]);

  const Component = as || 'div';
  const isInteractive = Component === 'button' || Component === 'a';

  const {
    role: propRole,
    tabIndex: propTabIndex,
    'aria-describedby': propAriaDescribedBy,
    onKeyDown: propOnKeyDown,
    onFocus: propOnFocus,
    onBlur: propOnBlur,
    style: propStyle,
    ...restProps
  } = props as any;

  const { mixedHandlers, AccessibleElements, reduceMotion } = useUnified3DInput({
    domRef: internalRef as any,
    onDragMove: (norm) => {
      x.set(norm.x);
      y.set(norm.y);
    },
    onDragEnd: () => {
      x.set(0);
      y.set(0);
    },
  });

  const handleFocus = (e: React.FocusEvent<HTMLElement>) => {
    if (!reduceMotion && e.target === e.currentTarget) {
      x.set(0.15);
      y.set(-0.15);
    }

    if (propOnFocus) {
      propOnFocus(e);
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLElement>) => {
    x.set(0);
    y.set(0);

    if (propOnBlur) {
      propOnBlur(e);
    }
  };

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' && internalRef.current && isInteractive) {
      const interactiveChildren = internalRef.current.querySelectorAll('button, a, input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (interactiveChildren.length > 0) {
        console.warn(`Interactive3DCard warning: The card is rendered as an interactive element ('${Component}'), but contains nested interactive elements. This creates invalid HTML and breaks screen readers. Please review your usage.`);
      }
    }
  }, [Component, isInteractive]);

  const {
    'aria-describedby': mixedDescribedBy,
    onClick: mixedOnClick,
    onKeyDown: mixedOnKeyDown,
    ...restMixedHandlers
  } = mixedHandlers as any;

  const shouldApplyButtonSemantics = Boolean(onClick) && propTabIndex !== -1 && !isInteractive;
  const cardRole = propRole ?? (shouldApplyButtonSemantics ? 'button' : undefined);
  const cardTabIndex = propTabIndex ?? (shouldApplyButtonSemantics ? 0 : undefined);
  const combinedDescribedBy = [propAriaDescribedBy, mixedDescribedBy].filter(Boolean).join(' ') || undefined;

  const handleCardClick = onClick || mixedOnClick
    ? (e: React.MouseEvent<any>) => {
      mixedOnClick?.(e);
      onClick?.(e);
    }
    : undefined;

  const handleCardKeyDown = onClick || propOnKeyDown || mixedOnKeyDown
    ? (e: React.KeyboardEvent<any>) => {
      mixedOnKeyDown?.(e);
      if (onClick && Component !== 'a' && e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        onClick(e as any);
      }
      propOnKeyDown?.(e);
    }
    : undefined;

  return (
    <MotionComponentWrapper
      asComponent={Component}
      ref={setRef}
      {...restProps}
      role={cardRole}
      tabIndex={cardTabIndex}
      aria-describedby={combinedDescribedBy}
      className={cn(
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 transition-all',
        className
      )}
      {...restMixedHandlers}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      onFocus={handleFocus}
      onBlur={handleBlur}
      style={{
        ...(reduceMotion
          ? {}
          : {
            transformPerspective: cardPerspective,
            rotateX,
            rotateY,
            transformStyle: 'preserve-3d',
            willChange: 'transform',
          }),
        ...(propStyle || {}),
      }}
    >
      {AccessibleElements}
      {children}
    </MotionComponentWrapper>
  );
}
