import { useEffect, useRef, useId, type RefObject } from 'react';

export interface UseOverlayOptions {
  isModal?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  restoreFocus?: boolean;
}

interface OverlayStackEntry {
  id: string;
  isModal: boolean;
  getContainer: () => HTMLElement | null;
  markedElements: Set<HTMLElement>;
}

const overlayStack: OverlayStackEntry[] = [];
const inertRefCounts = new WeakMap<HTMLElement, number>();
const originallyInertElements = new WeakSet<HTMLElement>();

const FOCUSABLE_SELECTORS = [
  'button:not(:disabled):not([tabindex="-1"]):not([aria-disabled="true"])',
  'a[href]:not(:disabled):not([tabindex="-1"]):not([aria-disabled="true"])',
  'input:not(:disabled):not([tabindex="-1"]):not([aria-disabled="true"]):not([type="hidden"])',
  'select:not(:disabled):not([tabindex="-1"]):not([aria-disabled="true"])',
  'textarea:not(:disabled):not([tabindex="-1"]):not([aria-disabled="true"])',
  '[tabindex]:not([tabindex="-1"]):not(:disabled):not([aria-disabled="true"])',
].join(',');

const NON_INERT_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'TEMPLATE', 'NOSCRIPT']);
const RESPONSIVE_DISPLAY_RE =
  /(?:^|\s)[a-z0-9]+:(?:block|inline|inline-block|flex|inline-flex|grid|inline-grid|table)(?:\s|$)/i;

function isElementInert(el: HTMLElement): boolean {
  return Boolean((el as HTMLElement & { inert?: boolean }).inert) || el.hasAttribute('inert');
}

function setElementInert(el: HTMLElement, value: boolean): void {
  (el as HTMLElement & { inert?: boolean }).inert = value;
  if (value) {
    el.setAttribute('inert', '');
  } else {
    el.removeAttribute('inert');
  }
}

function acquireInert(el: HTMLElement): void {
  const currentCount = inertRefCounts.get(el) ?? 0;
  if (currentCount === 0) {
    if (isElementInert(el)) {
      originallyInertElements.add(el);
    } else {
      originallyInertElements.delete(el);
      setElementInert(el, true);
    }
  }
  inertRefCounts.set(el, currentCount + 1);
}

function releaseInert(el: HTMLElement): void {
  const currentCount = inertRefCounts.get(el) ?? 0;
  if (currentCount <= 1) {
    inertRefCounts.delete(el);
    if (!originallyInertElements.has(el)) {
      setElementInert(el, false);
    }
    originallyInertElements.delete(el);
  } else {
    inertRefCounts.set(el, currentCount - 1);
  }
}

function shouldExemptFromInert(el: HTMLElement): boolean {
  if (NON_INERT_TAGS.has(el.tagName)) return true;
  if (el.id === '__next-route-announcer__' || el.tagName === 'NEXT-ROUTE-ANNOUNCER') return true;
  if (el.hasAttribute('data-toast-region') || el.hasAttribute('aria-live')) return true;
  if (
    el.children.length > 0 &&
    Array.from(el.children).every((child) => child.hasAttribute('aria-live'))
  ) {
    return true;
  }
  return false;
}

function applyModalInert(modal: HTMLElement, entry: OverlayStackEntry): void {
  if (typeof document === 'undefined' || !document.body) return;

  let ancestor: HTMLElement | null = modal;
  while (ancestor && ancestor !== document.body) {
    for (const other of overlayStack) {
      if (other.id !== entry.id && other.markedElements.has(ancestor)) {
        other.markedElements.delete(ancestor);
        releaseInert(ancestor);
      }
    }
    ancestor = ancestor.parentElement;
  }

  let current: HTMLElement | null = modal;
  while (current && current !== document.body) {
    const parent: HTMLElement | null = current.parentElement;
    if (!parent) break;

    for (const sibling of Array.from(parent.children)) {
      if (sibling === current || !(sibling instanceof HTMLElement)) continue;
      if (shouldExemptFromInert(sibling)) continue;
      if (!entry.markedElements.has(sibling)) {
        entry.markedElements.add(sibling);
        acquireInert(sibling);
      }
    }

    current = parent;
  }
}

