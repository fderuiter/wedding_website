import React from 'react';
import { SearchX } from 'lucide-react';

/**
 * @interface EmptyStateProps
 * @description Defines the props for the EmptyState component.
 * @property {string} message - The message to display in the empty state.
 */
interface EmptyStateProps {
  message: string;
}

/**
 * @function EmptyState
 * @description A React component that displays a message indicating an empty state,
 * typically when no data or results are available to be shown.
 * @param {EmptyStateProps} props - The props for the component.
 * @returns {JSX.Element} The rendered EmptyState component.
 */
const EmptyState: React.FC<EmptyStateProps> = ({ message }) => {
  return (
    <div className="text-center p-10 col-span-full">
      <SearchX className="mx-auto h-12 w-12 text-gray-400" />
      <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100">No items found</h3>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{message}</p>
    </div>
  );
};

export default EmptyState;
