'use client';
import React, { createContext, useContext, useId } from 'react';

export function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(' ');
}

type FormItemContextValue = {
  id: string;
  state: 'error' | 'success' | 'warning' | 'default';
  messageId: string;
};

const FormItemContext = createContext<FormItemContextValue | null>(null);

export const FormGroup = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { state?: 'error' | 'success' | 'warning' | 'default' }
>(({ className, state = 'default', ...props }, ref) => {
  const id = useId();
  const messageId = `${id}-message`;

  return (
    <FormItemContext.Provider value={{ id, state, messageId }}>
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
        state === 'error' ? 'text-red-600 dark:text-red-400' : 
          state === 'success' ? 'text-green-600 dark:text-green-400' : 
            state === 'warning' ? 'text-yellow-600 dark:text-yellow-400' : 
              'text-gray-900 dark:text-gray-100',
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
>(({ className, type = 'text', ...props }, ref) => {
  const { id, state, messageId } = useFormItem();

  const stateStyles = {
    default: 'border-gray-300 dark:border-gray-600 focus-visible:ring-primary',
    error: 'border-red-500 focus-visible:ring-red-500 dark:border-red-500 dark:focus-visible:ring-red-500',
    success: 'border-green-500 focus-visible:ring-green-500 dark:border-green-500 dark:focus-visible:ring-green-500',
    warning: 'border-yellow-500 focus-visible:ring-yellow-500 dark:border-yellow-500 dark:focus-visible:ring-yellow-500',
  };

  return (
    <input
      type={type}
      id={id}
      className={cn(
        'flex h-10 w-full rounded-md border bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        stateStyles[state],
        className
      )}
      ref={ref}
      aria-invalid={state === 'error' ? 'true' : 'false'}
      aria-describedby={messageId}
      {...props}
    />
  );
});
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => {
  const { id, state, messageId } = useFormItem();

  const stateStyles = {
    default: 'border-gray-300 dark:border-gray-600 focus-visible:ring-primary',
    error: 'border-red-500 focus-visible:ring-red-500',
    success: 'border-green-500 focus-visible:ring-green-500',
    warning: 'border-yellow-500 focus-visible:ring-yellow-500',
  };

  return (
    <textarea
      id={id}
      className={cn(
        'flex min-h-[80px] w-full rounded-md border bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        stateStyles[state],
        className
      )}
      ref={ref}
      aria-invalid={state === 'error' ? 'true' : 'false'}
      aria-describedby={messageId}
      {...props}
    />
  );
});
Textarea.displayName = 'Textarea';

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => {
  const { id, state, messageId } = useFormItem();

  const stateStyles = {
    default: 'border-gray-300 dark:border-gray-600 focus-visible:ring-primary',
    error: 'border-red-500 focus-visible:ring-red-500',
    success: 'border-green-500 focus-visible:ring-green-500',
    warning: 'border-yellow-500 focus-visible:ring-yellow-500',
  };

  return (
    <select
      id={id}
      className={cn(
        'flex h-10 w-full rounded-md border bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        stateStyles[state],
        className
      )}
      ref={ref}
      aria-invalid={state === 'error' ? 'true' : 'false'}
      aria-describedby={messageId}
      {...props}
    />
  );
});
Select.displayName = 'Select';

export const Checkbox = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => {
  const { id, state, messageId } = useFormItem();

  const stateStyles = {
    default: 'border-gray-300 dark:border-gray-600 text-primary focus-visible:ring-primary',
    error: 'border-red-500 text-red-500 focus-visible:ring-red-500',
    success: 'border-green-500 text-green-500 focus-visible:ring-green-500',
    warning: 'border-yellow-500 text-yellow-500 focus-visible:ring-yellow-500',
  };

  return (
    <input
      type="checkbox"
      id={id}
      className={cn(
        'h-4 w-4 rounded border bg-white dark:bg-gray-700 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        stateStyles[state],
        className
      )}
      ref={ref}
      aria-invalid={state === 'error' ? 'true' : 'false'}
      aria-describedby={messageId}
      {...props}
    />
  );
});
Checkbox.displayName = 'Checkbox';

export const FormMessage = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement> & { children?: React.ReactNode }
>(({ className, children, ...props }, ref) => {
  const { state, messageId } = useFormItem();

  if (!children) {
    return null;
  }

  const stateStyles = {
    default: 'text-gray-500 dark:text-gray-400',
    error: 'text-red-500 dark:text-red-400 font-medium',
    success: 'text-green-500 dark:text-green-400 font-medium',
    warning: 'text-yellow-600 dark:text-yellow-500 font-medium',
  };

  return (
    <p
      ref={ref}
      id={messageId}
      className={cn('text-xs mt-1', stateStyles[state], className)}
      {...props}
    >
      {children}
    </p>
  );
});
FormMessage.displayName = 'FormMessage';
