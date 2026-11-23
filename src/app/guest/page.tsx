import type { Metadata } from 'next';
import { createPageMetadata } from '@/app/metadata';
import GuestPortalClient from './GuestPortalClient';

export const metadata: Metadata = createPageMetadata({
  title: 'Guest RSVP & Address Portal',
  description: 'Enter your invitation code to RSVP to wedding events and update your mailing address.',
  noIndex: true,
});

export default function GuestAddressPage() {
  return <GuestPortalClient />;
}
