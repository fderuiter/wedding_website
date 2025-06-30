import React from 'react';
import { render, screen } from '@testing-library/react';
import ProjectInfo from '../project-info/page';

describe('ProjectInfo Page', () => {
  it('renders the main heading', () => {
    render(<ProjectInfo />);
    expect(screen.getByRole('heading', { name: /about this project/i })).toBeInTheDocument();
  });

  it('renders the technology stack list', () => {
    render(<ProjectInfo />);
    expect(screen.getByText(/Next.js \(App Router\)/)).toBeInTheDocument();
    expect(screen.getByText(/TypeScript & React/)).toBeInTheDocument();
    expect(screen.getByText(/Tailwind CSS/)).toBeInTheDocument();
    expect(screen.getByText(/React Three Fiber, Drei/)).toBeInTheDocument();
    expect(screen.getByText(/Fuse.js/)).toBeInTheDocument();
    expect(screen.getByText(/React Hooks/)).toBeInTheDocument();
  });

  it('renders the GitHub repository link', () => {
    render(<ProjectInfo />);
    const link = screen.getByRole('link', { name: /github repository/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', expect.stringContaining('github.com'));
  });
});
