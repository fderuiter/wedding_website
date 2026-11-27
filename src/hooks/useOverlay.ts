import { useEffect, useRef, useId, type RefObject } from 'react';

const overlayStack: string[] = [];

const OVERLAY_TABBABLE_SELECTORS = [
  'button:not(:disabled):not([tabindex="-1"])',
  'a[href]:not([tabindex="-1"])',
  'input:not(:disabled):not([type="hidden"]):not([tabindex="-1"])',
  'select:not(:disabled):not([tabindex="-1"])',
  'textarea:not(:disabled):not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"]):not(:disabled)',
].join(',');

function isOverlayTabbableVisible(el: HTMLElement): boolean {
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

export function getOverlayTabbableElements(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(OVERLAY_TABBABLE_SELECTORS)).filter(
    isOverlayTabbableVisible
  );
}

function getPreferredInitialFocusTarget(modal: HTMLElement): HTMLElement | null {
  const tabbable = getOverlayTabbableElements(modal);
  if (tabbable.length === 0) {
    return null;
  }
  return (
    tabbable.find((el) => el.getAttribute('aria-disabled') !== 'true') ?? tabbable[0]
  );
}

interface ModalInertEntry {
  id: string;
  getRootElement: () => HTMLElement | null;
  allowToastInteraction: boolean;
}

const modalInertStack: ModalInertEntry[] = [];
const managedInertElements = new Set<HTMLElement>();
const IGNORED_INERT_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'NOSCRIPT', 'TEMPLATE']);
let bodyObserver: MutationObserver | null = null;
let isSyncingModalInert = false;

function syncModalInertState(): void {
  if (typeof document === 'undefined' || !document.body || isSyncingModalInert) {
    return;
  }

  let activeEntry: ModalInertEntry | null = null;
  let activeRoot: HTMLElement | null = null;
  for (let i = modalInertStack.length - 1; i >= 0; i -= 1) {
    const candidate = modalInertStack[i];
    const root = candidate.getRootElement();
    if (root && root.isConnected) {
      activeEntry = candidate;
      activeRoot = root;
      break;
    }
  }

  isSyncingModalInert = true;
  try {
    if (!activeEntry || !activeRoot) {
      for (const el of Array.from(managedInertElements)) {
        el.inert = false;
        el.removeAttribute('inert');
      }
      managedInertElements.clear();
      if (bodyObserver) {
        bodyObserver.disconnect();
        bodyObserver = null;
      }
      return;
    }

    const exemptElements: HTMLElement[] = [activeRoot];
    if (activeEntry.allowToastInteraction) {
      const toastContainers = Array.from(
        document.body.querySelectorAll<HTMLElement>('[data-toast-container]')
      ).filter((el) => el.isConnected);
      exemptElements.push(...toastContainers);
    }

    const nextInertTargets = new Set<HTMLElement>();
    const visitChildren = (parent: Element) => {
      for (const child of Array.from(parent.children)) {
        if (!(child instanceof HTMLElement)) continue;
        if (IGNORED_INERT_TAGS.has(child.tagName)) continue;
        if (exemptElements.includes(child)) continue;

        const containsExempt = exemptElements.some(
          (exemptEl) => exemptEl !== child && child.contains(exemptEl)
        );
        if (containsExempt) {
          visitChildren(child);
        } else {
          nextInertTargets.add(child);
        }
      }
    };

    visitChildren(document.body);

    for (const el of Array.from(managedInertElements)) {
      if (!nextInertTargets.has(el)) {
        el.inert = false;
        el.removeAttribute('inert');
        managedInertElements.delete(el);
      }
    }

    for (const el of nextInertTargets) {
      if (!managedInertElements.has(el)) {
        if (!el.hasAttribute('inert') && !el.inert) {
          el.inert = true;
          el.setAttribute('inert', '');
          managedInertElements.add(el);
        }
      }
    }

    if (!bodyObserver && typeof MutationObserver !== 'undefined') {
      bodyObserver = new MutationObserver(() => {
        if (!isSyncingModalInert && modalInertStack.length > 0) {
          syncModalInertState();
        }
      });
      bodyObserver.observe(document.body, { childList: true });
    }
  } finally {
    isSyncingModalInert = false;
  }
}

