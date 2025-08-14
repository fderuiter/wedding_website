import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import Modal from '../Modal'; // Adjust the import path as necessary
import { RegistryItem } from '@/types/registry';

// Mock item data
const mockSingleItem: RegistryItem = {
  id: 'item-1',
  name: 'Single Item',
  description: 'A nice single item.',
  price: 100,
  image: '/images/valid.jpg',
  vendorUrl: 'https://example.com',
  quantity: 1,
  category: 'Home',
  isGroupGift: false,
  purchased: false,
  amountContributed: 0,
  contributors: [],
};

const mockGroupItem: RegistryItem = {
  ...mockSingleItem,
  id: 'item-2',
  name: 'Group Item',
  isGroupGift: true,
  amountContributed: 30,
};

const mockPurchasedItem: RegistryItem = {
  ...mockSingleItem,
  id: 'item-3',
  name: 'Purchased Item',
  purchased: true,
  purchaserName: 'Generous Guest',
};

const mockFundedGroupItem: RegistryItem = {
    ...mockGroupItem,
    id: 'item-4',
    name: 'Funded Group Item',
    purchased: true, // Mark as purchased when fully funded
    amountContributed: 100,
    contributors: [
        { name: 'Contributor 1', amount: 50, date: '2023-11-01' }, 
        { name: 'Contributor 2', amount: 50, date: '2023-11-02' }
    ],
};


// Mock functions
const mockOnClose = jest.fn();
const mockOnContribute = jest.fn().mockResolvedValue(undefined); // Mock async function

