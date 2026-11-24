import React from 'react';
import { cn } from '@/utils/cn';

export function Container({
  className,
  style,
  ref,
  ...props
}: React.ComponentPropsWithRef<'div'>) {
  return (
    <div
      ref={ref}
      style={{
        backgroundColor: 'var(--container-bg, var(--color-background, #fff1f2))',
        ...style,
      }}
      className={cn('min-h-screen flex items-center justify-center text-gray-900 dark:text-gray-100 p-[var(--card-padding)] max-w-[var(--container-max-w)] w-full mx-auto', className)}
      {...props}
    />
  );
}

export function Card({
  className,
  style,
  ref,
  ...props
}: React.ComponentPropsWithRef<'div'>) {
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

export type HeadingLevel = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
export type HeadingVariant = 'display' | 'h1' | 'h2' | 'h3' | 'none';

const HEADING_VARIANT_CLASSES: Record<HeadingVariant, string> = {
  display: 'type-display',
  h1: 'type-h1',
  h2: 'type-h2',
  h3: 'type-h3',
  none: '',
};

export interface HeadingProps extends React.ComponentPropsWithRef<'h1'> {
  as?: HeadingLevel;
  variant?: HeadingVariant;
  unstyledColor?: boolean;
}

export function Heading({
  as: Component = 'h1',
  variant,
  unstyledColor = false,
  className,
  style,
  ref,
  ...props
}: HeadingProps) {
  const typographyClass =
    variant !== undefined ? HEADING_VARIANT_CLASSES[variant] : 'text-2xl font-bold';
  const resolvedStyle = unstyledColor
    ? style
    : {
      color: 'var(--heading-color, var(--color-primary, #b91c1c))',
      ...style,
    };

  return (
    <Component
      ref={ref}
      style={resolvedStyle}
      className={cn(typographyClass, className)}
      {...props}
    />
  );
}

export interface MainLandmarkProps extends React.ComponentPropsWithRef<'main'> {
  suppressLandmark?: boolean;
}

export function MainLandmark({
  id = 'main-content',
  tabIndex = -1,
  suppressLandmark = false,
  className,
  ref,
  ...props
}: MainLandmarkProps) {
  if (suppressLandmark) {
    return (
      <div
        ref={ref as React.Ref<HTMLDivElement>}
        id={id}
        tabIndex={tabIndex}
        className={cn('focus:outline-none', className)}
        {...(props as React.ComponentPropsWithoutRef<'div'>)}
      />
    );
  }

  return (
    <main
      ref={ref}
      id={id}
      tabIndex={tabIndex}
      className={cn('focus:outline-none', className)}
      {...props}
    />
  );
}

export interface SiteFooterProps extends React.ComponentPropsWithRef<'footer'> {
  suppressLandmark?: boolean;
}

export function SiteFooter({
  suppressLandmark = false,
  className,
  ref,
  ...props
}: SiteFooterProps) {
  const mergedClassName = cn(
    'relative z-10 bg-[var(--color-background)] flex flex-col items-center gap-4 px-4 pb-10 text-sm text-gray-600 dark:text-gray-400',
    className
  );

  if (suppressLandmark) {
    return (
      <div
        ref={ref as React.Ref<HTMLDivElement>}
        className={mergedClassName}
        {...(props as React.ComponentPropsWithoutRef<'div'>)}
      />
    );
  }

  return (
    <footer
      ref={ref}
      className={mergedClassName}
      {...props}
    />
  );
}
