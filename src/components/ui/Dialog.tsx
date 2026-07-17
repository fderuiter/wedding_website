'use client';

import React, { useId } from 'react';
import { Overlay } from './Overlay';

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
}

export function Dialog({
  isOpen,
  onClose,
  title,
  description,
  children,
  role = 'dialog',
  'aria-labelledby': ariaLabelledby,
  'aria-describedby': ariaDescribedby,
  className = '',
}: DialogProps) {
  const defaultId = useId();
  
  const finalLabelId = ariaLabelledby || (title ? `dialog-title-${defaultId}` : undefined);
  const finalDescId = ariaDescribedby || (description ? `dialog-desc-${defaultId}` : undefined);

  return (
    <Overlay
      isOpen={isOpen}
      onClose={onClose}
      className={`bg-white dark:bg-zinc-900 rounded-lg shadow-xl w-full max-w-md overflow-hidden text-gray-900 dark:text-zinc-50 ${className}`}
    >
      <div
        role={role}
        aria-labelledby={finalLabelId}
        aria-describedby={finalDescId}
        className="w-full h-full"
      >
        {title && (
          <div className="px-6 py-4 border-b border-gray-200 dark:border-zinc-800">
            {typeof title === 'string' ? (
              <h2 id={finalLabelId} className="text-lg font-medium text-gray-900 dark:text-zinc-50">
                {title}
              </h2>
            ) : (
              <div id={finalLabelId}>{title}</div>
            )}
          </div>
        )}
        {description && (
          <div className="px-6 pt-4 pb-2 text-sm text-gray-500 dark:text-zinc-400" id={finalDescId}>
            {description}
          </div>
        )}
        <div className="px-6 py-4">
          {children}
        </div>
      </div>
    </Overlay>
  );
}
