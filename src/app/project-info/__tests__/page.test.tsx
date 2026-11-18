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

    const repoLink = screen.getByRole('link', {
      name: /view on github \(opens in a new tab\)/i,
    });
    expect(repoLink).toBeInTheDocument();
    expect(repoLink).toHaveAttribute(
      'href',
      'https://github.com/fderuiter/wedding_website'
    );
    expect(repoLink).toHaveAttribute('target', '_blank');
    expect(repoLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders all external links with accessible new tab warnings', () => {
    render(<ProjectInfo />);

    const externalLinks = [
      {
        name: /view on github \(opens in a new tab\)/i,
        href: 'https://github.com/fderuiter/wedding_website',
      },
      {
        name: /vercel \(opens in a new tab\)/i,
        href: 'https://vercel.com/',
      },
      {
        name: /netlify \(opens in a new tab\)/i,
        href: 'https://www.netlify.com/',
      },
      {
        name: /readme \(opens in a new tab\)/i,
        href: 'https://github.com/fderuiter/wedding_website#readme',
      },
      {
        name: /contributing\.md \(opens in a new tab\)/i,
        href: 'https://github.com/fderuiter/wedding_website',
      },
      {
        name: /^github \(opens in a new tab\)$/i,
        href: 'https://github.com/fderuiter/wedding_website',
      },
    ];

    for (const { name, href } of externalLinks) {
      const link = screen.getByRole('link', { name });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', href);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });
});
