import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe } from 'jest-axe';
import HomePageClient from '../HomePageClient';
import type { PublicAppConfig } from '@/lib/config';

// Mock framer-motion
jest.mock('framer-motion', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const stripMotionProps = ({
    variants: _variants,
    initial: _initial,
    animate: _animate,
    whileInView: _whileInView,
    viewport: _viewport,
    custom: _custom,
    style,
    ...domProps
  }: any) => {
    if (!style) return domProps;
    const {
      transformPerspective: _tp,
      rotateX: _rx,
      rotateY: _ry,
      ...restStyle
    } = style;
    return { ...domProps, style: restStyle };
  };

  const createTag = (Tag: any) => {
    const Mocked = ReactActual.forwardRef(({ children, ...props }: any, ref: any) =>
      ReactActual.createElement(Tag, { ref, ...stripMotionProps(props) }, children)
    );
    Mocked.displayName = `Motion(${String(Tag)})`;
    return Mocked;
  };

  return {
    motion: {
      create: createTag,
      div: createTag('div'),
      article: createTag('article'),
      h1: createTag('h1'),
      p: createTag('p'),
      nav: createTag('nav'),
      section: createTag('section'),
    },
    AnimatePresence: ({ children }: any) => <>{children}</>,
    useMotionValue: (initial: number) => ({
      get: () => initial,
      set: jest.fn(),
    }),
    useSpring: (val: any) => val,
    useTransform: () => '0deg',
  };
});

// Mock ThemeProvider
jest.mock('@/components/ThemeProvider', () => ({
  useTheme: () => ({
    themePreset: 'classic',
  }),
}));

const mockConfig: PublicAppConfig = {
  heroTitle: 'Test Wedding',
  heroSubtitle: 'Welcome to our wedding',
  weddingDate: '2026-12-31T18:00:00Z',
  timezone: 'UTC',
  venueName: 'The Grand Hall',
  venueAddress: '123 Main St',
  venueCity: 'New York',
  venueState: 'NY',
  venueDescription: 'A beautiful venue.',
  storyText: 'Our story began...',
  brideName: 'Alice',
  groomName: 'Bob',
  partner1Name: 'Alice',
  partner2Name: 'Bob',
  showCountdown: false,
  showAddToCalendar: false,
  modules: { countdown: true, gallery: true },
  features: [],
  heroImageUrl: '/images/hero.jpg',
  heroImageAlt: 'Hero image',
  brandWatermarkUrl: '/images/watermark.png',
  brandWatermarkAlt: 'Watermark',
  badgeGraphicUrl: '/images/badge.png',
  badgeGraphicAlt: 'Badge',
} as any;

