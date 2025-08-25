import React from 'react';
import { Metadata } from 'next';
import ThingsToDoList from '@/components/ThingsToDoList';

export const metadata: Metadata = {
  title: "Things to Do",
  alternates: {
    canonical: '/things-to-do',
  },
};

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
