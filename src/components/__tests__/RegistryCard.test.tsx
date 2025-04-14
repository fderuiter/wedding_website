import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
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

  // Test for onClick handler
  it('calls onClick when the card is clicked', () => {
    const mockOnClick = jest.fn();
    render(<RegistryCard item={mockItem} onClick={mockOnClick} />);
    fireEvent.click(screen.getByText('Test Item')); // Click on an element within the card
    expect(mockOnClick).toHaveBeenCalledTimes(1);
    expect(mockOnClick).toHaveBeenCalledWith(mockItem);
  });

  // Test for image error handling
  it('displays placeholder image if item image fails to load', () => {
    render(<RegistryCard item={{ ...mockItem, image: '/invalid-path.jpg' }} onClick={() => {}} />);
    const img = screen.getByAltText(mockItem.name);
    // Simulate the error event
    fireEvent.error(img);
    // Check if the src is updated to the placeholder
    expect(img).toHaveAttribute('src', '/images/placeholder.jpg');
  });

  // Tests for admin button interactions
  it('calls onEdit when the edit button is clicked', () => {
    const mockOnEdit = jest.fn();
    render(<RegistryCard item={mockItem} onClick={() => {}} isAdmin={true} onEdit={mockOnEdit} onDelete={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    expect(mockOnEdit).toHaveBeenCalledTimes(1);
    expect(mockOnEdit).toHaveBeenCalledWith(mockItem.id);
  });

  it('calls onDelete when the delete button is clicked', () => {
    const mockOnDelete = jest.fn();
    render(<RegistryCard item={mockItem} onClick={() => {}} isAdmin={true} onEdit={() => {}} onDelete={mockOnDelete} />);
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(mockOnDelete).toHaveBeenCalledTimes(1);
    expect(mockOnDelete).toHaveBeenCalledWith(mockItem.id);
  });

  it('does not call onClick when the edit button is clicked', () => {
    const mockOnClick = jest.fn();
    render(<RegistryCard item={mockItem} onClick={mockOnClick} isAdmin={true} onEdit={() => {}} onDelete={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    expect(mockOnClick).not.toHaveBeenCalled();
  });

  it('does not call onClick when the delete button is clicked', () => {
    const mockOnClick = jest.fn();
    render(<RegistryCard item={mockItem} onClick={mockOnClick} isAdmin={true} onEdit={() => {}} onDelete={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(mockOnClick).not.toHaveBeenCalled();
  });

  // Add more tests for click handlers, image errors, etc.
});
