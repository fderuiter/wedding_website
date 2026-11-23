import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import WeddingPartyList from '@/components/WeddingPartyList';
import { weddingPartyRepository, type WeddingPartyMemberDTO } from '@/features/wedding-party';
import { withPageQuery } from '@/lib/query-wrapper';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { enforceActiveGuestPageSession } from '@/core/auth/guestInviteSession';

export const metadata: Metadata = {
  title: 'Wedding Party',
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
  await enforceActiveGuestPageSession();
  const config = await getAppConfig();
  if (!isFeatureEnabled('weddingParty', config.modules)) {
    notFound();
  }

  const members = await withPageQuery(
    () => weddingPartyRepository.getMembers(),
    [] as WeddingPartyMemberDTO[]
  );

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-4xl font-bold text-center mb-8 text-primary dark:text-primary">
        Wedding Party
      </h1>
      <h2 className="sr-only">Wedding Party Members</h2>
      <WeddingPartyList
        members={members}
        partner1Name={config.partner1Name || config.brideName || undefined}
        partner2Name={config.partner2Name || config.groomName || undefined}
      />
    </div>
  );
}
