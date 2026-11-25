'use client';
import React, { createContext, useContext, useId } from 'react';
import { cn } from '@/utils/cn';

type FormFeedbackState = 'error' | 'success' | 'warning' | 'default';

type RegisteredControl = {
  key: string;
  resolvedId: string;
  customId?: string;
  required?: boolean;
  hasExplicitLabel?: boolean;
};

type FormItemContextValue = {
  id: string;
  controlId: string | undefined;
  hasMultiControlCollision: boolean;
  groupLabelId: string;
  isGroup: boolean;
  asFieldset: boolean;
  controls: RegisteredControl[];
  state: FormFeedbackState;
  required: boolean;
  groupRequired: boolean;
  busy: boolean;
  messageId: string;
  hasMessage: boolean;
  describedByIds: string[];
  registerControl: (
    key: string,
    resolvedId: string,
    customId?: string,
    required?: boolean,
    hasExplicitLabel?: boolean
  ) => void;
  unregisterControl: (key: string) => void;
  registerLabel: (key: string) => void;
  unregisterLabel: (key: string) => void;
  registerMessage: (id: string, active: boolean) => void;
};

const FormItemContext = createContext<FormItemContextValue | null>(null);

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

const READONLY_CAPABLE_INPUT_TYPES = new Set([
  'text',
  'password',
  'search',
  'url',
  'tel',
  'email',
  'number',
  'date',
  'month',
  'week',
  'time',
  'datetime-local',
]);

const NAVIGATION_PASSTHROUGH_KEYS = new Set(['Tab', 'Escape']);

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

export type FormGroupProps = (
  | (React.ComponentPropsWithRef<'div'> & { as?: 'div' })
  | (React.ComponentPropsWithRef<'fieldset'> & { as: 'fieldset' })
) & {
  state?: FormFeedbackState;
  required?: boolean;
  busy?: boolean;
  group?: boolean;
};

