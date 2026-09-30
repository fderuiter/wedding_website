'use client';

import React, { useEffect, useRef, useCallback } from 'react';
import { cn } from '@/utils/cn';

export interface AccessibleStepProps extends React.HTMLAttributes<HTMLDivElement> {
  isActive: boolean;
  children: React.ReactNode;
  className?: string;
}

export const AccessibleStep = React.forwardRef<HTMLDivElement, AccessibleStepProps>(
  ({ isActive, children, className, ...props }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const isFirstRender = useRef(true);

    const setRef = useCallback(
      (node: HTMLDivElement | null) => {
        containerRef.current = node;
        if (typeof ref === 'function') {
          ref(node);
        } else if (ref) {
          (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
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
);

AccessibleStep.displayName = 'AccessibleStep';

