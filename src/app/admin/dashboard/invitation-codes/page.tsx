import type { Metadata } from 'next';
import { createPageMetadata } from '@/app/metadata';
import InvitationCodesClient from './InvitationCodesClient';

export const metadata: Metadata = createPageMetadata({
  title: 'Invitation Codes',
  description: 'Manage guest invitation codes, households, RSVPs, and broadcasts.',
  noIndex: true,
});

export default function InvitationCodesDashboardPage() {
  return <InvitationCodesClient />;
}
