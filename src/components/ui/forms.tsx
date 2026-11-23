'use client';
import React, { createContext, useContext, useId } from 'react';
import { cn } from '@/utils/cn';

type FormFeedbackState = 'error' | 'success' | 'warning' | 'default';

type RegisteredControl = {
  key: string;
  customId?: string;
};

type FormItemContextValue = {
  id: string;
  controlId: string;
  controls: RegisteredControl[];
  state: FormFeedbackState;
  messageId: string;
  hasMessage: boolean;
  describedByIds: string[];
  registerControl: (key: string, customId?: string) => void;
  unregisterControl: (key: string) => void;
  registerMessage: (id: string, active: boolean) => void;
};

const FormItemContext = createContext<FormItemContextValue | null>(null);

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

function mergeAriaDescribedBy(
  contextIds: string[] | undefined,
  propDescribedBy: string | undefined
): string | undefined {
  const tokens: string[] = [];
  if (propDescribedBy) {
    for (const token of propDescribedBy.split(/\s+/)) {
      if (token && !tokens.includes(token)) {
        tokens.push(token);
      }
    }
  }
  if (contextIds) {
    for (const token of contextIds) {
      if (token && !tokens.includes(token)) {
        tokens.push(token);
      }
    }
  }
  return tokens.length > 0 ? tokens.join(' ') : undefined;
}

export function FormGroup({
  className,
  state = 'default',
  ref,
  ...props
}: React.ComponentPropsWithRef<'div'> & { state?: FormFeedbackState }) {
  const id = useId();
  const messageId = `${id}-message`;

  const [controls, setControls] = React.useState<RegisteredControl[]>([]);
  const [describedByIds, setDescribedByIds] = React.useState<string[]>([]);

  const registerControl = React.useCallback((key: string, customId?: string) => {
    setControls((prev) => {
      const existingIdx = prev.findIndex((item) => item.key === key);
      if (existingIdx >= 0) {
        if (prev[existingIdx].customId === customId) return prev;
        const next = [...prev];
        next[existingIdx] = { key, customId };
        return next;
      }
      return [...prev, { key, customId }];
    });
  }, []);

  const unregisterControl = React.useCallback((key: string) => {
    setControls((prev) => {
      if (!prev.some((item) => item.key === key)) return prev;
      return prev.filter((item) => item.key !== key);
    });
  }, []);

  const registerMessage = React.useCallback((msgId: string, active: boolean) => {
    setDescribedByIds((prev) => {
      const exists = prev.includes(msgId);
      if (active && !exists) return [...prev, msgId];
      if (!active && exists) return prev.filter((item) => item !== msgId);
      return prev;
    });
  }, []);

  const primaryControl = controls[0];
  const controlId = primaryControl ? (primaryControl.customId || id) : id;
  const hasMessage = describedByIds.length > 0;

  return (
    <FormItemContext.Provider
      value={{
        id,
        controlId,
        controls,
        state,
        messageId,
        hasMessage,
        describedByIds,
        registerControl,
        unregisterControl,
        registerMessage,
      }}
    >
      <div ref={ref} className={cn('space-y-1', className)} {...props} />
    </FormItemContext.Provider>
  );
}

const useFormItem = () => {
  const context = useContext(FormItemContext);
  if (!context) {
    throw new Error('useFormItem must be used within a FormGroup');
  }
  return context;
};

function useFormControl({
  propId,
  propState,
  propAriaDescribedBy,
  propAriaInvalid,
  requireGroup,
}: {
  propId?: string;
  propState?: FormFeedbackState;
  propAriaDescribedBy?: string;
  propAriaInvalid?: React.AriaAttributes['aria-invalid'];
  requireGroup: boolean;
}) {
  const context = useContext(FormItemContext);
  if (requireGroup && !context) {
    throw new Error('useFormItem must be used within a FormGroup');
  }
  const controlKey = useId();
  const registerControl = context?.registerControl;
  const unregisterControl = context?.unregisterControl;

  useIsomorphicLayoutEffect(() => {
    if (!registerControl) return;
    registerControl(controlKey, propId);
  }, [controlKey, propId, registerControl]);

  useIsomorphicLayoutEffect(() => {
    if (!unregisterControl) return;
    return () => {
      unregisterControl(controlKey);
    };
  }, [controlKey, unregisterControl]);

  const isPrimary =
    !context ||
    context.controls.length === 0 ||
    context.controls[0]?.key === controlKey;

  const id = propId || (context && isPrimary ? context.id : controlKey);
  const state: FormFeedbackState = propState || context?.state || 'default';
  const ariaDescribedBy = mergeAriaDescribedBy(context?.describedByIds, propAriaDescribedBy);
  const ariaInvalid: React.AriaAttributes['aria-invalid'] =
    propAriaInvalid !== undefined ? propAriaInvalid : (state === 'error' ? 'true' : 'false');

  return {
    id,
    state,
    ariaDescribedBy,
    ariaInvalid,
  };
}

