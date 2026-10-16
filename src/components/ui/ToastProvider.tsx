'use client';
import { createContext, useContext, useState, useCallback, ReactNode, useRef, useEffect } from 'react';
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
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (message: string, type?: ToastType, onConfirm?: () => void, onCancel?: () => void, action?: ToastAction) => void;
  removeToast: (id: string) => void;
  confirm: (message: string) => Promise<boolean>;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((
    message: string,
    type: ToastType = 'info',
    onConfirm?: () => void,
    onCancel?: () => void,
    action?: ToastAction
  ) => {
    const id = generateSecureUUID();
    setToasts((prev) => [...prev, { id, message, type, onConfirm, onCancel, action }]);
    if (type !== 'confirm') {
      const timer = setTimeout(() => {
        timersRef.current.delete(id);
        removeToast(id);
      }, 5000);
      timersRef.current.set(id, timer);
    }
  }, [removeToast]);

  const confirm = useCallback((message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      const id = generateSecureUUID();
      const onConfirm = () => {
        resolve(true);
        removeToast(id);
      };
      const onCancel = () => {
        resolve(false);
        removeToast(id);
      };
      setToasts((prev) => [...prev, { id, message, type: 'confirm', onConfirm, onCancel }]);
    });
  }, [removeToast]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

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
        aria-live="polite" 
        aria-atomic="true"
        className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none"
      >
        {toasts.filter(t => t.type !== 'confirm').map((toast) => (
          <div
            key={toast.id}
            role={toast.type === 'error' ? 'alert' : 'status'}
            className={`px-4 py-3 rounded shadow-lg flex flex-col gap-2 min-w-[300px] pointer-events-auto ${
              toast.type === 'success' ? 'bg-green-600 text-white' :
                toast.type === 'error' ? 'bg-red-600 text-white' :
                  toast.type === 'confirm' ? 'bg-gray-800 text-white' :
                    'bg-blue-600 text-white'
            }`}
          >
            <div className="flex justify-between items-center w-full gap-2">
              <span>{toast.message}</span>
              <div className="flex items-center gap-2">
                {toast.action && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      toast.action?.onClick();
                      removeToast(toast.id);
                    }}
                    className="text-xs px-2.5 py-1 bg-white/20 text-white hover:bg-white/30 border-white/40 focus:ring-1 focus:ring-white"
                  >
                    {toast.action.label}
                  </Button>
                )}
                {toast.type !== 'confirm' && (
                  <Button 
                    variant="ghost"
                    size="sm"
                    onClick={() => removeToast(toast.id)} 
                    className="ml-2 text-white hover:text-white dark:hover:text-white hover:bg-white/20 dark:hover:bg-white/20"
                    aria-label="Close notification"
                  >
                    &times;
                  </Button>
                )}
              </div>
            </div>
          </div>
        ))}
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

