import React from 'react';
import { cn } from '@/utils/cn';
import { Icon } from './Icon';

export interface UploadAlertProps extends React.HTMLAttributes<HTMLParagraphElement> {
  showIcon?: boolean;
}

export const UploadAlert = React.forwardRef<HTMLParagraphElement, UploadAlertProps>(
  ({ className, showIcon = false, children, ...props }, ref) => (
    <p
      ref={ref}
      role="alert"
      className={cn(
        'text-xs font-medium text-[var(--color-error-text,#dc2626)] flex items-center gap-1.5',
        className
      )}
      {...props}
    >
      {showIcon && (
        <Icon name="AlertTriangle" className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      )}
      <span>{children}</span>
    </p>
  )
);
UploadAlert.displayName = 'UploadAlert';

export interface UploadStatusNoticeProps extends React.HTMLAttributes<HTMLDivElement> {
  showIcon?: boolean;
}

export const UploadStatusNotice = React.forwardRef<HTMLDivElement, UploadStatusNoticeProps>(
  ({ className, showIcon = true, children, ...props }, ref) => (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      className={cn(
        'text-xs font-medium bg-[var(--color-warning-bg,rgba(245,158,11,0.1))] text-[var(--color-warning-text,#78350f)] p-2 rounded-lg border border-[var(--color-warning-border,rgba(245,158,11,0.3))] flex items-center gap-1.5',
        className
      )}
      {...props}
    >
      {showIcon && <Icon name="Info" className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
      <span>{children}</span>
    </div>
  )
);
UploadStatusNotice.displayName = 'UploadStatusNotice';

export interface UploadProgressBarProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number;
  filename: string;
}

export const UploadProgressBar = React.forwardRef<HTMLDivElement, UploadProgressBarProps>(
  ({ value, filename, className, 'aria-label': ariaLabel, ...props }, ref) => {
    const clampedValue = Math.max(0, Math.min(100, Math.round(value)));

    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clampedValue}
        aria-label={ariaLabel ?? `Uploading ${filename}`}
        className={cn(
          'w-full bg-stone-200 dark:bg-stone-800 rounded-full h-2 overflow-hidden forced-colors:border forced-colors:border-[ButtonText]',
          className
        )}
        {...props}
      >
        <div
          className="bg-[var(--color-primary,#B91C1C)] h-full rounded-full transition-all duration-300 forced-colors:bg-[Highlight]"
          style={{ width: `${clampedValue}%` }}
        />
      </div>
    );
  }
);
UploadProgressBar.displayName = 'UploadProgressBar';
