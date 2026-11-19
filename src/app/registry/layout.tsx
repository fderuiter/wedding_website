import { enforceActiveGuestPageSession } from '@/core/auth/guestInviteSession';

export default async function RegistryLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await enforceActiveGuestPageSession();
  return <>{children}</>;
}
