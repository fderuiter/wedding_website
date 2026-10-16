import React from 'react';
import { cn } from '@/utils/cn';

export const Container = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, style, ...props }, ref) => {
    return (
      <div
        ref={ref}
        style={{
          backgroundColor: 'var(--container-bg, var(--color-background, #fff1f2))',
          ...style,
        }}
        className={cn('min-h-screen flex items-center justify-center text-gray-900 p-[var(--card-padding)] max-w-[var(--container-max-w)] w-full mx-auto', className)}
        {...props}
      />
    );
  }
);
Container.displayName = 'Container';

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, style, ...props }, ref) => {
    return (
      <div
        ref={ref}
        style={{
          backgroundColor: 'var(--card-bg, #ffffff)',
          borderColor: 'var(--card-border, transparent)',
          boxShadow: 'var(--shadow-md, var(--card-shadow, 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)))',
          ...style,
        }}
        className={cn('w-full border p-[var(--card-padding)] rounded-[var(--radius-card)]', className)}
        {...props}
      />
    );
  }
);
Card.displayName = 'Card';

export const Heading = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, style, ...props }, ref) => {
    return (
      <h1
        ref={ref}
        style={{
          color: 'var(--heading-color, var(--color-primary, #b91c1c))',
          ...style,
        }}
        className={cn('text-2xl font-bold', className)}
        {...props}
      />
    );
  }
);
Heading.displayName = 'Heading';