export function FormGroup({
  className,
  state = 'default',
  required: groupRequired = false,
  busy = false,
  group = false,
  as = 'div',
  ref,
  ...props
}: FormGroupProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const groupLabelId = `${id}-label`;
  const asFieldset = as === 'fieldset';
  const isGroup = Boolean(group) || asFieldset;

  const [controls, setControls] = React.useState<RegisteredControl[]>([]);
  const [unkeyedLabelKeys, setUnkeyedLabelKeys] = React.useState<string[]>([]);
  const [describedByIds, setDescribedByIds] = React.useState<string[]>([]);

  const registerControl = React.useCallback(
    (
      key: string,
      resolvedId: string,
      customId?: string,
      controlRequired?: boolean,
      hasExplicitLabel?: boolean
    ) => {
      setControls((prev) => {
        const existingIdx = prev.findIndex((item) => item.key === key);
        const normalizedRequired = Boolean(controlRequired);
        const normalizedExplicitLabel = Boolean(hasExplicitLabel);
        if (existingIdx >= 0) {
          if (
            prev[existingIdx].resolvedId === resolvedId &&
            prev[existingIdx].customId === customId &&
            Boolean(prev[existingIdx].required) === normalizedRequired &&
            Boolean(prev[existingIdx].hasExplicitLabel) === normalizedExplicitLabel
          ) {
            return prev;
          }
          const next = [...prev];
          next[existingIdx] = {
            key,
            resolvedId,
            customId,
            required: normalizedRequired,
            hasExplicitLabel: normalizedExplicitLabel,
          };
          return next;
        }
        return [
          ...prev,
          {
            key,
            resolvedId,
            customId,
            required: normalizedRequired,
            hasExplicitLabel: normalizedExplicitLabel,
          },
        ];
      });
    },
    []
  );

  const unregisterControl = React.useCallback((key: string) => {
    setControls((prev) => {
      if (!prev.some((item) => item.key === key)) return prev;
      return prev.filter((item) => item.key !== key);
    });
  }, []);

  const registerLabel = React.useCallback((key: string) => {
    setUnkeyedLabelKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
  }, []);

  const unregisterLabel = React.useCallback((key: string) => {
    setUnkeyedLabelKeys((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : prev));
  }, []);

  const registerMessage = React.useCallback((msgId: string, active: boolean) => {
    setDescribedByIds((prev) => {
      const exists = prev.includes(msgId);
      if (active && !exists) return [...prev, msgId];
      if (!active && exists) return prev.filter((item) => item !== msgId);
      return prev;
    });
  }, []);

  const unlabelledControls = controls.filter((item) => !item.hasExplicitLabel);
  const hasMultiControlCollision =
    !isGroup && (unlabelledControls.length > 1 || unkeyedLabelKeys.length > 1);
  const primaryControl = hasMultiControlCollision
    ? undefined
    : (unlabelledControls[0] ?? (controls.length === 1 ? controls[0] : undefined));
  const controlId = hasMultiControlCollision
    ? undefined
    : primaryControl
      ? (primaryControl.customId || primaryControl.resolvedId)
      : controls.length === 0
        ? id
        : undefined;
  const hasMessage = describedByIds.length > 0;
  const isRequired = Boolean(groupRequired || controls.some((item) => item.required));

  const describedByValue = describedByIds.length > 0 ? describedByIds.join(' ') : undefined;

  return (
    <FormItemContext.Provider
      value={{
        id,
        controlId,
        hasMultiControlCollision,
        groupLabelId,
        isGroup,
        asFieldset,
        controls,
        state,
        required: isRequired,
        groupRequired: Boolean(groupRequired),
        busy: Boolean(busy),
        messageId,
        hasMessage,
        describedByIds,
        registerControl,
        unregisterControl,
        registerLabel,
        unregisterLabel,
        registerMessage,
      }}
    >
      {asFieldset ? (
        <fieldset
          ref={ref as React.Ref<HTMLFieldSetElement>}
          aria-describedby={
            (props as React.ComponentPropsWithoutRef<'fieldset'>)['aria-describedby'] ??
            describedByValue
          }
          className={cn('space-y-1 min-w-0 border-0 p-0 m-0', className)}
          {...(props as React.ComponentPropsWithoutRef<'fieldset'>)}
        />
      ) : (
        <div
          ref={ref as React.Ref<HTMLDivElement>}
          role={(props as React.ComponentPropsWithoutRef<'div'>).role ?? (isGroup ? 'group' : undefined)}
          aria-labelledby={
            (props as React.ComponentPropsWithoutRef<'div'>)['aria-labelledby'] ??
            (isGroup ? groupLabelId : undefined)
          }
          aria-describedby={
            (props as React.ComponentPropsWithoutRef<'div'>)['aria-describedby'] ??
            (isGroup ? describedByValue : undefined)
          }
          className={cn('space-y-1', className)}
          {...(props as React.ComponentPropsWithoutRef<'div'>)}
        />
      )}
    </FormItemContext.Provider>
  );
}

const INVALID_CONTROL_SELECTOR =
  'input[aria-invalid="true"]:not([disabled]):not([type="hidden"]), select[aria-invalid="true"]:not([disabled]), textarea[aria-invalid="true"]:not([disabled]), [role="combobox"][aria-invalid="true"]:not([aria-disabled="true"]), [aria-invalid="true"][tabindex]:not([tabindex="-1"]):not([disabled])';

