import React from 'react';
import { Icon } from '@/components/ui/Icon';

/**
 * @function LoadingScreen
 * @description A React component that displays a full-screen loading indicator.
 * It is used to signify that the application is in a loading state.
 * @returns {JSX.Element} The rendered LoadingScreen component.
 */
export default function LoadingScreen() {
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-gradient-to-br from-red-50 to-yellow-50 dark:from-gray-900 dark:to-yellow-900">
      <Icon name="Spinner" className="animate-spin h-16 w-16 text-red-500 mb-6" />
      <span className="text-xl font-semibold text-red-700 dark:text-yellow-300">Loading...</span>
    </div>
  );
}