export function Label({
  className,
  htmlFor: propHtmlFor,
  ref,
  ...props
}: React.ComponentPropsWithRef<'label'>) {
  const { controlId, state } = useFormItem();

  return (
    <label
      ref={ref}
      {...props}
      htmlFor={propHtmlFor || controlId}
      className={cn(
        'block text-sm font-semibold leading-none',
        state === 'error' ? 'text-[var(--form-error-text,var(--color-error-text,#dc2626))]' :
          state === 'success' ? 'text-[var(--form-success-text,#16a34a)]' :
            state === 'warning' ? 'text-[var(--form-warning-text,#ca8a04)]' :
              'text-[var(--form-label-text,var(--color-primary-text,#111827))]',
        className
      )}
    />
  );
}

export interface InputProps extends React.ComponentPropsWithRef<'input'> {
  state?: FormFeedbackState;
  sizeVariant?: 'default' | 'compact';
}

export function Input({
  className,
  type = 'text',
  style,
  state: propState,
  sizeVariant = 'default',
  id: propId,
  'aria-describedby': propAriaDescribedBy,
  'aria-invalid': propAriaInvalid,
  ref,
  ...props
}: InputProps) {
  const { id, state, ariaDescribedBy, ariaInvalid } = useFormControl({
    propId,
    propState,
    propAriaDescribedBy,
    propAriaInvalid,
    requireGroup: false,
  });

  const sizeStyles = {
    default: 'h-10 px-3 py-2 text-sm',
    compact: 'h-7 px-2 py-1 text-xs',
  };

  const stateStyles = {
    default: 'border-[var(--input-border,var(--color-surface-border,#d1d5db))] focus-visible:ring-[var(--input-focus-ring,var(--color-focus-ring,var(--color-primary,#B91C1C)))]',
    error: 'border-[var(--input-error-border,var(--color-error-text,#ef4444))] focus-visible:ring-[var(--input-error-focus-ring,var(--color-error-text,#ef4444))]',
    success: 'border-[var(--input-success-border,#22c55e)] focus-visible:ring-[var(--input-success-focus-ring,#22c55e)]',
    warning: 'border-[var(--input-warning-border,#f59e0b)] focus-visible:ring-[var(--input-warning-focus-ring,#f59e0b)]',
  };

  return (
    <input
      {...props}
      type={type}
      id={id}
      style={{
        borderRadius: 'var(--input-radius, 0.375rem)',
        ...style,
      }}
      className={cn(
        'flex w-full border bg-[var(--input-bg,#ffffff)] text-[var(--form-label-text,var(--color-primary-text,#111827))] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        sizeStyles[sizeVariant],
        stateStyles[state],
        className
      )}
      ref={ref}
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedBy}
    />
  );
}

export function Textarea({
  className,
  style,
  state: propState,
  id: propId,
  'aria-describedby': propAriaDescribedBy,
  'aria-invalid': propAriaInvalid,
  ref,
  ...props
}: React.ComponentPropsWithRef<'textarea'> & { state?: FormFeedbackState }) {
  const { id, state, ariaDescribedBy, ariaInvalid } = useFormControl({
    propId,
    propState,
    propAriaDescribedBy,
    propAriaInvalid,
    requireGroup: true,
  });

  const stateStyles = {
    default: 'border-[var(--input-border,var(--color-surface-border,#d1d5db))] focus-visible:ring-[var(--input-focus-ring,var(--color-focus-ring,var(--color-primary,#B91C1C)))]',
    error: 'border-[var(--input-error-border,var(--color-error-text,#ef4444))] focus-visible:ring-[var(--input-error-focus-ring,var(--color-error-text,#ef4444))]',
    success: 'border-[var(--input-success-border,#22c55e)] focus-visible:ring-[var(--input-success-focus-ring,#22c55e)]',
    warning: 'border-[var(--input-warning-border,#f59e0b)] focus-visible:ring-[var(--input-warning-focus-ring,#f59e0b)]',
  };

  return (
    <textarea
      {...props}
      id={id}
      style={{
        borderRadius: 'var(--input-radius, 0.375rem)',
        ...style,
      }}
      className={cn(
        'flex min-h-[80px] w-full border bg-[var(--input-bg,#ffffff)] px-3 py-2 text-sm text-[var(--form-label-text,var(--color-primary-text,#111827))] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        stateStyles[state],
        className
      )}
      ref={ref}
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedBy}
    />
  );
}