export function focusFirstInvalidControl(
  root?: ParentNode | null
): HTMLElement | null {
  const scope = root ?? (typeof document !== 'undefined' ? document : null);
  if (!scope) return null;
  const candidates = scope.querySelectorAll<HTMLElement>(INVALID_CONTROL_SELECTOR);
  for (const el of Array.from(candidates)) {
    if (el.closest('[aria-hidden="true"], .hidden, [hidden]')) {
      continue;
    }
    el.focus();
    return el;
  }
  return null;
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
  propRequired,
  propAriaRequired,
  propBusy,
  propAriaBusy,
  propAriaDescribedBy,
  propAriaInvalid,
  hasExplicitLabel = false,
  requireGroup,
}: {
  propId?: string;
  propState?: FormFeedbackState;
  propRequired?: boolean;
  propAriaRequired?: React.AriaAttributes['aria-required'];
  propBusy?: boolean;
  propAriaBusy?: React.AriaAttributes['aria-busy'];
  propAriaDescribedBy?: string;
  propAriaInvalid?: React.AriaAttributes['aria-invalid'];
  hasExplicitLabel?: boolean;
  requireGroup: boolean;
}) {
  const context = useContext(FormItemContext);
  if (requireGroup && !context) {
    throw new Error('useFormItem must be used within a FormGroup');
  }
  const controlKey = useId();
  const registerControl = context?.registerControl;
  const unregisterControl = context?.unregisterControl;

  const isPrimary =
    !context ||
    context.controls.length === 0 ||
    context.controls[0]?.key === controlKey;

  const id = propId || (context && isPrimary ? context.id : controlKey);

  useIsomorphicLayoutEffect(() => {
    if (!registerControl) return;
    registerControl(controlKey, id, propId, Boolean(propRequired), Boolean(hasExplicitLabel));
  }, [controlKey, id, propId, propRequired, hasExplicitLabel, registerControl]);

  useIsomorphicLayoutEffect(() => {
    if (!unregisterControl) return;
    return () => {
      unregisterControl(controlKey);
    };
  }, [controlKey, unregisterControl]);
  const state: FormFeedbackState = propState || context?.state || 'default';
  const isRequired = propRequired !== undefined ? propRequired : Boolean(context?.groupRequired);
  const ariaRequired: React.AriaAttributes['aria-required'] =
    propAriaRequired !== undefined
      ? propAriaRequired
      : isRequired
        ? 'true'
        : undefined;
  const isBusy = propBusy !== undefined ? propBusy : Boolean(context?.busy);
  const ariaBusy: React.AriaAttributes['aria-busy'] =
    propAriaBusy !== undefined ? propAriaBusy : (isBusy ? true : undefined);
  const ariaDescribedBy = mergeAriaDescribedBy(context?.describedByIds, propAriaDescribedBy);
  const ariaInvalid: React.AriaAttributes['aria-invalid'] =
    propAriaInvalid !== undefined ? propAriaInvalid : (state === 'error' ? 'true' : 'false');

  return {
    id,
    state,
    isRequired,
    ariaRequired,
    isBusy,
    ariaBusy,
    ariaDescribedBy,
    ariaInvalid,
  };
}