export function useModalInert(
  isOpen: boolean,
  rootRef: RefObject<HTMLElement | null>,
  allowToastInteraction = true
): void {
  const id = useId();

  useEffect(() => {
    if (!isOpen) return;

    const entry: ModalInertEntry = {
      id,
      getRootElement: () => rootRef.current,
      allowToastInteraction,
    };
    modalInertStack.push(entry);
    syncModalInertState();

    return () => {
      const idx = modalInertStack.findIndex((item) => item.id === id);
      if (idx !== -1) {
        modalInertStack.splice(idx, 1);
      }
      syncModalInertState();
    };
  }, [isOpen, id, rootRef, allowToastInteraction]);
}

interface UseOverlayOptions {
  triggerRef?: RefObject<HTMLElement | null>;
  inertRootRef?: RefObject<HTMLElement | null>;
  allowToastInteraction?: boolean;
}

/**
 * Manages modal overlay focus and close behavior, and provides a ref and backdrop click handler.
 *
 * While the overlay is open, this hook saves and restores the previously focused element,
 * moves focus to the first focusable element inside the overlay, wraps focus with
 * Tab/Shift+Tab (including tabbable `aria-disabled="true"` controls), recovers focus when
 * an active descendant unmounts, closes on Escape, and closes when the user clicks outside
 * the overlay (excluding an optional external toggle trigger element).
 */
