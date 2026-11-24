import React from 'react';
import { cn } from '@/utils/cn';

export type StatusBadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
export type StatusBadgeVariant = 'subtle' | 'solid';
export type StatusBadgeSize = 'xs' | 'sm' | 'md';

export interface StatusBadgeProps extends React.ComponentPropsWithRef<'span'> {
  tone?: StatusBadgeTone;
  variant?: StatusBadgeVariant;
  size?: StatusBadgeSize;
}

const STATUS_BADGE_BASE_STYLES =
  'inline-flex items-center font-semibold border forced-colors:border forced-colors:border-[CanvasText]';

const STATUS_BADGE_SIZES: Record<StatusBadgeSize, string> = {
  xs: 'px-2 py-0.5 text-[10px] leading-tight rounded',
  sm: 'px-2.5 py-0.5 text-xs rounded-full',
  md: 'px-3 py-1 text-sm rounded-full',
};

const STATUS_BADGE_VARIANTS: Record<StatusBadgeVariant, Record<StatusBadgeTone, string>> = {
  subtle: {
    success:
      'bg-emerald-50 text-status-success-text border-emerald-700/30 dark:bg-emerald-950/60 dark:border-emerald-400/30',
    warning:
      'bg-amber-50 text-status-warning-text border-amber-700/30 dark:bg-amber-950/60 dark:border-amber-400/30',
    danger:
      'bg-red-50 text-red-800 border-red-700/30 dark:bg-red-950/60 dark:text-red-200 dark:border-red-400/30',
    info:
      'bg-blue-50 text-status-info-text border-blue-700/30 dark:bg-blue-950/60 dark:border-blue-400/30',
    neutral:
      'bg-[var(--schedule-tag-bg,#f3f4f6)] text-[var(--schedule-tag-text,#374151)] border-[var(--color-surface-border,#6b7280)]',
  },
  solid: {
    success:
      'bg-[var(--btn-success-bg,#15803d)] text-[var(--btn-success-text,#ffffff)] border-[var(--btn-success-border,transparent)]',
    warning:
      'bg-amber-800 text-white border-transparent dark:bg-amber-300 dark:text-stone-950',
    danger:
      'bg-[var(--btn-danger-bg,#b91c1c)] text-[var(--btn-danger-text,#ffffff)] border-transparent',
    info:
      'bg-[var(--toast-info-bg,#1d4ed8)] text-[var(--toast-info-text,#ffffff)] border-transparent',
    neutral:
      'bg-stone-800 text-white border-transparent dark:bg-stone-200 dark:text-stone-900',
  },
};

export function getStatusBadgeClassName({
  tone = 'neutral',
  variant = 'subtle',
  size = 'sm',
  className,
}: {
  tone?: StatusBadgeTone;
  variant?: StatusBadgeVariant;
  size?: StatusBadgeSize;
  className?: string;
} = {}): string {
  return cn(
    STATUS_BADGE_BASE_STYLES,
    STATUS_BADGE_VARIANTS[variant][tone],
    STATUS_BADGE_SIZES[size],
    className
  );
}

export function StatusBadge({
  tone = 'neutral',
  variant = 'subtle',
  size = 'sm',
  className,
  children,
  ref,
  ...props
}: StatusBadgeProps) {
  return (
    <span
      ref={ref}
      className={getStatusBadgeClassName({ tone, variant, size, className })}
      {...props}
    >
      {children}
    </span>
  );
}
