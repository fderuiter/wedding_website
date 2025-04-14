
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import RegistryCard from '../RegistryCard';
import { RegistryItem } from '@/types/registry';

// Mock data for a registry item
const mockItem: RegistryItem = {
  id: '1',
  name: 'Test Item',
  description: 'A description for the test item.',
  category: 'Test Category',
  price: 99.99,
  image: '/images/placeholder.jpg',
  vendorUrl: null,
  quantity: 1,
  isGroupGift: false,
  purchased: false,
  amountContributed: 0,
  contributors: [],
};

describe('RegistryCard', () => {
  it('renders item details correctly', () => {
    render(<RegistryCard item={mockItem} onClick={() => {}} />);

    // Check if the item name, category, and price are displayed
    expect(screen.getByText('Test Item')).toBeInTheDocument();
    expect(screen.getByText('Test Category')).toBeInTheDocument();
    expect(screen.getByText('$ 99.99')).toBeInTheDocument(); // Note the space added by the component
    expect(screen.getByAltText('Test Item')).toHaveAttribute('src', '/images/placeholder.jpg');
  });

  it('renders claimed status when purchased', () => {
    const purchasedItem = { ...mockItem, purchased: true };
    render(<RegistryCard item={purchasedItem} onClick={() => {}} />);

    expect(screen.getByText('Claimed!')).toBeInTheDocument();
    // Check for opacity class indicating it's claimed
    expect(screen.getByText('Test Item').closest('div[class*="opacity-50"]')).toBeInTheDocument();
  });

   it('renders group gift details when applicable', () => {
    const groupGiftItem = { ...mockItem, isGroupGift: true, amountContributed: 50 };
    render(<RegistryCard item={groupGiftItem} onClick={() => {}} />);

    expect(screen.getByText(/Group Gift:/)).toBeInTheDocument();
    expect(screen.getByText(/\$50.00 contributed/)).toBeInTheDocument();
  });

  it('renders fully funded status for purchased group gift', () => {
    const fundedGroupGift = { ...mockItem, isGroupGift: true, purchased: true, amountContributed: 99.99 };
    render(<RegistryCard item={fundedGroupGift} onClick={() => {}} />);

    expect(screen.getByText('Fully Funded!')).toBeInTheDocument();
     // Check for opacity class indicating it's claimed/funded
    expect(screen.getByText('Test Item').closest('div[class*="opacity-50"]')).toBeInTheDocument();
  });

  it('renders admin buttons when isAdmin is true', () => {
    render(<RegistryCard item={mockItem} onClick={() => {}} isAdmin={true} onEdit={() => {}} onDelete={() => {}} />);

    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });

  it('does not render admin buttons when isAdmin is false or undefined', () => {
    render(<RegistryCard item={mockItem} onClick={() => {}} />);

    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  // Add more tests for click handlers, image errors, etc.
});
