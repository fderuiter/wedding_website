import React from 'react';
import { render, screen } from '@testing-library/react';
import WeddingPartyList from '../WeddingPartyList';
import { weddingPartyMembers } from '@/data/wedding-party';

jest.mock('@/data/wedding-party', () => ({
  weddingPartyMembers: [
    { name: 'John Doe', role: 'Groomsman', bio: 'Bio 1', photo: '/photo1.jpg' },
    { name: 'Jane Smith', role: 'Bridesmaid', bio: 'Bio 2', photo: '/photo2.jpg' },
  ],
}));

describe('WeddingPartyList', () => {
  it('should render a card for each wedding party member', () => {
    render(<WeddingPartyList />);

    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();

    // Check that the correct number of cards are rendered
    const cards = screen.getAllByText(/Groomsman|Bridesmaid/);
    expect(cards).toHaveLength(weddingPartyMembers.length);
  });
});