export function Select({
  className,
  style,
  state: propState,
  id: propId,
  'aria-describedby': propAriaDescribedBy,
  'aria-invalid': propAriaInvalid,
  ref,
  ...props
}: React.ComponentPropsWithRef<'select'> & { state?: FormFeedbackState }) {
  const { id, state, ariaDescribedBy, ariaInvalid } = useFormControl({
    propId,
    propState,
    propAriaDescribedBy,
    propAriaInvalid,
    requireGroup: true,
  });

  const stateStyles = {
    default: 'border-[var(--input-border,var(--color-surface-border,#d1d5db))] focus-visible:ring-[var(--input-focus-ring,var(--color-focus-ring,var(--color-primary,#B91C1C)))]',
    error: 'border-[var(--input-error-border,var(--color-error-text,#ef4444))] focus-visible:ring-[var(--input-error-focus-ring,var(--color-error-text,#ef4444))]',
    success: 'border-[var(--input-success-border,#22c55e)] focus-visible:ring-[var(--input-success-focus-ring,#22c55e)]',
    warning: 'border-[var(--input-warning-border,#f59e0b)] focus-visible:ring-[var(--input-warning-focus-ring,#f59e0b)]',
  };

  return (
    <select
      {...props}
      id={id}
      style={{
        borderRadius: 'var(--input-radius, 0.375rem)',
        ...style,
      }}
      className={cn(
        'flex h-10 w-full border bg-[var(--input-bg,#ffffff)] px-3 py-2 text-sm text-[var(--form-label-text,var(--color-primary-text,#111827))] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        stateStyles[state],
        className
      )}
      ref={ref}
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedBy}
    />
  );
}

export function Checkbox({
  className,
  style,
  state: propState,
  id: propId,
  'aria-describedby': propAriaDescribedBy,
  'aria-invalid': propAriaInvalid,
  ref,
  ...props
}: React.ComponentPropsWithRef<'input'> & { state?: FormFeedbackState }) {
  const { id, state, ariaDescribedBy, ariaInvalid } = useFormControl({
    propId,
    propState,
    propAriaDescribedBy,
    propAriaInvalid,
    requireGroup: true,
  });

  const stateStyles = {
    default: 'border-[var(--input-border,var(--color-surface-border,#d1d5db))] text-[var(--color-primary,#B91C1C)] focus-visible:ring-[var(--input-focus-ring,var(--color-focus-ring,var(--color-primary,#B91C1C)))]',
    error: 'border-[var(--input-error-border,var(--color-error-text,#ef4444))] text-[var(--form-error-text,var(--color-error-text,#ef4444))] focus-visible:ring-[var(--input-error-focus-ring,var(--color-error-text,#ef4444))]',
    success: 'border-[var(--input-success-border,#22c55e)] text-[var(--form-success-text,#22c55e)] focus-visible:ring-[var(--input-success-focus-ring,#22c55e)]',
    warning: 'border-[var(--input-warning-border,#f59e0b)] text-[var(--form-warning-text,#ca8a04)] focus-visible:ring-[var(--input-warning-focus-ring,#f59e0b)]',
  };

  return (
    <input
      {...props}
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
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedBy}
    />
  );
}

export function FormMessage({
  className,
  children,
  id: propId,
  role: propRole,
  'aria-live': propAriaLive,
  'aria-atomic': propAriaAtomic,
  ref,
  ...props
}: React.ComponentPropsWithRef<'p'>) {
  const { state, registerMessage } = useFormItem();
  const messageUniqueId = React.useId();
  const resolvedId = propId || `${messageUniqueId}-message`;
  const hasContent =
    children !== null &&
    children !== undefined &&
    children !== false &&
    children !== '';

  useIsomorphicLayoutEffect(() => {
    registerMessage(resolvedId, hasContent);
    return () => {
      registerMessage(resolvedId, false);
    };
  }, [resolvedId, hasContent, registerMessage]);

  const stateStyles = {
    default: 'text-[var(--form-message-text,var(--color-secondary-text,#6b7280))]',
    error: 'text-[var(--form-error-text,var(--color-error-text,#dc2626))] font-medium',
    success: 'text-[var(--form-success-text,#16a34a)] font-medium',
    warning: 'text-[var(--form-warning-text,#ca8a04)] font-medium',
  };

  const role = propRole ?? (state === 'error' ? 'alert' : 'status');
  const ariaLive = propAriaLive ?? (state === 'error' ? 'assertive' : 'polite');
  const ariaAtomic = propAriaAtomic ?? 'true';

  return (
    <p
      ref={ref}
      {...props}
      id={resolvedId}
      role={role}
      aria-live={ariaLive}
      aria-atomic={ariaAtomic}
      className={cn(
        'text-xs',
        hasContent ? 'mt-1' : 'sr-only',
        stateStyles[state],
        className
      )}
    >
      {children}
    </p>
  );
}