function releaseModalInert(entry: OverlayStackEntry): void {
  for (const el of entry.markedElements) {
    releaseInert(el);
  }
  entry.markedElements.clear();
}

function isElementFocusable(el: HTMLElement, root: HTMLElement): boolean {
  if (!el.isConnected) return false;
  if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') {
    return false;
  }

  let current: HTMLElement | null = el;
  while (current && current !== root.parentElement) {
    if (
      current.hasAttribute('hidden') ||
      current.getAttribute('aria-hidden') === 'true' ||
      (current !== root && isElementInert(current))
    ) {
      return false;
    }
    if (current.classList.contains('hidden') && !RESPONSIVE_DISPLAY_RE.test(current.className)) {
      if (typeof window === 'undefined') return false;
      const computedDisplay = window.getComputedStyle(current).display;
      if (computedDisplay === 'none' || !current.style.display) {
        return false;
      }
    }
    if (typeof window !== 'undefined') {
      const style = window.getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden') {
        return false;
      }
    }
    current = current.parentElement;
  }

  return true;
}

function getFocusableElements(modal: HTMLElement): HTMLElement[] {
  const candidates = Array.from(modal.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS));
  return candidates.filter((el) => isElementFocusable(el, modal));
}

function focusWithinContainer(
  modal: HTMLElement,
  options: { preferLast?: boolean; fallbackToContainer?: boolean } = {}
): void {
  const { preferLast = false, fallbackToContainer = true } = options;
  const focusable = getFocusableElements(modal);
  const ordered = preferLast ? [...focusable].reverse() : focusable;

  for (const candidate of ordered) {
    candidate.focus();
    if (document.activeElement === candidate) {
      return;
    }
  }

  if (fallbackToContainer) {
    modal.focus();
  }
}

function getTopmostOverlayId(): string | undefined {
  return overlayStack[overlayStack.length - 1]?.id;
}

function getTopmostModalEntry(): OverlayStackEntry | undefined {
  for (let i = overlayStack.length - 1; i >= 0; i -= 1) {
    if (overlayStack[i].isModal) {
      return overlayStack[i];
    }
  }
  return undefined;
}

/**
 * Manages overlay focus and close behavior, and provides a ref and backdrop click handler.
 *
 * While the overlay is open, this hook saves and restores the previously focused element,
 * moves focus to the configured initial target or first focusable element inside the overlay,
 * contains focus with Tab/Shift+Tab, closes on Escape, and closes when clicking outside.
 * When `options.isModal` is enabled, it also isolates background siblings with reference-counted
 * `inert` attributes and recovers focus via `MutationObserver` and `focusin` listeners.
 *
 * @param isOpen - Whether the overlay is currently open
 * @param onClose - Callback invoked when the overlay should close
 * @param options - Optional modal focus-containment configuration
 * @returns An object containing:
 *  - `overlayRef`: a ref to attach to the overlay container element
 *  - `handleBackdropClick`: a click handler that closes the overlay only when the backdrop itself is clicked
 */
