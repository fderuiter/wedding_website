import React from 'react';
import { render, screen } from '@testing-library/react';
import RSVPPage from '../page';

describe('RSVPPage', () => {
  it('renders the page title and text', () => {
    render(<RSVPPage />);
    expect(screen.getByText('Are you invited?')).toBeInTheDocument();
    expect(screen.getByText("We're so excited to celebrate our special day with you.")).toBeInTheDocument();
    expect(screen.getByText('Please RSVP by clicking the link below.')).toBeInTheDocument();
  });

  it('renders the RSVP link with the correct attributes', () => {
    render(<RSVPPage />);
    const rsvpLink = screen.getByText('RSVP Now');
    expect(rsvpLink).toBeInTheDocument();
    expect(rsvpLink).toHaveAttribute('href', 'https://www.icloud.com/invites/0b7SkTB_W6Y1s83A33EmaswkA');
    expect(rsvpLink).toHaveAttribute('target', '_blank');
    expect(rsvpLink).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
