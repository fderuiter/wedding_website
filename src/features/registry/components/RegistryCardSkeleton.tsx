import React from 'react';
import { Skeleton } from '@/components/ui/Skeleton';

/**
 * @function RegistryCardSkeleton
 * @description A React component that displays a skeleton loading state for a RegistryCard.
 * Its dimensions match RegistryCard exactly, preventing layout shift (CLS).
 * @returns {JSX.Element} The rendered RegistryCardSkeleton component.
 */
const RegistryCardSkeleton: React.FC = () => {
  return (
    <div
      data-testid="registry-card-skeleton"
      className="border border-primary dark:border-gray-700 rounded-2xl overflow-hidden shadow-md bg-white dark:bg-gray-800 h-full flex flex-col justify-between"
      style={{ minHeight: 'calc(340px * var(--scale-factor))' }}
    >
      <Skeleton className="relative w-full aspect-square !rounded-none" />
      <div className="p-6 pb-16 relative z-20 flex flex-col gap-2">
        <Skeleton className="h-7 w-3/4 mb-1" />
        <Skeleton className="h-5 w-1/2 mb-1" />
        <Skeleton className="h-6 w-1/4" />
      </div>
    </div>
  );
};

export default RegistryCardSkeleton;
