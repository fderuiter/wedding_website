import React from 'react';
import { cn } from '@/utils/cn';

export interface TableProps extends React.ComponentPropsWithRef<'table'> {
  containerClassName?: string;
  containerAriaLabel?: string;
  containerProps?: React.HTMLAttributes<HTMLDivElement>;
}

const EXPLICIT_POSITION_CLASS_RE = /(?:^|\s)!?(?:static|fixed|absolute|relative|sticky)(?:\s|$)/;

export function Table({
  className,
  containerClassName,
  containerAriaLabel,
  containerProps,
  ref,
  ...props
}: TableProps) {
  const { onKeyDown: containerOnKeyDown, className: containerPropsClassName, ...restContainerProps } = containerProps || {};
  const mergedCustomContainerClass = cn(containerClassName, containerPropsClassName);
  const containerPositionClass =
    mergedCustomContainerClass && EXPLICIT_POSITION_CLASS_RE.test(mergedCustomContainerClass)
      ? undefined
      : 'relative';

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (containerOnKeyDown) {
      containerOnKeyDown(e);
    }
    if (e.defaultPrevented) return;
    if (e.target !== e.currentTarget) return;

    const container = e.currentTarget;
    const hasHorizontalOverflow = container.scrollWidth > container.clientWidth;
    const hasVerticalOverflow = container.scrollHeight > container.clientHeight;
    const scrollAmount = 40;

    switch (e.key) {
      case 'ArrowLeft':
        if (hasHorizontalOverflow) {
          container.scrollLeft -= scrollAmount;
          e.preventDefault();
        }
        break;
      case 'ArrowRight':
        if (hasHorizontalOverflow) {
          container.scrollLeft += scrollAmount;
          e.preventDefault();
        }
        break;
      case 'ArrowUp':
        if (hasVerticalOverflow) {
          container.scrollTop -= scrollAmount;
          e.preventDefault();
        }
        break;
      case 'ArrowDown':
        if (hasVerticalOverflow) {
          container.scrollTop += scrollAmount;
          e.preventDefault();
        }
        break;
      case 'Home':
        if (hasHorizontalOverflow) {
          container.scrollLeft = 0;
          e.preventDefault();
        }
        break;
      case 'End':
        if (hasHorizontalOverflow) {
          container.scrollLeft = container.scrollWidth;
          e.preventDefault();
        }
        break;
    }
  };

  const ariaLabel =
    containerAriaLabel ||
    restContainerProps?.['aria-label'] ||
    props['aria-label'] ||
    'Scrollable table';

  const ariaLabelledBy =
    restContainerProps?.['aria-labelledby'] || props['aria-labelledby'];

  return (
    <div
      role="region"
      tabIndex={restContainerProps?.tabIndex ?? 0}
      aria-label={ariaLabelledBy ? undefined : ariaLabel}
      aria-labelledby={ariaLabelledBy}
      {...restContainerProps}
      onKeyDown={handleKeyDown}
      className={cn(
        containerPositionClass,
        'w-full overflow-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--input-focus-ring,var(--color-primary,#B91C1C))] focus-visible:ring-offset-2 rounded-md',
        containerClassName,
        containerPropsClassName
      )}
    >
      <table
        ref={ref}
        className={cn('w-full caption-bottom text-sm', className)}
        {...props}
      />
    </div>
  );
}

export function TableHeader({
  className,
  ref,
  ...props
}: React.ComponentPropsWithRef<'thead'>) {
  return (
    <thead ref={ref} className={cn('[&_tr]:border-b', className)} {...props} />
  );
}

export function TableBody({
  className,
  ref,
  ...props
}: React.ComponentPropsWithRef<'tbody'>) {
  return (
    <tbody
      ref={ref}
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  );
}

export function TableFooter({
  className,
  ref,
  ...props
}: React.ComponentPropsWithRef<'tfoot'>) {
  return (
    <tfoot
      ref={ref}
      className={cn(
        'border-t bg-gray-100/50 font-medium [&>tr]:last:border-b-0 dark:bg-gray-800/50',
        className
      )}
      {...props}
    />
  );
}

export function TableRow({
  className,
  ref,
  ...props
}: React.ComponentPropsWithRef<'tr'>) {
  return (
    <tr
      ref={ref}
      className={cn(
        'border-b transition-colors hover:bg-gray-100/50 data-[state=selected]:bg-gray-100 dark:hover:bg-gray-800/50 dark:data-[state=selected]:bg-gray-800',
        className
      )}
      {...props}
    />
  );
}

export function TableHead({
  className,
  ref,
  ...props
}: React.ComponentPropsWithRef<'th'>) {
  return (
    <th
      ref={ref}
      scope="col"
      className={cn(
        'h-10 px-4 text-left align-middle font-medium text-gray-500 [&:has([role=checkbox])]:pr-0 dark:text-gray-400',
        className
      )}
      {...props}
    />
  );
}

export function TableCell({
  className,
  ref,
  ...props
}: React.ComponentPropsWithRef<'td'>) {
  return (
    <td
      ref={ref}
      className={cn(
        'p-4 align-middle [&:has([role=checkbox])]:pr-0',
        className
      )}
      {...props}
    />
  );
}

export function TableCaption({
  className,
  ref,
  ...props
}: React.ComponentPropsWithRef<'caption'>) {
  return (
    <caption
      ref={ref}
      className={cn('mt-4 text-sm text-gray-500 dark:text-gray-400', className)}
      {...props}
    />
  );
}

