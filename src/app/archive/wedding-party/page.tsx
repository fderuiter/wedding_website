import React from 'react';
import { Metadata } from 'next';
import WeddingPartyList from '@/components/WeddingPartyList';

export const metadata: Metadata = {
  title: "Wedding Party",
  alternates: {
    canonical: '/wedding-party',
  },
};

/**
 * @page WeddingPartyPage
 * @description A page that introduces the members of the wedding party.
 *
 * This component renders the `WeddingPartyList`, which displays a series of cards,
 * each featuring a member of the wedding party with their photo, name, role, and bio.
 *
 * @returns {JSX.Element} The rendered wedding party page.
 */
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
