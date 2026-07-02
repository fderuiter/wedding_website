import React from 'react';
import { useOverlay } from '../../hooks/useOverlay';

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
  const { overlayRef, handleBackdropClick } = useOverlay(isOpen, onClose);
  
  // Use provided IDs or generate generic ones for this instance
  const defaultLabelId = `dialog-title-${Math.random().toString(36).substr(2, 9)}`;
  const defaultDescId = `dialog-desc-${Math.random().toString(36).substr(2, 9)}`;
  
  const finalLabelId = ariaLabelledby || (title ? defaultLabelId : undefined);
  const finalDescId = ariaDescribedby || (description ? defaultDescId : undefined);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 sm:p-6"
      onClick={handleBackdropClick}
    >
      <div
        ref={overlayRef}
        role={role}
        aria-modal="true"
        aria-labelledby={finalLabelId}
        aria-describedby={finalDescId}
        className={`bg-white rounded-lg shadow-xl w-full max-w-md overflow-hidden ${className}`}
      >
        {title && (
          <div className="px-6 py-4 border-b border-gray-200">
            {typeof title === 'string' ? (
              <h2 id={finalLabelId} className="text-lg font-medium text-gray-900">
                {title}
              </h2>
            ) : (
              <div id={finalLabelId}>{title}</div>
            )}
          </div>
        )}
        {description && (
          <div className="px-6 pt-4 pb-2 text-sm text-gray-500" id={finalDescId}>
            {description}
          </div>
        )}
        <div className="px-6 py-4">
          {children}
        </div>
      </div>
    </div>
  );
}