export function Label({
  className,
  id: propId,
  htmlFor: propHtmlFor,
  required: propRequired,
  hideRequiredIndicator = false,
  children,
  ref,
  ...props
}: React.ComponentPropsWithRef<'label'> & {
  required?: boolean;
  hideRequiredIndicator?: boolean;
}) {
  const {
    controlId,
    hasMultiControlCollision,
    groupLabelId,
    isGroup,
    asFieldset,
    state,
    required: contextRequired,
    groupRequired,
    registerLabel,
    unregisterLabel,
  } = useFormItem();
  const labelKey = useId();
  const isUnkeyedControlLabel = !isGroup && !propHtmlFor;

  useIsomorphicLayoutEffect(() => {
    if (!isUnkeyedControlLabel) return;
    registerLabel(labelKey);
    return () => {
      unregisterLabel(labelKey);
    };
  }, [isUnkeyedControlLabel, labelKey, registerLabel, unregisterLabel]);

  const isRequired = propRequired !== undefined ? propRequired : contextRequired;
  const showIndicator =
    !hideRequiredIndicator &&
    (propRequired !== undefined ? propRequired : groupRequired);

  const labelClasses = cn(
    'block text-sm font-semibold leading-none',
    state === 'error' ? 'text-[var(--form-error-text,var(--color-error-text,#dc2626))]' :
      state === 'success' ? 'text-[var(--form-success-text,var(--color-status-success-text,#166534))]' :
        state === 'warning' ? 'text-[var(--form-warning-text,var(--color-warning-text,#78350f))]' :
          'text-[var(--form-label-text,var(--color-primary-text,#111827))]',
    className
  );

  const content = (
    <>
      {children}
      {showIndicator && (
        <span
          aria-hidden="true"
          className="ml-0.5 text-[var(--form-error-text,var(--color-error-text,#dc2626))]"
        >
          *
        </span>
      )}
    </>
  );

  if (asFieldset && !propHtmlFor) {
    const { form: _form, ...legendProps } = props;
    return (
      <legend
        ref={ref as unknown as React.Ref<HTMLLegendElement>}
        {...(legendProps as React.ComponentPropsWithoutRef<'legend'>)}
        id={propId || groupLabelId}
        data-required={isRequired ? 'true' : undefined}
        className={cn('p-0', labelClasses)}
      >
        {content}
      </legend>
    );
  }

  const resolvedHtmlFor =
    propHtmlFor ?? (isGroup || hasMultiControlCollision ? undefined : controlId);

  return (
    <label
      ref={ref}
      {...props}
      id={propId || (isGroup ? groupLabelId : undefined)}
      htmlFor={resolvedHtmlFor}
      data-required={isRequired ? 'true' : undefined}
      className={labelClasses}
    >
      {content}
    </label>
  );
}

export interface InputProps extends React.ComponentPropsWithRef<'input'> {
  state?: FormFeedbackState;
  sizeVariant?: 'default' | 'compact';
  busy?: boolean;
}

