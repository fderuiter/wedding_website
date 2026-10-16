import React from 'react';
import { cn } from '@/utils/cn';

export interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  containerClassName?: string;
  containerAriaLabel?: string;
  containerProps?: React.HTMLAttributes<HTMLDivElement>;
}

export const Table = React.forwardRef<HTMLTableElement, TableProps>(
  (
    {
      className,
      containerClassName,
      containerAriaLabel,
      containerProps,
      ...props
    },
    ref
  ) => {
    const { onKeyDown: containerOnKeyDown, className: containerPropsClassName, ...restContainerProps } = containerProps || {};

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (containerOnKeyDown) {
        containerOnKeyDown(e);
      }
      if (e.defaultPrevented) return;

      const container = e.currentTarget || (e.target as HTMLDivElement);
      const scrollAmount = 40;

      switch (e.key) {
        case 'ArrowLeft':
          container.scrollLeft -= scrollAmount;
          e.preventDefault();
          break;
        case 'ArrowRight':
          container.scrollLeft += scrollAmount;
          e.preventDefault();
          break;
        case 'ArrowUp':
          container.scrollTop -= scrollAmount;
          e.preventDefault();
          break;
        case 'ArrowDown':
          container.scrollTop += scrollAmount;
          e.preventDefault();
          break;
        case 'Home':
          container.scrollLeft = 0;
          e.preventDefault();
          break;
        case 'End':
          container.scrollLeft = container.scrollWidth;
          e.preventDefault();
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
);
Table.displayName = 'Table';

export const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn('[&_tr]:border-b', className)} {...props} />
));
TableHeader.displayName = 'TableHeader';

export const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn('[&_tr:last-child]:border-0', className)}
    {...props}
  />
));
TableBody.displayName = 'TableBody';

export const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      'border-t bg-gray-100/50 font-medium [&>tr]:last:border-b-0 dark:bg-gray-800/50',
      className
    )}
    {...props}
  />
));
TableFooter.displayName = 'TableFooter';

export const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      'border-b transition-colors hover:bg-gray-100/50 data-[state=selected]:bg-gray-100 dark:hover:bg-gray-800/50 dark:data-[state=selected]:bg-gray-800',
      className
    )}
    {...props}
  />
));
TableRow.displayName = 'TableRow';

export const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    scope="col"
    className={cn(
      'h-10 px-4 text-left align-middle font-medium text-gray-500 [&:has([role=checkbox])]:pr-0 dark:text-gray-400',
      className
    )}
    {...props}
  />
));
TableHead.displayName = 'TableHead';

export const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      'p-4 align-middle [&:has([role=checkbox])]:pr-0',
      className
    )}
    {...props}
  />
));
TableCell.displayName = 'TableCell';

export const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn('mt-4 text-sm text-gray-500 dark:text-gray-400', className)}
    {...props}
  />
));
TableCaption.displayName = 'TableCaption';

