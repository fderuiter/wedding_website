import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import RegistryCard from '../RegistryCard';
import RegistryCardSkeleton from '../RegistryCardSkeleton';
import { RegistryItem } from '@/features/registry';
import { ToastProvider } from '@/components/ui/ToastProvider';

// Mock data for a registry item
const mockItem: RegistryItem = {
  id: '1',
  name: 'Test Item',
  description: 'A description for the test item.',
  category: 'Test Category',
  price: 99.99,
  image: '/images/placeholder.png',
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
    expect(screen.getByText('$99.99')).toBeInTheDocument(); // Note the space added by the component
    const img = screen.getByRole('presentation');
    expect(img.getAttribute('src')).toContain('placeholder.png');
  });

  it('renders claimed status when purchased', () => {
    const purchasedItem = { ...mockItem, purchased: true };
    render(<RegistryCard item={purchasedItem} onClick={() => {}} />);

    expect(screen.getByText('Claimed!')).toBeInTheDocument();
    // Check for opacity class indicating it's claimed
    expect(screen.getByText('Test Item').closest('div[class*="opacity-60"]')).toBeInTheDocument();
  });

  it('renders group gift details when applicable', () => {
    const groupGiftItem = { ...mockItem, price: 100, isGroupGift: true, amountContributed: 50 };
    render(<RegistryCard item={groupGiftItem} onClick={() => {}} />);

    expect(screen.getByText(/Group Gift:/)).toBeInTheDocument();
    expect(screen.getByText(/Group Gift:/)).toHaveTextContent('$50.00');
    expect(screen.getByText('50%')).toBeInTheDocument();

    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toBeInTheDocument();
    expect(progressBar).toHaveAttribute('aria-valuenow', '50');

    const card = screen.getByTestId('registry-card');
    expect(card).toHaveAttribute('aria-label', expect.stringContaining('50% funded'));
  });

  it('handles zero price and zero contribution edge cases safely', () => {
    const zeroPriceItem = { ...mockItem, price: 0, isGroupGift: true, amountContributed: 0 };
    render(<RegistryCard item={zeroPriceItem} onClick={() => {}} />);

    expect(screen.getByText('0%')).toBeInTheDocument();
    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveAttribute('aria-valuenow', '0');
    const card = screen.getByTestId('registry-card');
    expect(card).toHaveAttribute('aria-label', expect.stringContaining('0% funded'));
  });

  it('caps percentage display at 100% when contributions exceed total price', () => {
    const overFundedItem = { ...mockItem, price: 100, isGroupGift: true, amountContributed: 150 };
    render(<RegistryCard item={overFundedItem} onClick={() => {}} />);

    expect(screen.getByText('100%')).toBeInTheDocument();
    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveAttribute('aria-valuenow', '100');
    const card = screen.getByTestId('registry-card');
    expect(card).toHaveAttribute('aria-label', expect.stringContaining('100% funded'));
  });

  it('renders fully funded status for purchased group gift', () => {
    const fundedGroupGift = { ...mockItem, isGroupGift: true, purchased: true, amountContributed: 99.99 };
    render(<RegistryCard item={fundedGroupGift} onClick={() => {}} />);

    expect(screen.getByText('Fully Funded!')).toBeInTheDocument();
    // Check for opacity class indicating it's claimed/funded
    expect(screen.getByText('Test Item').closest('div[class*="opacity-60"]')).toBeInTheDocument();
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
    fireEvent.click(screen.getByText('Test Item'));
    expect(mockOnClick).toHaveBeenCalledTimes(1);
    // Do not check argument, as the handler receives the event
  });

  // Test for image error handling
  it('displays placeholder image if item image fails to load', () => {
    render(<RegistryCard item={{ ...mockItem, image: '/invalid-path.jpg' }} onClick={() => {}} />);
    const img = screen.getByRole('presentation');
    // Simulate the error event
    fireEvent.error(img);
    // Check if the src is updated to the placeholder
    expect(img).toHaveAttribute('src', '/images/placeholder.png');
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

  it('is rendered as a div with role="button" and tabIndex when clickable for keyboard accessibility', () => {
    const mockOnClick = jest.fn();
    render(<RegistryCard item={mockItem} onClick={mockOnClick} />);
    const card = screen.getByTestId('registry-card');

    // It should be rendered as a div with role="button" and tabIndex to avoid invalid nested button elements
    expect(card.tagName).toBe('DIV');
    expect(card).toHaveAttribute('tabIndex', '0');
    expect(card).toHaveAttribute('role', 'button');
  });

  it('renders as a div without tabIndex when item is purchased to avoid focus traps', () => {
    const mockOnClick = jest.fn();
    const purchasedItem = { ...mockItem, purchased: true };
    render(<RegistryCard item={purchasedItem} onClick={mockOnClick} />);
    const card = screen.getByTestId('registry-card');

    // It should be rendered as a div without tabIndex so non-clickable cards stay out of keyboard tab order
    expect(card.tagName).toBe('DIV');
    expect(card).not.toHaveAttribute('tabIndex');
    expect(card).not.toHaveAttribute('role', 'button');
  });

  it('renders as a div without tabIndex when admin to avoid focus traps', () => {
    const mockOnClick = jest.fn();
    render(<RegistryCard item={mockItem} onClick={mockOnClick} isAdmin={true} />);
    const card = screen.getByTestId('registry-card');

    // Admin cards have separate buttons, so card container itself does not have tabIndex
    expect(card.tagName).toBe('DIV');
    expect(card).not.toHaveAttribute('tabIndex');
    expect(card).not.toHaveAttribute('role', 'button');
  });

  it('includes fallback 1 in scale-factor minHeight calculation for RegistryCard and RegistryCardSkeleton', () => {
    render(<RegistryCard item={mockItem} onClick={() => {}} />);
    const card = screen.getByTestId('registry-card');
    expect(card.style.minHeight).toBe('calc(340px * var(--scale-factor, 1))');

    render(<RegistryCardSkeleton />);
    const skeleton = screen.getByTestId('registry-card-skeleton');
    expect(skeleton.style.minHeight).toBe('calc(340px * var(--scale-factor, 1))');
  });

  it('shows overlay and badge for claimed item', () => {
    const purchasedItem = { ...mockItem, purchased: true };
    render(<RegistryCard item={purchasedItem} onClick={() => {}} />);
    // Overlay should be present
    expect(screen.getByText('Claimed')).toBeInTheDocument();
    // Overlay should be visually present
    const overlay = screen.getByText('Claimed').closest('div');
    expect(overlay).toHaveClass('absolute');
  });

  it('shows overlay and badge for fully funded group gift', () => {
    const fundedGroupGift = { ...mockItem, isGroupGift: true, purchased: true };
    render(<RegistryCard item={fundedGroupGift} onClick={() => {}} />);
    expect(screen.getByText('Fully Funded')).toBeInTheDocument();
    const overlay = screen.getByText('Fully Funded').closest('div');
    expect(overlay).toHaveClass('absolute');
  });

  describe('Share functionality', () => {
    let originalShare: any;
    let originalClipboard: any;

    beforeEach(() => {
      originalShare = navigator.share;
      originalClipboard = navigator.clipboard;
    });

    afterEach(() => {
      Object.defineProperty(navigator, 'share', { value: originalShare, writable: true, configurable: true });
      Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, writable: true, configurable: true });
    });

    it('renders share button and copies permalink without triggering card onClick', async () => {
      const mockOnClick = jest.fn();
      const mockWriteText = jest.fn().mockResolvedValue(undefined);

      Object.defineProperty(navigator, 'share', { value: undefined, writable: true, configurable: true });
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: mockWriteText },
        writable: true,
        configurable: true,
      });

      render(
        <ToastProvider>
          <RegistryCard item={mockItem} onClick={mockOnClick} />
        </ToastProvider>
      );

      const shareButton = screen.getByRole('button', { name: `Share ${mockItem.name}` });
      expect(shareButton).toBeInTheDocument();

      fireEvent.click(shareButton);

      await waitFor(() => {
        expect(mockWriteText).toHaveBeenCalledWith(
          expect.stringContaining(`?item=${mockItem.id}`)
        );
      });
      expect(mockOnClick).not.toHaveBeenCalled();
      expect(await screen.findByText('Link copied to clipboard!')).toBeInTheDocument();
    });

    it('uses navigator.share when available', async () => {
      const mockOnClick = jest.fn();
      const mockShare = jest.fn().mockResolvedValue(undefined);

      Object.defineProperty(navigator, 'share', { value: mockShare, writable: true, configurable: true });

      render(
        <ToastProvider>
          <RegistryCard item={mockItem} onClick={mockOnClick} />
        </ToastProvider>
      );

      const shareButton = screen.getByRole('button', { name: `Share ${mockItem.name}` });
      fireEvent.click(shareButton);

      await waitFor(() => {
        expect(mockShare).toHaveBeenCalledWith(
          expect.objectContaining({
            title: mockItem.name,
            url: expect.stringContaining(`?item=${mockItem.id}`),
          })
        );
      });
      expect(mockOnClick).not.toHaveBeenCalled();
    });
  });
});
