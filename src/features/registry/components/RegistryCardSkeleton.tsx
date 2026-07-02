import React from 'react';
import { Skeleton } from '@/components/ui/Skeleton';

/**
 * @function RegistryCardSkeleton
 * @description A React component that displays a skeleton loading state for a RegistryCard.
 * It provides a visual placeholder while the actual registry item data is being loaded.
 * @returns {JSX.Element} The rendered RegistryCardSkeleton component.
 */
const RegistryCardSkeleton: React.FC = () => {
  return (
    <div className="border border-primary dark:border-gray-700 rounded-2xl overflow-hidden shadow-md bg-white dark:bg-gray-800">
      <Skeleton className="relative w-full aspect-square !rounded-none" />
      <div className="p-6">
        <Skeleton className="h-6 w-3/4 mb-4" />
        <Skeleton className="h-4 w-1/2 mb-2" />
        <Skeleton className="h-4 w-1/4" />
      </div>
    </div>
  );
};

export default RegistryCardSkeleton;