export function useOverlay(
  isOpen: boolean,
  onClose: () => void,
  options?: UseOverlayOptions
) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const lastFocusedInModalRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  const triggerRefHolder = useRef(options?.triggerRef);
  const inertRootRefHolder = useRef(options?.inertRootRef);
  const allowToastInteractionRef = useRef(options?.allowToastInteraction ?? true);
  const handledOutsideMouseDownRef = useRef(false);
  const id = useId();

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    triggerRefHolder.current = options?.triggerRef;
    inertRootRefHolder.current = options?.inertRootRef;
    allowToastInteractionRef.current = options?.allowToastInteraction ?? true;
  }, [options?.triggerRef, options?.inertRootRef, options?.allowToastInteraction]);

  // Recover focus synchronously after React commits if the previously focused
  // element inside the active topmost modal unmounted during a state transition.
  useEffect(() => {
    if (!isOpen) return;
    const isTopmost = overlayStack[overlayStack.length - 1] === id;
    if (!isTopmost) return;

    const modal = overlayRef.current;
    const lastFocused = lastFocusedInModalRef.current;
    if (!modal || !lastFocused || lastFocused.isConnected) return;

    const activeEl =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (activeEl && (modal.contains(activeEl) || activeEl.closest('[data-toast-container]'))) {
      return;
    }

    const scrollRegion = modal.querySelector<HTMLElement>('[data-scroll-region]');
    const nextTarget =
      (scrollRegion ? getPreferredInitialFocusTarget(scrollRegion) : null) ??
      getPreferredInitialFocusTarget(modal);
    if (nextTarget) {
      nextTarget.focus();
      lastFocusedInModalRef.current = nextTarget;
    } else {
      if (!modal.hasAttribute('tabindex')) {
        modal.setAttribute('tabindex', '-1');
      }
      modal.focus();
      lastFocusedInModalRef.current = modal;
    }
  });

  useEffect(() => {
    if (!isOpen) {
      lastFocusedInModalRef.current = null;
      return;
    }

    handledOutsideMouseDownRef.current = false;
    overlayStack.push(id);

    // Save previous focus before applying inert (falling back to triggerRef if DOM commit already blurred activeElement)
    const currentActiveEl =
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body &&
      document.activeElement !== document.documentElement
        ? document.activeElement
        : null;
    previousFocusRef.current = currentActiveEl ?? triggerRefHolder.current?.current ?? null;

    const modal = overlayRef.current;
    if (modal) {
      const initialTarget = getPreferredInitialFocusTarget(modal);
      if (initialTarget) {
        initialTarget.focus();
        lastFocusedInModalRef.current = initialTarget;
      }
    }

    const registeredInertRootRef = inertRootRefHolder.current;
    if (registeredInertRootRef) {
      modalInertStack.push({
        id,
        getRootElement: () => registeredInertRootRef.current,
        allowToastInteraction: allowToastInteractionRef.current,
      });
      syncModalInertState();
    }

    function recoverFocusIfUnmounted() {
      const isTopmost = overlayStack[overlayStack.length - 1] === id;
      if (!isTopmost) return;

      const currentModal = overlayRef.current;
      const lastFocused = lastFocusedInModalRef.current;
      if (!currentModal || !currentModal.isConnected) return;
      if (!lastFocused || lastFocused.isConnected) return;

      const activeEl =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (
        activeEl &&
        activeEl !== document.body &&
        activeEl !== document.documentElement &&
        activeEl.isConnected &&
        (currentModal.contains(activeEl) || Boolean(activeEl.closest('[data-toast-container]')))
      ) {
        return;
      }

      const scrollRegion = currentModal.querySelector<HTMLElement>('[data-scroll-region]');
      const nextTarget =
        (scrollRegion ? getPreferredInitialFocusTarget(scrollRegion) : null) ??
        getPreferredInitialFocusTarget(currentModal);
      if (nextTarget) {
        nextTarget.focus();
        lastFocusedInModalRef.current = nextTarget;
      } else {
        if (!currentModal.hasAttribute('tabindex')) {
          currentModal.setAttribute('tabindex', '-1');
        }
        currentModal.focus();
        lastFocusedInModalRef.current = currentModal;
      }
    }

    function handleFocusIn(e: FocusEvent) {
      const currentModal = overlayRef.current;
      if (!currentModal) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (!target) return;
      if (currentModal.contains(target)) {
        lastFocusedInModalRef.current = target;
      } else if (target.isConnected && target !== document.body && target !== document.documentElement) {
        lastFocusedInModalRef.current = null;
      }
    }

    let subtreeObserver: MutationObserver | null = null;
    if (modal && typeof MutationObserver !== 'undefined') {
      subtreeObserver = new MutationObserver(() => {
        recoverFocusIfUnmounted();
      });
      subtreeObserver.observe(modal, { childList: true, subtree: true });
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
        const targetToast = targetElement?.closest('[data-toast-container]');
        const activeToast = activeElement?.closest('[data-toast-container]');
        if (
          e.defaultPrevented ||
          Boolean(targetToast && !targetToast.hasAttribute('inert')) ||
          Boolean(activeToast && !activeToast.hasAttribute('inert'))
        ) {
          return;
        }
        e.preventDefault();
        closeRef.current();
      } else if (e.key === 'Tab') {
        const currentModal = overlayRef.current;
        if (!currentModal) return;
        const modalFocusable = getOverlayTabbableElements(currentModal);
        const toastContainers = Array.from(
          document.querySelectorAll<HTMLElement>('[data-toast-container]')
        ).filter((container) => !container.hasAttribute('inert') && !container.inert);
        const toastFocusable = toastContainers
          .flatMap((container) => getOverlayTabbableElements(container))
          .filter((el) => !currentModal.contains(el));

        const focusable = [...modalFocusable, ...toastFocusable];
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const lastModalEl =
          modalFocusable.length > 0 ? modalFocusable[modalFocusable.length - 1] : null;
        const firstToastEl = toastFocusable.length > 0 ? toastFocusable[0] : null;

        const activeEl =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const isInsideModal = Boolean(activeEl && currentModal.contains(activeEl));
        const activeToastContainer = activeEl?.closest('[data-toast-container]');
        const isInsideToast = Boolean(
          activeToastContainer && !activeToastContainer.hasAttribute('inert')
        );

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
      const toastContainer = targetElement?.closest('[data-toast-container]');
      if (toastContainer && !toastContainer.hasAttribute('inert')) {
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

    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      subtreeObserver?.disconnect();
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('mouseup', handleMouseUp);
      if (mouseUpResetTimer) clearTimeout(mouseUpResetTimer);

      const index = overlayStack.indexOf(id);
      if (index !== -1) {
        overlayStack.splice(index, 1);
      }

      const inertIndex = modalInertStack.findIndex((item) => item.id === id);
      if (inertIndex !== -1) {
        modalInertStack.splice(inertIndex, 1);
        syncModalInertState();
      }

      // Restore focus after releasing inert so browsers never ignore .focus() on un-inerted triggers
      const restoreTarget =
        (previousFocusRef.current && previousFocusRef.current.isConnected
          ? previousFocusRef.current
          : triggerRefHolder.current?.current) ?? null;
      if (restoreTarget && restoreTarget.isConnected) {
        if (restoreTarget.closest('[inert]')) {
          queueMicrotask(() => {
            if (restoreTarget.isConnected && !restoreTarget.closest('[inert]')) {
              restoreTarget.focus();
            }
          });
        } else {
          restoreTarget.focus();
        }
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
