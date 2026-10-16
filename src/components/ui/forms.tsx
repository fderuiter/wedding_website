'use client';
import React, { createContext, useContext, useId } from 'react';
import { cn } from '@/utils/cn';

type FormItemContextValue = {
  id: string;
  state: 'error' | 'success' | 'warning' | 'default';
  messageId: string;
  hasMessage: boolean;
  registerMessage: (id: string, active: boolean) => void;
};

const FormItemContext = createContext<FormItemContextValue | null>(null);

export const FormGroup = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { state?: 'error' | 'success' | 'warning' | 'default' }
>(({ className, state = 'default', ...props }, ref) => {
  const id = useId();
  const messageId = `${id}-message`;

  const [activeMessages, setActiveMessages] = React.useState<Record<string, boolean>>({});

  const registerMessage = React.useCallback((msgId: string, active: boolean) => {
    setActiveMessages((prev) => {
      if (prev[msgId] === active) return prev;
      return { ...prev, [msgId]: active };
    });
  }, []);

  const hasMessage = Object.values(activeMessages).some(Boolean);

  return (
    <FormItemContext.Provider value={{ id, state, messageId, hasMessage, registerMessage }}>
      <div ref={ref} className={cn('space-y-1', className)} {...props} />
    </FormItemContext.Provider>
  );
});
FormGroup.displayName = 'FormGroup';

const useFormItem = () => {
  const context = useContext(FormItemContext);
  if (!context) {
    throw new Error('useFormItem must be used within a FormGroup');
  }
  return context;
};

export const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => {
  const { id, state } = useFormItem();
  
  return (
    <label
      ref={ref}
      htmlFor={id}
      className={cn(
        'block text-sm font-semibold leading-none',
        state === 'error' ? 'text-[var(--form-error-text,#dc2626)]' : 
          state === 'success' ? 'text-[var(--form-success-text,#16a34a)]' : 
            state === 'warning' ? 'text-[var(--form-warning-text,#ca8a04)]' : 
              'text-[var(--form-label-text,#111827)]',
        className
      )}
      {...props}
    />
  );
});
Label.displayName = 'Label';

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type = 'text', style, ...props }, ref) => {
  const { id, state, messageId, hasMessage } = useFormItem();

  const stateStyles = {
    default: 'border-[var(--input-border,#d1d5db)] focus-visible:ring-[var(--input-focus-ring,var(--color-primary,#B91C1C))]',
    error: 'border-[var(--input-error-border,#ef4444)] focus-visible:ring-[var(--input-error-focus-ring,#ef4444)]',
    success: 'border-[var(--input-success-border,#22c55e)] focus-visible:ring-[var(--input-success-focus-ring,#22c55e)]',
    warning: 'border-[var(--input-warning-border,#f59e0b)] focus-visible:ring-[var(--input-warning-focus-ring,#f59e0b)]',
  };

  return (
    <input
      type={type}
      id={id}
      style={{
        borderRadius: 'var(--input-radius, 0.375rem)',
        ...style,
      }}
      className={cn(
        'flex h-10 w-full border bg-[var(--input-bg,#ffffff)] px-3 py-2 text-sm text-[var(--form-label-text,#111827)] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        stateStyles[state],
        className
      )}
      ref={ref}
      aria-invalid={state === 'error' ? 'true' : 'false'}
      aria-describedby={hasMessage ? messageId : undefined}
      {...props}
    />
  );
});
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, style, ...props }, ref) => {
  const { id, state, messageId, hasMessage } = useFormItem();

  const stateStyles = {
    default: 'border-[var(--input-border,#d1d5db)] focus-visible:ring-[var(--input-focus-ring,var(--color-primary,#B91C1C))]',
    error: 'border-[var(--input-error-border,#ef4444)] focus-visible:ring-[var(--input-error-focus-ring,#ef4444)]',
    success: 'border-[var(--input-success-border,#22c55e)] focus-visible:ring-[var(--input-success-focus-ring,#22c55e)]',
    warning: 'border-[var(--input-warning-border,#f59e0b)] focus-visible:ring-[var(--input-warning-focus-ring,#f59e0b)]',
  };

  return (
    <textarea
      id={id}
      style={{
        borderRadius: 'var(--input-radius, 0.375rem)',
        ...style,
      }}
      className={cn(
        'flex min-h-[80px] w-full border bg-[var(--input-bg,#ffffff)] px-3 py-2 text-sm text-[var(--form-label-text,#111827)] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        stateStyles[state],
        className
      )}
      ref={ref}
      aria-invalid={state === 'error' ? 'true' : 'false'}
      aria-describedby={hasMessage ? messageId : undefined}
      {...props}
    />
  );
});
Textarea.displayName = 'Textarea';

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, style, ...props }, ref) => {
  const { id, state, messageId, hasMessage } = useFormItem();

  const stateStyles = {
    default: 'border-[var(--input-border,#d1d5db)] focus-visible:ring-[var(--input-focus-ring,var(--color-primary,#B91C1C))]',
    error: 'border-[var(--input-error-border,#ef4444)] focus-visible:ring-[var(--input-error-focus-ring,#ef4444)]',
    success: 'border-[var(--input-success-border,#22c55e)] focus-visible:ring-[var(--input-success-focus-ring,#22c55e)]',
    warning: 'border-[var(--input-warning-border,#f59e0b)] focus-visible:ring-[var(--input-warning-focus-ring,#f59e0b)]',
  };

  return (
    <select
      id={id}
      style={{
        borderRadius: 'var(--input-radius, 0.375rem)',
        ...style,
      }}
      className={cn(
        'flex h-10 w-full border bg-[var(--input-bg,#ffffff)] px-3 py-2 text-sm text-[var(--form-label-text,#111827)] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        stateStyles[state],
        className
      )}
      ref={ref}
      aria-invalid={state === 'error' ? 'true' : 'false'}
      aria-describedby={hasMessage ? messageId : undefined}
      {...props}
    />
  );
});
Select.displayName = 'Select';

