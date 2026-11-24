'use client';

import React, { createContext, useCallback, useContext, useId, useRef } from 'react';
import { Overlay } from './Overlay';
import { Heading, type HeadingLevel } from './Layout';
import { EnsureToastProvider, ToastContext, type ToastContextValue } from './ToastProvider';
import { cn } from '@/utils/cn';

const DEFAULT_CONFIRM_DISCARD_MESSAGE =
  'You have unsaved changes. Are you sure you want to discard them?';

const FallbackToastContext = createContext<ToastContextValue | null>(null);

export function useDirtyConfirmClose(
  isDirty: boolean,
  onClose: () => void,
  confirmDiscardMessage = DEFAULT_CONFIRM_DISCARD_MESSAGE
) {
  const optionalToast = useContext(ToastContext ?? FallbackToastContext);
  const isConfirmingRef = useRef(false);

  return useCallback(() => {
    if (!isDirty) {
      onClose();
      return;
    }
    if (isConfirmingRef.current) {
      return;
    }
    if (optionalToast?.confirm) {
      isConfirmingRef.current = true;
      void optionalToast
        .confirm(confirmDiscardMessage)
        .then((confirmed) => {
          if (confirmed) {
            onClose();
          }
        })
        .finally(() => {
          isConfirmingRef.current = false;
        });
      return;
    }
    onClose();
  }, [isDirty, onClose, confirmDiscardMessage, optionalToast]);
}

export interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  headingLevel?: HeadingLevel;
  description?: React.ReactNode;
  children: React.ReactNode;
  role?: 'dialog' | 'alertdialog';
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  className?: string;
  contentClassName?: string;
  scrollRegion?: boolean;
  style?: React.CSSProperties;
  isDirty?: boolean;
  confirmDiscardMessage?: string;
  ref?: React.Ref<HTMLDivElement>;
}

function DialogInner({
  isOpen,
  onClose,
  title,
  headingLevel = 'h2',
  description,
  children,
  role = 'dialog',
  'aria-labelledby': ariaLabelledby,
  'aria-describedby': ariaDescribedby,
  className,
  contentClassName,
  scrollRegion = true,
  style,
  isDirty = false,
  confirmDiscardMessage = DEFAULT_CONFIRM_DISCARD_MESSAGE,
  ref,
}: DialogProps) {
  const defaultId = useId();
  const handleRequestClose = useDirtyConfirmClose(isDirty, onClose, confirmDiscardMessage);

  const finalLabelId = ariaLabelledby || (title ? `dialog-title-${defaultId}` : undefined);
  const finalDescId = ariaDescribedby || (description ? `dialog-desc-${defaultId}` : undefined);

  return (
    <Overlay
      ref={ref}
      isOpen={isOpen}
      onClose={handleRequestClose}
      className={cn(
        'bg-white dark:bg-zinc-900 rounded-lg shadow-[var(--shadow-overlay)] w-full max-w-md overflow-hidden text-gray-900 dark:text-zinc-50 border',
        className
      )}
      style={{
        backgroundColor: 'var(--dialog-bg, var(--background, #ffffff))',
        borderRadius: 'var(--dialog-border-radius, 0.5rem)',
        boxShadow: 'var(--dialog-shadow, var(--shadow-overlay, 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)))',
        borderColor: 'var(--dialog-border-color, var(--color-border, #e5e7eb))',
        ...style,
      }}
    >
      <div
        role={role}
        aria-modal="true"
        aria-labelledby={finalLabelId}
        aria-describedby={finalDescId}
        className="w-full h-full"
      >
        {title && (
          <div
            className="px-6 py-4 border-b border-[var(--dialog-border-color,var(--color-border,#e5e7eb))] dark:border-zinc-800"
            style={{ color: 'var(--dialog-title-color, inherit)' }}
          >
            {typeof title === 'string' ? (
              <Heading
                as={headingLevel}
                variant="none"
                unstyledColor
                id={finalLabelId}
                className="text-lg font-medium"
              >
                {title}
              </Heading>
            ) : (
              <div id={finalLabelId}>{title}</div>
            )}
          </div>
        )}
        {description && (
          <div
            className="px-6 pt-4 pb-2 text-sm text-gray-500 dark:text-zinc-400"
            id={finalDescId}
            style={{ color: 'var(--dialog-desc-color, var(--color-muted-foreground, #6b7280))' }}
          >
            {description}
          </div>
        )}
        <div
          data-scroll-region={scrollRegion ? '' : undefined}
          className={contentClassName ?? 'px-6 py-4'}
        >
          {children}
        </div>
      </div>
    </Overlay>
  );
}

export function Dialog(props: DialogProps) {
  if (props.role === 'alertdialog' || typeof EnsureToastProvider !== 'function') {
    return <DialogInner {...props} />;
  }

  return (
    <EnsureToastProvider>
      <DialogInner {...props} />
    </EnsureToastProvider>
  );
}
