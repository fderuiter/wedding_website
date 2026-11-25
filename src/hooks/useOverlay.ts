import { useEffect, useRef, useId, type RefObject } from 'react';

const overlayStack: string[] = [];

interface UseOverlayOptions {
  triggerRef?: RefObject<HTMLElement | null>;
}

/**
 * Manages overlay focus and close behavior, and provides a ref and backdrop click handler.
 *
 * While the overlay is open, this hook saves and restores the previously focused element,
 * moves focus to the first focusable element inside the overlay, traps focus with
 * Tab/Shift+Tab, closes on Escape, and closes when the user clicks outside the overlay
 * (excluding an optional external toggle trigger element).
 *
 * @param isOpen - Whether the overlay is currently open
 * @param onClose - Callback invoked when the overlay should close
 * @param options - Optional configuration such as `triggerRef` to exclude from outside mousedown dismissal
 * @returns An object containing:
 *  - `overlayRef`: a ref to attach to the overlay container element
 *  - `handleBackdropClick`: a click handler that closes the overlay only when the backdrop itself is clicked
 */
export function useOverlay(
  isOpen: boolean,
  onClose: () => void,
  options?: UseOverlayOptions
) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  const triggerRefHolder = useRef(options?.triggerRef);
  const handledOutsideMouseDownRef = useRef(false);
  const id = useId();

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    triggerRefHolder.current = options?.triggerRef;
  }, [options?.triggerRef]);

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
        const targetElement =
          e.target instanceof Element
            ? e.target
            : (e.target as Node | null)?.parentElement ?? null;
        const activeElement =
          document.activeElement instanceof Element ? document.activeElement : null;
        if (
          e.defaultPrevented ||
          Boolean(targetElement?.closest('[data-toast-container]')) ||
          Boolean(activeElement?.closest('[data-toast-container]'))
        ) {
          return;
        }
        e.preventDefault();
        closeRef.current();
      } else if (e.key === 'Tab') {
        const modal = overlayRef.current;
        if (!modal) return;
        const selector = focusableSelectors.join(',');
        const modalFocusable = Array.from(modal.querySelectorAll<HTMLElement>(selector));
        const toastContainers = Array.from(
          document.querySelectorAll<HTMLElement>('[data-toast-container]')
        );
        const toastFocusable = toastContainers
          .flatMap((container) => Array.from(container.querySelectorAll<HTMLElement>(selector)))
          .filter((el) => !modal.contains(el));

        const focusable = [...modalFocusable, ...toastFocusable];
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const lastModalEl =
          modalFocusable.length > 0 ? modalFocusable[modalFocusable.length - 1] : null;
        const firstToastEl = toastFocusable.length > 0 ? toastFocusable[0] : null;

        const activeEl =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const isInsideModal = Boolean(activeEl && modal.contains(activeEl));
        const isInsideToast = Boolean(activeEl?.closest('[data-toast-container]'));

        if (!isInsideModal && !isInsideToast) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
          return;
        }

        if (e.shiftKey) {
          if (activeEl === first) {
            e.preventDefault();
            last.focus();
          } else if (
            lastModalEl &&
            (activeEl === firstToastEl ||
              (isInsideToast && activeEl !== null && !toastFocusable.includes(activeEl)))
          ) {
            e.preventDefault();
            lastModalEl.focus();
          }
        } else {
          if (activeEl === last) {
            e.preventDefault();
            first.focus();
          } else if (activeEl === lastModalEl && firstToastEl) {
            e.preventDefault();
            firstToastEl.focus();
          }
        }
      }
    }

    let mouseUpResetTimer: ReturnType<typeof setTimeout> | null = null;

    function handleClickOutside(e: MouseEvent) {
      const isTopmost = overlayStack[overlayStack.length - 1] === id;
      if (!isTopmost) return;

      const target = e.target as Node | null;
      const targetElement =
        target instanceof Element ? target : target?.parentElement ?? null;
      if (targetElement?.closest('[data-toast-container]')) {
        return;
      }

      if (target && triggerRefHolder.current?.current?.contains(target)) {
        return;
      }

      if (overlayRef.current && (!target || !overlayRef.current.contains(target))) {
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
