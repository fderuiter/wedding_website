import React from 'react';
import { cn } from '@/utils/cn';

export const Container = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn('min-h-screen flex items-center justify-center bg-rose-50 text-gray-900 p-[var(--card-padding)] max-w-[var(--container-max-w)] w-full mx-auto', className)}
        {...props}
      />
    );
  }
);
Container.displayName = 'Container';

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn('w-full bg-white p-[var(--card-padding)] rounded-[var(--radius-card)] shadow-lg', className)}
        {...props}
      />
    );
  }
);
Card.displayName = 'Card';

export const Heading = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => {
    return (
      <h1
        ref={ref}
        className={cn('text-2xl font-bold text-rose-700', className)}
        {...props}
      />
    );
  }
);
Heading.displayName = 'Heading';
