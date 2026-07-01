import React from 'react';
import { Metadata } from 'next';
import WeddingPartyList from '@/components/WeddingPartyList';
import { contentService } from '@/features/content/service';

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
export default async function WeddingPartyPage() {
  let members: import('@prisma/client').WeddingPartyMember[] = [];
  try {
    members = await contentService.getPublicWeddingPartyMembers();
  } catch (error) {
    console.warn("Database unreachable, using empty members array.");
  }

  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="text-4xl font-bold text-center mb-8 text-primary dark:text-primary">
        Wedding Party
      </h1>
      <WeddingPartyList members={members} />
    </main>
  );
}
