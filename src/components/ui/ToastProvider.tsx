'use client';
import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
  useRef,
  useEffect,
  useSyncExternalStore,
} from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { generateSecureUUID } from '@/utils/uuid';

type ToastType = 'success' | 'error' | 'info' | 'confirm';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  onConfirm?: () => void;
  onCancel?: () => void;
  action?: ToastAction;
  duration?: number | null;
}

export interface ToastContextValue {
  toasts: Toast[];
  addToast: (
    message: string,
    type?: ToastType,
    onConfirm?: () => void,
    onCancel?: () => void,
    action?: ToastAction,
    duration?: number | null
  ) => void;
  removeToast: (id: string) => void;
  confirm: (message: string) => Promise<boolean>;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

const FOCUSABLE_SELECTOR = [
  'button:not(:disabled):not([tabindex="-1"]):not([aria-disabled="true"])',
  'a[href]:not(:disabled):not([tabindex="-1"]):not([aria-disabled="true"])',
  'input:not(:disabled):not([tabindex="-1"]):not([aria-disabled="true"])',
  'select:not(:disabled):not([tabindex="-1"]):not([aria-disabled="true"])',
  'textarea:not(:disabled):not([tabindex="-1"]):not([aria-disabled="true"])',
  '[tabindex]:not([tabindex="-1"]):not(:disabled):not([aria-disabled="true"])',
].join(',');

function isElementFocusable(el: HTMLElement | null): el is HTMLElement {
  if (!el || !el.isConnected) return false;
  if ((el as HTMLButtonElement).disabled) return false;
  if (el.getAttribute('aria-disabled') === 'true') return false;
  return true;
}

function subscribeToPreviewSearch(onStoreChange: () => void) {
  if (typeof window === 'undefined') {
    return () => {};
  }
  window.addEventListener('popstate', onStoreChange);
  return () => {
    window.removeEventListener('popstate', onStoreChange);
  };
}

function getPreviewSearchSnapshot(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return new URLSearchParams(window.location.search).get('preview') === 'true';
}

function getServerPreviewSearchSnapshot(): boolean {
  return false;
}

interface ToastItemProps {
  toast: Toast;
  onClose: (id: string) => void;
  onRestoreFocus?: () => void;
  duration?: number | null;
}

const ToastItem = ({ toast, onClose, onRestoreFocus, duration }: ToastItemProps) => {
  const resolvedDuration =
    duration !== undefined
      ? duration
      : toast.duration !== undefined
        ? toast.duration
        : toast.type === 'error' || Boolean(toast.action)
          ? null
          : 5000;

  const itemRef = useRef<HTMLDivElement>(null);
  const remainingRef = useRef<number>(resolvedDuration ?? 0);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHoveredRef = useRef<boolean>(false);
  const isFocusedRef = useRef<boolean>(false);
  const isPausedRef = useRef<boolean>(false);

  const dismissFromInteraction = useCallback(() => {
    const wasFocusInside = Boolean(
      itemRef.current && itemRef.current.contains(document.activeElement)
    );
    onClose(toast.id);
    if (wasFocusInside) {
      onRestoreFocus?.();
    }
  }, [onClose, onRestoreFocus, toast.id]);

  const startTimer = useCallback(() => {
    if (resolvedDuration === null) {
      return;
    }
    if (remainingRef.current <= 0) {
      onClose(toast.id);
      return;
    }
    startTimeRef.current = Date.now();
    isPausedRef.current = false;
    timerRef.current = setTimeout(() => {
      const wasFocusInside = Boolean(
        itemRef.current && itemRef.current.contains(document.activeElement)
      );
      onClose(toast.id);
      if (wasFocusInside) {
        onRestoreFocus?.();
      }
    }, remainingRef.current);
  }, [resolvedDuration, toast.id, onClose, onRestoreFocus]);

  const pauseTimer = useCallback(() => {
    if (resolvedDuration === null || isPausedRef.current) return;
    isPausedRef.current = true;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const elapsed = Date.now() - startTimeRef.current;
    remainingRef.current = Math.max(0, remainingRef.current - elapsed);
  }, [resolvedDuration]);

  const resumeTimer = useCallback(() => {
    if (resolvedDuration === null || !isPausedRef.current) return;
    if (!isHoveredRef.current && !isFocusedRef.current) {
      startTimer();
    }
  }, [resolvedDuration, startTimer]);

  useEffect(() => {
    if (resolvedDuration === null) {
      return;
    }
    remainingRef.current = resolvedDuration;
    startTimer();
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [resolvedDuration, startTimer]);

  useEffect(() => {
    const handleDocumentKeyDownCapture = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const itemEl = itemRef.current;
      if (!itemEl) return;

      const targetNode = e.target as Node | null;
      if (targetNode && itemEl.contains(targetNode)) {
        // Let ToastItem's React onKeyDown handle events dispatched inside the toast subtree
        return;
      }

      const hasFocusInside =
        isFocusedRef.current || Boolean(document.activeElement && itemEl.contains(document.activeElement));
      if (isHoveredRef.current || hasFocusInside) {
        e.preventDefault();
        e.stopPropagation();
        dismissFromInteraction();
      }
    };

    document.addEventListener('keydown', handleDocumentKeyDownCapture, true);
    return () => {
      document.removeEventListener('keydown', handleDocumentKeyDownCapture, true);
    };
  }, [dismissFromInteraction]);

  const handleMouseEnter = () => {
    isHoveredRef.current = true;
    pauseTimer();
  };

  const handleMouseLeave = () => {
    isHoveredRef.current = false;
    resumeTimer();
  };

  const handleFocus = () => {
    isFocusedRef.current = true;
    pauseTimer();
  };

  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) {
      return;
    }
    isFocusedRef.current = false;
    resumeTimer();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      dismissFromInteraction();
    }
  };

  return (
    <div
      ref={itemRef}
      data-toast-item
      tabIndex={-1}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      className="px-4 py-3 shadow-lg flex flex-col gap-2 min-w-[300px] max-w-[420px] pointer-events-auto focus:outline-none"
      style={{
        backgroundColor: `var(--toast-${toast.type}-bg)`,
        color: `var(--toast-${toast.type}-text)`,
        borderRadius: 'var(--toast-radius)',
      }}
    >
      <div className="flex justify-between items-center w-full gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {toast.type === 'error' && (
            <svg
              aria-hidden="true"
              className="w-5 h-5 shrink-0 opacity-90"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <circle cx="12" cy="12" r="10" strokeWidth={2} />
              <line strokeLinecap="round" strokeWidth={2} x1="12" x2="12" y1="8" y2="12" />
              <line strokeLinecap="round" strokeWidth={2} x1="12" x2="12.01" y1="16" y2="16" />
            </svg>
          )}
          <span
            role={toast.type === 'error' ? 'alert' : 'status'}
            className="text-sm font-medium leading-snug"
          >
            {toast.message}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {toast.action && (
            <Button
              type="button"
              variant="inverse"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                const wasFocusInside = Boolean(
                  itemRef.current && itemRef.current.contains(document.activeElement)
                );
                toast.action?.onClick();
                onClose(toast.id);
                if (
                  wasFocusInside &&
                  ((itemRef.current && itemRef.current.contains(document.activeElement)) ||
                    document.activeElement === document.body)
                ) {
                  onRestoreFocus?.();
                }
              }}
              className="shrink-0 px-2.5"
            >
              {toast.action.label}
            </Button>
          )}
          {toast.type !== 'confirm' && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                dismissFromInteraction();
              }}
              className="ml-1 text-inherit hover:bg-[var(--toast-close-hover-bg)] focus-visible:ring-[var(--toast-action-bg,#ffffff)] focus-visible:ring-offset-1 focus-visible:ring-offset-transparent"
              style={{
                color: 'inherit',
                '--btn-ghost-hover-bg': 'var(--toast-close-hover-bg)',
              } as React.CSSProperties}
              aria-label="Close notification"
            >
              &times;
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export const ToastProvider = ({
  children,
  isFallback = false,
}: {
  children: ReactNode;
  isFallback?: boolean;
}) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const priorFocusRef = useRef<HTMLElement | null>(null);
  const lastExternalFocusRef = useRef<HTMLElement | null>(null);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const restorePriorFocus = useCallback(() => {
    const candidate = isElementFocusable(priorFocusRef.current)
      ? priorFocusRef.current
      : isElementFocusable(lastExternalFocusRef.current)
        ? lastExternalFocusRef.current
        : null;

    const modalDialogs = Array.from(
      document.querySelectorAll<HTMLElement>('[aria-modal="true"]')
    );
    const topmostModal =
      modalDialogs.length > 0 ? modalDialogs[modalDialogs.length - 1] : null;

    if (topmostModal) {
      if (candidate && topmostModal.contains(candidate)) {
        priorFocusRef.current = null;
        candidate.focus();
        return;
      }
      const modalFocusable = topmostModal.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      if (modalFocusable) {
        priorFocusRef.current = null;
        modalFocusable.focus();
        return;
      }
    }

    if (
      candidate &&
      (!containerRef.current || !containerRef.current.contains(candidate))
    ) {
      priorFocusRef.current = null;
      candidate.focus();
    }
  }, []);

  const addToast = useCallback((
    message: string,
    type: ToastType = 'info',
    onConfirm?: () => void,
    onCancel?: () => void,
    action?: ToastAction,
    duration?: number | null
  ) => {
    const id = generateSecureUUID();
    setToasts((prev) => {
      if (type === 'error' && prev.some((t) => t.type === 'error' && t.message === message)) {
        return prev;
      }
      return [...prev, { id, message, type, onConfirm, onCancel, action, duration }];
    });
  }, []);

  const confirm = useCallback((message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      const id = generateSecureUUID();
      const onConfirm = () => {
        removeToast(id);
        resolve(true);
      };
      const onCancel = () => {
        removeToast(id);
        resolve(false);
      };
      setToasts((prev) => [...prev, { id, message, type: 'confirm', onConfirm, onCancel }]);
    });
  }, [removeToast]);

  const visibleToasts = toasts.filter((t) => t.type !== 'confirm');
  const hasVisibleToasts = visibleToasts.length > 0;
  const isPreviewFrame = useSyncExternalStore(
    subscribeToPreviewSearch,
    getPreviewSearchSnapshot,
    getServerPreviewSearchSnapshot
  );
  const shouldExposeLandmark = (!isFallback && !isPreviewFrame) || hasVisibleToasts;
  const landmarkLabel = isPreviewFrame ? 'Preview Notifications' : 'Notifications';

  useEffect(() => {
    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (containerRef.current && containerRef.current.contains(target)) {
        if (
          e.relatedTarget instanceof HTMLElement &&
          !containerRef.current.contains(e.relatedTarget)
        ) {
          lastExternalFocusRef.current = e.relatedTarget;
        }
        return;
      }
      if (target !== document.body && target !== document.documentElement) {
        lastExternalFocusRef.current = target;
      }
    };

    document.addEventListener('focusin', handleFocusIn);
    return () => {
      document.removeEventListener('focusin', handleFocusIn);
    };
  }, []);

  useEffect(() => {
    const handleShortcutKeyDown = (e: KeyboardEvent) => {
      const isAltT =
        e.altKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        (e.key.toLowerCase() === 't' || e.code === 'KeyT');
      const isF6 = e.key === 'F6' && !e.ctrlKey && !e.metaKey && !e.altKey;

      if (!isAltT && !isF6) return;
      if (!hasVisibleToasts) return;

      const container = containerRef.current;
      if (!container) return;

      const activeEl =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;

      if (activeEl && container.contains(activeEl)) {
        e.preventDefault();
        restorePriorFocus();
        return;
      }

      const firstControl =
        container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
        container.querySelector<HTMLElement>('[data-toast-item]');
      if (!firstControl) return;

      e.preventDefault();
      if (activeEl && activeEl !== document.body && activeEl !== document.documentElement) {
        priorFocusRef.current = activeEl;
        lastExternalFocusRef.current = activeEl;
      }
      firstControl.focus();
    };

    document.addEventListener('keydown', handleShortcutKeyDown);
    return () => {
      document.removeEventListener('keydown', handleShortcutKeyDown);
    };
  }, [hasVisibleToasts, restorePriorFocus]);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast, confirm }}>
      {children}
      {toasts.filter(t => t.type === 'confirm').map(toast => (
        <Dialog
          key={toast.id}
          isOpen={true}
          onClose={() => toast.onCancel?.()}
          role="alertdialog"
          title="Confirm Action"
          description={toast.message}
        >
          <div className="flex justify-end gap-2 mt-4">
            <Button
              variant="outline"
              onClick={toast.onCancel}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={toast.onConfirm}
            >
              Confirm
            </Button>
          </div>
        </Dialog>
      ))}
      <div
        ref={containerRef}
        data-toast-container
        role={shouldExposeLandmark ? 'region' : undefined}
        aria-label={shouldExposeLandmark ? landmarkLabel : undefined}
        className="fixed top-4 right-4 z-[60] flex flex-col items-end gap-2 pointer-events-none"
      >
        {hasVisibleToasts && (
          <div
            data-toast-shortcut-hint
            className="bg-neutral-900 text-xs px-2.5 py-1 rounded-full text-white font-medium inline-flex items-center gap-1.5 self-end shadow-sm border border-neutral-700 pointer-events-none"
          >
            <svg
              aria-hidden="true"
              className="w-3 h-3 text-neutral-200 shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
              />
            </svg>
            <span>Notifications · Alt+T</span>
          </div>
        )}
        <div
          aria-live="assertive"
          className="flex flex-col items-end gap-2 pointer-events-none"
        >
          {toasts.filter(t => t.type === 'error').map((toast) => (
            <ToastItem
              key={toast.id}
              toast={toast}
              onClose={removeToast}
              onRestoreFocus={restorePriorFocus}
            />
          ))}
        </div>
        <div
          aria-live="polite"
          className="flex flex-col items-end gap-2 pointer-events-none"
        >
          {toasts.filter(t => t.type !== 'error' && t.type !== 'confirm').map((toast) => (
            <ToastItem
              key={toast.id}
              toast={toast}
              onClose={removeToast}
              onRestoreFocus={restorePriorFocus}
            />
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

export const useOptionalToast = (): ToastContextValue | null => {
  return useContext(ToastContext);
};

export const EnsureToastProvider = ({ children }: { children: ReactNode }) => {
  const existing = useContext(ToastContext);
  if (existing) {
    return <>{children}</>;
  }
  return <ToastProvider isFallback>{children}</ToastProvider>;
};
