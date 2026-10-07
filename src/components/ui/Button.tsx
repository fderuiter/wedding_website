import React from 'react';
import { cn } from '@/utils/cn';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', style, ...props }, ref) => {
    const baseStyles =
      'inline-flex items-center justify-center text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none';

    const variants = {
      primary:
        'bg-[var(--btn-primary-bg,var(--color-primary,#B91C1C))] text-[var(--btn-primary-text,#ffffff)] hover:bg-[var(--btn-primary-hover-bg,var(--color-primary,#B91C1C))] border border-[var(--btn-primary-border,transparent)] focus-visible:ring-[var(--btn-focus-ring,var(--color-primary,#B91C1C))]',
      secondary:
        'bg-[var(--btn-secondary-bg,var(--color-secondary,#B45309))] text-[var(--btn-secondary-text,#ffffff)] hover:bg-[var(--btn-secondary-hover-bg,var(--color-secondary,#B45309))] border border-[var(--btn-secondary-border,transparent)] focus-visible:ring-[var(--btn-focus-ring,var(--color-secondary,#B45309))]',
      danger:
        'bg-[var(--btn-danger-bg,#b91c1c)] text-[var(--btn-danger-text,#ffffff)] hover:bg-[var(--btn-danger-hover-bg,#991b1b)] focus-visible:ring-[var(--btn-danger-bg,#b91c1c)]',
      ghost:
        'bg-[var(--btn-ghost-bg,transparent)] text-[var(--btn-ghost-text,inherit)] hover:bg-[var(--btn-ghost-hover-bg,rgba(0,0,0,0.05))]',
      outline:
        'bg-[var(--btn-outline-bg,transparent)] text-[var(--btn-outline-text,inherit)] border border-[var(--btn-outline-border,#d1d5db)] hover:bg-[var(--btn-outline-hover-bg,rgba(0,0,0,0.05))]',
    };

    const sizes = {
      sm: 'h-8 px-3 text-xs',
      md: 'h-10 py-2 px-4',
      lg: 'h-12 px-8 text-lg',
    };

    return (
      <button
        ref={ref}
        style={{
          borderRadius: 'var(--btn-radius, 0.375rem)',
          fontWeight: 'var(--btn-font-weight, 500)',
          ...style,
        }}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';
