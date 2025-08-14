import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ProjectInfo from '../page';

// Mock IntersectionObserver for framer-motion's whileInView
beforeAll(() => {
  class MockIntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (global as unknown as { IntersectionObserver: typeof MockIntersectionObserver }).IntersectionObserver = MockIntersectionObserver;
});

describe('ProjectInfo Page', () => {
  it('renders the main heading and repository link', () => {
    render(<ProjectInfo />);

    expect(
      screen.getByRole('heading', { level: 1, name: /about this project/i })
    ).toBeInTheDocument();

    const repoLink = screen.getByRole('link', { name: /view on github/i });
    expect(repoLink).toBeInTheDocument();
    expect(repoLink).toHaveAttribute(
      'href',
      'https://github.com/fderuiter/wedding_website'
    );
  });
});