export function Input({
  className,
  type = 'text',
  style,
  state: propState,
  sizeVariant = 'default',
  busy: propBusy,
  required: propRequired,
  readOnly: propReadOnly,
  disabled,
  id: propId,
  onClick,
  onChange,
  onKeyDown,
  'aria-required': propAriaRequired,
  'aria-busy': propAriaBusy,
  'aria-disabled': propAriaDisabled,
  'aria-describedby': propAriaDescribedBy,
  'aria-invalid': propAriaInvalid,
  ref,
  ...props
}: InputProps) {
  const {
    id,
    state,
    isRequired,
    ariaRequired,
    isBusy,
    ariaBusy,
    ariaDescribedBy,
    ariaInvalid,
  } = useFormControl({
    propId,
    propState,
    propRequired,
    propAriaRequired,
    propBusy,
    propAriaBusy,
    propAriaDescribedBy,
    propAriaInvalid,
    hasExplicitLabel: Boolean(props['aria-label'] || props['aria-labelledby']),
    requireGroup: false,
  });

  const supportsReadOnly = READONLY_CAPABLE_INPUT_TYPES.has(type.toLowerCase());
  const busyReadOnlyLock = isBusy && !disabled && supportsReadOnly;
  const busyAriaLock = isBusy && !disabled && !supportsReadOnly;

  const sizeStyles = {
    default: 'h-10 px-3 py-2 text-sm',
    compact: 'h-7 px-2 py-1 text-xs',
  };

  const stateStyles = {
    default: 'border-[var(--input-border,var(--color-surface-border,#6b7280))] focus-visible:ring-[var(--input-focus-ring,var(--color-focus-ring,var(--color-primary,#B91C1C)))]',
    error: 'border-[var(--input-error-border,var(--color-error-text,#dc2626))] focus-visible:ring-[var(--input-error-focus-ring,var(--color-error-text,#dc2626))]',
    success: 'border-[var(--input-success-border,var(--color-status-success-text,#15803d))] focus-visible:ring-[var(--input-success-focus-ring,var(--color-status-success-text,#15803d))]',
    warning: 'border-[var(--input-warning-border,var(--color-warning-text,#b45309))] focus-visible:ring-[var(--input-warning-focus-ring,var(--color-warning-text,#b45309))]',
  };

  const handleClick = (e: React.MouseEvent<HTMLInputElement>) => {
    if (busyAriaLock) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    onClick?.(e);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (busyAriaLock) {
      e.preventDefault();
      return;
    }
    onChange?.(e);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (busyAriaLock && !NAVIGATION_PASSTHROUGH_KEYS.has(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    onKeyDown?.(e);
  };

  return (
    <input
      {...props}
      type={type}
      id={id}
      disabled={disabled}
      required={isRequired || undefined}
      readOnly={propReadOnly || busyReadOnlyLock || undefined}
      onClick={handleClick}
      onChange={onChange || busyAriaLock ? handleChange : undefined}
      onKeyDown={onKeyDown || busyAriaLock ? handleKeyDown : undefined}
      style={{
        borderRadius: 'var(--input-radius, 0.375rem)',
        ...style,
      }}
      className={cn(
        'flex w-full border bg-[var(--input-bg,#ffffff)] text-[var(--form-label-text,var(--color-primary-text,#111827))] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-busy:cursor-wait aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
        sizeStyles[sizeVariant],
        stateStyles[state],
        className
      )}
      ref={ref}
      aria-required={ariaRequired}
      aria-busy={ariaBusy}
      aria-disabled={propAriaDisabled ?? (busyAriaLock ? 'true' : undefined)}
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedBy}
    />
  );
}

export function Textarea({
  className,
  style,
  state: propState,
  busy: propBusy,
  required: propRequired,
  readOnly: propReadOnly,
  disabled,
  id: propId,
  'aria-required': propAriaRequired,
  'aria-busy': propAriaBusy,
  'aria-describedby': propAriaDescribedBy,
  'aria-invalid': propAriaInvalid,
  ref,
  ...props
}: React.ComponentPropsWithRef<'textarea'> & {
  state?: FormFeedbackState;
  busy?: boolean;
}) {
  const {
    id,
    state,
    isRequired,
    ariaRequired,
    isBusy,
    ariaBusy,
    ariaDescribedBy,
    ariaInvalid,
  } = useFormControl({
    propId,
    propState,
    propRequired,
    propAriaRequired,
    propBusy,
    propAriaBusy,
    propAriaDescribedBy,
    propAriaInvalid,
    hasExplicitLabel: Boolean(props['aria-label'] || props['aria-labelledby']),
    requireGroup: true,
  });

  const busyReadOnlyLock = isBusy && !disabled;

  const stateStyles = {
    default: 'border-[var(--input-border,var(--color-surface-border,#6b7280))] focus-visible:ring-[var(--input-focus-ring,var(--color-focus-ring,var(--color-primary,#B91C1C)))]',
    error: 'border-[var(--input-error-border,var(--color-error-text,#dc2626))] focus-visible:ring-[var(--input-error-focus-ring,var(--color-error-text,#dc2626))]',
    success: 'border-[var(--input-success-border,var(--color-status-success-text,#15803d))] focus-visible:ring-[var(--input-success-focus-ring,var(--color-status-success-text,#15803d))]',
    warning: 'border-[var(--input-warning-border,var(--color-warning-text,#b45309))] focus-visible:ring-[var(--input-warning-focus-ring,var(--color-warning-text,#b45309))]',
  };

  return (
    <textarea
      {...props}
      id={id}
      disabled={disabled}
      required={isRequired || undefined}
      readOnly={propReadOnly || busyReadOnlyLock || undefined}
      style={{
        borderRadius: 'var(--input-radius, 0.375rem)',
        ...style,
      }}
      className={cn(
        'flex min-h-[80px] w-full border bg-[var(--input-bg,#ffffff)] px-3 py-2 text-sm text-[var(--form-label-text,var(--color-primary-text,#111827))] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-busy:cursor-wait',
        stateStyles[state],
        className
      )}
      ref={ref}
      aria-required={ariaRequired}
      aria-busy={ariaBusy}
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedBy}
    />
  );
}

