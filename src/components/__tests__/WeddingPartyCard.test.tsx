import React from 'react';
import { render, screen } from '@testing-library/react';
import WeddingPartyCard from '../WeddingPartyCard';

describe('WeddingPartyCard', () => {
  const mockMember = {
    name: 'Test Member',
    role: 'Test Role',
    bio: 'Test Bio',
    photo: '/test-photo.jpg',
    link: 'https://test-link.com',
  };

  it('renders member details', () => {
    render(<WeddingPartyCard member={mockMember} />);
    expect(screen.getByText('Test Member')).toBeInTheDocument();
    expect(screen.getByText('Test Role')).toBeInTheDocument();
    expect(screen.getByText('Test Bio')).toBeInTheDocument();
  });

  it('renders a link with a descriptive aria-label', () => {
    render(<WeddingPartyCard member={mockMember} />);
    const link = screen.getByRole('link', { name: 'Learn more about Test Member' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'https://test-link.com');
  });

  it('hides the external link icon from screen readers', () => {
    render(<WeddingPartyCard member={mockMember} />);
    const icon = document.querySelector('svg');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });
});
