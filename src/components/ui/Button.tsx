import React, { ButtonHTMLAttributes, AnchorHTMLAttributes } from 'react';
import Link from 'next/link';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';

interface CommonProps {
  variant?: ButtonVariant;
  className?: string;
  children?: React.ReactNode;
}

interface ButtonProps extends CommonProps, ButtonHTMLAttributes<HTMLButtonElement> {
  href?: undefined;
}

interface LinkProps extends CommonProps, AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
}

type Props = ButtonProps | LinkProps;

export const Button = React.forwardRef<HTMLElement, Props>((props, ref) => {
  const { variant = 'primary', className = '', children, ...rest } = props;

  // Base classes that ensure minimum 44px height for accessibility
  const baseClasses = 'inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-4 py-2 font-medium rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm sm:text-base';

  let variantClasses = '';
  switch (variant) {
    case 'primary':
      variantClasses = 'bg-primary text-white hover:bg-rose-700 focus-visible:ring-primary';
      break;
    case 'secondary':
      variantClasses = 'bg-gray-200 text-gray-900 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600 focus-visible:ring-gray-500';
      break;
    case 'danger':
      variantClasses = 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600';
      break;
    case 'ghost':
      variantClasses = 'bg-transparent text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 focus-visible:ring-gray-500';
      break;
    case 'outline':
      variantClasses = 'border-2 border-primary text-primary hover:bg-rose-50 dark:hover:bg-gray-800 focus-visible:ring-primary';
      break;
  }

  // To allow className to override, we should put className at the end.
  const combinedClasses = `${baseClasses} ${variantClasses} ${className}`;

  if ('href' in rest && rest.href) {
    const { href, ...anchorProps } = rest as LinkProps;
    return (
      <Link href={href} className={combinedClasses} ref={ref as React.Ref<HTMLAnchorElement>} {...anchorProps}>
        {children}
      </Link>
    );
  }

  return (
    <button className={combinedClasses} ref={ref as React.Ref<HTMLButtonElement>} {...(rest as ButtonProps)}>
      {children}
    </button>
  );
});

Button.displayName = 'Button';