export const Checkbox = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, style, ...props }, ref) => {
  const { id, state, messageId, hasMessage } = useFormItem();

  const stateStyles = {
    default: 'border-[var(--input-border,#d1d5db)] text-[var(--color-primary,#B91C1C)] focus-visible:ring-[var(--input-focus-ring,var(--color-primary,#B91C1C))]',
    error: 'border-[var(--input-error-border,#ef4444)] text-[var(--form-error-text,#ef4444)] focus-visible:ring-[var(--input-error-focus-ring,#ef4444)]',
    success: 'border-[var(--input-success-border,#22c55e)] text-[var(--form-success-text,#22c55e)] focus-visible:ring-[var(--input-success-focus-ring,#22c55e)]',
    warning: 'border-[var(--input-warning-border,#f59e0b)] text-[var(--form-warning-text,#ca8a04)] focus-visible:ring-[var(--input-warning-focus-ring,#f59e0b)]',
  };

  return (
    <input
      type="checkbox"
      id={id}
      style={{
        borderRadius: 'var(--input-radius, 0.25rem)',
        ...style,
      }}
      className={cn(
        'h-4 w-4 border bg-[var(--input-bg,#ffffff)] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        stateStyles[state],
        className
      )}
      ref={ref}
      aria-invalid={state === 'error' ? 'true' : 'false'}
      aria-describedby={hasMessage ? messageId : undefined}
      {...props}
    />
  );
});
Checkbox.displayName = 'Checkbox';

export const FormMessage = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement> & { children?: React.ReactNode }
>(({ className, children, ...props }, ref) => {
  const { state, messageId, registerMessage } = useFormItem();
  const messageUniqueId = React.useId();
  const hasContent = !!children;

  React.useEffect(() => {
    registerMessage(messageUniqueId, hasContent);
    return () => {
      registerMessage(messageUniqueId, false);
    };
  }, [messageUniqueId, hasContent, registerMessage]);

  const stateStyles = {
    default: 'text-[var(--form-message-text,#6b7280)]',
    error: 'text-[var(--form-error-text,#dc2626)] font-medium',
    success: 'text-[var(--form-success-text,#16a34a)] font-medium',
    warning: 'text-[var(--form-warning-text,#ca8a04)] font-medium',
  };

  const role = props.role ?? (state === 'error' ? 'alert' : 'status');
  const ariaLive = props['aria-live'] ?? (state === 'error' ? 'assertive' : 'polite');

  return (
    <p
      ref={ref}
      id={messageId}
      role={role}
      aria-live={ariaLive}
      aria-atomic="true"
      className={cn(
        'text-xs',
        hasContent ? 'mt-1' : 'sr-only',
        stateStyles[state],
        className
      )}
      {...props}
    >
      {children}
    </p>
  );
});
FormMessage.displayName = 'FormMessage';
