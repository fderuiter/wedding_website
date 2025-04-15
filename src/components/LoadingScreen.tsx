import React from 'react';

export default function LoadingScreen() {
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-gradient-to-br from-red-50 to-yellow-50 dark:from-gray-900 dark:to-yellow-900">
      <svg className="animate-spin h-16 w-16 text-red-500 mb-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
      </svg>
      <span className="text-xl font-semibold text-red-700 dark:text-yellow-300">Loading...</span>
    </div>
  );
}
