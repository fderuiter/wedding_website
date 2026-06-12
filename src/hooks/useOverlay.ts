import { useEffect, useRef } from 'react';

/**
 * Manages overlay focus and close behavior, and provides a ref and backdrop click handler.
 *
 * While the overlay is open, this hook saves and restores the previously focused element,
 * moves focus to the first focusable element inside the overlay, traps focus with
 * Tab/Shift+Tab, closes on Escape, and closes when the user clicks outside the overlay.
 *
 * @param isOpen - Whether the overlay is currently open
 * @param onClose - Callback invoked when the overlay should close
 * @returns An object containing:
 *  - `overlayRef`: a ref to attach to the overlay container element
 *  - `handleBackdropClick`: a click handler that closes the overlay only when the backdrop itself is clicked
 */
export function useOverlay(isOpen: boolean, onClose: () => void) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    // Save previous focus
    previousFocusRef.current = document.activeElement as HTMLElement;

    const focusableSelectors = [
      'button', 'a[href]', 'input', 'select', 'textarea', '[tabindex]:not([tabindex="-1"])'
    ];

    const modal = overlayRef.current;
    if (modal) {
      const focusableEls = modal.querySelectorAll<HTMLElement>(focusableSelectors.join(','));
      if (focusableEls.length > 0) {
        (focusableEls[0] as HTMLElement).focus();
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Tab') {
        const modal = overlayRef.current;
        if (!modal) return;
        const focusableEls = modal.querySelectorAll<HTMLElement>(focusableSelectors.join(','));
        const focusable = Array.from(focusableEls);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            (last as HTMLElement).focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            (first as HTMLElement).focus();
          }
        }
      }
    }

    function handleClickOutside(e: MouseEvent) {
      if (overlayRef.current && !overlayRef.current.contains(e.target as Node)) {
        onClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
      // Restore focus
      if (previousFocusRef.current) {
        previousFocusRef.current.focus();
      }
    };
  }, [isOpen, onClose]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return { overlayRef, handleBackdropClick };
}
