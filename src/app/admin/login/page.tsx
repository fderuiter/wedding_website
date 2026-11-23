import type { Metadata } from 'next';
import { createPageMetadata } from '@/app/metadata';
import AdminLoginClient from './AdminLoginClient';

export const metadata: Metadata = createPageMetadata({
  title: 'Admin Login',
  description: 'Sign in to the wedding website administrative control panel.',
  noIndex: true,
});

export default function LoginPage() {
  return <AdminLoginClient />;
}
