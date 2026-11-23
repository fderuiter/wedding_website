/* eslint-disable @typescript-eslint/no-require-imports, react/display-name */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { getAppConfig } from '@/lib/config';

jest.mock('framer-motion', () => {
  const React = require('react');
  const framerMotionProps = [
    'initial',
    'animate',
    'exit',
    'variants',
    'transition',
    'whileHover',
    'whileTap',
    'whileFocus',
    'whileInView',
    'layout',
    'layoutId',
    'onLayoutAnimationComplete',
    'drag',
    'dragConstraints',
    'dragControls',
    'dragElastic',
    'dragMomentum',
    'dragSnapToOrigin',
    'dragTransition',
    'onDragStart',
    'onDrag',
    'onDragEnd',
    'viewport',
    'custom'
  ];

  return {
    __esModule: true,
    motion: new Proxy(
      {
        create: (tag: string) =>
          React.forwardRef(
            (
              { children, style, ...props }: Record<string, unknown> & { children?: React.ReactNode; style?: Record<string, unknown> },
              ref: React.Ref<unknown>
            ) => {
              const filteredProps = Object.keys(props).reduce((acc, key) => {
                if (!framerMotionProps.includes(key)) {
                  acc[key] = props[key];
                }
                return acc;
              }, {} as Record<string, unknown>);
              if (style) {
                const {
                  transformPerspective: _tp,
                  rotateX: _rx,
                  rotateY: _ry,
                  ...restStyle
                } = style;
                filteredProps.style = restStyle;
              }
              return React.createElement(tag, { ref, ...filteredProps }, children);
            }
          ),
      },
      {
        get: (target, tag) => {
          if (tag in target) {
            return target[tag as keyof typeof target];
          }
          return React.forwardRef(
            ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }, ref: React.Ref<unknown>) => {
              const filteredProps = Object.keys(props).reduce((acc, key) => {
                if (!framerMotionProps.includes(key)) {
                  acc[key] = props[key];
                }
                return acc;
              }, {} as Record<string, unknown>);
              return React.createElement(tag as string, { ref, ...filteredProps }, children);
            }
          );
        },
      }
    ),
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useMotionValue: (initial: number) => ({
      get: () => initial,
      set: jest.fn(),
    }),
    useSpring: (val: unknown) => val,
    useTransform: () => '0deg',
  };
});

const defaultMockConfig = {
  brideName: 'Bride',
  groomName: 'Groom',
  weddingDate: new Date('2025-10-10T00:00:00.000Z'),
  baseUrl: 'https://example.com',
  venueName: 'Wedding Venue',
  venueAddress: '123 Wedding St',
  venueCity: 'City',
  venueState: 'State',
  venueZip: '12345',
  latitude: 0.0,
  longitude: 0.0,
  storyText: 'Our story began...',
  venueDescription: 'A beautiful venue...',
  travelAdvice: 'Travel safely...',
};

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn(),
  toPublicAppConfig: jest.fn().mockImplementation((config) => {
    return config;
  })
}));

const mockGetVisibleAttractions = jest.fn();
jest.mock('@/features/attractions', () => ({
  attractionsRepository: {
    getVisibleAttractions: () => mockGetVisibleAttractions(),
  },
}));

const mockGetHomepageLogistics = jest.fn();
jest.mock('@/features/logistics', () => ({
  logisticsService: {
    getHomepageLogistics: () => mockGetHomepageLogistics(),
  },
}));

const mockGetScheduleForGuest = jest.fn();
jest.mock('@/features/sub-events', () => ({
  subEventService: {
    getScheduleForGuest: (...args: unknown[]) => mockGetScheduleForGuest(...args),
  },
}));

const mockEnforceActiveGuestPageSession = jest.fn();
const mockGetGuestInviteSession = jest.fn();
jest.mock('@/core/auth/guestInviteSession', () => ({
  enforceActiveGuestPageSession: () => mockEnforceActiveGuestPageSession(),
  getGuestInviteSession: () => mockGetGuestInviteSession(),
}));

const pageModule = require('../page');
const HomePage = pageModule.default;
const generateMetadata = pageModule.generateMetadata;

