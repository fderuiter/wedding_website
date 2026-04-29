import React from 'react';
import { SearchX } from 'lucide-react';

/**
 * @interface EmptyStateProps
 * @description Defines the props for the EmptyState component.
 * @property {string} message - The message to display in the empty state.
 * @property {() => void} [onAction] - Optional callback function to execute when the action button is clicked.
 * @property {string} [actionLabel] - Optional text label for the action button.
 */
interface EmptyStateProps {
  message: string;
  onAction?: () => void;
  actionLabel?: string;
}

/**
 * @function EmptyState
 * @description A React component that displays a message indicating an empty state,
 * typically when no data or results are available to be shown. Optionally displays an action button.
 * @param {EmptyStateProps} props - The props for the component.
 * @returns {JSX.Element} The rendered EmptyState component.
 */
const EmptyState: React.FC<EmptyStateProps> = ({ message, onAction, actionLabel }) => {
  return (
    <div className="text-center p-10 col-span-full flex flex-col items-center">
      <SearchX className="mx-auto h-12 w-12 text-gray-400" />
      <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100">No items found</h3>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 mb-4">{message}</p>
      {onAction && actionLabel && (
        <button
          onClick={onAction}
          className="bg-rose-600 hover:bg-rose-700 text-white font-medium py-2 px-4 rounded-md shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-rose-500 transition-colors"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
};

export default EmptyState;
