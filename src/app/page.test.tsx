import React from 'react';
import { render, screen } from '@testing-library/react';
import Home from './page';

jest.mock('framer-motion', () => ({
  motion: {
    div: (props: any) => <div {...props} />, // Simplify motion.div
    section: (props: any) => <section {...props} />,
    h1: (props: any) => <h1 {...props} />,
    h2: (props: any) => <h2 {...props} />,
    p: (props: any) => <p {...props} />,
    a: (props: any) => <a {...props} />,
    li: (props: any) => <li {...props} />,
  },
}));

jest.mock('next/dynamic', () => (importFn: any, opts: any) => {
  // Return a dummy AddToCalendarButtonClient
  const Dummy = () => <button>Add to Calendar</button>;
  return Dummy;
});

jest.mock('@/components/WeddingScene', () => () => <div>WeddingScene</div>);

describe('Home Page', () => {
  it('renders the hero section', () => {
    render(<Home />);
    expect(screen.getByRole('heading', { name: /abbi & fred/i })).toBeInTheDocument();
    expect(screen.getByText(/april 15, 2025/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /project info/i })).toBeInTheDocument();
  });

  it('renders the Our Story section', () => {
    render(<Home />);
    expect(screen.getByRole('heading', { name: /our story/i })).toBeInTheDocument();
    expect(screen.getByText(/once upon a swipe/i)).toBeInTheDocument();
  });

  it('renders the Celebration Details section', () => {
    render(<Home />);
    expect(screen.getByRole('heading', { name: /celebration details/i })).toBeInTheDocument();
    expect(screen.getByText(/ceremony/i)).toBeInTheDocument();
    expect(screen.getByText(/reception/i)).toBeInTheDocument();
    expect(screen.getByText(/add to calendar/i)).toBeInTheDocument();
  });

  it('renders the WeddingScene section', () => {
    render(<Home />);
    expect(screen.getByRole('heading', { name: /our wedding experience/i })).toBeInTheDocument();
    expect(screen.getByText(/WeddingScene/)).toBeInTheDocument();
  });

  it('renders the open source project link', () => {
    render(<Home />);
    expect(screen.getByRole('link', { name: /view project/i })).toHaveAttribute('href', expect.stringContaining('github.com'));
  });

  it('renders the JSON-LD script tag for SEO', () => {
    render(<Home />);
    const script = document.querySelector('script[type="application/ld+json"]');
    expect(script).toBeInTheDocument();
    expect(script?.textContent).toContain('Abbigayle & Frederick\'s Wedding');
  });
});
