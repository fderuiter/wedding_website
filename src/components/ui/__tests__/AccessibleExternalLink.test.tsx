import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe } from 'jest-axe';
import {
  AccessibleExternalLink,
  AccessibleExternalLinkProps,
} from '../AccessibleExternalLink';

describe('AccessibleExternalLink Component', () => {
  it('enforces target="_blank" and rel="noopener noreferrer"', () => {
    render(
      <AccessibleExternalLink href="https://example.com" target="_self" rel="author">
        Example
      </AccessibleExternalLink>
    );

    const link = screen.getByRole('link', { name: /example \(opens in a new tab\)/i });
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders sr-only warning text when aria-label is not provided', () => {
    const { container } = render(
      <AccessibleExternalLink href="https://example.com">
        Visit Website
      </AccessibleExternalLink>
    );

    const link = screen.getByRole('link', { name: 'Visit Website (opens in a new tab)' });
    expect(link).toBeInTheDocument();

    const srOnlySpan = container.querySelector('.sr-only');
    expect(srOnlySpan).toBeInTheDocument();
    expect(srOnlySpan?.textContent?.trim()).toBe('(opens in a new tab)');
  });

  it('combines custom aria-label with new-tab announcement', () => {
    const { container } = render(
      <AccessibleExternalLink
        href="https://example.com"
        aria-label="Read John's biography"
      >
        Bio
      </AccessibleExternalLink>
    );

    const link = screen.getByRole('link', {
      name: "Read John's biography (opens in a new tab)",
    });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute(
      'aria-label',
      "Read John's biography (opens in a new tab)"
    );
    expect(container.querySelector('.sr-only')).toBeNull();
  });

  it('does not duplicate announcement if aria-label already includes it', () => {
    render(
      <AccessibleExternalLink
        href="https://example.com"
        aria-label="Payment link (opens in a new tab)"
      >
        Pay
      </AccessibleExternalLink>
    );

    const link = screen.getByRole('link', {
      name: 'Payment link (opens in a new tab)',
    });
    expect(link).toHaveAttribute('aria-label', 'Payment link (opens in a new tab)');
  });

  it('renders external icon hidden from screen readers when showIcon is true', () => {
    const { container } = render(
      <AccessibleExternalLink
        href="https://example.com"
        showIcon
        iconClassName="w-4 h-4 ml-2"
      >
        View External Source
      </AccessibleExternalLink>
    );

    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveClass('w-4', 'h-4', 'ml-2');
  });

  it('omits icon when showIcon is omitted or false', () => {
    const { container } = render(
      <AccessibleExternalLink href="https://example.com">
        Plain Link
      </AccessibleExternalLink>
    );

    expect(container.querySelector('svg')).toBeNull();
  });

  it('forwards ref to the anchor element', () => {
    const ref = React.createRef<HTMLAnchorElement>();
    render(
      <AccessibleExternalLink ref={ref} href="https://example.com">
        Link with ref
      </AccessibleExternalLink>
    );

    expect(ref.current).toBeInstanceOf(HTMLAnchorElement);
    expect(ref.current?.href).toBe('https://example.com/');
  });

  it('passes axe accessibility audit with zero violations', async () => {
    const { container } = render(
      <nav aria-label="External Resources">
        <AccessibleExternalLink href="https://example.com" showIcon>
          Documentation
        </AccessibleExternalLink>
        <AccessibleExternalLink
          href="https://example.org"
          aria-label="Special Profile"
        >
          Profile
        </AccessibleExternalLink>
      </nav>
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('supports custom srText when provided', () => {
    render(
      <AccessibleExternalLink
        href="https://example.com"
        srText="(external site, opens in new window)"
      >
        Custom Warning
      </AccessibleExternalLink>
    );

    expect(
      screen.getByRole('link', {
        name: 'Custom Warning (external site, opens in new window)',
      })
    ).toBeInTheDocument();
  });

  it('satisfies typing contract with AccessibleExternalLinkProps', () => {
    const props: AccessibleExternalLinkProps = {
      href: 'https://example.com',
      showIcon: true,
      className: 'test-class',
    };
    expect(props.href).toBe('https://example.com');
  });
});
