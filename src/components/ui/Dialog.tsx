'use client';

import React, { useId } from 'react';
import { Overlay } from './Overlay';
import { cn } from '@/utils/cn';

export interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  role?: 'dialog' | 'alertdialog';
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  className?: string;
  style?: React.CSSProperties;
}

export const Dialog = React.forwardRef<HTMLDivElement, DialogProps>(
  (
    {
      isOpen,
      onClose,
      title,
      description,
      children,
      role = 'dialog',
      'aria-labelledby': ariaLabelledby,
      'aria-describedby': ariaDescribedby,
      className,
      style,
    },
    ref
  ) => {
    const defaultId = useId();

    const finalLabelId = ariaLabelledby || (title ? `dialog-title-${defaultId}` : undefined);
    const finalDescId = ariaDescribedby || (description ? `dialog-desc-${defaultId}` : undefined);

    return (
      <Overlay
        ref={ref}
        isOpen={isOpen}
        onClose={onClose}
        className={cn(
          'bg-white dark:bg-zinc-900 rounded-lg shadow-xl w-full max-w-md overflow-hidden text-gray-900 dark:text-zinc-50 border',
          className
        )}
        style={{
          backgroundColor: 'var(--dialog-bg, #ffffff)',
          borderRadius: 'var(--dialog-border-radius, 0.5rem)',
          boxShadow: 'var(--dialog-shadow, 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1))',
          borderColor: 'var(--dialog-border-color, #e5e7eb)',
          ...style,
        }}
      >
        <div
          role={role}
          aria-labelledby={finalLabelId}
          aria-describedby={finalDescId}
          className="w-full h-full"
        >
          {title && (
            <div
              className="px-6 py-4 border-b border-[var(--dialog-border-color,#e5e7eb)] dark:border-zinc-800"
              style={{ color: 'var(--dialog-title-color, inherit)' }}
            >
              {typeof title === 'string' ? (
                <h2 id={finalLabelId} className="text-lg font-medium">
                  {title}
                </h2>
              ) : (
                <div id={finalLabelId}>{title}</div>
              )}
            </div>
          )}
          {description && (
            <div
              className="px-6 pt-4 pb-2 text-sm text-gray-500 dark:text-zinc-400"
              id={finalDescId}
              style={{ color: 'var(--dialog-desc-color, #6b7280)' }}
            >
              {description}
            </div>
          )}
          <div className="px-6 py-4">{children}</div>
        </div>
      </Overlay>
    );
  }
);

Dialog.displayName = 'Dialog';