describe('HomePageClient', () => {
  test('renders safe brand media URLs correctly', () => {
    render(<HomePageClient config={mockConfig} />);

    const watermark = screen.getByAltText('Watermark');
    expect(watermark).toBeInTheDocument();
    expect(watermark).toHaveAttribute('src', '/images/watermark.png');

    const badge = screen.getByAltText('Badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute('src', '/images/badge.png');
  });

  test('filters out unsafe brand media URLs (e.g., javascript: URIs)', () => {
    const maliciousConfig: PublicAppConfig = {
      ...mockConfig,
      brandWatermarkUrl: 'javascript:alert(1)',
      badgeGraphicUrl: 'javascript:alert(2)',
      heroImageUrl: 'javascript:alert(3)',
    };

    render(<HomePageClient config={maliciousConfig} />);

    expect(screen.queryByAltText('Watermark')).not.toBeInTheDocument();
    expect(screen.queryByAltText('Badge')).not.toBeInTheDocument();
  });

  test('renders public SubEvent schedule timeline when zero Logistics ContentNodes exist', () => {
    const publicSubEventNodes = [
      {
        id: 'se-pub-1',
        type: 'Schedule' as const,
        tags: ['Homepage', 'Schedule'],
        data: {
          title: 'Public Garden Ceremony',
          startTime: '2026-06-20T15:00:00.000Z',
          endTime: '2026-06-20T16:00:00.000Z',
          locationName: 'Estate Lawn',
          categoryTags: ['Ceremony'],
          isPrivate: false,
          isReadOnly: false,
        },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ];

    render(<HomePageClient config={mockConfig} contentNodes={publicSubEventNodes} />);

    expect(screen.getByText('Public Garden Ceremony')).toBeInTheDocument();
    expect(screen.getByText('Estate Lawn')).toBeInTheDocument();
    expect(screen.queryByText('Details coming soon...')).not.toBeInTheDocument();
    expect(screen.queryByTestId('rsvp-card-se-pub-1')).not.toBeInTheDocument();
  });

  test('localizes hero formattedDate and AddToCalendar event to venue timezone', () => {
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);

    const chicagoConfig: PublicAppConfig = {
      ...mockConfig,
      heroSubtitle: '',
      weddingDate: '2026-09-20T00:00:00.000Z',
      timezone: 'America/Chicago',
      showAddToCalendar: true,
      modules: { countdown: true, gallery: true, addToCalendar: true },
    } as any;

    render(<HomePageClient config={chicagoConfig} />);

    expect(screen.getByText(/September 19, 2026/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add to Calendar' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Google' }));

    expect(openSpy).toHaveBeenCalledTimes(1);
    const googleUrl = new URL(openSpy.mock.calls[0][0] as string);
    expect(googleUrl.searchParams.get('dates')).toBe('20260919T190000/20260920T010000');
    expect(googleUrl.searchParams.get('ctz')).toBe('America/Chicago');

    openSpy.mockRestore();
  });

  test('renders travel cards as native article containers exposing h3 headings and descriptions without button roles and passes axe', async () => {
    const travelContentNodes = [
      {
        id: 'travel-1',
        type: 'Logistics' as const,
        tags: ['Homepage', 'Logistics'],
        data: {
          title: 'Airport & Shuttle',
          description: 'Fly into JFK or LGA; complimentary shuttles depart every 30 minutes.',
        },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: 'travel-2',
        type: 'Logistics' as const,
        tags: ['Homepage', 'Logistics'],
        data: {
          title: 'Local Sightseeing',
          description: 'Explore Central Park and Brooklyn Bridge before the ceremony.',
        },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ];

    const { container } = render(
      <HomePageClient config={mockConfig} contentNodes={travelContentNodes as any} />
    );

    const travelSection = container.querySelector('#travel') as HTMLElement;
    expect(travelSection).toBeInTheDocument();

    const articles = within(travelSection).getAllByRole('article');
    expect(articles).toHaveLength(2);
    for (const article of articles) {
      expect(article).not.toHaveAttribute('tabIndex');
      expect(article).not.toHaveAttribute('aria-label');
      expect(article).not.toHaveAttribute('aria-describedby');
      expect(article).not.toHaveAttribute('role');
      for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
        expect(fireEvent.keyDown(article, { key })).toBe(true);
      }
    }

    expect(within(travelSection).queryAllByRole('button')).toHaveLength(0);
    expect(within(travelSection).getByRole('heading', { level: 3, name: 'Airport & Shuttle' })).toBeInTheDocument();
    expect(within(travelSection).getByRole('heading', { level: 3, name: 'Local Sightseeing' })).toBeInTheDocument();
    expect(within(travelSection).getByText(/complimentary shuttles depart every 30 minutes/i)).toBeInTheDocument();
    expect(within(travelSection).getByText(/Explore Central Park and Brooklyn Bridge/i)).toBeInTheDocument();

    const results = await axe(travelSection);
    expect(results).toHaveNoViolations();
  });

  test('renders subtle accessible Admin Login link in the footer and passes axe', async () => {
    render(<HomePageClient config={mockConfig} />);

    const footer = screen.getByRole('contentinfo');
    const loginLink = within(footer).getByRole('link', { name: /admin login/i });
    expect(loginLink).toBeInTheDocument();
    expect(loginLink).toHaveAttribute('href', '/admin/login');

    const results = await axe(footer);
    expect(results).toHaveNoViolations();
  });
});

