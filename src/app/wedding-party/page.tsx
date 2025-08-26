import React from 'react';
import { Metadata } from 'next';
import WeddingPartyList from '@/components/WeddingPartyList';

export const metadata: Metadata = {
  title: "Wedding Party",
  alternates: {
    canonical: '/wedding-party',
  },
};

export default function WeddingPartyPage() {
  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="text-4xl font-bold text-center mb-8 text-rose-700 dark:text-rose-400">
        Wedding Party
      </h1>
      <WeddingPartyList />
    </main>
  );
}
