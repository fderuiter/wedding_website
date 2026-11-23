import React from 'react';
import { Icon } from '@/components/ui/Icon';
import { Heading, type HeadingLevel } from '@/components/ui/Layout';

/**
 * @interface EmptyStateProps
 * @description Defines the props for the EmptyState component.
 * @property {string} message - The message to display in the empty state.
 * @property {() => void} [onAction] - Optional callback function to execute when the action button is clicked.
 * @property {string} [actionLabel] - Optional text label for the action button.
 * @property {HeadingLevel} [headingLevel='h2'] - Semantic HTML heading rank for the empty state title.
 */
interface EmptyStateProps {
  message: string;
  onAction?: () => void;
  actionLabel?: string;
  headingLevel?: HeadingLevel;
}

/**
 * @function EmptyState
 * @description A React component that displays a message indicating an empty state,
 * typically when no data or results are available to be shown. Optionally displays an action button.
 * @param {EmptyStateProps} props - The props for the component.
 * @returns {JSX.Element} The rendered EmptyState component.
 */
const EmptyState: React.FC<EmptyStateProps> = ({
  message,
  onAction,
  actionLabel,
  headingLevel = 'h2',
}) => {
  return (
    <div className="text-center p-10 col-span-full flex flex-col items-center">
      <Icon name="SearchX" className="mx-auto h-12 w-12 text-muted-text" />
      <Heading
        as={headingLevel}
        variant="none"
        unstyledColor
        className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100"
      >
        No items found
      </Heading>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 mb-4">{message}</p>
      {onAction && actionLabel && (
        <button
          onClick={onAction}
          className="btn-primary shadow"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
};

export default EmptyState;
