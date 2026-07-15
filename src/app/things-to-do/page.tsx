import { Metadata } from 'next';
import ThingsToDoList from './components/ThingsToDoList';
import { attractionsRepository, type AttractionDTO } from '@/features/attractions';

export const metadata: Metadata = {
  title: 'Things to Do',
  alternates: {
    canonical: '',
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
  let attractions: AttractionDTO[] = [];
  try {
    const rawAttractions = await attractionsRepository.getVisibleAttractions();
    attractions = rawAttractions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  } catch (error) {
    console.warn('Database unreachable, using empty attractions array.');
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-4xl font-bold text-center mb-8 text-primary dark:text-primary">
        Things to Do in City
      </h1>
      <ThingsToDoList attractions={attractions} />
    </div>
  );
}
