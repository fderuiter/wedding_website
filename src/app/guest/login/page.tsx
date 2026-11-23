import type { Metadata } from 'next';
import { createPageMetadata } from '@/app/metadata';
import GuestLoginClient from './GuestLoginClient';

export const metadata: Metadata = createPageMetadata({
  title: 'Guest Sign-In',
  description: 'Sign in with your event passcode or personal invitation code to view wedding details.',
  noIndex: true,
});

export default function GuestLoginPage() {
  return <GuestLoginClient />;
}
