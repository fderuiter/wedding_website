"use client";
import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";

export type ToastType = "success" | "error" | "info" | "confirm";

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  onConfirm?: () => void;
  onCancel?: () => void;
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (message: string, type?: ToastType) => void;
  removeToast: (id: string) => void;
  confirm: (message: string) => Promise<boolean>;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((message: string, type: ToastType = "info", onConfirm?: () => void, onCancel?: () => void) => {
    const id = Date.now().toString() + Math.random().toString();
    setToasts((prev) => [...prev, { id, message, type, onConfirm, onCancel }]);
    if (type !== "confirm") {
      setTimeout(() => {
        removeToast(id);
      }, 5000);
    }
  }, [removeToast]);

  const confirm = useCallback((message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      const id = Date.now().toString() + Math.random().toString();
      const onConfirm = () => {
        resolve(true);
        removeToast(id);
      };
      const onCancel = () => {
        resolve(false);
        removeToast(id);
      };
      setToasts((prev) => [...prev, { id, message, type: "confirm", onConfirm, onCancel }]);
    });
  }, [removeToast]);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast, confirm }}>
      {children}
      <div 
        aria-live="polite" 
        aria-atomic="true"
        className="fixed top-4 right-4 z-50 flex flex-col gap-2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`px-4 py-3 rounded shadow-lg flex flex-col gap-2 min-w-[300px] ${
              toast.type === 'success' ? 'bg-green-600 text-white' :
              toast.type === 'error' ? 'bg-red-600 text-white' :
              toast.type === 'confirm' ? 'bg-gray-800 text-white' :
              'bg-blue-600 text-white'
            }`}
          >
            <div className="flex justify-between items-center w-full">
              <span>{toast.message}</span>
              {toast.type !== 'confirm' && (
                <button 
                  onClick={() => removeToast(toast.id)} 
                  className="ml-4 text-white opacity-80 hover:opacity-100 focus:outline-none"
                  aria-label="Close notification"
                >
                  &times;
                </button>
              )}
            </div>
            {toast.type === 'confirm' && (
              <div className="flex justify-end gap-2 mt-2">
                <button 
                  onClick={toast.onCancel} 
                  className="px-3 py-1 bg-gray-600 rounded text-sm hover:bg-gray-500 focus:outline-none focus:ring-2 focus:ring-white"
                >
                  Cancel
                </button>
                <button 
                  onClick={toast.onConfirm} 
                  className="px-3 py-1 bg-red-600 rounded text-sm hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-white"
                >
                  Confirm
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
};
