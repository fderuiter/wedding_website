/* eslint-disable @typescript-eslint/no-require-imports, react/display-name, react-hooks/rules-of-hooks */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('framer-motion', () => {
  const React = require('react');
  return {
    __esModule: true,
    motion: new Proxy({}, {
      get: (_target, tag) => {
        return React.forwardRef(({ children, ...props }, ref) =>
          React.createElement(tag as string, { ref, ...props }, children)
        );
      },
    }),
  };
});

jest.mock('@/components/WeddingIntro', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({ onFinish }: { onFinish?: () => void }) => {
      React.useEffect(() => {
        onFinish?.();
      }, [onFinish]);
      return null;
    },
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
    await screen.findAllByRole('button', { name: 'Add to Calendar' });

    // Hero heading renders
    expect(screen.getByRole('heading', { name: /Abbi.*Fred/ })).toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'Our Story' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add to Calendar' }).length).toBeGreaterThan(0);

    // Wrapper should not be hidden after intro
    const wrapper = screen.getByRole('main').parentElement;
    expect(wrapper).not.toHaveClass('hidden');
  });
});
