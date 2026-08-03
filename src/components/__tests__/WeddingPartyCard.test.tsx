import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe } from 'jest-axe';
import WeddingPartyCard from '../WeddingPartyCard';
import type { WeddingPartyMemberDTO } from '@/features/wedding-party';

describe('WeddingPartyCard', () => {
  const mockMemberWithPhoto: WeddingPartyMemberDTO = {
    id: 'member-1',
    name: 'John Doe',
    role: 'Best Man',
    bio: 'John has been the groom\'s best friend since high school. He loves sports and cooking.',
    photoId: 'media-1',
    photoUrl: 'https://example.com/john.jpg',
    photoAlt: 'John smiling',
    photoDecorative: false,
    photo: {
      id: 'media-1',
      url: 'https://example.com/john.jpg',
      altText: 'John smiling',
      isDecorative: false,
    },
    link: 'https://example.com/john-personal-site',
    order: 1,
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-01-01T00:00:00.000Z'),
  };

  const mockMemberNoPhoto: WeddingPartyMemberDTO = {
    id: 'member-2',
    name: 'Jane Smith',
    role: 'Maid of Honor',
    bio: 'Jane is the bride\'s sister and a talented designer.',
    photoId: undefined,
    photoUrl: '',
    photoAlt: null,
    photoDecorative: false,
    photo: undefined,
    link: '',
    order: 2,
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-01-01T00:00:00.000Z'),
  };

  it('renders standard details including name, role, biography and photo correctly', () => {
    render(<WeddingPartyCard member={mockMemberWithPhoto} />);

    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('Best Man')).toBeInTheDocument();
    expect(
      screen.getByText('John has been the groom\'s best friend since high school. He loves sports and cooking.')
    ).toBeInTheDocument();

    const img = screen.getByRole('img');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'https://example.com/john.jpg');
    expect(img).toHaveAttribute('alt', 'John smiling');
  });

  it('renders default image placeholders and fallback alt text when optional photo is missing', () => {
    render(<WeddingPartyCard member={mockMemberNoPhoto} />);

    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    expect(screen.getByText('Maid of Honor')).toBeInTheDocument();

    const img = screen.getByRole('img');
    expect(img).toBeInTheDocument();
    // Falls back to /images/placeholder.png
    expect(img).toHaveAttribute('src', '/images/placeholder.png');
    // Falls back to Photo of [Name]
    expect(img).toHaveAttribute('alt', 'Photo of Jane Smith');
  });

  it('checks all outgoing links to ensure they use correct security attributes', () => {
    render(<WeddingPartyCard member={mockMemberWithPhoto} />);

    const link = screen.getByRole('link', { name: /learn more about john doe/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'https://example.com/john-personal-site');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('does not render link if it is not provided', () => {
    render(<WeddingPartyCard member={mockMemberNoPhoto} />);

    const link = screen.queryByRole('link');
    expect(link).not.toBeInTheDocument();
  });

  it('matches the component snapshot when member has photo and link', () => {
    const { container } = render(<WeddingPartyCard member={mockMemberWithPhoto} />);
    expect(container).toMatchSnapshot();
  });

  it('matches the component snapshot when member has no photo or link', () => {
    const { container } = render(<WeddingPartyCard member={mockMemberNoPhoto} />);
    expect(container).toMatchSnapshot();
  });

  it('evaluates rendered markup with zero accessibility warnings', async () => {
    const { container } = render(<WeddingPartyCard member={mockMemberWithPhoto} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
