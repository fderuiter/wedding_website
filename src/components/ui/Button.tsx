import React from 'react';
import { cn } from '@/utils/cn';
import { Icon } from './Icon';

export interface ButtonProps extends React.ComponentPropsWithRef<'button'> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  pressed?: boolean;
  srContext?: string;
}

export function Button({
  className,
  variant = 'primary',
  size = 'md',
  pressed,
  srContext,
  style,
  disabled,
  type,
  onClick,
  onKeyDown,
  children,
  'aria-disabled': ariaDisabledProp,
  'aria-pressed': ariaPressedProp,
  ref,
  ...props
}: ButtonProps) {
  const isAriaDisabled = ariaDisabledProp === true || ariaDisabledProp === 'true';
  const isDisabled = Boolean(disabled) || isAriaDisabled;
  const resolvedAriaPressed = pressed !== undefined ? pressed : ariaPressedProp;
  const isPressed =
    pressed === true ||
    (pressed === undefined && (ariaPressedProp === true || ariaPressedProp === 'true'));

  const baseStyles =
    'inline-flex items-center justify-center text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:cursor-not-allowed';

  const pressedStyles = isPressed
    ? 'ring-2 ring-offset-1 ring-current forced-colors:outline forced-colors:outline-2'
    : '';

  const variants = {
    primary:
      'bg-[var(--btn-primary-bg,var(--color-primary,#B91C1C))] text-[var(--btn-primary-text,#ffffff)] hover:bg-[var(--btn-primary-hover-bg,var(--color-primary,#B91C1C))] border border-[var(--btn-primary-border,transparent)] focus-visible:ring-[var(--btn-focus-ring,var(--color-focus-ring,var(--color-primary,#B91C1C)))]',
    secondary:
      'bg-[var(--btn-secondary-bg,var(--color-secondary,#B45309))] text-[var(--btn-secondary-text,#ffffff)] hover:bg-[var(--btn-secondary-hover-bg,var(--color-secondary,#B45309))] border border-[var(--btn-secondary-border,transparent)] focus-visible:ring-[var(--btn-focus-ring,var(--color-focus-ring,var(--color-secondary,#B45309)))]',
    danger:
      'bg-[var(--btn-danger-bg,#b91c1c)] text-[var(--btn-danger-text,#ffffff)] hover:bg-[var(--btn-danger-hover-bg,#991b1b)] focus-visible:ring-[var(--btn-focus-ring,var(--color-error-text,#b91c1c))]',
    ghost:
      'bg-[var(--btn-ghost-bg,transparent)] text-[var(--btn-ghost-text,var(--color-primary-text,inherit))] hover:bg-[var(--btn-ghost-hover-bg,rgba(0,0,0,0.05))] focus-visible:ring-[var(--btn-focus-ring,var(--color-focus-ring,var(--color-primary,#B91C1C)))]',
    outline:
      'bg-[var(--btn-outline-bg,transparent)] text-[var(--btn-outline-text,var(--color-primary-text,inherit))] border border-[var(--btn-outline-border,var(--color-surface-border,#d1d5db))] hover:bg-[var(--btn-outline-hover-bg,rgba(0,0,0,0.05))] focus-visible:ring-[var(--btn-focus-ring,var(--color-focus-ring,var(--color-primary,#B91C1C)))]',
  };

  const sizes = {
    sm: 'h-8 px-3 text-xs',
    md: 'h-10 py-2 px-4',
    lg: 'h-12 px-8 text-lg',
  };

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (isDisabled) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    onClick?.(e);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (isDisabled && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    onKeyDown?.(e);
  };

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      aria-disabled={isDisabled ? true : undefined}
      aria-pressed={resolvedAriaPressed}
      style={{
        borderRadius: 'var(--btn-radius, 0.375rem)',
        fontWeight: 'var(--btn-font-weight, 500)',
        ...style,
      }}
      className={cn(baseStyles, variants[variant], sizes[size], pressedStyles, className)}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      {...props}
    >
      {isPressed && (
        <Icon
          name="Check"
          className="mr-1.5 h-3.5 w-3.5 shrink-0"
          aria-hidden="true"
        />
      )}
      {children}
      {srContext ? <span className="sr-only">{` ${srContext}`}</span> : null}
    </button>
  );
}
