import type { Metadata } from 'next';
import { createPageMetadata } from '@/app/metadata';
import ThankYouNotesClient from './ThankYouNotesClient';

export const metadata: Metadata = createPageMetadata({
  title: 'Thank-You Note Manager',
  description: 'Track gift contributions, mailing addresses, and thank-you note status.',
  noIndex: true,
});

export default function ThankYouNotesPage() {
  return <ThankYouNotesClient />;
}
