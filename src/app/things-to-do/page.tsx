import React from 'react';
import { Metadata } from 'next';
import ThingsToDoList from '@/components/ThingsToDoList';

export const metadata: Metadata = {
  title: "Things to Do",
  alternates: {
    canonical: '/things-to-do',
  },
};

/**
 * @page ThingsToDoPage
 * @description A page that lists recommended local attractions, restaurants, and points of interest.
 *
 * This component renders the `ThingsToDoList`, which provides an interactive, filterable
 * list and map of things for wedding guests to do in the Rochester area.
 *
 * @returns {JSX.Element} The rendered "Things to Do" page.
 */
export default function ThingsToDoPage() {
  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="text-4xl font-bold text-center mb-8 text-rose-700 dark:text-rose-400">
        Things to Do in Rochester
      </h1>
      <ThingsToDoList />
    </main>
  );
}