export function Select({
  className,
  style,
  state: propState,
  busy: propBusy,
  required: propRequired,
  disabled,
  id: propId,
  onClick,
  onMouseDown,
  onChange,
  onKeyDown,
  'aria-required': propAriaRequired,
  'aria-busy': propAriaBusy,
  'aria-disabled': propAriaDisabled,
  'aria-describedby': propAriaDescribedBy,
  'aria-invalid': propAriaInvalid,
  ref,
  ...props
}: React.ComponentPropsWithRef<'select'> & {
  state?: FormFeedbackState;
  busy?: boolean;
}) {
  const {
    id,
    state,
    isRequired,
    ariaRequired,
    isBusy,
    ariaBusy,
    ariaDescribedBy,
    ariaInvalid,
  } = useFormControl({
    propId,
    propState,
    propRequired,
    propAriaRequired,
    propBusy,
    propAriaBusy,
    propAriaDescribedBy,
    propAriaInvalid,
    hasExplicitLabel: Boolean(props['aria-label'] || props['aria-labelledby']),
    requireGroup: true,
  });

  const busyAriaLock = isBusy && !disabled;

  const stateStyles = {
    default: 'border-[var(--input-border,var(--color-surface-border,#6b7280))] focus-visible:ring-[var(--input-focus-ring,var(--color-focus-ring,var(--color-primary,#B91C1C)))]',
    error: 'border-[var(--input-error-border,var(--color-error-text,#dc2626))] focus-visible:ring-[var(--input-error-focus-ring,var(--color-error-text,#dc2626))]',
    success: 'border-[var(--input-success-border,var(--color-status-success-text,#15803d))] focus-visible:ring-[var(--input-success-focus-ring,var(--color-status-success-text,#15803d))]',
    warning: 'border-[var(--input-warning-border,var(--color-warning-text,#b45309))] focus-visible:ring-[var(--input-warning-focus-ring,var(--color-warning-text,#b45309))]',
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLSelectElement>) => {
    if (busyAriaLock) {
      e.preventDefault();
      return;
    }
    onMouseDown?.(e);
  };

  const handleClick = (e: React.MouseEvent<HTMLSelectElement>) => {
    if (busyAriaLock) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    onClick?.(e);
  };

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (busyAriaLock) {
      e.preventDefault();
      return;
    }
    onChange?.(e);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLSelectElement>) => {
    if (busyAriaLock && !NAVIGATION_PASSTHROUGH_KEYS.has(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    onKeyDown?.(e);
  };

  return (
    <select
      {...props}
      id={id}
      disabled={disabled}
      required={isRequired || undefined}
      onMouseDown={onMouseDown || busyAriaLock ? handleMouseDown : undefined}
      onClick={onClick || busyAriaLock ? handleClick : undefined}
      onChange={onChange || busyAriaLock ? handleChange : undefined}
      onKeyDown={onKeyDown || busyAriaLock ? handleKeyDown : undefined}
      style={{
        borderRadius: 'var(--input-radius, 0.375rem)',
        ...style,
      }}
      className={cn(
        'flex h-10 w-full border bg-[var(--input-bg,#ffffff)] px-3 py-2 text-sm text-[var(--form-label-text,var(--color-primary-text,#111827))] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
        stateStyles[state],
        className
      )}
      ref={ref}
      aria-required={ariaRequired}
      aria-busy={ariaBusy}
      aria-disabled={propAriaDisabled ?? (busyAriaLock ? 'true' : undefined)}
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedBy}
    />
  );
}