describe('Modal Component', () => {
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
  });

  it('renders correctly for a single, available item', () => {
    render(<Modal item={mockSingleItem} onClose={mockOnClose} onContribute={mockOnContribute} />);

    expect(screen.getByText('Single Item')).toBeInTheDocument();
    expect(screen.getByText('A nice single item.')).toBeInTheDocument();
    expect(screen.getByText('Price: $100.00')).toBeInTheDocument();
    const img = screen.getByRole('img', { name: 'Single Item' });
    expect(img.getAttribute('src')).toContain('valid.jpg');
    expect(screen.getByRole('link', { name: 'View on Vendor Site' })).toHaveAttribute('href', 'https://example.com');
    expect(screen.getByPlaceholderText('Your Name')).toBeInTheDocument();
    // Corrected button name
    expect(screen.getByRole('button', { name: 'Claim Gift' })).toBeInTheDocument();
    // Group gift contribution input should not be present
    expect(screen.queryByPlaceholderText(/Contribution Amount/)).not.toBeInTheDocument();
  });

  it('renders correctly for a group gift item', () => {
    render(<Modal item={mockGroupItem} onClose={mockOnClose} onContribute={mockOnContribute} />);

    expect(screen.getByText('Group Item')).toBeInTheDocument();
    expect(screen.getByText(/Group Gift - \$30.00 contributed so far./)).toBeInTheDocument();
    expect(screen.getByText(/\$70.00 still needed./)).toBeInTheDocument(); // 100 - 30
    expect(screen.getByPlaceholderText('Your Name')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Contribution Amount (up to $70.00)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit Contribution' })).toBeInTheDocument();
  });

   it('renders correctly for a purchased single item', () => {
    render(<Modal item={mockPurchasedItem} onClose={mockOnClose} onContribute={mockOnContribute} />);

    expect(screen.getByText('Purchased Item')).toBeInTheDocument();
    expect(screen.getByText('This gift has been claimed!')).toBeInTheDocument();
    expect(screen.getByText('Claimed by: Generous Guest')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Claim This Gift' })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Your Name')).not.toBeInTheDocument();
  });

  it('renders correctly for a fully funded group item', () => {
    render(<Modal item={mockFundedGroupItem} onClose={mockOnClose} onContribute={mockOnContribute} />);

    expect(screen.getByText('Funded Group Item')).toBeInTheDocument();
    expect(screen.getByText('This gift is fully funded!')).toBeInTheDocument();
    expect(screen.getByText('Thank you for your generosity!')).toBeInTheDocument(); // Check for contributor thank you message
    expect(screen.queryByRole('button', { name: 'Submit Contribution' })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Your Name')).not.toBeInTheDocument();
  });


  it('calls onClose when the close button is clicked', () => {
    render(<Modal item={mockSingleItem} onClose={mockOnClose} onContribute={mockOnContribute} />);
    fireEvent.click(screen.getByLabelText('Close modal'));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape key is pressed', async () => {
    render(<Modal item={mockSingleItem} onClose={mockOnClose} onContribute={mockOnContribute} />);
    const closeButton = screen.getByLabelText('Close modal');
    await waitFor(() => expect(closeButton).toHaveFocus());

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('loops focus from last to first element with Tab', async () => {
    render(<Modal item={mockSingleItem} onClose={mockOnClose} onContribute={mockOnContribute} />);
    const closeButton = screen.getByLabelText('Close modal');
    await waitFor(() => expect(closeButton).toHaveFocus());
    const claimButton = screen.getByRole('button', { name: 'Claim Gift' });

    claimButton.focus();
    expect(claimButton).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(closeButton).toHaveFocus();
  });

  it('loops focus from first to last element with Shift+Tab', async () => {
    render(<Modal item={mockSingleItem} onClose={mockOnClose} onContribute={mockOnContribute} />);
    const closeButton = screen.getByLabelText('Close modal');
    const claimButton = screen.getByRole('button', { name: 'Claim Gift' });
    await waitFor(() => expect(closeButton).toHaveFocus());

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(claimButton).toHaveFocus();
  });

  it('updates contributor name input', () => {
    render(<Modal item={mockSingleItem} onClose={mockOnClose} onContribute={mockOnContribute} />);
    const nameInput = screen.getByPlaceholderText('Your Name');
    fireEvent.change(nameInput, { target: { value: 'Test User' } });
    expect(nameInput).toHaveValue('Test User');
  });

  it('updates contribution amount input for group gift', () => {
    render(<Modal item={mockGroupItem} onClose={mockOnClose} onContribute={mockOnContribute} />);
    const amountInput = screen.getByPlaceholderText('Contribution Amount (up to $70.00)');
    fireEvent.change(amountInput, { target: { value: '25' } });
    expect(amountInput).toHaveValue(25); // Input type=number returns number
  });

  // --- Validation and Submission Tests ---

  it('shows error if name is missing on contribution/claim', async () => {
    render(<Modal item={mockSingleItem} onClose={mockOnClose} onContribute={mockOnContribute} />);
    // Corrected button name
    fireEvent.click(screen.getByRole('button', { name: 'Claim Gift' }));
    expect(await screen.findByText('Please enter your name.')).toBeInTheDocument();
    expect(mockOnContribute).not.toHaveBeenCalled();
  });

  it('shows error if contribution amount is invalid for group gift', async () => {
    render(<Modal item={mockGroupItem} onClose={mockOnClose} onContribute={mockOnContribute} />);
    fireEvent.change(screen.getByPlaceholderText('Your Name'), { target: { value: 'Test User' } });
    fireEvent.change(screen.getByPlaceholderText('Contribution Amount (up to $70.00)'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Contribution' }));
    expect(await screen.findByText('Please enter a valid contribution amount.')).toBeInTheDocument();
    expect(mockOnContribute).not.toHaveBeenCalled();
  });

  it('shows error if contribution amount exceeds remaining for group gift', async () => {
    render(<Modal item={mockGroupItem} onClose={mockOnClose} onContribute={mockOnContribute} />);
    fireEvent.change(screen.getByPlaceholderText('Your Name'), { target: { value: 'Test User' } });
    fireEvent.change(screen.getByPlaceholderText('Contribution Amount (up to $70.00)'), { target: { value: '80' } }); // More than remaining 70
    fireEvent.click(screen.getByRole('button', { name: 'Submit Contribution' }));
    expect(await screen.findByText('Amount cannot exceed the remaining $70.00.')).toBeInTheDocument();
    expect(mockOnContribute).not.toHaveBeenCalled();
  });

  it('calls onContribute with correct details for single item claim', async () => {
    render(<Modal item={mockSingleItem} onClose={mockOnClose} onContribute={mockOnContribute} />);
    fireEvent.change(screen.getByPlaceholderText('Your Name'), { target: { value: 'Claimer' } });
    // Corrected button name
    fireEvent.click(screen.getByRole('button', { name: 'Claim Gift' }));

    // Check for processing state immediately after click
    expect(screen.getByRole('button', { name: 'Processing...' })).toBeInTheDocument();

    await waitFor(() => {
      expect(mockOnContribute).toHaveBeenCalledTimes(1);
      // For single items, amount sent is the full price
      expect(mockOnContribute).toHaveBeenCalledWith(mockSingleItem.id, 'Claimer', mockSingleItem.price);
    });
  });

  it('calls onContribute with correct details for group gift contribution', async () => {
    render(<Modal item={mockGroupItem} onClose={mockOnClose} onContribute={mockOnContribute} />);
    fireEvent.change(screen.getByPlaceholderText('Your Name'), { target: { value: 'Contributor' } });
    fireEvent.change(screen.getByPlaceholderText('Contribution Amount (up to $70.00)'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Contribution' }));

    // Check for processing state immediately after click
    expect(screen.getByRole('button', { name: 'Processing...' })).toBeInTheDocument();

    await waitFor(() => {
      expect(mockOnContribute).toHaveBeenCalledTimes(1);
      expect(mockOnContribute).toHaveBeenCalledWith(mockGroupItem.id, 'Contributor', 50); // Amount entered
    });
  });

   it('handles contribution submission error', async () => {
    const errorMessage = 'Network Error';
    // Suppress console.error for this specific test
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockOnContribute.mockRejectedValueOnce(new Error(errorMessage)); // Simulate API error

    render(<Modal item={mockGroupItem} onClose={mockOnClose} onContribute={mockOnContribute} />);
    fireEvent.change(screen.getByPlaceholderText('Your Name'), { target: { value: 'Contributor' } });
    fireEvent.change(screen.getByPlaceholderText('Contribution Amount (up to $70.00)'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Contribution' }));

    // Check for the actual error message displayed
    expect(await screen.findByText(errorMessage)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit Contribution' })).toBeInTheDocument(); // Button should be enabled again

    // Restore console.error
    consoleErrorSpy.mockRestore();
  });

  it('displays placeholder image if item image fails to load', () => {
    render(<Modal item={{...mockSingleItem, image: '/invalid-path.jpg'}} onClose={mockOnClose} onContribute={mockOnContribute} />);
    const img = screen.getByRole('img', { name: mockSingleItem.name });
    // Simulate the error event
    fireEvent.error(img);
    // Check if the src is updated to the placeholder
    expect(img).toHaveAttribute('src', '/images/placeholder.png');
  });

});
