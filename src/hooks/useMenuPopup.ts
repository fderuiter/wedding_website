import { useEffect, useRef, type RefObject } from 'react';

const MENU_TABBABLE_SELECTORS = [
  'button:not(:disabled):not([tabindex="-1"])',
  'a[href]:not([tabindex="-1"])',
  'input:not(:disabled):not([type="hidden"]):not([tabindex="-1"])',
  'select:not(:disabled):not([tabindex="-1"])',
  'textarea:not(:disabled):not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"]):not(:disabled)',
].join(',');

function isVisibleTabbable(el: HTMLElement): boolean {
  if (
    el.hidden ||
    el.closest('[hidden]') ||
    el.closest('[inert]') ||
    el.closest('[aria-hidden="true"]')
  ) {
    return false;
  }
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') {
    return false;
  }
  const isJsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
  if (!isJsdom && el.getClientRects().length === 0) {
    return false;
  }
  return true;
}

function getTabbableElements(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(MENU_TABBABLE_SELECTORS)).filter(
    isVisibleTabbable
  );
}

export interface UseMenuPopupOptions {
  triggerRef?: RefObject<HTMLElement | null>;
  restoreFocusOnOutsideClick?: boolean;
}

/**
 * Non-trapping popup lifecycle hook for WAI-ARIA `role="menu"` popups.
 *
 * Unlike `useOverlay` (which traps Tab focus for `aria-modal="true"` dialogs),
 * `useMenuPopup`:
 * - Focuses the first enabled menuitem when opened.
 * - Closes on `Escape` and restores focus to the trigger element.
 * - Closes on `Tab` / `Shift+Tab` without trapping focus, moving focus
 *   sequentially to the next tabbable page element on `Tab` or back to the
 *   trigger on `Shift+Tab`.
 * - Closes on outside pointer `mousedown` (excluding `triggerRef` so clicking
 *   an open trigger toggles cleanly on the first click).
 */
export function useMenuPopup(
  isOpen: boolean,
  onClose: () => void,
  options?: UseMenuPopupOptions
) {
  const menuRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  const triggerRefHolder = useRef(options?.triggerRef);
  const restoreOnOutsideRef = useRef(options?.restoreFocusOnOutsideClick ?? true);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    triggerRefHolder.current = options?.triggerRef;
    restoreOnOutsideRef.current = options?.restoreFocusOnOutsideClick ?? true;
  }, [options?.triggerRef, options?.restoreFocusOnOutsideClick]);

  useEffect(() => {
    if (!isOpen) return;

    const initialTrigger =
      triggerRefHolder.current?.current ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    previousFocusRef.current = initialTrigger;

    const menu = menuRef.current;
    if (menu) {
      const firstMenuItem = Array.from(
        menu.querySelectorAll<HTMLElement>(
          '[role="menuitem"]:not(:disabled):not([aria-disabled="true"]):not([tabindex="-1"])'
        )
      ).find(isVisibleTabbable);

      if (firstMenuItem) {
        firstMenuItem.focus();
      } else {
        const tabbables = getTabbableElements(menu);
        if (tabbables.length > 0) {
          tabbables[0].focus();
        }
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        const triggerEl = triggerRefHolder.current?.current ?? previousFocusRef.current;
        closeRef.current();
        if (triggerEl && triggerEl.isConnected) {
          triggerEl.focus();
        }
        return;
      }

      if (e.key === 'Tab') {
        const currentMenu = menuRef.current;
        if (!currentMenu) return;

        const activeEl =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const triggerEl = triggerRefHolder.current?.current ?? previousFocusRef.current;
        const isInsideMenu = Boolean(activeEl && currentMenu.contains(activeEl));
        const isOnTrigger = Boolean(activeEl && triggerEl && activeEl === triggerEl);

        if (!isInsideMenu && !isOnTrigger) {
          closeRef.current();
          return;
        }

        const pageTabbables = getTabbableElements(document.body).filter(
          (el) => !currentMenu.contains(el)
        );
        const triggerIndex = triggerEl ? pageTabbables.indexOf(triggerEl) : -1;

        e.preventDefault();
        closeRef.current();

        if (e.shiftKey) {
          if (isOnTrigger) {
            const prevTarget = triggerIndex > 0 ? pageTabbables[triggerIndex - 1] : null;
            if (prevTarget && prevTarget.isConnected) {
              prevTarget.focus();
            } else if (triggerEl) {
              triggerEl.blur();
            }
          } else if (triggerEl && triggerEl.isConnected) {
            triggerEl.focus();
          }
        } else {
          const nextTarget =
            triggerIndex !== -1 && triggerIndex + 1 < pageTabbables.length
              ? pageTabbables[triggerIndex + 1]
              : null;
          if (nextTarget && nextTarget.isConnected) {
            nextTarget.focus();
          } else if (triggerEl && triggerEl.isConnected) {
            triggerEl.blur();
          }
        }
      }
    }

    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node | null;
      const targetElement =
        target instanceof Element ? target : target?.parentElement ?? null;

      if (target && triggerRefHolder.current?.current?.contains(target)) {
        return;
      }

      const currentMenu = menuRef.current;
      if (currentMenu && (!target || !currentMenu.contains(target))) {
        const triggerEl = triggerRefHolder.current?.current ?? previousFocusRef.current;
        const clickedInteractive = Boolean(
          targetElement?.closest(
            'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          )
        );
        closeRef.current();
        if (
          restoreOnOutsideRef.current &&
          !clickedInteractive &&
          triggerEl &&
          triggerEl.isConnected
        ) {
          triggerEl.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  return { menuRef };
}