describe('Home Page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getAppConfig as jest.Mock).mockResolvedValue({ ...defaultMockConfig });
    mockGetVisibleAttractions.mockResolvedValue([]);
    mockGetHomepageLogistics.mockResolvedValue([]);
    mockGetScheduleForGuest.mockResolvedValue([]);
    mockEnforceActiveGuestPageSession.mockResolvedValue(undefined);
    mockGetGuestInviteSession.mockResolvedValue(null);
  });

  it('renders hero content and navigation after intro finishes', async () => {
    const Component = await HomePage();
    render(Component);

    // Wait for elements to appear after intro
    await screen.findByRole('link', { name: 'Our Story' });
    await screen.findByRole('link', { name: 'View Photos' });

    // Gallery and pre-wedding hero heading render
    expect(screen.getByRole('heading', { name: 'Bride & Groom' })).toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'Our Story' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View Photos' })).toBeInTheDocument();
    
    expect(
      screen.getByRole('navigation', { name: /primary navigation/i })
    ).toBeInTheDocument();

    // Wrapper should not be hidden after intro
    const mainWrapper = document.getElementById('home-main');
    expect(mainWrapper?.parentElement).not.toHaveClass('hidden');
  });

  it('excludes private Schedule and Logistics ContentNodes while rendering public nodes when SubEvent is empty', async () => {
    mockGetHomepageLogistics.mockResolvedValue([
      {
        id: 'priv-sched',
        type: 'Schedule',
        tags: ['Homepage', 'Schedule'],
        data: {
          title: 'Private Rehearsal Dinner',
          startTime: '2026-06-19T18:00:00.000Z',
          isPrivate: true,
        },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: 'priv-log',
        type: 'Logistics',
        tags: ['Homepage', 'Logistics'],
        data: {
          title: 'Private VIP Shuttle',
          description: 'VIP shuttle pickup code',
          isPrivate: 'true',
        },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: 'pub-sched',
        type: 'Schedule',
        tags: ['Homepage', 'Schedule'],
        data: {
          title: 'Public Welcome Ceremony',
          startTime: '2026-06-20T15:00:00.000Z',
          isPrivate: 'false',
        },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: 'pub-log',
        type: 'Logistics',
        tags: ['Homepage', 'Logistics'],
        data: {
          title: 'Public Guest Parking',
          description: 'Complimentary parking at main gate',
          isPrivate: false,
        },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);

    const Component = await HomePage();
    render(Component);

    expect(screen.getByText('Public Welcome Ceremony')).toBeInTheDocument();
    expect(screen.getByText('Public Guest Parking')).toBeInTheDocument();
    expect(screen.queryByText('Private Rehearsal Dinner')).not.toBeInTheDocument();
    expect(screen.queryByText('Private VIP Shuttle')).not.toBeInTheDocument();
    expect(screen.queryByText('VIP shuttle pickup code')).not.toBeInTheDocument();
  });

  it('filters private ContentNodes from nonScheduleNodes while preserving authorized private SubEvents for invited guests', async () => {
    mockGetGuestInviteSession.mockResolvedValue({
      code: 'VIP2026',
      guestName: 'VIP Household',
    });
    mockGetHomepageLogistics.mockResolvedValue([
      {
        id: 'priv-log-vip',
        type: 'Logistics',
        tags: ['Homepage', 'Logistics'],
        data: {
          title: 'Hidden Backstage Logistics',
          description: 'Secret door code',
          isPrivate: 'TRUE',
        },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: 'pub-log-shuttle',
        type: 'Logistics',
        tags: ['Homepage', 'Logistics'],
        data: {
          title: 'Hotel Shuttle Schedule',
          description: 'Shuttles depart on the hour',
          isPrivate: 'false',
        },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    mockGetScheduleForGuest.mockResolvedValue([
      {
        id: 'se-public',
        title: 'Main Garden Ceremony',
        description: 'Outdoor ceremony',
        startTime: new Date('2026-06-20T15:00:00.000Z'),
        endTime: new Date('2026-06-20T16:00:00.000Z'),
        locationName: 'Garden',
        isPrivate: false,
        isReadOnly: false,
        userRsvp: null,
      },
      {
        id: 'se-private-invited',
        title: 'Authorized Rehearsal Toast',
        description: 'Invited family dinner',
        startTime: new Date('2026-06-19T18:00:00.000Z'),
        endTime: new Date('2026-06-19T21:00:00.000Z'),
        locationName: 'Cellar',
        isPrivate: true,
        isReadOnly: false,
        userRsvp: null,
      },
    ]);

    const Component = await HomePage();
    render(Component);

    expect(screen.getByText('Main Garden Ceremony')).toBeInTheDocument();
    expect(screen.getByText('Authorized Rehearsal Toast')).toBeInTheDocument();
    expect(screen.getByText('Hotel Shuttle Schedule')).toBeInTheDocument();
    expect(screen.queryByText('Hidden Backstage Logistics')).not.toBeInTheDocument();
    expect(screen.queryByText('Secret door code')).not.toBeInTheDocument();
  });

  it('renders safe empty schedule state without crashing when all Schedule ContentNodes are private and SubEvent is empty', async () => {
    mockGetHomepageLogistics.mockResolvedValue([
      {
        id: 'priv-sched-1',
        type: 'Schedule',
        tags: ['Homepage', 'Schedule'],
        data: {
          title: 'Hidden Rehearsal Dinner',
          startTime: '2026-06-19T18:00:00.000Z',
          isPrivate: true,
        },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: 'priv-sched-2',
        type: 'Schedule',
        tags: ['Homepage', 'Schedule'],
        data: {
          title: 'Hidden Farewell Brunch',
          startTime: '2026-06-21T10:00:00.000Z',
          isPrivate: 'true',
        },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);

    const Component = await HomePage();
    render(Component);

    expect(screen.getByText('Details coming soon...')).toBeInTheDocument();
    expect(screen.queryByText('Hidden Rehearsal Dinner')).not.toBeInTheDocument();
    expect(screen.queryByText('Hidden Farewell Brunch')).not.toBeInTheDocument();
  });

  it('renders multi-paragraph travel advice, supplemental custom travel cards, and /things-to-do link when attractions module is active', async () => {
    (getAppConfig as jest.Mock).mockResolvedValue({
      ...defaultMockConfig,
      travelAdvice: 'Fly into MSP International Airport.\n\nComplimentary valet parking is available at the north gate.',
      modules: { attractions: true },
    });
    mockGetHomepageLogistics.mockResolvedValue([
      {
        id: 'custom-travel-card',
        type: 'Logistics',
        tags: ['Homepage', 'Logistics'],
        data: {
          title: 'Late Night Ride Share',
          description: 'Use pickup zone B after 11:00 PM.',
        },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);

    const Component = await HomePage();
    const { container } = render(Component);

    const travelSection = container.querySelector('#travel') as HTMLElement;
    expect(travelSection).toBeInTheDocument();
    expect(within(travelSection).getByText('Fly into MSP International Airport.')).toBeInTheDocument();
    expect(within(travelSection).getByText('Complimentary valet parking is available at the north gate.')).toBeInTheDocument();
    expect(within(travelSection).getByText('Late Night Ride Share')).toBeInTheDocument();
    expect(within(travelSection).getByText('Use pickup zone B after 11:00 PM.')).toBeInTheDocument();
    expect(within(travelSection).queryByText('Travel details coming soon...')).not.toBeInTheDocument();

    const guideLink = within(travelSection).getByRole('link', { name: /explore local guide & things to do/i });
    expect(guideLink).toHaveAttribute('href', '/things-to-do');
  });

  it('renders interactive hotel block cards instead of coming-soon text and omits non-hotel attractions', async () => {
    const writeTextMock = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    mockGetVisibleAttractions.mockResolvedValue([
      {
        id: 'hotel-block-1',
        name: 'The Harbor Grand Hotel',
        description: 'Discounted waterfront suites reserved for wedding guests.',
        category: 'hotel',
        website: 'https://example.com/harbor-grand',
        directions: 'https://maps.google.com/?q=Harbor+Grand',
        latitude: 44.9778,
        longitude: -93.265,
        isVisible: true,
        promoCode: 'HARBOR2026',
        roomRate: '$179/night',
        cutoffDate: 'September 1, 2026',
        shuttleInfo: 'Shuttles depart from the main portico at 3:15 PM.',
        bookingUrl: 'https://example.com/book-harbor',
        image: null,
        isSample: false,
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
      },
      {
        id: 'museum-1',
        name: 'City Art Institute',
        description: 'Modern art collection downtown.',
        category: 'museum',
        website: 'https://example.com/art',
        directions: '',
        latitude: 44.97,
        longitude: -93.27,
        isVisible: true,
        promoCode: null,
        roomRate: null,
        cutoffDate: null,
        shuttleInfo: null,
        bookingUrl: '',
        image: null,
        isSample: false,
        createdAt: new Date('2026-02-02T00:00:00.000Z'),
        updatedAt: new Date('2026-02-02T00:00:00.000Z'),
      },
    ]);

    const Component = await HomePage();
    const { container } = render(Component);

    const accommodationsSection = container.querySelector('#accommodations') as HTMLElement;
    expect(accommodationsSection).toBeInTheDocument();
    expect(within(accommodationsSection).getByText('The Harbor Grand Hotel')).toBeInTheDocument();
    expect(within(accommodationsSection).getByText('Discounted waterfront suites reserved for wedding guests.')).toBeInTheDocument();
    expect(within(accommodationsSection).getByText('$179/night')).toBeInTheDocument();
    expect(within(accommodationsSection).getByText('HARBOR2026')).toBeInTheDocument();
    expect(within(accommodationsSection).getByText('September 1, 2026')).toBeInTheDocument();
    expect(within(accommodationsSection).getByText('Shuttles depart from the main portico at 3:15 PM.')).toBeInTheDocument();
    expect(within(accommodationsSection).queryByText('Accommodation details coming soon...')).not.toBeInTheDocument();
    expect(within(accommodationsSection).queryByText('City Art Institute')).not.toBeInTheDocument();

    const bookingLink = within(accommodationsSection).getByRole('link', { name: /book hotel block/i });
    expect(bookingLink).toHaveAttribute('href', 'https://example.com/book-harbor');

    const copyBtn = within(accommodationsSection).getByRole('button', { name: /copy promo code HARBOR2026/i });
    fireEvent.click(copyBtn);
    expect(writeTextMock).toHaveBeenCalledWith('HARBOR2026');
    expect(await within(accommodationsSection).findByText('Copied!')).toBeInTheDocument();
  });

  it('skips attraction queries, hides hotel cards and /things-to-do links when attractions module is disabled, and preserves custom notes', async () => {
    (getAppConfig as jest.Mock).mockResolvedValue({
      ...defaultMockConfig,
      travelAdvice: 'Take Highway 101 North.',
      modules: { attractions: false },
    });
    mockGetHomepageLogistics.mockResolvedValue([
      {
        id: 'acc-note-1',
        type: 'Logistics',
        tags: ['Homepage', 'Logistics'],
        data: {
          title: 'Accommodations',
          description: 'Cabins are available directly on the ranch property.',
        },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);

    const Component = await HomePage();
    render(Component);

    expect(mockGetVisibleAttractions).not.toHaveBeenCalled();
    expect(screen.getByText('Cabins are available directly on the ranch property.')).toBeInTheDocument();
    expect(screen.getByText('Take Highway 101 North.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /explore local guide & things to do/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Accommodation details coming soon...')).not.toBeInTheDocument();
  });

  it('shows coming-soon fallbacks when travel advice, hotel blocks, and custom logistics notes are empty', async () => {
    (getAppConfig as jest.Mock).mockResolvedValue({
      ...defaultMockConfig,
      travelAdvice: '   ',
      modules: { attractions: false },
    });
    mockGetHomepageLogistics.mockResolvedValue([]);

    const Component = await HomePage();
    render(Component);

    expect(screen.getByText('Accommodation details coming soon...')).toBeInTheDocument();
    expect(screen.getByText('Travel details coming soon...')).toBeInTheDocument();
  });

  it('omits TBD and empty venue strings from homepage ceremony details, footer, and Event JSON-LD', async () => {
    (getAppConfig as jest.Mock).mockResolvedValue({
      ...defaultMockConfig,
      venueName: 'TBD',
      venueAddress: '',
      venueCity: 'TBD',
      venueState: '   ',
      venueZip: '',
      heroTitle: '',
      heroSubtitle: '',
    });
    mockGetHomepageLogistics.mockResolvedValue([]);

    const metadata = await generateMetadata();
    const rawJsonLd = metadata.other?.['application/ld+json'];
    expect(rawJsonLd).toBeDefined();
    const parsedJsonLd = JSON.parse(rawJsonLd as string);
    expect(parsedJsonLd['@type']).toBe('Event');
    expect(parsedJsonLd.location).toBeUndefined();

    const Component = await HomePage();
    const { container } = render(Component);

    expect(screen.getByRole('heading', { name: 'Bride & Groom' })).toBeInTheDocument();
    expect(container.textContent).not.toContain('We Tied the Knot!');
    expect(container.textContent).not.toContain('TBD');
  });

  it('includes structured Place and PostalAddress in Event JSON-LD when venue fields are populated', async () => {
    (getAppConfig as jest.Mock).mockResolvedValue({
      ...defaultMockConfig,
      venueName: 'Conservatory Hall',
      venueAddress: '500 Park Ave',
      venueCity: 'Minneapolis',
      venueState: 'MN',
      venueZip: '55401',
    });

    const metadata = await generateMetadata();
    const parsedJsonLd = JSON.parse(metadata.other['application/ld+json'] as string);
    expect(parsedJsonLd.location).toEqual({
      '@type': 'Place',
      name: 'Conservatory Hall',
      address: {
        '@type': 'PostalAddress',
        streetAddress: '500 Park Ave',
        addressLocality: 'Minneapolis',
        addressRegion: 'MN',
        postalCode: '55401',
        addressCountry: 'US',
      },
    });
  });
});
