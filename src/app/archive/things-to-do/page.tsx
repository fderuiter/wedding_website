import React from 'react';
import { Metadata } from 'next';
import ThingsToDoList from './components/ThingsToDoList';
import { prisma } from '@/lib/prisma';

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
 * list and map of things for wedding guests to do in the City area.
 *
 * @returns {JSX.Element} The rendered "Things to Do" page.
 */
export default async function ThingsToDoPage() {
  let attractions: import('@prisma/client').Attraction[] = [];
  try {
    attractions = await prisma.attraction.findMany({
      where: { isVisible: true },
    });
  } catch (error) {
    console.warn("Database unreachable, using empty attractions array.");
  }

  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="text-4xl font-bold text-center mb-8 text-rose-700 dark:text-rose-400">
        Things to Do in City
      </h1>
      <ThingsToDoList attractions={attractions} />
    </main>
  );
}
