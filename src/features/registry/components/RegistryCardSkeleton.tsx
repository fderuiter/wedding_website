import React from 'react';

/**
 * @function RegistryCardSkeleton
 * @description A React component that displays a skeleton loading state for a RegistryCard.
 * It provides a visual placeholder while the actual registry item data is being loaded.
 * @returns {JSX.Element} The rendered RegistryCardSkeleton component.
 */
const RegistryCardSkeleton: React.FC = () => {
  return (
    <div
      className="border border-rose-100 dark:border-gray-700 rounded-2xl overflow-hidden shadow-md bg-white dark:bg-gray-800"
      data-testid="registry-card-skeleton"
    >
      <div className="relative w-full h-56 bg-gray-200 dark:bg-gray-700 animate-pulse"></div>
      <div className="p-6">
        <div className="h-6 w-3/4 mb-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
        <div className="h-4 w-1/2 mb-2 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
        <div className="h-4 w-1/4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
      </div>
    </div>
  );
};

export default RegistryCardSkeleton;
