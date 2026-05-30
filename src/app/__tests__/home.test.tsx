/* eslint-disable @typescript-eslint/no-require-imports, react/display-name, react-hooks/rules-of-hooks */
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
    motion: new Proxy({}, {
      get: (_target, tag) => {
        return React.forwardRef(({ children, ...props }, ref) => {
          const filteredProps = Object.keys(props).reduce((acc, key) => {
            if (!framerMotionProps.includes(key)) {
              acc[key] = props[key];
            }
            return acc;
          }, {} as Record<string, unknown>);
          return React.createElement(tag as string, { ref, ...filteredProps }, children);
        });
      },
    }),
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

jest.mock('@/components/AddToCalendar', () => ({
  __esModule: true,
  default: () => <button>Add to Calendar</button>,
}));

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
    features: [
      { id: 'hero', title: 'Hero', type: 'Hero', isVisible: true },
      { id: 'story', title: 'Our Story', type: 'Story', isVisible: true },
      { id: 'details', title: 'Details', type: 'Details', isVisible: true },
      { id: 'accommodations', title: 'Accommodations', type: 'Accommodations', isVisible: true },
      { id: 'venue', title: 'Venue', type: 'Venue', isVisible: true },
      { id: 'travel', title: 'Travel', type: 'Travel', isVisible: true },
      { id: 'faq', title: 'FAQ', type: 'FAQ', isVisible: true },
    ]
  })
}));

const HomePage = require('../page').default;

describe('Home Page', () => {
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

    // Wrapper should not be hidden after intro
    const wrapper = screen.getByRole('main').parentElement;
    expect(wrapper).not.toHaveClass('hidden');
  });
});
