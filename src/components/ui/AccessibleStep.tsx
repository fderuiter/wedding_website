'use client';

import React, { useEffect, useRef, useCallback } from 'react';
import { cn } from '@/utils/cn';

export interface AccessibleStepProps extends React.ComponentPropsWithRef<'div'> {
  isActive: boolean;
  children: React.ReactNode;
  className?: string;
}

export function AccessibleStep({
  isActive,
  children,
  className,
  ref,
  ...props
}: AccessibleStepProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isFirstRender = useRef(true);

  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      containerRef.current = node;
      if (typeof ref === 'function') {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
    },
    [ref]
  );

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (isActive && containerRef.current) {
      containerRef.current.focus();
    }
  }, [isActive]);

  if (!isActive) return null;

  return (
    <div
      ref={setRef}
      tabIndex={-1}
      aria-hidden={!isActive}
      className={cn('outline-none', className)}
      {...props}
    >
      {children}
    </div>
  );
}

