import { Metadata } from 'next';
import WeddingPartyList from '@/components/WeddingPartyList';
import { weddingPartyRepository, type WeddingPartyMemberDTO } from '@/features/wedding-party';
import { withPageQuery } from '@/lib/query-wrapper';

export const metadata: Metadata = {
  title: 'Wedding Party',
  alternates: {
    canonical: '',
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
  const members = await withPageQuery(
    () => weddingPartyRepository.getMembers(),
    [] as WeddingPartyMemberDTO[]
  );

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-4xl font-bold text-center mb-8 text-primary dark:text-primary">
        Wedding Party
      </h1>
      <WeddingPartyList members={members} />
    </div>
  );
}
