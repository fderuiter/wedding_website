import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ThingsToDoList from './components/ThingsToDoList';
import { attractionsRepository, type AttractionDTO } from '@/features/attractions';
import { withPageQuery } from '@/lib/query-wrapper';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { enforceActiveGuestPageSession } from '@/core/auth/guestInviteSession';

export const metadata: Metadata = {
  title: 'Things to Do',
  alternates: {
    canonical: '/things-to-do',
  },
};

/**
 * @page ThingsToDoPage
 * @description A page that lists recommended local attractions, restaurants, and points of interest.
 *
 * This component renders the `ThingsToDoList`, which provides an interactive, filterable
 * list and map of things for wedding guests to do in the City area.
 *
 * @returns {JSX.Element} The rendered "Things to Do" page.
 */
export default async function ThingsToDoPage() {
  await enforceActiveGuestPageSession();
  const config = await getAppConfig();
  if (!isFeatureEnabled('attractions', config.modules)) {
    notFound();
  }

  const attractions = await withPageQuery(
    async () => {
      const rawAttractions = await attractionsRepository.getVisibleAttractions();
      return rawAttractions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    [] as AttractionDTO[]
  );

  const heading = config.venueCity?.trim()
    ? `Things to Do in ${config.venueCity.trim()}`
    : 'Things to Do';

  const travelParagraphs = (config.travelAdvice || '')
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-4xl font-bold text-center mb-8 text-primary dark:text-primary">
        {heading}
      </h1>
      {travelParagraphs.length > 0 && (
        <section
          aria-label="Getting Here & Travel Advice"
          className="mx-auto mb-10 max-w-3xl rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 sm:p-8 shadow-[var(--shadow-lg)] space-y-4"
          style={{ boxShadow: 'var(--shadow-lg)' }}
        >
          <h2 className="text-2xl font-bold text-primary dark:text-primary">
            Getting Here &amp; Travel Advice
          </h2>
          {travelParagraphs.map((paragraph, index) => (
            <p key={index} className="type-body text-gray-700 dark:text-gray-300 whitespace-pre-line">
              {paragraph}
            </p>
          ))}
        </section>
      )}
      <ThingsToDoList attractions={attractions} defaultCenter={[config.latitude, config.longitude]} />
    </div>
  );
}
