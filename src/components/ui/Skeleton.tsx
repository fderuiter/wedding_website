'use client';

import React from 'react';
import { cn } from '@/utils/cn';
import { useReducedMotion } from '@/hooks/useReducedMotion';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  'aria-label'?: string;
  'aria-busy'?: boolean;
  'aria-live'?: 'polite' | 'assertive' | 'off';
  isInteractive?: boolean;
}

export const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  (
    {
      className,
      role = 'status',
      'aria-busy': ariaBusy = true,
      'aria-live': ariaLive = 'polite',
      'aria-label': ariaLabel = 'Loading...',
      isInteractive = false,
      tabIndex,
      onKeyDown,
      ...props
    },
    ref
  ) => {
    const reduceMotion = useReducedMotion();

    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (onKeyDown) {
        onKeyDown(event);
      }
      if (isInteractive && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        if (props.onClick) {
          (props.onClick as unknown as React.MouseEventHandler<HTMLDivElement>)(
            event as unknown as React.MouseEvent<HTMLDivElement>
          );
        }
      }
    };

    return (
      <div
        ref={ref}
        role={role}
        aria-busy={ariaBusy}
        aria-live={ariaLive}
        aria-label={ariaLabel}
        tabIndex={tabIndex ?? (isInteractive ? 0 : undefined)}
        onKeyDown={handleKeyDown}
        className={cn(
          'rounded-md bg-gray-200 dark:bg-gray-800',
          !reduceMotion && 'animate-pulse',
          'motion-reduce:animate-none',
          'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
          className
        )}
        {...props}
      />
    );
  }
);
Skeleton.displayName = 'Skeleton';

