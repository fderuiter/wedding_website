import React from 'react';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/utils/cn';

export interface AccessibleExternalLinkProps
  extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  showIcon?: boolean;
  iconClassName?: string;
  iconSize?: number | string;
  srText?: string;
}

export const AccessibleExternalLink = React.forwardRef<
  HTMLAnchorElement,
  AccessibleExternalLinkProps
>(
  (
    {
      href,
      children,
      className,
      showIcon = false,
      iconClassName,
      iconSize,
      srText = '(opens in a new tab)',
      'aria-label': ariaLabel,
      ...props
    },
    ref
  ) => {
    let computedAriaLabel: string | undefined = undefined;
    if (ariaLabel) {
      const trimmed = ariaLabel.trim();
      if (/opens in a new (tab|window)/i.test(trimmed)) {
        computedAriaLabel = trimmed;
      } else {
        computedAriaLabel = `${trimmed} ${srText}`;
      }
    }

    return (
      <a
        ref={ref}
        {...props}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={computedAriaLabel}
        className={cn(className)}
      >{children}{showIcon && (
          <Icon
            name="ExternalLink"
            aria-hidden="true"
            size={iconSize}
            className={cn(iconClassName || 'w-4 h-4 ml-1')}
          />
        )}{!computedAriaLabel && (
          <span className="sr-only"> {srText}</span>
        )}</a>
    );
  }
);

AccessibleExternalLink.displayName = 'AccessibleExternalLink';

