import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe } from 'jest-axe';
import RegistryCard from '../RegistryCard';
import RegistryCardSkeleton from '../RegistryCardSkeleton';
import { RegistryItem } from '@/features/registry';
import { ToastProvider } from '@/components/ui/ToastProvider';
import { createMockMedia } from '@/testing/factories/mediaFactory';
import { createMockRegistryItem } from '@/testing/factories/registryFactory';

// Mock data for a registry item
const mockItem: RegistryItem = createMockRegistryItem({
  id: '1',
  name: 'Test Item',
  description: 'A description for the test item.',
  category: 'Test Category',
  price: 99.99,
  image: createMockMedia({ url: '/images/placeholder.png', altText: 'Test Item' }),
  vendorUrl: null,
  quantity: 1,
  isGroupGift: false,
  purchased: false,
  amountContributed: 0,
  contributors: [],
});

describe('RegistryCard', () => {
  it('renders item details correctly', () => {
    const { rerender } = render(<RegistryCard item={mockItem} onClick={() => {}} />);

    // Check if the item name heading (h2 by default), category, and price are displayed
    expect(screen.getByRole('heading', { level: 2, name: 'Test Item' })).toBeInTheDocument();
    expect(screen.getByText('Test Category')).toBeInTheDocument();
    expect(screen.getByText('$99.99')).toBeInTheDocument(); // Note the space added by the component
    const img = screen.getByRole('img');
    expect(img.getAttribute('src')).toContain('placeholder.png');

    rerender(<RegistryCard item={mockItem} onClick={() => {}} headingLevel="h3" />);
    expect(screen.getByRole('heading', { level: 3, name: 'Test Item' })).toBeInTheDocument();
  });

  it('renders Most Wanted badge when isMostWanted is true', () => {
    const mostWantedItem: RegistryItem = { ...mockItem, isMostWanted: true };
    render(<RegistryCard item={mostWantedItem} onClick={() => {}} />);

    const badge = screen.getByTestId('most-wanted-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('Most Wanted');
  });

  it('displays requested and remaining unit count badge when quantity > 1 and hides it when quantity === 1', () => {
    const { rerender } = render(<RegistryCard item={mockItem} onClick={() => {}} />);
    expect(screen.queryByTestId('registry-card-unit-badge')).not.toBeInTheDocument();

    const multiQtyItem: RegistryItem = {
      ...mockItem,
      price: 50,
      quantity: 3,
      amountContributed: 50,
      purchased: false,
    };
    rerender(<RegistryCard item={multiQtyItem} onClick={() => {}} />);
    expect(screen.getByTestId('registry-card-unit-badge')).toHaveTextContent('2 of 3 remaining');
  });

  it('shows unconfigured warning badge for physical group gifts without Stripe or payment handle unless site default handle is provided', () => {
    const physicalGroupItem: RegistryItem = {
      ...mockItem,
      itemType: 'PHYSICAL',
      isGroupGift: true,
      paymentHandle: undefined,
    };
    const { rerender } = render(
      <RegistryCard item={physicalGroupItem} onClick={() => {}} cardCheckoutEnabled={false} />
    );
    expect(screen.getByTestId('unconfigured-fund-card-warning')).toBeInTheDocument();

    rerender(
      <RegistryCard
        item={physicalGroupItem}
        onClick={() => {}}
        cardCheckoutEnabled={false}
        defaultPaymentHandle="@site-default"
        defaultPaymentHandleType="Venmo"
      />
    );
    expect(screen.queryByTestId('unconfigured-fund-card-warning')).not.toBeInTheDocument();
  });

  it('does not render Most Wanted badge when isMostWanted is false or undefined', () => {
    render(<RegistryCard item={mockItem} onClick={() => {}} />);

    expect(screen.queryByTestId('most-wanted-badge')).not.toBeInTheDocument();
  });

  it('renders cash fund badge tag when itemType is CASH_FUND', () => {
    const cashFundItem: RegistryItem = { ...mockItem, itemType: 'CASH_FUND', category: 'Cash Fund' };
    render(<RegistryCard item={cashFundItem} onClick={() => {}} />);

    expect(screen.getByText('Cash Fund', { selector: 'span' })).toBeInTheDocument();
  });

  it('renders claimed status when purchased', () => {
    const purchasedItem = { ...mockItem, purchased: true };
    render(<RegistryCard item={purchasedItem} onClick={() => {}} />);

    expect(screen.getByText('Claimed!')).toBeInTheDocument();
    // Check for opacity class indicating it's claimed
    expect(screen.getByText('Test Item').closest('article[class*="opacity-60"]')).toBeInTheDocument();
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
    expect(progressBar).toHaveAttribute('aria-valuetext', expect.stringContaining('50%'));

    const card = screen.getByTestId('registry-card');
    expect(card).not.toHaveAttribute('aria-label');
  });

  it('handles zero price and zero contribution edge cases safely', () => {
    const zeroPriceItem = { ...mockItem, price: 0, isGroupGift: true, amountContributed: 0 };
    render(<RegistryCard item={zeroPriceItem} onClick={() => {}} />);

    expect(screen.getByText('0%')).toBeInTheDocument();
    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveAttribute('aria-valuenow', '0');
    expect(progressBar).toHaveAttribute('aria-valuetext', expect.stringContaining('0%'));
    const card = screen.getByTestId('registry-card');
    expect(card).not.toHaveAttribute('aria-label');
  });

  it('caps percentage display at 100% when contributions exceed total price', () => {
    const overFundedItem = { ...mockItem, price: 100, isGroupGift: true, amountContributed: 150 };
    render(<RegistryCard item={overFundedItem} onClick={() => {}} />);

    expect(screen.getByText('100%')).toBeInTheDocument();
    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveAttribute('aria-valuenow', '100');
    expect(progressBar).toHaveAttribute('aria-valuetext', expect.stringContaining('100%'));
    const card = screen.getByTestId('registry-card');
    expect(card).not.toHaveAttribute('aria-label');
  });

  it('renders fully funded status for purchased group gift', () => {
    const fundedGroupGift = { ...mockItem, isGroupGift: true, purchased: true, amountContributed: 99.99 };
    render(<RegistryCard item={fundedGroupGift} onClick={() => {}} />);

    expect(screen.getByText('Fully Funded!')).toBeInTheDocument();
    // Check for opacity class indicating it's claimed/funded
    expect(screen.getByText('Test Item').closest('article[class*="opacity-60"]')).toBeInTheDocument();
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
    render(<RegistryCard item={{ ...mockItem, image: createMockMedia({ url: '/invalid-path.jpg', altText: 'Test Item' }) }} onClick={() => {}} />);
    const img = screen.getByRole('img');
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

  it('is rendered as an article without role="region" or aria-label when clickable, keeps Share and Contribute buttons keyboard-operable, and passes axe audit', async () => {
    const mockOnClick = jest.fn();
    const { container } = render(<RegistryCard item={mockItem} onClick={mockOnClick} />);
    const card = screen.getByTestId('registry-card');

    expect(card.tagName).toBe('ARTICLE');
    expect(card).toHaveAttribute('tabIndex', '-1');
    expect(card).not.toHaveAttribute('role');
    expect(card).not.toHaveAttribute('aria-label');
    expect(card).not.toHaveAttribute('aria-describedby');

    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
      expect(fireEvent.keyDown(card, { key })).toBe(true);
    }

    const shareButton = screen.getByRole('button', { name: `Share ${mockItem.name}` });
    const contributeButton = screen.getByRole('button', { name: `Contribute to ${mockItem.name}` });
    expect(shareButton).toBeInTheDocument();
    expect(contributeButton).toBeInTheDocument();

    // Pressing Enter or Space on nested Share button must not trigger outer card onClick
    fireEvent.keyDown(shareButton, { key: 'Enter' });
    fireEvent.keyDown(shareButton, { key: ' ' });
    expect(mockOnClick).not.toHaveBeenCalled();

    fireEvent.click(contributeButton);
    expect(mockOnClick).toHaveBeenCalledTimes(1);
    expect(mockOnClick).toHaveBeenCalledWith(mockItem);

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('remains clickable in read-only mode with View Details button and passes axe audit when item is purchased', async () => {
    const mockOnClick = jest.fn();
    const purchasedItem = { ...mockItem, purchased: true };
    const { container } = render(<RegistryCard item={purchasedItem} onClick={mockOnClick} />);
    const card = screen.getByTestId('registry-card');

    expect(card.tagName).toBe('ARTICLE');
    expect(card).toHaveAttribute('tabIndex', '-1');
    expect(card).not.toHaveAttribute('role');
    expect(card).not.toHaveAttribute('aria-label');
    expect(screen.queryByRole('button', { name: /contribute/i })).not.toBeInTheDocument();

    const viewDetailsBtn = screen.getByRole('button', {
      name: `View details for ${purchasedItem.name}`,
    });
    expect(viewDetailsBtn).toHaveTextContent('View Details');

    fireEvent.click(viewDetailsBtn);
    expect(mockOnClick).toHaveBeenCalledTimes(1);
    expect(mockOnClick).toHaveBeenCalledWith(purchasedItem);

    fireEvent.click(card);
    expect(mockOnClick).toHaveBeenCalledTimes(2);

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('renders as an article without tabIndex, role, or aria-label when admin to avoid focus traps', async () => {
    const mockOnClick = jest.fn();
    const { container } = render(<RegistryCard item={mockItem} onClick={mockOnClick} isAdmin={true} />);
    const card = screen.getByTestId('registry-card');

    expect(card.tagName).toBe('ARTICLE');
    expect(card).not.toHaveAttribute('tabIndex');
    expect(card).not.toHaveAttribute('role');
    expect(card).not.toHaveAttribute('aria-label');
    expect(screen.queryByRole('button', { name: /contribute/i })).not.toBeInTheDocument();

    const results = await axe(container);
    expect(results).toHaveNoViolations();
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

  describe('Theme token utilities', () => {
    it('applies semantic theme utility classes for card background, border, placeholder, and badges', () => {
      const sampleItem: RegistryItem = {
        ...mockItem,
        isSample: true,
        itemType: 'CASH_FUND',
        category: 'Honeymoon',
      };
      render(<RegistryCard item={sampleItem} onClick={() => {}} />);

      const card = screen.getByTestId('registry-card');
      expect(card.className).toContain('border-card-border');
      expect(card.className).toContain('bg-card');
      expect(card.className).not.toContain('dark:border-gray-700');
      expect(card.className).not.toContain('bg-white dark:bg-gray-800');

      const sampleBadge = screen.getByTestId('sample-item-badge');
      expect(sampleBadge.className).toContain('bg-badge');
      expect(sampleBadge.className).toContain('text-badge-text');
      expect(sampleBadge.className).toContain('border-card-border');

      const cashFundBadge = screen.getByText('Cash Fund', { selector: 'span' });
      expect(cashFundBadge.className).toContain('bg-badge');
      expect(cashFundBadge.className).toContain('text-badge-text');
      expect(cashFundBadge.className).toContain('border-card-border');
    });
  });
});

