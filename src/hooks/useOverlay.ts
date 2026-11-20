import { useEffect, useRef, useId } from 'react';

const overlayStack: string[] = [];

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
  const closeRef = useRef(onClose);
  const handledOutsideMouseDownRef = useRef(false);
  const id = useId();

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    handledOutsideMouseDownRef.current = false;
    overlayStack.push(id);

    // Save previous focus
    previousFocusRef.current = document.activeElement as HTMLElement;

    const focusableSelectors = [
      'button:not(:disabled):not([tabindex="-1"]):not([aria-disabled="true"])',
      'a[href]:not(:disabled):not([tabindex="-1"]):not([aria-disabled="true"])',
      'input:not(:disabled):not([tabindex="-1"]):not([aria-disabled="true"])',
      'select:not(:disabled):not([tabindex="-1"]):not([aria-disabled="true"])',
      'textarea:not(:disabled):not([tabindex="-1"]):not([aria-disabled="true"])',
      '[tabindex]:not([tabindex="-1"]):not(:disabled):not([aria-disabled="true"])'
    ];

    const modal = overlayRef.current;
    if (modal) {
      const focusableEls = modal.querySelectorAll<HTMLElement>(focusableSelectors.join(','));
      if (focusableEls.length > 0) {
        (focusableEls[0] as HTMLElement).focus();
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      const isTopmost = overlayStack[overlayStack.length - 1] === id;
      if (!isTopmost) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
      } else if (e.key === 'Tab') {
        const modal = overlayRef.current;
        if (!modal) return;
        const focusableEls = modal.querySelectorAll<HTMLElement>(focusableSelectors.join(','));
        const focusable = Array.from(focusableEls);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (!modal.contains(document.activeElement)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
          return;
        }

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

    let mouseUpResetTimer: ReturnType<typeof setTimeout> | null = null;

    function handleClickOutside(e: MouseEvent) {
      const isTopmost = overlayStack[overlayStack.length - 1] === id;
      if (!isTopmost) return;

      if (overlayRef.current && !overlayRef.current.contains(e.target as Node)) {
        handledOutsideMouseDownRef.current = true;
        closeRef.current();
      }
    }

    function handleMouseUp() {
      if (!handledOutsideMouseDownRef.current) return;
      if (mouseUpResetTimer) clearTimeout(mouseUpResetTimer);
      mouseUpResetTimer = setTimeout(() => {
        handledOutsideMouseDownRef.current = false;
        mouseUpResetTimer = null;
      }, 0);
    }

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('mouseup', handleMouseUp);
      if (mouseUpResetTimer) clearTimeout(mouseUpResetTimer);

      const index = overlayStack.indexOf(id);
      if (index !== -1) {
        overlayStack.splice(index, 1);
      }

      // Restore focus
      if (previousFocusRef.current && previousFocusRef.current.isConnected) {
        previousFocusRef.current.focus();
      }
    };
  }, [isOpen, id]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (handledOutsideMouseDownRef.current) {
      handledOutsideMouseDownRef.current = false;
      return;
    }
    const isTopmost = overlayStack[overlayStack.length - 1] === id;
    if (!isTopmost) return;
    if (e.target === e.currentTarget) {
      closeRef.current();
    }
  };

  return { overlayRef, handleBackdropClick };
}
