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

const HomePage = require('../page').default;

describe('Home Page', () => {
  it('renders hero content and navigation after intro finishes', async () => {
    render(<HomePage />);

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
