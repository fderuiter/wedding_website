import React from 'react';
import { render, screen } from '@testing-library/react';
import WeddingPartyCard from '../WeddingPartyCard';
import { WeddingPartyMember } from '@/data/wedding-party';

const mockMember: WeddingPartyMember = {
  name: 'John Doe',
  role: 'Groomsman',
  bio: 'A great friend.',
  photo: '/images/placeholder.png',
  link: 'https://example.com',
};

const mockMemberWithoutLink: WeddingPartyMember = {
    name: 'Jane Doe',
    role: 'Bridesmaid',
    bio: 'A wonderful sister.',
    photo: '/images/placeholder.png',
  };

describe('WeddingPartyCard', () => {
  it('should render the member\'s information correctly', () => {
    render(<WeddingPartyCard member={mockMember} />);

    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('Groomsman')).toBeInTheDocument();
    expect(screen.getByText('A great friend.')).toBeInTheDocument();
    expect(screen.getByAltText('Photo of John Doe')).toBeInTheDocument();

    const link = screen.getByRole('link', { name: /learn more/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'https://example.com');
  });

  it('should not render the link if it is not provided', () => {
    render(<WeddingPartyCard member={mockMemberWithoutLink} />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