export function Checkbox({
  className,
  style,
  state: propState,
  busy: propBusy,
  required: propRequired,
  disabled,
  id: propId,
  onClick,
  onChange,
  onKeyDown,
  'aria-required': propAriaRequired,
  'aria-busy': propAriaBusy,
  'aria-disabled': propAriaDisabled,
  'aria-describedby': propAriaDescribedBy,
  'aria-invalid': propAriaInvalid,
  ref,
  ...props
}: React.ComponentPropsWithRef<'input'> & {
  state?: FormFeedbackState;
  busy?: boolean;
}) {
  const {
    id,
    state,
    isRequired,
    ariaRequired,
    isBusy,
    ariaBusy,
    ariaDescribedBy,
    ariaInvalid,
  } = useFormControl({
    propId,
    propState,
    propRequired,
    propAriaRequired,
    propBusy,
    propAriaBusy,
    propAriaDescribedBy,
    propAriaInvalid,
    hasExplicitLabel: Boolean(props['aria-label'] || props['aria-labelledby']),
    requireGroup: true,
  });

  const busyAriaLock = isBusy && !disabled;

  const stateStyles = {
    default: 'border-[var(--input-border,var(--color-surface-border,#6b7280))] text-[var(--color-primary,#B91C1C)] focus-visible:ring-[var(--input-focus-ring,var(--color-focus-ring,var(--color-primary,#B91C1C)))]',
    error: 'border-[var(--input-error-border,var(--color-error-text,#dc2626))] text-[var(--form-error-text,var(--color-error-text,#dc2626))] focus-visible:ring-[var(--input-error-focus-ring,var(--color-error-text,#dc2626))]',
    success: 'border-[var(--input-success-border,var(--color-status-success-text,#15803d))] text-[var(--form-success-text,var(--color-status-success-text,#166534))] focus-visible:ring-[var(--input-success-focus-ring,var(--color-status-success-text,#15803d))]',
    warning: 'border-[var(--input-warning-border,var(--color-warning-text,#b45309))] text-[var(--form-warning-text,var(--color-warning-text,#78350f))] focus-visible:ring-[var(--input-warning-focus-ring,var(--color-warning-text,#b45309))]',
  };

  const handleClick = (e: React.MouseEvent<HTMLInputElement>) => {
    if (busyAriaLock) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    onClick?.(e);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (busyAriaLock) {
      e.preventDefault();
      return;
    }
    onChange?.(e);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (busyAriaLock && !NAVIGATION_PASSTHROUGH_KEYS.has(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    onKeyDown?.(e);
  };

  return (
    <input
      {...props}
      type="checkbox"
      id={id}
      disabled={disabled}
      required={isRequired || undefined}
      onClick={onClick || busyAriaLock ? handleClick : undefined}
      onChange={onChange || busyAriaLock ? handleChange : undefined}
      onKeyDown={onKeyDown || busyAriaLock ? handleKeyDown : undefined}
      style={{
        borderRadius: 'var(--input-radius, 0.25rem)',
        ...style,
      }}
      className={cn(
        'h-4 w-4 border bg-[var(--input-bg,#ffffff)] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
        stateStyles[state],
        className
      )}
      ref={ref}
      aria-required={ariaRequired}
      aria-busy={ariaBusy}
      aria-disabled={propAriaDisabled ?? (busyAriaLock ? 'true' : undefined)}
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
    default: 'text-[var(--form-message-text,var(--color-muted-text,#4b5563))]',
    error: 'text-[var(--form-error-text,var(--color-error-text,#dc2626))] font-medium',
    success: 'text-[var(--form-success-text,var(--color-status-success-text,#166534))] font-medium',
    warning: 'text-[var(--form-warning-text,var(--color-warning-text,#78350f))] font-medium',
  };

  const suppressLiveRole = propRole === 'none' || propAriaLive === 'off';
  const role = suppressLiveRole
    ? undefined
    : (propRole ?? (state === 'error' ? 'alert' : 'status'));
  const ariaLive = suppressLiveRole
    ? undefined
    : (propAriaLive ?? (state === 'error' ? 'assertive' : 'polite'));
  const ariaAtomic = suppressLiveRole ? undefined : (propAriaAtomic ?? 'true');

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