export function useOverlay(
  isOpen: boolean,
  onClose: () => void,
  options?: UseOverlayOptions
) {
  const isModal = options?.isModal ?? false;
  const initialFocusRef = options?.initialFocusRef;
  const restoreFocus = options?.restoreFocus ?? true;

  const overlayRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  const optionsRef = useRef({ initialFocusRef, restoreFocus });
  const id = useId();

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    optionsRef.current = { initialFocusRef, restoreFocus };
  }, [initialFocusRef, restoreFocus]);

  useEffect(() => {
    if (!isOpen) return;

    const stackEntry: OverlayStackEntry = {
      id,
      isModal,
      getContainer: () => overlayRef.current,
      markedElements: new Set<HTMLElement>(),
    };
    overlayStack.push(stackEntry);

    // Save previous focus
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const modal = overlayRef.current;
    if (modal) {
      if (isModal) {
        applyModalInert(modal, stackEntry);
      }

      const preferredInitial = optionsRef.current.initialFocusRef?.current;
      if (preferredInitial && preferredInitial.isConnected && modal.contains(preferredInitial)) {
        preferredInitial.focus();
      } else {
        focusWithinContainer(modal, {
          preferLast: false,
          fallbackToContainer: isModal,
        });
      }
    }

    let isRecoveringFocus = false;

    function recoverModalFocus(preferLast = false) {
      if (isRecoveringFocus) return;
      const currentModal = overlayRef.current;
      if (!currentModal || !currentModal.isConnected) return;
      isRecoveringFocus = true;
      try {
        focusWithinContainer(currentModal, {
          preferLast,
          fallbackToContainer: true,
        });
      } finally {
        isRecoveringFocus = false;
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      const isTopmost = getTopmostOverlayId() === id;
      if (!isTopmost) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
      } else if (e.key === 'Tab') {
        const currentModal = overlayRef.current;
        if (!currentModal) return;

        const focusable = getFocusableElements(currentModal);
        if (focusable.length === 0) {
          if (isModal) {
            e.preventDefault();
            currentModal.focus();
          }
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const activeEl =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const isInside = Boolean(activeEl && currentModal.contains(activeEl));

        if (!isInside || activeEl === currentModal) {
          e.preventDefault();
          focusWithinContainer(currentModal, {
            preferLast: e.shiftKey,
            fallbackToContainer: isModal,
          });
          return;
        }

        if (activeEl && !focusable.includes(activeEl)) {
          e.preventDefault();
          if (e.shiftKey) {
            const preceding = [...focusable]
              .reverse()
              .find((el) => Boolean(activeEl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING));
            (preceding ?? last).focus();
          } else {
            const following = focusable.find((el) =>
              Boolean(activeEl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
            );
            (following ?? first).focus();
          }
          return;
        }

        if (e.shiftKey) {
          if (activeEl === first) {
            e.preventDefault();
            last.focus();
          }
        } else if (activeEl === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    function handleClickOutside(e: MouseEvent) {
      const isTopmost = getTopmostOverlayId() === id;
      if (!isTopmost) return;

      if (overlayRef.current && !overlayRef.current.contains(e.target as Node)) {
        closeRef.current();
      }
    }

    function handleFocusIn(e: FocusEvent) {
      if (!isModal || isRecoveringFocus) return;
      if (getTopmostModalEntry()?.id !== id) return;

      const currentModal = overlayRef.current;
      const target = e.target;
      if (!currentModal || !(target instanceof HTMLElement)) return;
      if (target === document.body || target === document.documentElement) return;

      if (!currentModal.contains(target)) {
        recoverModalFocus(false);
      }
    }

    let observer: MutationObserver | null = null;
    if (isModal && modal && typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(() => {
        if (isRecoveringFocus) return;
        if (getTopmostModalEntry()?.id !== id) return;

        const currentModal = overlayRef.current;
        if (!currentModal || !currentModal.isConnected) return;

        const activeEl =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const isActiveValidInside =
          Boolean(activeEl) &&
          activeEl !== document.body &&
          activeEl !== document.documentElement &&
          currentModal.contains(activeEl!) &&
          !(activeEl as HTMLButtonElement).disabled &&
          activeEl!.getAttribute('aria-disabled') !== 'true';

        if (!isActiveValidInside) {
          recoverModalFocus(false);
        }
      });

      observer.observe(modal, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['disabled', 'hidden', 'aria-disabled', 'inert'],
      });
    }

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    if (isModal) {
      document.addEventListener('focusin', handleFocusIn);
    }

    return () => {
      observer?.disconnect();
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
      if (isModal) {
        document.removeEventListener('focusin', handleFocusIn);
        releaseModalInert(stackEntry);
      }

      const index = overlayStack.findIndex((entry) => entry.id === id);
      if (index !== -1) {
        overlayStack.splice(index, 1);
      }

      // Restore focus if enabled
      if (optionsRef.current.restoreFocus) {
        if (previousFocusRef.current && previousFocusRef.current.isConnected) {
          previousFocusRef.current.focus();
        } else if (isModal) {
          const nextTopModal = getTopmostModalEntry()?.getContainer();
          if (nextTopModal && nextTopModal.isConnected) {
            focusWithinContainer(nextTopModal, {
              preferLast: false,
              fallbackToContainer: true,
            });
          }
        }
      }
    };
  }, [isOpen, id, isModal]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      closeRef.current();
    }
  };

  return { overlayRef, handleBackdropClick };
}
