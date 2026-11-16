import type { Meta, StoryObj } from '@storybook/react';
import ThingsToDoMap from './ThingsToDoMap';
import type { AttractionDTO } from '@/features/attractions';

const mockAttractions: AttractionDTO[] = [
  {
    id: 'attr-1',
    name: 'Castello di Amorosa',
    description: 'Authentic 13th-century Tuscan-style castle winery nestled in Napa Valley.',
    category: 'Winery',
    website: 'https://castellodiamorosa.com',
    directions: '4045 St Helena Hwy, Calistoga, CA 94515',
    latitude: 38.5583,
    longitude: -122.5422,
    isVisible: true,
    promoCode: 'WEDDING2026',
    bookingUrl: 'https://castellodiamorosa.com/tasting',
    isSample: false,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  },
  {
    id: 'attr-2',
    name: 'Bouchon Bakery',
    description: 'Thomas Keller French bakery offering artisanal breads and classical pastries.',
    category: 'Dining',
    website: 'https://thomaskeller.com/bouchonbakeryyountville',
    directions: '6528 Washington St, Yountville, CA 94599',
    latitude: 38.4042,
    longitude: -122.3644,
    isVisible: true,
    isSample: false,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  },
  {
    id: 'attr-3',
    name: 'Napa Valley Wine Train',
    description: 'Scenic vintage rail dining journey across the historic wine country.',
    category: 'Activity',
    website: 'https://winetrain.com',
    directions: '1275 McKinstry St, Napa, CA 94559',
    latitude: 38.3015,
    longitude: -122.2828,
    isVisible: true,
    isSample: false,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  },
];

function LeafletMockContainer({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: '100%',
        maxWidth: '850px',
        height: '520px',
        margin: '0 auto',
        borderRadius: '16px',
        overflow: 'hidden',
        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.2), 0 4px 6px -4px rgba(0, 0, 0, 0.2)',
        position: 'relative',
      }}
    >
      {children}
    </div>
  );
}

const meta: Meta<typeof ThingsToDoMap> = {
  title: 'Visual & Graphical/ThingsToDoMap',
  component: ThingsToDoMap,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <LeafletMockContainer>
        <Story />
      </LeafletMockContainer>
    ),
  ],
  args: {
    attractions: mockAttractions,
    defaultCenter: [38.45, -122.4],
  },
};

export default meta;
type Story = StoryObj<typeof ThingsToDoMap>;

export const DefaultMap: Story = {
  args: {
    attractions: mockAttractions,
    defaultCenter: [38.45, -122.4],
  },
};

export const SingleAttraction: Story = {
  args: {
    attractions: [mockAttractions[0]],
    defaultCenter: [38.5583, -122.5422],
  },
};

export const EmptyAttractions: Story = {
  args: {
    attractions: [],
    defaultCenter: [38.45, -122.4],
  },
};
