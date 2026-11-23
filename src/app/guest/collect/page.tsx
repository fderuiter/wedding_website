import type { Metadata } from 'next';
import { createPageMetadata } from '@/app/metadata';
import GuestAddressCollectClient from './GuestAddressCollectClient';

export const metadata: Metadata = createPageMetadata({
  title: 'Mailing Address Form',
  description: 'Share your postal mailing address for wedding invitations and updates.',
  noIndex: true,
});

export default function GuestAddressCollectPage() {
  return <GuestAddressCollectClient />;
}
