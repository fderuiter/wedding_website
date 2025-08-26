import React from 'react';
import { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: "RSVP",
  alternates: {
    canonical: '/rsvp',
  },
};

export default function RSVPPage() {
  return (
    <main className="container mx-auto px-4 py-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-center mb-4 text-rose-700 dark:text-rose-400">
          You&apos;re Invited!
        </h1>
        <p className="mb-8 text-lg text-gray-800 dark:text-gray-300">
          We&apos;re so excited to celebrate our special day with you.
        </p>
        <p className="mb-8 text-lg text-gray-800 dark:text-gray-300">
          Please RSVP by clicking the link below.
        </p>
        <Link href="https://www.icloud.com/invites/0b7SkTB_W6Y1s83A33EmaswkA"
          className="inline-block bg-rose-500 hover:bg-rose-600 text-white font-bold py-3 px-6 rounded-lg text-xl transition duration-300 ease-in-out transform hover:scale-105"
          target="_blank"
          rel="noopener noreferrer"
        >
          RSVP Now
        </Link>
      </div>
    </main>
  );
}
