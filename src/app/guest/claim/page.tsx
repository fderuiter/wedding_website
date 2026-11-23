import type { Metadata } from 'next';
import { createPageMetadata } from '@/app/metadata';
import GuestClaimClient from './GuestClaimClient';

export const metadata: Metadata = createPageMetadata({
  title: 'Gift Reservation Verification',
  description: 'Confirm or release your wedding gift reservation.',
  noIndex: true,
});

export default function GuestClaimPage() {
  return <GuestClaimClient />;
}
