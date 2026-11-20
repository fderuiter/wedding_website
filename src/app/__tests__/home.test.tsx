/* eslint-disable @typescript-eslint/no-require-imports, react/display-name */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

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

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({
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
  }),
  toPublicAppConfig: jest.fn().mockImplementation((config) => {
    return config;
  })
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

const HomePage = require('../page').default;

describe('Home Page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

    // Gallery and hero heading render
    expect(screen.getByRole('heading', { name: 'We Tied the Knot!' })).toBeInTheDocument();

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
});
