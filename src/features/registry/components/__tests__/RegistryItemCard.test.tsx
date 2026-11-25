import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import { Overlay } from '@/components/ui/Overlay';
import { Dialog } from '@/components/ui/Dialog';

expect.extend(toHaveNoViolations);
import { ThemeProvider } from '@/components/ThemeProvider';
import RegistryItemCard from '../RegistryItemCard'; // Adjust the import path as necessary
import { RegistryItem } from '@/features/registry';
import { GuestSessionProvider } from '../../context/GuestSessionContext';
import { apiClient } from '@/lib/apiClient';
import { ToastProvider } from '@/components/ui/ToastProvider';
import { createMockMedia } from '@/testing/factories/mediaFactory';
import { createMockContributor, createMockRegistryItem } from '@/testing/factories/registryFactory';

jest.mock('@/lib/apiClient', () => {
  const actual = jest.requireActual('@/lib/apiClient');
  return {
    ...actual,
    apiClient: {
      get: jest.fn(),
      delete: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
    },
  };
});

// Mock item data
const mockSingleItem: RegistryItem = createMockRegistryItem({
  id: 'item-1',
  name: 'Single Item',
  description: 'A nice single item.',
  price: 100,
  image: createMockMedia({ id: 'm1', url: '/images/valid.jpg', altText: null, isDecorative: true }),
  vendorUrl: 'https://example.com',
  quantity: 1,
  category: 'Home',
  isGroupGift: false,
  purchased: false,
  amountContributed: 0,
  contributors: [],
});

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
    createMockContributor({ name: 'Contributor 1', amount: 50, date: '2023-11-01' }),
    createMockContributor({ name: 'Contributor 2', amount: 50, date: '2023-11-02' }),
  ],
};


// Mock functions
const mockOnClose = jest.fn();
const mockOnContribute = jest.fn().mockResolvedValue(undefined); // Mock async function

describe('RegistryItemCard Component', () => {
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
  });

  it('renders correctly for a single, available item', () => {
    render(<Overlay isOpen={true} onClose={mockOnClose}><RegistryItemCard item={mockSingleItem} onClose={mockOnClose} onContribute={mockOnContribute} /></Overlay>);

    expect(screen.getByText('Single Item')).toBeInTheDocument();
    expect(screen.getByText('A nice single item.')).toBeInTheDocument();
    expect(screen.getByText('Price: $100.00')).toBeInTheDocument();
    const img = screen.getByRole('presentation');
    expect(img.getAttribute('src')).toContain('valid.jpg');
    const vendorLink = screen.getByRole('link', { name: 'View on Vendor Site (opens in a new tab)' });
    expect(vendorLink).toHaveAttribute('href', 'https://example.com');
    expect(vendorLink).toHaveAttribute('target', '_blank');
    expect(vendorLink).toHaveAttribute('rel', 'noopener noreferrer');
    expect(vendorLink.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    // Using getByLabelText instead of getByPlaceholderText for robustness
    expect(screen.getByLabelText(/Your Name/i)).toBeInTheDocument();
    // Corrected button name
    expect(screen.getByRole('button', { name: 'Claim Gift' })).toBeInTheDocument();
    // Group gift contribution input should not be present
    expect(screen.queryByLabelText(/Contribution Amount/i)).not.toBeInTheDocument();
  });

  it('renders correctly for a CASH_FUND item with payment handle', () => {
    const cashFundItem: RegistryItem = {
      ...mockGroupItem,
      id: 'cash-fund-1',
      name: 'Honeymoon Cash Fund',
      price: 500,
      itemType: 'CASH_FUND',
      paymentHandleType: 'Venmo',
      paymentHandle: '@happy-couple',
      amountContributed: 100,
    };

    render(
      <Overlay isOpen={true} onClose={mockOnClose}>
        <RegistryItemCard item={cashFundItem} onClose={mockOnClose} onContribute={mockOnContribute} />
      </Overlay>
    );

    expect(screen.getByText('Honeymoon Cash Fund')).toBeInTheDocument();
    expect(screen.getByText('Target Goal: $500.00')).toBeInTheDocument();
    expect(screen.getByText('Send directly via Venmo:')).toBeInTheDocument();
    expect(screen.getByText('@happy-couple')).toBeInTheDocument();
    expect(screen.getByText(/Fund Contributions - \$100.00 contributed so far./)).toBeInTheDocument();
  });

  it('renders correctly for an EXPERIENCE_FUND item with payment handle', () => {
    const experienceFundItem: RegistryItem = {
      ...mockGroupItem,
      id: 'exp-fund-1',
      name: 'Scuba Diving Tour',
      price: 300,
      itemType: 'EXPERIENCE_FUND',
      paymentHandleType: 'Zelle',
      paymentHandle: 'couple@example.com',
      amountContributed: 0,
    };

    render(
      <Overlay isOpen={true} onClose={mockOnClose}>
        <RegistryItemCard item={experienceFundItem} onClose={mockOnClose} onContribute={mockOnContribute} />
      </Overlay>
    );

    expect(screen.getByText('Scuba Diving Tour')).toBeInTheDocument();
    expect(screen.getByText('Target Goal: $300.00')).toBeInTheDocument();
    expect(screen.getByText('Send directly via Zelle:')).toBeInTheDocument();
    expect(screen.getByText('couple@example.com')).toBeInTheDocument();
    expect(screen.getByText(/Fund Contributions - \$0.00 contributed so far./)).toBeInTheDocument();
  });

  it('renders correctly for a group gift item', () => {
    render(<Overlay isOpen={true} onClose={mockOnClose}><RegistryItemCard item={mockGroupItem} onClose={mockOnClose} onContribute={mockOnContribute} /></Overlay>);

    expect(screen.getByText('Group Item')).toBeInTheDocument();
    expect(screen.getByText(/Group Gift - \$30.00 contributed so far./)).toBeInTheDocument();
    expect(screen.getByText(/\$70.00 still needed./)).toBeInTheDocument(); // 100 - 30
    expect(screen.getByLabelText(/Your Name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Contribution Amount/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit Contribution' })).toBeInTheDocument();

    // Check for progress bar accessibility
    const progressBar = screen.getByRole('progressbar', { name: /Gift funding progress/i });
    expect(progressBar).toBeInTheDocument();
    expect(progressBar).toHaveAttribute('aria-valuenow', '30');
    expect(progressBar).toHaveAttribute('aria-valuemax', '100');
  });

  it('renders read-only details without checkout inputs, payment prompts, or purchaser PII for guests on a purchased single item', () => {
    const purchasedWithLinkAndHandle = {
      ...mockPurchasedItem,
      vendorUrl: 'https://vendor.example.com/gift',
      paymentHandleType: 'Venmo',
      paymentHandle: '@couple-venmo',
      shippingAddress: {
        recipientName: 'Alex & Sam',
        addressLine1: '100 Wedding Way',
        city: 'Austin',
        state: 'TX',
        zipCode: '78701',
        country: 'USA',
      },
    };
    render(
      <Overlay isOpen={true} onClose={mockOnClose}>
        <RegistryItemCard
          item={purchasedWithLinkAndHandle}
          onClose={mockOnClose}
          onContribute={mockOnContribute}
          cardCheckoutEnabled={true}
        />
      </Overlay>
    );

    expect(screen.getByText('Purchased Item')).toBeInTheDocument();
    expect(screen.getByText('A nice single item.')).toBeInTheDocument();
    expect(screen.getByText('Price: $100.00')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View on Vendor Site/i })).toHaveAttribute(
      'href',
      'https://vendor.example.com/gift'
    );
    expect(screen.getByText('This gift has been claimed!')).toBeInTheDocument();
    expect(screen.queryByText(/Claimed by/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Send directly via/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('stripe-payment-notice')).not.toBeInTheDocument();
    expect(screen.queryByTestId('registry-shipping-address-card')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Claim/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Your Name/i)).not.toBeInTheDocument();
  });

  it('renders purchaser name for admins on a purchased single item', () => {
    render(
      <Overlay isOpen={true} onClose={mockOnClose}>
        <RegistryItemCard
          item={mockPurchasedItem}
          onClose={mockOnClose}
          onContribute={mockOnContribute}
          isAdmin={true}
        />
      </Overlay>
    );

    expect(screen.getByText('This gift has been claimed!')).toBeInTheDocument();
    expect(screen.getByText('Claimed by: Generous Guest')).toBeInTheDocument();
  });

  it('renders read-only details without contributor PII for guests on a fully funded group item, while showing contributors to admins', () => {
    const { rerender } = render(
      <Overlay isOpen={true} onClose={mockOnClose}>
        <RegistryItemCard
          item={mockFundedGroupItem}
          onClose={mockOnClose}
          onContribute={mockOnContribute}
        />
      </Overlay>
    );

    expect(screen.getByText('Funded Group Item')).toBeInTheDocument();
    expect(screen.getByText('This gift is fully funded!')).toBeInTheDocument();
    expect(screen.getByText('Thank you for your generosity!')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit Contribution' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Your Name/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Contributors:')).not.toBeInTheDocument();
    expect(screen.queryByText('Contributor 1')).not.toBeInTheDocument();

    rerender(
      <Overlay isOpen={true} onClose={mockOnClose}>
        <RegistryItemCard
          item={mockFundedGroupItem}
          onClose={mockOnClose}
          onContribute={mockOnContribute}
          isAdmin={true}
        />
      </Overlay>
    );

    expect(screen.getByText('Contributors:')).toBeInTheDocument();
    expect(screen.getByText('Contributor 1')).toBeInTheDocument();
    expect(screen.getByText('Contributor 2')).toBeInTheDocument();
    expect(screen.getAllByText('($50.00)')).toHaveLength(2);
  });


  it('calls onClose when the close button is clicked', () => {
    render(<Overlay isOpen={true} onClose={mockOnClose}><RegistryItemCard item={mockSingleItem} onClose={mockOnClose} onContribute={mockOnContribute} /></Overlay>);
    fireEvent.click(screen.getByLabelText('Close modal'));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape key is pressed', async () => {
    render(<Overlay isOpen={true} onClose={mockOnClose}><RegistryItemCard item={mockSingleItem} onClose={mockOnClose} onContribute={mockOnContribute} /></Overlay>);
    const closeButton = screen.getByLabelText('Close modal');
    await waitFor(() => expect(closeButton).toHaveFocus());

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('loops focus from last to first element with Tab', async () => {
    render(<Overlay isOpen={true} onClose={mockOnClose}><RegistryItemCard item={mockSingleItem} onClose={mockOnClose} onContribute={mockOnContribute} /></Overlay>);
    const closeButton = screen.getByLabelText('Close modal');
    await waitFor(() => expect(closeButton).toHaveFocus());
    const claimButton = screen.getByRole('button', { name: 'Claim Gift' });

    claimButton.focus();
    expect(claimButton).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(closeButton).toHaveFocus();
  });

  it('loops focus from first to last element with Shift+Tab', async () => {
    render(<Overlay isOpen={true} onClose={mockOnClose}><RegistryItemCard item={mockSingleItem} onClose={mockOnClose} onContribute={mockOnContribute} /></Overlay>);
    const closeButton = screen.getByLabelText('Close modal');
    const claimButton = screen.getByRole('button', { name: 'Claim Gift' });
    await waitFor(() => expect(closeButton).toHaveFocus());

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(claimButton).toHaveFocus();
  });

  it('updates contributor name input', () => {
    render(<Overlay isOpen={true} onClose={mockOnClose}><RegistryItemCard item={mockSingleItem} onClose={mockOnClose} onContribute={mockOnContribute} /></Overlay>);
    const nameInput = screen.getByLabelText(/Your Name/i);
    fireEvent.change(nameInput, { target: { value: 'Test User' } });
    expect(nameInput).toHaveValue('Test User');
  });

  it('updates contribution amount input for group gift', () => {
    render(<Overlay isOpen={true} onClose={mockOnClose}><RegistryItemCard item={mockGroupItem} onClose={mockOnClose} onContribute={mockOnContribute} /></Overlay>);
    const amountInput = screen.getByLabelText(/Contribution Amount/i);
    fireEvent.change(amountInput, { target: { value: '25' } });
    expect(amountInput).toHaveValue(25); // Input type=number returns number
  });

  // --- Validation and Submission Tests ---

  it('shows error if name is missing on contribution/claim', async () => {
    render(<Overlay isOpen={true} onClose={mockOnClose}><RegistryItemCard item={mockSingleItem} onClose={mockOnClose} onContribute={mockOnContribute} /></Overlay>);
    const nameInput = screen.getByLabelText(/Your Name/i);
    expect(nameInput).not.toHaveAttribute('aria-describedby');
    expect(nameInput).toHaveAttribute('aria-invalid', 'false');

    // Corrected button name
    fireEvent.click(screen.getByRole('button', { name: 'Claim Gift' }));
    const errorMessage = await screen.findByText('Name is required and must be under 100 characters.');
    expect(errorMessage).toBeInTheDocument();
    expect(errorMessage).toHaveAttribute('role', 'alert');
    expect(nameInput).toHaveAttribute('aria-invalid', 'true');
    expect(nameInput).toHaveAttribute('aria-describedby', errorMessage.id);
    expect(mockOnContribute).not.toHaveBeenCalled();
  });

  it('shows error if contribution amount is invalid for group gift', async () => {
    render(<Overlay isOpen={true} onClose={mockOnClose}><RegistryItemCard item={mockGroupItem} onClose={mockOnClose} onContribute={mockOnContribute} /></Overlay>);
    const amountInput = screen.getByLabelText(/Contribution Amount/i);
    expect(amountInput).not.toHaveAttribute('aria-describedby');
    expect(amountInput).toHaveAttribute('aria-invalid', 'false');

    fireEvent.change(screen.getByLabelText(/Your Name/i), { target: { value: 'Test User' } });
    fireEvent.change(amountInput, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Contribution' }));
    const errorMessage = await screen.findByText('Contribution amount must be a positive number.');
    expect(errorMessage).toBeInTheDocument();
    expect(errorMessage).toHaveAttribute('role', 'alert');
    expect(amountInput).toHaveAttribute('aria-invalid', 'true');
    expect(amountInput).toHaveAttribute('aria-describedby', errorMessage.id);
    expect(mockOnContribute).not.toHaveBeenCalled();
  });

  it('shows error if contribution amount exceeds remaining for group gift', async () => {
    render(<Overlay isOpen={true} onClose={mockOnClose}><RegistryItemCard item={mockGroupItem} onClose={mockOnClose} onContribute={mockOnContribute} /></Overlay>);
    const amountInput = screen.getByLabelText(/Contribution Amount/i);

    fireEvent.change(screen.getByLabelText(/Your Name/i), { target: { value: 'Test User' } });
    fireEvent.change(amountInput, { target: { value: '80' } }); // More than remaining 70
    fireEvent.click(screen.getByRole('button', { name: 'Submit Contribution' }));
    const errorMessage = await screen.findByText('Amount cannot exceed the remaining $70.00.');
    expect(errorMessage).toBeInTheDocument();
    expect(errorMessage).toHaveAttribute('role', 'alert');
    expect(amountInput).toHaveAttribute('aria-invalid', 'true');
    expect(amountInput).toHaveAttribute('aria-describedby', errorMessage.id);
    expect(mockOnContribute).not.toHaveBeenCalled();
  });

  it('shows inline error and connects accessibility attributes for invalid email format', async () => {
    render(<Overlay isOpen={true} onClose={mockOnClose}><RegistryItemCard item={mockSingleItem} onClose={mockOnClose} onContribute={mockOnContribute} /></Overlay>);
    const nameInput = screen.getByLabelText(/Your Name/i);
    const emailInput = screen.getByLabelText(/Email Address/i);
    expect(emailInput).not.toHaveAttribute('aria-describedby');
    expect(emailInput).toHaveAttribute('aria-invalid', 'false');

    fireEvent.change(nameInput, { target: { value: 'Valid User' } });
    fireEvent.change(emailInput, { target: { value: 'invalid-email-address' } });
    fireEvent.click(screen.getByRole('button', { name: 'Claim Gift' }));

    const errorMessage = await screen.findByText('Invalid email address.');
    expect(errorMessage).toBeInTheDocument();
    expect(errorMessage).toHaveAttribute('role', 'alert');
    expect(emailInput).toHaveAttribute('aria-invalid', 'true');
    expect(emailInput).toHaveAttribute('aria-describedby', errorMessage.id);
    expect(mockOnContribute).not.toHaveBeenCalled();
  });

  it('displays simultaneous inline errors for name and amount and clears them on input change', async () => {
    render(<Overlay isOpen={true} onClose={mockOnClose}><RegistryItemCard item={mockGroupItem} onClose={mockOnClose} onContribute={mockOnContribute} /></Overlay>);
    const nameInput = screen.getByLabelText(/Your Name/i);
    const amountInput = screen.getByLabelText(/Contribution Amount/i);

    fireEvent.change(nameInput, { target: { value: '' } });
    fireEvent.change(amountInput, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Contribution' }));

    const nameError = await screen.findByText('Name is required and must be under 100 characters.');
    const amountError = await screen.findByText('Contribution amount must be a positive number.');
    expect(nameError).toBeInTheDocument();
    expect(amountError).toBeInTheDocument();
    expect(nameInput).toHaveAttribute('aria-invalid', 'true');
    expect(nameInput).toHaveAttribute('aria-describedby', nameError.id);
    expect(amountInput).toHaveAttribute('aria-invalid', 'true');
    expect(amountInput).toHaveAttribute('aria-describedby', amountError.id);

    // Typing into name clears name error
    fireEvent.change(nameInput, { target: { value: 'Alice' } });
    expect(screen.queryByText('Name is required and must be under 100 characters.')).not.toBeInTheDocument();
    expect(nameInput).not.toHaveAttribute('aria-describedby');

    // Selecting a preset button clears amount error
    const presetButton = screen.getByRole('button', { name: '$50' });
    fireEvent.click(presetButton);
    expect(screen.queryByText('Contribution amount must be a positive number.')).not.toBeInTheDocument();
    expect(amountInput).not.toHaveAttribute('aria-describedby');
  });

  it('shows inline error when personal message exceeds length limit', async () => {
    render(<Overlay isOpen={true} onClose={mockOnClose}><RegistryItemCard item={mockSingleItem} onClose={mockOnClose} onContribute={mockOnContribute} /></Overlay>);
    const nameInput = screen.getByLabelText(/Your Name/i);
    const messageInput = screen.getByLabelText(/Personal Message \(Optional\)/i);
    expect(messageInput).not.toHaveAttribute('aria-describedby');
    expect(messageInput).toHaveAttribute('aria-invalid', 'false');

    fireEvent.change(nameInput, { target: { value: 'Valid User' } });
    fireEvent.change(messageInput, { target: { value: 'a'.repeat(1001) } });
    fireEvent.click(screen.getByRole('button', { name: 'Claim Gift' }));

    const messageError = await screen.findByText('Personal note must be under 1000 characters.');
    expect(messageError).toBeInTheDocument();
    expect(messageError).toHaveAttribute('role', 'alert');
    expect(messageInput).toHaveAttribute('aria-invalid', 'true');
    expect(messageInput).toHaveAttribute('aria-describedby', messageError.id);
    expect(mockOnContribute).not.toHaveBeenCalled();
  });

  it('calls onContribute with correct details for single item claim', async () => {
    (apiClient.post as jest.Mock).mockResolvedValue({
      valid: true,
      code: 'INVITE26',
      guestName: 'Claimer',
    });

    render(<Overlay isOpen={true} onClose={mockOnClose}><RegistryItemCard item={mockSingleItem} onClose={mockOnClose} onContribute={mockOnContribute} /></Overlay>);
    fireEvent.change(screen.getByPlaceholderText('ABCDEF12'), { target: { value: 'INVITE26' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await screen.findByText(/Code verified!/i);

    fireEvent.change(screen.getByLabelText(/Your Name/i), { target: { value: 'Claimer' } });
    // Corrected button name
    fireEvent.click(screen.getByRole('button', { name: 'Claim Gift' }));

    // Check for processing state immediately after click
    expect(screen.getByRole('button', { name: 'Processing...' })).toBeInTheDocument();

    await waitFor(() => {
      expect(mockOnContribute).toHaveBeenCalledTimes(1);
      // For single items, amount sent is the full price plus verified code
      expect(mockOnContribute).toHaveBeenCalledWith(
        mockSingleItem.id,
        'Claimer',
        mockSingleItem.price,
        'INVITE26',
        undefined
      );
    });
  });

  it('allows entering a personal message and passes it to onContribute', async () => {
    (apiClient.post as jest.Mock).mockResolvedValue({
      valid: true,
      code: 'INVITE26',
      guestName: 'Jane Contributor',
    });

    render(
      <Overlay isOpen={true} onClose={mockOnClose}>
        <RegistryItemCard item={mockSingleItem} onClose={mockOnClose} onContribute={mockOnContribute} />
      </Overlay>
    );

    fireEvent.change(screen.getByPlaceholderText('ABCDEF12'), { target: { value: 'INVITE26' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await screen.findByText(/Code verified!/i);

    fireEvent.change(screen.getByLabelText(/Your Name/i), { target: { value: 'Jane Contributor' } });
    fireEvent.change(screen.getByLabelText(/Personal Message/i), { target: { value: 'So happy for you both!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Claim Gift' }));

    await waitFor(() => {
      expect(mockOnContribute).toHaveBeenCalledWith('item-1', 'Jane Contributor', 100, 'INVITE26', 'So happy for you both!');
    });
  });

  it('calls onContribute with correct details for group gift contribution', async () => {
    render(<Overlay isOpen={true} onClose={mockOnClose}><RegistryItemCard item={mockGroupItem} onClose={mockOnClose} onContribute={mockOnContribute} /></Overlay>);
    fireEvent.change(screen.getByLabelText(/Your Name/i), { target: { value: 'Contributor' } });
    fireEvent.change(screen.getByLabelText(/Contribution Amount/i), { target: { value: '50' } });
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

    render(<Overlay isOpen={true} onClose={mockOnClose}><RegistryItemCard item={mockGroupItem} onClose={mockOnClose} onContribute={mockOnContribute} /></Overlay>);
    fireEvent.change(screen.getByLabelText(/Your Name/i), { target: { value: 'Contributor' } });
    fireEvent.change(screen.getByLabelText(/Contribution Amount/i), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Contribution' }));

    // Check for the actual error message displayed
    expect(await screen.findByText(errorMessage)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit Contribution' })).toBeInTheDocument(); // Button should be enabled again

    // Restore console.error
    consoleErrorSpy.mockRestore();
  });

  it('displays placeholder image if item image fails to load', () => {
    render(<Overlay isOpen={true} onClose={mockOnClose}><RegistryItemCard item={{ ...mockSingleItem, image: createMockMedia({ id: 'm2', url: '/invalid-path.jpg', altText: null, isDecorative: true }) }} onClose={mockOnClose} onContribute={mockOnContribute} /></Overlay>);
    const img = screen.getByRole('presentation');
    // Simulate the error event
    fireEvent.error(img);
    // Check if the src is updated to the placeholder
    expect(img).toHaveAttribute('src', '/images/placeholder.png');
  });

  describe('Invitation Code Verification', () => {
    it('allows submission when invitation code field is empty (group gift)', async () => {
      const groupItem = { ...mockSingleItem, id: 'item-1', isGroupGift: true };
      render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard item={groupItem} onClose={mockOnClose} onContribute={mockOnContribute} />
        </Overlay>
      );

      const nameInput = screen.getByLabelText(/Your Name/i);
      fireEvent.change(nameInput, { target: { value: 'Guest Contributor' } });

      const amountInput = screen.getByLabelText(/Contribution Amount/i);
      fireEvent.change(amountInput, { target: { value: '50' } });

      const submitButton = screen.getByRole('button', { name: 'Submit Contribution' });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockOnContribute).toHaveBeenCalledWith('item-1', 'Guest Contributor', 50);
      });
    });

    it('keeps invitation code optional, requires email when claiming without a verified household code, and makes email optional once household code is verified', async () => {
      (apiClient.post as jest.Mock).mockResolvedValue({
        valid: true,
        guestName: 'Guest Contributor',
        code: 'INVITE26',
      });

      render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard item={mockSingleItem} onClose={mockOnClose} onContribute={mockOnContribute} />
        </Overlay>
      );

      const codeInput = screen.getByPlaceholderText('ABCDEF12');
      expect(codeInput).not.toBeRequired();

      const emailInput = screen.getByLabelText(/Email Address \(For confirmation\)/i);
      expect(emailInput).toBeRequired();

      const nameInput = screen.getByLabelText(/Your Name/i);
      fireEvent.change(nameInput, { target: { value: 'Guest Contributor' } });

      const submitButton = screen.getByRole('button', { name: 'Claim Gift' });
      fireEvent.click(submitButton);

      expect(
        await screen.findByText('Email address is required for confirmation.')
      ).toBeInTheDocument();
      expect(mockOnContribute).not.toHaveBeenCalled();

      fireEvent.change(codeInput, { target: { value: 'INVITE26' } });
      fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
      await screen.findByText(/Code verified!/i);
      expect(screen.getByLabelText(/Email Address \(Optional\)/i)).not.toBeRequired();

      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockOnContribute).toHaveBeenCalledWith(
          'item-1',
          'Guest Contributor',
          100,
          'INVITE26',
          undefined
        );
      });
    });

    it('successfully validates invitation code, auto-populates guest name, and allows editing name input', async () => {
      (apiClient.post as jest.Mock).mockResolvedValue({
        valid: true,
        guestName: 'Jane Smith',
        code: 'GOODCODE',
      });

      render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard item={mockSingleItem} onClose={mockOnClose} onContribute={mockOnContribute} />
        </Overlay>
      );

      const codeInput = screen.getByLabelText(/Invitation Code/i);
      fireEvent.change(codeInput, { target: { value: 'GOODCODE' } });
      expect(apiClient.get).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

      await waitFor(() => {
        expect(apiClient.post).toHaveBeenCalledWith(
          '/api/registry/validate-code',
          { code: 'GOODCODE' },
          expect.objectContaining({ signal: expect.any(Object) })
        );
        expect(screen.getByText('Code verified! Name pre-filled.')).toBeInTheDocument();
      });

      const nameInput = screen.getByLabelText(/Your Name/i);
      expect(nameInput).toHaveValue('Jane Smith');
      expect(nameInput).not.toBeDisabled();
      expect(codeInput).toBeDisabled();
    });

    it('shows error message if invitation code is invalid', async () => {
      (apiClient.post as jest.Mock).mockRejectedValue(new Error('Invalid invitation code.'));

      render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard item={mockSingleItem} onClose={mockOnClose} onContribute={mockOnContribute} />
        </Overlay>
      );

      const codeInput = screen.getByLabelText(/Invitation Code/i);
      fireEvent.change(codeInput, { target: { value: 'BADCODE' } });

      const verifyButton = screen.getByRole('button', { name: 'Verify' });
      fireEvent.click(verifyButton);

      await waitFor(() => {
        expect(apiClient.post).toHaveBeenCalledWith(
          '/api/registry/validate-code',
          { code: 'BADCODE' },
          expect.objectContaining({ signal: expect.any(Object) })
        );
        expect(screen.getByText('Invalid invitation code.')).toBeInTheDocument();
      });

      const nameInput = screen.getByLabelText(/Your Name/i);
      expect(nameInput).not.toBeDisabled();
      expect(nameInput).toHaveValue('');
    });

    it('disables the submit button while code verification is in flight', async () => {
      let resolveValidation: (value: any) => void;
      const validationPromise = new Promise((resolve) => {
        resolveValidation = resolve;
      });
      (apiClient.post as jest.Mock).mockReturnValue(validationPromise);

      render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard item={mockSingleItem} onClose={mockOnClose} onContribute={mockOnContribute} />
        </Overlay>
      );

      const codeInput = screen.getByLabelText(/Invitation Code/i);
      fireEvent.change(codeInput, { target: { value: 'INFLIGHT' } });
      fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

      const submitButton = screen.getByRole('button', { name: 'Claim Gift' });
      expect(submitButton).toBeDisabled();

      resolveValidation!({ valid: true, guestName: 'In Flight Guest', code: 'INFLIGHT' });
      await waitFor(() => {
        expect(submitButton).not.toBeDisabled();
      });
    });

    it('isolates field error indicators so only the failing field receives error styling', async () => {
      render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard item={mockGroupItem} onClose={mockOnClose} onContribute={mockOnContribute} />
        </Overlay>
      );

      // Submit with empty name and valid amount
      fireEvent.change(screen.getByLabelText(/Contribution Amount/i), { target: { value: '25' } });
      fireEvent.click(screen.getByRole('button', { name: 'Submit Contribution' }));

      expect(await screen.findByText('Name is required and must be under 100 characters.')).toBeInTheDocument();

      const nameInput = screen.getByLabelText(/Your Name/i);
      const amountInput = screen.getByLabelText(/Contribution Amount/i);

      // Name input should have error border styling
      expect(nameInput.className).toContain('border-[var(--input-error-border');
      // Amount input should remain in default state styling
      expect(amountInput.className).toContain('border-[var(--input-border');
    });

    it('auto-prefills and locks code when GuestSessionContext has an active verified session', async () => {
      (apiClient.get as jest.Mock).mockResolvedValue({
        isVerified: true,
        invitationCode: 'SESSION2026',
        guestName: 'Session Guest',
      });

      render(
        <GuestSessionProvider>
          <Overlay isOpen={true} onClose={mockOnClose}>
            <RegistryItemCard item={mockSingleItem} onClose={mockOnClose} onContribute={mockOnContribute} />
          </Overlay>
        </GuestSessionProvider>
      );

      await waitFor(() => {
        const codeInput = screen.getByLabelText(/Invitation Code/i);
        const nameInput = screen.getByLabelText(/Your Name/i);
        expect(codeInput).toHaveValue('SESSION2026');
        expect(nameInput).toHaveValue('Session Guest');
        expect(codeInput).toBeDisabled();
        expect(screen.getByText('Code verified! Name pre-filled.')).toBeInTheDocument();
      });
    });

    it('clears context session and unlocks code field when clicking Clear', async () => {
      (apiClient.get as jest.Mock).mockResolvedValue({
        isVerified: true,
        invitationCode: 'SESSION2026',
        guestName: 'Session Guest',
      });
      (apiClient.delete as jest.Mock).mockResolvedValue({ success: true });

      render(
        <GuestSessionProvider>
          <Overlay isOpen={true} onClose={mockOnClose}>
            <RegistryItemCard item={mockSingleItem} onClose={mockOnClose} onContribute={mockOnContribute} />
          </Overlay>
        </GuestSessionProvider>
      );

      await waitFor(() => {
        expect(screen.getByLabelText(/Invitation Code/i)).toHaveValue('SESSION2026');
      });

      const clearButton = screen.getByRole('button', { name: 'Clear' });
      fireEvent.click(clearButton);

      await waitFor(() => {
        expect(apiClient.delete).toHaveBeenCalledWith('/api/registry/session');
        const codeInput = screen.getByLabelText(/Invitation Code/i);
        expect(codeInput).not.toBeDisabled();
        expect(codeInput).toHaveValue('');
        expect(screen.getByLabelText(/Your Name/i)).toHaveValue('');
      });
    });
  });

  describe('Share Toolbar', () => {
    let originalClipboard: any;

    beforeEach(() => {
      originalClipboard = navigator.clipboard;
    });

    afterEach(() => {
      Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, writable: true, configurable: true });
    });

    it('renders share gift button and copies permalink on click', async () => {
      const mockWriteText = jest.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: mockWriteText },
        writable: true,
        configurable: true,
      });

      const { container } = render(
        <ToastProvider>
          <Overlay isOpen={true} onClose={mockOnClose}>
            <RegistryItemCard item={mockSingleItem} onClose={mockOnClose} onContribute={mockOnContribute} />
          </Overlay>
        </ToastProvider>
      );

      const shareButton = screen.getByRole('button', {
        name: `Share Gift for ${mockSingleItem.name}`,
      });
      expect(shareButton).toBeInTheDocument();
      expect(
        await axe(container, { rules: { 'label-content-name-mismatch': { enabled: true } } })
      ).toHaveNoViolations();

      fireEvent.click(shareButton);

      await waitFor(() => {
        expect(mockWriteText).toHaveBeenCalledWith(
          expect.stringContaining(`?item=${mockSingleItem.id}`)
        );
      });
      expect(await screen.findByText('Link Copied!')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: `Link Copied! for ${mockSingleItem.name}` })
      ).toBeInTheDocument();
      expect(
        await axe(container, { rules: { 'label-content-name-mismatch': { enabled: true } } })
      ).toHaveNoViolations();
      expect(await screen.findByText('Link copied to clipboard!')).toBeInTheDocument();
    });
  });

  describe('Cash & Experience Fund Processing Fee Disclosure', () => {
    it('displays fee notice banner and itemized calculation card for CASH_FUND items', () => {
      const cashFundItem: RegistryItem = {
        ...mockGroupItem,
        id: 'cash-fund-fee-1',
        name: 'Honeymoon Fund',
        price: 500,
        itemType: 'CASH_FUND',
        amountContributed: 0,
      };

      render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard item={cashFundItem} onClose={mockOnClose} onContribute={mockOnContribute} />
        </Overlay>
      );

      expect(screen.getByText('Payment Processing Fee Notice')).toBeInTheDocument();
      expect(screen.getByText('Standard Fee: 2.5%')).toBeInTheDocument();
      expect(screen.getByText(/Base Contribution Amount:/i)).toBeInTheDocument();
      expect(screen.getByText(/Estimated Card Processing Fee \(2\.5%\):/i)).toBeInTheDocument();
      expect(screen.getByText(/Net Payout Received by Couple:/i)).toBeInTheDocument();
    });

    it('displays fee notice banner for EXPERIENCE_FUND items', () => {
      const experienceFundItem: RegistryItem = {
        ...mockGroupItem,
        id: 'exp-fund-fee-1',
        name: 'Cooking Class Experience',
        price: 200,
        itemType: 'EXPERIENCE_FUND',
        amountContributed: 0,
      };

      render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard item={experienceFundItem} onClose={mockOnClose} onContribute={mockOnContribute} />
        </Overlay>
      );

      expect(screen.getByText('Payment Processing Fee Notice')).toBeInTheDocument();
      expect(screen.getByText('Standard Fee: 2.5%')).toBeInTheDocument();
    });

    it('dynamically recalculates base contribution, fee, and net payout upon user input', () => {
      const cashFundItem: RegistryItem = {
        ...mockGroupItem,
        id: 'cash-fund-recalc',
        name: 'House Downpayment Fund',
        price: 1000,
        itemType: 'CASH_FUND',
        amountContributed: 0,
      };

      render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard item={cashFundItem} onClose={mockOnClose} onContribute={mockOnContribute} />
        </Overlay>
      );

      const amountInput = screen.getByLabelText(/Contribution Amount/i);

      // Initially empty -> $0.00 base, -$0.00 fee, $0.00 net payout
      expect(screen.getAllByText('$0.00').length).toBeGreaterThan(0);

      // Enter $100 -> Base: $100.00, Fee: -$2.50, Net: $97.50
      fireEvent.change(amountInput, { target: { value: '100' } });

      expect(screen.getByText('$100.00')).toBeInTheDocument();
      expect(screen.getByText('-$2.50')).toBeInTheDocument();
      expect(screen.getByText('$97.50')).toBeInTheDocument();

      // Update to $200 -> Base: $200.00, Fee: -$5.00, Net: $195.00
      fireEvent.change(amountInput, { target: { value: '200' } });

      expect(screen.getByText('$200.00')).toBeInTheDocument();
      expect(screen.getByText('-$5.00')).toBeInTheDocument();
      expect(screen.getByText('$195.00')).toBeInTheDocument();
    });

    it('handles zero and invalid non-numeric amount inputs without errors or NaN displays', () => {
      const cashFundItem: RegistryItem = {
        ...mockGroupItem,
        id: 'cash-fund-edge',
        name: 'Travel Fund',
        price: 500,
        itemType: 'CASH_FUND',
        amountContributed: 0,
      };

      render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard item={cashFundItem} onClose={mockOnClose} onContribute={mockOnContribute} />
        </Overlay>
      );

      const amountInput = screen.getByLabelText(/Contribution Amount/i);

      // Enter 0
      fireEvent.change(amountInput, { target: { value: '0' } });
      expect(screen.queryByText(/NaN/i)).not.toBeInTheDocument();
      expect(screen.getAllByText('$0.00').length).toBeGreaterThan(0);

      // Enter negative amount
      fireEvent.change(amountInput, { target: { value: '-20' } });
      expect(screen.queryByText(/NaN/i)).not.toBeInTheDocument();
      expect(screen.getAllByText('$0.00').length).toBeGreaterThan(0);
    });

    it('displays Direct Transfer Notice with 0% fee when a fund has a direct payment handle', () => {
      const cashFundWithHandle: RegistryItem = {
        ...mockGroupItem,
        id: 'cash-fund-handle-1',
        name: 'Honeymoon Direct Fund',
        price: 500,
        itemType: 'CASH_FUND',
        paymentHandleType: 'Venmo',
        paymentHandle: '@happy-couple',
        amountContributed: 0,
      };

      render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard item={cashFundWithHandle} onClose={mockOnClose} onContribute={mockOnContribute} />
        </Overlay>
      );

      expect(screen.getByText('Direct Transfer Notice')).toBeInTheDocument();
      expect(screen.getByText('Standard Fee: 0%')).toBeInTheDocument();
      expect(screen.getByText(/Direct Transfer Fee \(0%\):/i)).toBeInTheDocument();
      expect(screen.getByText(/Net Payout Received by Couple:/i)).toBeInTheDocument();
      expect(screen.queryByText('Payment Processing Fee Notice')).not.toBeInTheDocument();
      expect(screen.queryByText('Standard Fee: 2.5%')).not.toBeInTheDocument();
    });

    it('dynamically calculates 100% net payout and -$0.00 fee for direct transfer fund upon user input', () => {
      const cashFundWithHandle: RegistryItem = {
        ...mockGroupItem,
        id: 'cash-fund-handle-recalc',
        name: 'Travel Direct Fund',
        price: 1000,
        itemType: 'CASH_FUND',
        paymentHandleType: 'Zelle',
        paymentHandle: 'couple@example.com',
        amountContributed: 0,
      };

      render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard item={cashFundWithHandle} onClose={mockOnClose} onContribute={mockOnContribute} />
        </Overlay>
      );

      const amountInput = screen.getByLabelText(/Contribution Amount/i);

      fireEvent.change(amountInput, { target: { value: '150' } });

      expect(screen.getAllByText('$150.00')).toHaveLength(2); // Base contribution $150.00 & Net payout $150.00
      expect(screen.getByText('-$0.00')).toBeInTheDocument();
    });

    it('does NOT render fee notice banner for non-fund items (e.g. PHYSICAL)', () => {
      const physicalItem: RegistryItem = {
        ...mockSingleItem,
        id: 'physical-gift-1',
        name: 'Kitchen Blender',
        price: 150,
        itemType: 'PHYSICAL',
      };

      render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard item={physicalItem} onClose={mockOnClose} onContribute={mockOnContribute} />
        </Overlay>
      );

      expect(screen.queryByText('Payment Processing Fee Notice')).not.toBeInTheDocument();
      expect(screen.queryByText(/Estimated Card Processing Fee/i)).not.toBeInTheDocument();
    });
  });

  describe('QR Code & Payment Deep Links', () => {
    it('renders QR code canvas and deep link for Venmo handle and passes jest-axe', async () => {
      const venmoItem: RegistryItem = {
        ...mockGroupItem,
        id: 'venmo-qr-1',
        name: 'Honeymoon Fund',
        itemType: 'CASH_FUND',
        paymentHandleType: 'Venmo',
        paymentHandle: '@happy-couple',
      };

      const { container } = render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard item={venmoItem} onClose={mockOnClose} onContribute={mockOnContribute} />
        </Overlay>
      );

      const link = screen.getByRole('link', {
        name: 'Open Link for Venmo (opens in a new tab)',
      });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', 'https://venmo.com/u/happy-couple');
      expect(
        await axe(container, { rules: { 'label-content-name-mismatch': { enabled: true } } })
      ).toHaveNoViolations();

      const qrCode = screen.getByLabelText(/QR code to pay via Venmo/i);
      expect(qrCode).toBeInTheDocument();
      expect(screen.getByText('Scan to Pay')).toBeInTheDocument();
    });

    it('renders QR code canvas and deep link for Cash App handle', () => {
      const cashAppItem: RegistryItem = {
        ...mockGroupItem,
        id: 'cashapp-qr-1',
        name: 'House Fund',
        itemType: 'CASH_FUND',
        paymentHandleType: 'Cash App',
        paymentHandle: '$happycouple',
      };

      render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard item={cashAppItem} onClose={mockOnClose} onContribute={mockOnContribute} />
        </Overlay>
      );

      const link = screen.getByRole('link', {
        name: 'Open Link for Cash App (opens in a new tab)',
      });
      expect(link).toHaveAttribute('href', 'https://cash.app/$happycouple');
      expect(screen.getByLabelText(/QR code to pay via Cash App/i)).toBeInTheDocument();
    });

    it('renders QR code canvas and deep link for PayPal handle', () => {
      const payPalItem: RegistryItem = {
        ...mockGroupItem,
        id: 'paypal-qr-1',
        name: 'Dinner Fund',
        itemType: 'EXPERIENCE_FUND',
        paymentHandleType: 'PayPal',
        paymentHandle: '@happycouple',
      };

      render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard item={payPalItem} onClose={mockOnClose} onContribute={mockOnContribute} />
        </Overlay>
      );

      const link = screen.getByRole('link', {
        name: 'Open Link for PayPal (opens in a new tab)',
      });
      expect(link).toHaveAttribute('href', 'https://paypal.me/happycouple');
      expect(screen.getByLabelText(/QR code to pay via PayPal/i)).toBeInTheDocument();
    });

    it('renders Copy Handle button and bank instructions without mailto:, tel:, or QR code for Zelle email and phone handles', async () => {
      const writeTextMock = jest.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextMock },
        configurable: true,
      });

      const zelleEmailItem: RegistryItem = {
        ...mockGroupItem,
        id: 'zelle-email-1',
        name: 'Furniture Fund',
        itemType: 'CASH_FUND',
        paymentHandleType: 'Zelle',
        paymentHandle: 'couple@example.com',
      };

      const { rerender } = render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard item={zelleEmailItem} onClose={mockOnClose} onContribute={mockOnContribute} />
        </Overlay>
      );

      expect(screen.queryByRole('link', { name: /Open Link/i })).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/QR code to pay via Zelle/i)).not.toBeInTheDocument();
      expect(screen.queryByText('Scan to Pay')).not.toBeInTheDocument();
      for (const anchor of screen.queryAllByRole('link')) {
        const href = anchor.getAttribute('href') || '';
        expect(href).not.toMatch(/^(mailto:|tel:)/i);
      }
      expect(screen.getByTestId('zelle-bank-instructions')).toHaveTextContent(/bank's app|banking app/i);

      const copyBtn = screen.getByTestId('copy-payment-handle-button');
      fireEvent.click(copyBtn);
      await waitFor(() => {
        expect(writeTextMock).toHaveBeenCalledWith('couple@example.com');
      });

      const zellePhoneItem: RegistryItem = {
        ...zelleEmailItem,
        id: 'zelle-phone-1',
        paymentHandle: '(555) 867-5309',
      };
      rerender(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard item={zellePhoneItem} onClose={mockOnClose} onContribute={mockOnContribute} />
        </Overlay>
      );

      expect(screen.queryByRole('link', { name: /Open Link/i })).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/QR code to pay via Zelle/i)).not.toBeInTheDocument();
      for (const anchor of screen.queryAllByRole('link')) {
        const href = anchor.getAttribute('href') || '';
        expect(href).not.toMatch(/^(mailto:|tel:)/i);
      }
      expect(screen.getByTestId('copy-payment-handle-button')).toBeInTheDocument();
    });

    it('appends positive contribution amounts to Venmo, Cash App, and PayPal links when entered', () => {
      const venmoItem: RegistryItem = {
        ...mockGroupItem,
        id: 'venmo-amt-1',
        itemType: 'CASH_FUND',
        paymentHandleType: 'Venmo',
        paymentHandle: '@happycouple',
      };

      const { rerender } = render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard item={venmoItem} onClose={mockOnClose} onContribute={mockOnContribute} />
        </Overlay>
      );

      fireEvent.change(screen.getByLabelText(/Contribution Amount/i), { target: { value: '50' } });
      expect(
        screen.getByRole('link', { name: 'Open Link for Venmo (opens in a new tab)' })
      ).toHaveAttribute('href', 'https://venmo.com/u/happycouple?txn=pay&amount=50.00');

      rerender(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard
            item={{ ...venmoItem, id: 'cashapp-amt-1', paymentHandleType: 'Cash App', paymentHandle: '$happycouple' }}
            onClose={mockOnClose}
            onContribute={mockOnContribute}
          />
        </Overlay>
      );
      fireEvent.change(screen.getByLabelText(/Contribution Amount/i), { target: { value: '75.5' } });
      expect(
        screen.getByRole('link', { name: 'Open Link for Cash App (opens in a new tab)' })
      ).toHaveAttribute('href', 'https://cash.app/$happycouple/75.50');

      rerender(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard
            item={{ ...venmoItem, id: 'paypal-amt-1', paymentHandleType: 'PayPal', paymentHandle: '@happycouple' }}
            onClose={mockOnClose}
            onContribute={mockOnContribute}
          />
        </Overlay>
      );
      fireEvent.change(screen.getByLabelText(/Contribution Amount/i), { target: { value: '125' } });
      expect(
        screen.getByRole('link', { name: 'Open Link for PayPal (opens in a new tab)' })
      ).toHaveAttribute('href', 'https://paypal.me/happycouple/125.00');
    });

    it('fires zero network requests across 6+ edits of an 8-character code until Verify, Enter, or submit and allows editing pre-filled email', async () => {
      (apiClient.post as jest.Mock).mockResolvedValue({
        valid: true,
        guestName: 'Jane Smith',
        email: 'jane.invite@example.com',
        code: 'ABCDEF17',
      });

      render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard item={mockSingleItem} onClose={mockOnClose} onContribute={mockOnContribute} />
        </Overlay>
      );

      const codeInput = screen.getByLabelText(/Invitation Code/i);
      for (const candidate of [
        'ABCDEF11',
        'ABCDEF12',
        'ABCDEF13',
        'ABCDEF14',
        'ABCDEF15',
        'ABCDEF16',
        'ABCDEF17',
      ]) {
        fireEvent.change(codeInput, { target: { value: candidate } });
      }

      expect(apiClient.get).toHaveBeenCalledTimes(0);
      expect(apiClient.post).toHaveBeenCalledTimes(0);

      fireEvent.keyDown(codeInput, { key: 'Enter' });

      await waitFor(() => {
        expect(apiClient.post).toHaveBeenCalledTimes(1);
        expect(apiClient.post).toHaveBeenCalledWith(
          '/api/registry/validate-code',
          { code: 'ABCDEF17' },
          expect.objectContaining({ signal: expect.any(AbortSignal) })
        );
        expect(screen.getByText('Code verified! Name pre-filled.')).toBeInTheDocument();
      });

      const emailInput = screen.getByLabelText(/Email Address \(Optional\)/i);
      expect(emailInput).toHaveValue('jane.invite@example.com');

      fireEvent.change(emailInput, { target: { value: 'custom@example.com' } });
      expect(emailInput).toHaveValue('custom@example.com');

      fireEvent.change(emailInput, { target: { value: '' } });
      expect(emailInput).toHaveValue('');
    });

    it('does not render QR code or deep link when handle is not convertible to URL', () => {
      const itemWithoutUrl: RegistryItem = {
        ...mockGroupItem,
        id: 'no-url-1',
        name: 'Custom Gift',
        itemType: 'CASH_FUND',
        paymentHandleType: 'Custom',
        paymentHandle: 'unformatted-text-handle',
      };

      render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard item={itemWithoutUrl} onClose={mockOnClose} onContribute={mockOnContribute} />
        </Overlay>
      );

      expect(screen.getByText('Send directly via Custom:')).toBeInTheDocument();
      expect(screen.getByText('unformatted-text-handle')).toBeInTheDocument();
      expect(screen.queryByText('Open Link')).not.toBeInTheDocument();
      expect(screen.queryByText('Scan to Pay')).not.toBeInTheDocument();
    });

    it('integrates theme colors and preserves accessibility labels with ThemedQRCode', () => {
      const venmoItem: RegistryItem = {
        ...mockGroupItem,
        id: 'themed-qr-test',
        name: 'Honeymoon Fund',
        itemType: 'CASH_FUND',
        paymentHandleType: 'Venmo',
        paymentHandle: '@happy-couple',
      };

      render(
        <ThemeProvider config={{ colorPrimary: '#B91C1C', themePreset: 'classic' }} initialThemeMode="light">
          <Overlay isOpen={true} onClose={mockOnClose}>
            <RegistryItemCard item={venmoItem} onClose={mockOnClose} onContribute={mockOnContribute} />
          </Overlay>
        </ThemeProvider>
      );

      const qrCode = screen.getByLabelText(/QR code to pay via Venmo/i);
      expect(qrCode).toBeInTheDocument();
      expect(screen.getByText('Scan to Pay')).toBeInTheDocument();
    });

    it('renders optional email input field and submits contributor email when provided', async () => {
      (apiClient.post as jest.Mock).mockResolvedValue({
        valid: true,
        code: 'INVITE26',
        guestName: 'Well Wisher',
      });

      render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard item={mockSingleItem} onClose={mockOnClose} onContribute={mockOnContribute} />
        </Overlay>
      );

      fireEvent.change(screen.getByPlaceholderText('ABCDEF12'), { target: { value: 'INVITE26' } });
      fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
      await screen.findByText(/Code verified!/i);

      const nameInput = screen.getByLabelText(/Your Name/i);
      const emailInput = screen.getByLabelText(/Email Address \(Optional\)/i);
      const submitBtn = screen.getByRole('button', { name: 'Claim Gift' });

      expect(emailInput).toBeInTheDocument();

      fireEvent.change(nameInput, { target: { value: 'Well Wisher' } });
      fireEvent.change(emailInput, { target: { value: 'wellwisher@example.com' } });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockOnContribute).toHaveBeenCalledWith('item-1', 'Well Wisher', 100, 'INVITE26', undefined, false, 'wellwisher@example.com');
      });
    });

    it('shows validation error when an invalid email format is entered', async () => {
      render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard item={mockSingleItem} onClose={mockOnClose} onContribute={mockOnContribute} />
        </Overlay>
      );

      const nameInput = screen.getByLabelText(/Your Name/i);
      const emailInput = screen.getByLabelText(/Email Address/i);
      const submitBtn = screen.getByRole('button', { name: 'Claim Gift' });

      fireEvent.change(nameInput, { target: { value: 'Well Wisher' } });
      fireEvent.change(emailInput, { target: { value: 'invalid-email-address' } });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        const errorEl = screen.getByText('Invalid email address.');
        expect(errorEl).toBeInTheDocument();
        expect(emailInput).toHaveAttribute('aria-invalid', 'true');
        expect(emailInput).toHaveAttribute('aria-describedby', errorEl.id);
      });
      expect(mockOnContribute).not.toHaveBeenCalled();
    });
  });

  describe('Fee Coverage Toggle Integration', () => {
    const feeCashFundItem: RegistryItem = {
      ...mockGroupItem,
      id: 'cash-fund-fee-optin',
      name: 'Honeymoon Fund',
      price: 500,
      itemType: 'CASH_FUND',
      amountContributed: 0,
    };

    it('renders unchecked fee coverage checkbox for cash fund items without direct payment handle', () => {
      render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard item={feeCashFundItem} onClose={mockOnClose} onContribute={mockOnContribute} />
        </Overlay>
      );

      const checkbox = screen.getByRole('checkbox', {
        name: /Cover transaction processing fee/i,
      });
      expect(checkbox).toBeInTheDocument();
      expect(checkbox).not.toBeChecked();
    });

    it('toggling fee coverage updates total charge and net payout displays instantly', () => {
      render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard item={feeCashFundItem} onClose={mockOnClose} onContribute={mockOnContribute} />
        </Overlay>
      );

      const amountInput = screen.getByLabelText(/Contribution Amount/i);
      fireEvent.change(amountInput, { target: { value: '100' } });

      const checkbox = screen.getByRole('checkbox', {
        name: /Cover transaction processing fee/i,
      });

      // Before checking: Net payout is $97.50
      expect(screen.getByText('$97.50')).toBeInTheDocument();

      // Check fee coverage
      fireEvent.click(checkbox);
      expect(checkbox).toBeChecked();

      // After checking: Total amount charged is $102.50, Net payout is $100.00
      expect(screen.getByText('Covered Card Processing Fee (2.5%):')).toBeInTheDocument();
      expect(screen.getByText('+$2.50')).toBeInTheDocument();
      expect(screen.getByText('$102.50')).toBeInTheDocument();
      expect(screen.getAllByText('$100.00').length).toBeGreaterThanOrEqual(2); // Base gift $100 & Net payout $100
    });

    it('submits contribution with coverFee=true when checkbox is checked', async () => {
      render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard item={feeCashFundItem} onClose={mockOnClose} onContribute={mockOnContribute} />
        </Overlay>
      );

      fireEvent.change(screen.getByLabelText(/Your Name/i), { target: { value: 'Generous Guest' } });
      fireEvent.change(screen.getByLabelText(/Contribution Amount/i), { target: { value: '100' } });

      const checkbox = screen.getByRole('checkbox', {
        name: /Cover transaction processing fee/i,
      });
      fireEvent.click(checkbox);

      fireEvent.click(screen.getByRole('button', { name: 'Submit Contribution' }));

      await waitFor(() => {
        expect(mockOnContribute).toHaveBeenCalledWith(
          'cash-fund-fee-optin',
          'Generous Guest',
          100,
          undefined,
          undefined,
          true,
          undefined
        );
      });
    });
  });

  describe('Group Gift Preset Contribution Buttons', () => {
    it('renders all fixed presets and full remaining balance button when remaining amount is sufficient', () => {
      const highBalanceItem: RegistryItem = {
        ...mockGroupItem,
        id: 'group-high-balance',
        price: 500,
        amountContributed: 0,
      };

      render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard item={highBalanceItem} onClose={mockOnClose} onContribute={mockOnContribute} />
        </Overlay>
      );

      const presetGroup = screen.getByRole('group', { name: /Contribution presets/i });
      expect(presetGroup).toBeInTheDocument();

      expect(screen.getByRole('button', { name: '$50' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '$100' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '$250' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Full Remaining \(\$500\.00\)/i })).toBeInTheDocument();
    });

    it('filters out preset buttons that exceed the remaining item balance', () => {
      // mockGroupItem has price: 100, amountContributed: 30 -> remaining $70.00
      render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard item={mockGroupItem} onClose={mockOnClose} onContribute={mockOnContribute} />
        </Overlay>
      );

      expect(screen.getByRole('button', { name: '$50' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Full Remaining \(\$70\.00\)/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '$100' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '$250' })).not.toBeInTheDocument();
    });

    it('hides higher fixed tiers and displays only the full remaining balance button when remaining balance is under $50', () => {
      const lowBalanceItem: RegistryItem = {
        ...mockGroupItem,
        id: 'group-low-balance',
        price: 100,
        amountContributed: 75, // remaining: $25.00
      };

      render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard item={lowBalanceItem} onClose={mockOnClose} onContribute={mockOnContribute} />
        </Overlay>
      );

      expect(screen.queryByRole('button', { name: '$50' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '$100' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '$250' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Full Remaining \(\$25\.00\)/i })).toBeInTheDocument();
    });

    it('sets amount input and clears existing error messages on preset button click', async () => {
      render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard item={mockGroupItem} onClose={mockOnClose} onContribute={mockOnContribute} />
        </Overlay>
      );

      const nameInput = screen.getByLabelText(/Your Name/i);
      const amountInput = screen.getByLabelText(/Contribution Amount/i);

      fireEvent.change(nameInput, { target: { value: 'Generous Contributor' } });
      // Enter invalid amount that exceeds remaining ($70.00)
      fireEvent.change(amountInput, { target: { value: '999' } });
      fireEvent.click(screen.getByRole('button', { name: 'Submit Contribution' }));

      expect(await screen.findByText(/Amount cannot exceed the remaining \$70\.00\./i)).toBeInTheDocument();

      // Click $50 preset
      const preset50 = screen.getByRole('button', { name: '$50' });
      fireEvent.click(preset50);

      // Error should be cleared and amount input prefilled
      expect(screen.queryByText(/Amount cannot exceed/i)).not.toBeInTheDocument();
      expect(amountInput).toHaveValue(50);
      expect(preset50).toHaveAttribute('aria-pressed', 'true');

      // Click full remaining balance preset
      const fullPreset = screen.getByRole('button', { name: /Full Remaining \(\$70\.00\)/i });
      fireEvent.click(fullPreset);

      expect(amountInput).toHaveValue(70);
      expect(fullPreset).toHaveAttribute('aria-pressed', 'true');
      expect(preset50).toHaveAttribute('aria-pressed', 'false');
    });

    it('highlights preset button and sets aria-pressed=true when user types matching custom amount', () => {
      render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard item={mockGroupItem} onClose={mockOnClose} onContribute={mockOnContribute} />
        </Overlay>
      );

      const amountInput = screen.getByLabelText(/Contribution Amount/i);
      const preset50 = screen.getByRole('button', { name: '$50' });
      const fullPreset = screen.getByRole('button', { name: /Full Remaining \(\$70\.00\)/i });

      expect(preset50).toHaveAttribute('aria-pressed', 'false');
      expect(fullPreset).toHaveAttribute('aria-pressed', 'false');

      // Type matching 50
      fireEvent.change(amountInput, { target: { value: '50' } });
      expect(preset50).toHaveAttribute('aria-pressed', 'true');
      expect(fullPreset).toHaveAttribute('aria-pressed', 'false');

      // Type matching 70 (full remaining)
      fireEvent.change(amountInput, { target: { value: '70' } });
      expect(preset50).toHaveAttribute('aria-pressed', 'false');
      expect(fullPreset).toHaveAttribute('aria-pressed', 'true');

      // Type non-matching custom value
      fireEvent.change(amountInput, { target: { value: '45' } });
      expect(preset50).toHaveAttribute('aria-pressed', 'false');
      expect(fullPreset).toHaveAttribute('aria-pressed', 'false');
    });

    it('supports keyboard interaction with Enter and Space keys to select presets', () => {
      render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard item={mockGroupItem} onClose={mockOnClose} onContribute={mockOnContribute} />
        </Overlay>
      );

      const amountInput = screen.getByLabelText(/Contribution Amount/i);
      const preset50 = screen.getByRole('button', { name: '$50' });
      const fullPreset = screen.getByRole('button', { name: /Full Remaining \(\$70\.00\)/i });

      // Trigger Enter on $50 preset
      fireEvent.keyDown(preset50, { key: 'Enter' });
      expect(amountInput).toHaveValue(50);
      expect(preset50).toHaveAttribute('aria-pressed', 'true');

      // Trigger Space on full remaining preset
      fireEvent.keyDown(fullPreset, { key: ' ' });
      expect(amountInput).toHaveValue(70);
      expect(fullPreset).toHaveAttribute('aria-pressed', 'true');
      expect(preset50).toHaveAttribute('aria-pressed', 'false');
    });

    it('submits group contribution successfully after selecting a preset button', async () => {
      render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard item={mockGroupItem} onClose={mockOnClose} onContribute={mockOnContribute} />
        </Overlay>
      );

      fireEvent.change(screen.getByLabelText(/Your Name/i), { target: { value: 'Preset Contributor' } });
      fireEvent.click(screen.getByRole('button', { name: '$50' }));

      fireEvent.click(screen.getByRole('button', { name: 'Submit Contribution' }));

      await waitFor(() => {
        expect(mockOnContribute).toHaveBeenCalledWith(
          mockGroupItem.id,
          'Preset Contributor',
          50
        );
      });
    });
  });

  describe('Stripe Elements isolation', () => {
    it('does not mount Elements or call useStripe/useElements for non-group physical items', () => {
      const stripeReact = jest.requireMock('@stripe/react-stripe-js');
      const useStripeSpy = jest.spyOn(stripeReact, 'useStripe');
      const useElementsSpy = jest.spyOn(stripeReact, 'useElements');

      render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard
            item={{ ...mockSingleItem, itemType: 'PHYSICAL' }}
            onClose={mockOnClose}
            onContribute={mockOnContribute}
          />
        </Overlay>
      );

      expect(screen.queryByTestId('stripe-elements-container')).not.toBeInTheDocument();
      expect(useStripeSpy).not.toHaveBeenCalled();
      expect(useElementsSpy).not.toHaveBeenCalled();

      useStripeSpy.mockRestore();
      useElementsSpy.mockRestore();
    });

    it('mounts Elements for physical group gifts when card checkout is active and skips mounting in direct transfer mode', () => {
      render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard
            item={{
              ...mockGroupItem,
              itemType: 'PHYSICAL',
              paymentHandleType: 'Venmo',
              paymentHandle: '@couple-venmo',
            }}
            onClose={mockOnClose}
            onContribute={mockOnContribute}
            cardCheckoutEnabled={true}
            stripePublishableKey="pk_test_12345"
          />
        </Overlay>
      );

      // Dual-mode defaults to direct transfer (0% fee) so Elements is not mounted initially
      expect(screen.queryByTestId('stripe-elements-container')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('radio', { name: /Card Checkout/i }));
      expect(screen.getByTestId('stripe-elements-container')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('radio', { name: /Direct Transfer/i }));
      expect(screen.queryByTestId('stripe-elements-container')).not.toBeInTheDocument();
    });
  });

  describe('Multi-quantity, shipping address, order tracking, and group gift defaults', () => {
    it('renders available unit badge and unit selector for non-group multi-quantity items', async () => {
      const multiQtyItem: RegistryItem = {
        ...mockSingleItem,
        id: 'item-multi-1',
        name: 'Linen Dinner Napkin Set',
        price: 45,
        quantity: 4,
        amountContributed: 45, // 1 unit already claimed -> 3 remaining
        isGroupGift: false,
      };

      (apiClient.post as jest.Mock).mockResolvedValue({
        valid: true,
        code: 'INVITE26',
        guestName: 'Alex Buyer',
      });

      render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard item={multiQtyItem} onClose={mockOnClose} onContribute={mockOnContribute} />
        </Overlay>
      );

      expect(screen.getByTestId('item-unit-count-badge')).toHaveTextContent('3 of 4 remaining (1 claimed)');

      const unitSelect = screen.getByTestId('unit-quantity-select') as HTMLSelectElement;
      expect(unitSelect.options).toHaveLength(3);
      fireEvent.change(unitSelect, { target: { value: '2' } });

      fireEvent.change(screen.getByPlaceholderText('ABCDEF12'), { target: { value: 'INVITE26' } });
      fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
      await screen.findByText(/Code verified!/i);

      fireEvent.change(screen.getByLabelText(/Your Name/i), { target: { value: 'Alex Buyer' } });
      fireEvent.click(screen.getByRole('button', { name: 'Claim Gift' }));

      await waitFor(() => {
        expect(mockOnContribute).toHaveBeenCalledWith(
          'item-multi-1',
          'Alex Buyer',
          90,
          'INVITE26',
          undefined
        );
      });
    });

    it('hides shipping address until invite code is verified, then displays address, copies it, and forwards order tracking details on external claims', async () => {
      (apiClient.post as jest.Mock).mockResolvedValue({
        valid: true,
        code: 'INVITE26',
        guestName: 'Morgan Guest',
      });

      const writeTextMock = jest.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: { writeText: writeTextMock },
      });

      const { rerender } = render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard
            item={mockSingleItem}
            onClose={mockOnClose}
            onContribute={mockOnContribute}
            shippingAddress={null}
          />
        </Overlay>
      );

      expect(screen.queryByTestId('registry-shipping-address-card')).not.toBeInTheDocument();

      rerender(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard
            item={mockSingleItem}
            onClose={mockOnClose}
            onContribute={mockOnContribute}
            shippingAddress={{
              recipientName: 'Alex & Jordan Rivera',
              addressLine1: '742 Evergreen Terrace',
              addressLine2: 'Apt 4B',
              city: 'Portland',
              state: 'OR',
              zip: '97205',
              country: 'United States',
              phone: '(555) 234-5678',
              deliveryNotes: 'Leave on covered porch',
            }}
          />
        </Overlay>
      );

      // Hidden for unverified guests even if prop is supplied, while sign-in prompt is shown
      expect(screen.queryByTestId('registry-shipping-address-card')).not.toBeInTheDocument();
      expect(screen.getByTestId('registry-shipping-signin-prompt')).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: /Sign in with Wedding Passcode/i })
      ).toHaveAttribute('href', '/guest/login?callbackUrl=/registry');

      fireEvent.change(screen.getByPlaceholderText('ABCDEF12'), { target: { value: 'INVITE26' } });
      fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
      await screen.findByText(/Code verified!/i);

      expect(screen.getByTestId('registry-shipping-address-card')).toHaveTextContent('742 Evergreen Terrace');
      expect(screen.getByTestId('registry-shipping-address-card')).toHaveTextContent('Leave on covered porch');

      fireEvent.click(screen.getByTestId('copy-shipping-address-button'));
      await waitFor(() => {
        expect(writeTextMock).toHaveBeenCalledWith(expect.stringContaining('742 Evergreen Terrace'));
      });

      fireEvent.change(screen.getByLabelText(/Your Name/i), { target: { value: 'Morgan Guest' } });
      fireEvent.change(screen.getByLabelText(/Retailer Order Number/i), { target: { value: 'ORD-554433' } });
      fireEvent.change(screen.getByLabelText(/Shipping Carrier/i), { target: { value: 'UPS' } });
      fireEvent.change(screen.getByLabelText(/Tracking Number/i), { target: { value: '1Z999AA10123456784' } });

      fireEvent.click(screen.getByRole('button', { name: 'Claim Gift' }));

      await waitFor(() => {
        expect(mockOnContribute).toHaveBeenCalledWith(
          mockSingleItem.id,
          'Morgan Guest',
          100,
          'INVITE26',
          undefined,
          false,
          undefined,
          undefined,
          {
            retailerOrderNumber: 'ORD-554433',
            carrier: 'UPS',
            trackingNumber: '1Z999AA10123456784',
          }
        );
      });
    });

    it('disables checkout and warns when a physical group gift lacks both Stripe card processing and any payment handle, and enables direct mode with site default handle', () => {
      const unconfiguredPhysicalGroupGift: RegistryItem = {
        ...mockGroupItem,
        id: 'phys-group-unconf',
        itemType: 'PHYSICAL',
        paymentHandleType: undefined,
        paymentHandle: undefined,
      };

      const { rerender } = render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard
            item={unconfiguredPhysicalGroupGift}
            onClose={mockOnClose}
            onContribute={mockOnContribute}
            cardCheckoutEnabled={false}
            isAdmin={true}
          />
        </Overlay>
      );

      expect(screen.getByTestId('admin-fund-config-warning')).toBeInTheDocument();
      expect(screen.getByTestId('fund-checkout-unavailable')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Checkout Disabled/i })).toBeDisabled();

      rerender(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard
            item={unconfiguredPhysicalGroupGift}
            onClose={mockOnClose}
            onContribute={mockOnContribute}
            cardCheckoutEnabled={false}
            defaultPaymentHandleType="Venmo"
            defaultPaymentHandle="@site-default-venmo"
          />
        </Overlay>
      );

      expect(screen.queryByTestId('fund-checkout-unavailable')).not.toBeInTheDocument();
      expect(screen.getByTestId('direct-transfer-instructions')).toHaveTextContent('@site-default-venmo');
    });
  });

  describe('Post-claim lifecycle confirmation and cancellation controls', () => {
    it('renders Reserved badge and lets guest confirm gift sent via signed token', async () => {
      const claimOnContribute = jest.fn().mockResolvedValue({
        claimActions: {
          confirmToken: 'signed-confirm-token-1',
          cancelToken: 'signed-cancel-token-1',
          status: 'RESERVED',
        },
      });
      const mockOnItemUpdated = jest.fn();
      const confirmedItem = {
        ...mockSingleItem,
        purchased: true,
        amountContributed: 100,
        purchaserName: 'Alex Claimer',
      };
      (apiClient.post as jest.Mock).mockImplementation(async (url: string) => {
        if (url === '/api/registry/validate-code') {
          return {
            valid: true,
            code: 'INVITE26',
            guestName: 'Alex Claimer',
          };
        }
        return {
          action: 'confirm',
          status: 'CONFIRMED',
          changed: true,
          item: confirmedItem,
        };
      });

      render(
        <ToastProvider>
          <Overlay isOpen={true} onClose={mockOnClose}>
            <RegistryItemCard
              item={mockSingleItem}
              onClose={mockOnClose}
              onContribute={claimOnContribute}
              onItemUpdated={mockOnItemUpdated}
            />
          </Overlay>
        </ToastProvider>
      );

      fireEvent.change(screen.getByPlaceholderText('ABCDEF12'), { target: { value: 'INVITE26' } });
      fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
      await screen.findByText(/Code verified!/i);

      fireEvent.change(screen.getByLabelText(/Your Name/i), { target: { value: 'Alex Claimer' } });
      fireEvent.click(screen.getByRole('button', { name: 'Claim Gift' }));

      const controls = await screen.findByTestId('post-claim-lifecycle-controls');
      expect(controls).toHaveTextContent('Reserved');

      fireEvent.click(screen.getByTestId('post-claim-confirm-button'));

      await waitFor(() => {
        expect(apiClient.post).toHaveBeenCalledWith('/api/registry/claim', {
          token: 'signed-confirm-token-1',
        });
      });

      expect(await screen.findByText('Confirmed')).toBeInTheDocument();
      expect(
        screen.getByText(/Payment completion confirmed — the couple has been notified of your gift!/i)
      ).toBeInTheDocument();
      expect(mockOnItemUpdated).toHaveBeenCalledWith(confirmedItem);
    });

    it('keeps shipping address and order-tracking cards visible to active passcode claim holders and forwards tracking details on inline confirm', async () => {
      const claimOnContribute = jest.fn().mockResolvedValue({
        claimActions: {
          confirmToken: 'signed-confirm-token-passcode',
          cancelToken: 'signed-cancel-token-passcode',
          status: 'RESERVED',
        },
      });
      (apiClient.post as jest.Mock).mockResolvedValue({
        action: 'confirm',
        status: 'CONFIRMED',
        changed: true,
      });

      render(
        <ToastProvider>
          <Overlay isOpen={true} onClose={mockOnClose}>
            <RegistryItemCard
              item={mockSingleItem}
              onClose={mockOnClose}
              onContribute={claimOnContribute}
              isAdmin={true}
              shippingAddress={{
                recipientName: 'Alex & Jordan Rivera',
                addressLine1: '742 Evergreen Terrace',
                addressLine2: '',
                city: 'Portland',
                state: 'OR',
                zip: '97205',
                country: 'United States',
                phone: '',
                deliveryNotes: '',
              }}
            />
          </Overlay>
        </ToastProvider>
      );

      fireEvent.change(screen.getByLabelText(/Your Name/i), { target: { value: 'Passcode Claimer' } });
      fireEvent.change(screen.getByLabelText(/Email Address/i), {
        target: { value: 'claimer@example.com' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Claim Gift' }));

      await screen.findByTestId('post-claim-lifecycle-controls');
      expect(screen.getByTestId('registry-shipping-address-card')).toHaveTextContent(
        '742 Evergreen Terrace'
      );
      expect(screen.getByTestId('external-order-tracking-fields')).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText(/Retailer Order Number/i), {
        target: { value: '114-2223334' },
      });
      fireEvent.change(screen.getByLabelText(/Shipping Carrier/i), {
        target: { value: 'UPS' },
      });
      fireEvent.change(screen.getByLabelText(/Tracking Number/i), {
        target: { value: '1Z999AA10123456784' },
      });

      fireEvent.click(screen.getByTestId('post-claim-confirm-button'));

      await waitFor(() => {
        expect(apiClient.post).toHaveBeenCalledWith('/api/registry/claim', {
          token: 'signed-confirm-token-passcode',
          retailerOrderNumber: '114-2223334',
          carrier: 'UPS',
          trackingNumber: '1Z999AA10123456784',
        });
      });

      expect(await screen.findByText('Confirmed')).toBeInTheDocument();
      expect(screen.getByTestId('registry-shipping-address-card')).toBeInTheDocument();
      expect(screen.getByTestId('external-order-tracking-fields')).toHaveTextContent(
        '114-2223334'
      );
    });

    it('lets guest cancel a RESERVED claim via signed token and reopens item state', async () => {
      const claimOnContribute = jest.fn().mockResolvedValue({
        claimActions: {
          confirmToken: 'signed-confirm-token-2',
          cancelToken: 'signed-cancel-token-2',
          status: 'RESERVED',
        },
      });
      const mockOnItemUpdated = jest.fn();
      const reopenedItem = {
        ...mockSingleItem,
        purchased: false,
        amountContributed: 0,
        purchaserName: null,
      };
      (apiClient.post as jest.Mock).mockImplementation(async (url: string) => {
        if (url === '/api/registry/validate-code') {
          return {
            valid: true,
            code: 'INVITE26',
            guestName: 'Taylor Guest',
          };
        }
        return {
          action: 'cancel',
          status: 'CANCELLED',
          changed: true,
          item: reopenedItem,
        };
      });

      render(
        <ToastProvider>
          <Overlay isOpen={true} onClose={mockOnClose}>
            <RegistryItemCard
              item={mockSingleItem}
              onClose={mockOnClose}
              onContribute={claimOnContribute}
              onItemUpdated={mockOnItemUpdated}
            />
          </Overlay>
        </ToastProvider>
      );

      fireEvent.change(screen.getByPlaceholderText('ABCDEF12'), { target: { value: 'INVITE26' } });
      fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
      await screen.findByText(/Code verified!/i);

      fireEvent.change(screen.getByLabelText(/Your Name/i), { target: { value: 'Taylor Guest' } });
      fireEvent.click(screen.getByRole('button', { name: 'Claim Gift' }));

      await screen.findByTestId('post-claim-lifecycle-controls');
      fireEvent.click(screen.getByTestId('post-claim-cancel-button'));

      await waitFor(() => {
        expect(apiClient.post).toHaveBeenCalledWith('/api/registry/claim', {
          token: 'signed-cancel-token-2',
        });
      });

      expect(await screen.findByText('Reservation Released')).toBeInTheDocument();
      expect(screen.getByText('Cancelled')).toBeInTheDocument();
      expect(mockOnItemUpdated).toHaveBeenCalledWith(reopenedItem);
    });
  });

  it('expands optional return-address section and forwards giver postal fields to onContribute', async () => {
    (apiClient.post as jest.Mock).mockResolvedValue({
      valid: true,
      code: 'INVITE26',
      guestName: 'Jordan Donor',
    });

    const captureContribute = jest.fn().mockResolvedValue(undefined);
    render(
      <Overlay isOpen={true} onClose={mockOnClose}>
        <RegistryItemCard
          item={mockSingleItem}
          onClose={mockOnClose}
          onContribute={captureContribute}
        />
      </Overlay>
    );

    const toggleBtn = screen.getByTestId('toggle-return-address-button');
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('contributor-return-address-fields')).not.toBeInTheDocument();

    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('contributor-return-address-fields')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('ABCDEF12'), { target: { value: 'INVITE26' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await screen.findByText(/Code verified!/i);

    fireEvent.change(screen.getByLabelText(/Your Name/i), { target: { value: 'Jordan Donor' } });
    fireEvent.change(screen.getByLabelText(/^Address Line 1$/i), {
      target: { value: '742 Evergreen Terrace' },
    });
    fireEvent.change(screen.getByLabelText(/Address Line 2/i), {
      target: { value: 'Apt 2B' },
    });
    fireEvent.change(screen.getByLabelText(/^City$/i), {
      target: { value: 'Springfield' },
    });
    fireEvent.change(screen.getByLabelText(/State \/ Province/i), {
      target: { value: 'IL' },
    });
    fireEvent.change(screen.getByLabelText(/ZIP \/ Postal Code/i), {
      target: { value: '62704' },
    });
    fireEvent.change(screen.getByLabelText(/Country/i), {
      target: { value: 'USA' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Claim Gift' }));

    await waitFor(() => {
      expect(captureContribute).toHaveBeenCalledWith(
        'item-1',
        'Jordan Donor',
        100,
        'INVITE26',
        undefined,
        false,
        undefined,
        undefined,
        undefined,
        {
          addressLine1: '742 Evergreen Terrace',
          addressLine2: 'Apt 2B',
          city: 'Springfield',
          state: 'IL',
          zipCode: '62704',
          country: 'USA',
        }
      );
    });
  });

  it('exposes name/email autoComplete tokens, required + aria-required="true" with aria-hidden asterisks, and retains focus across 8-char auto-verification and async submission', async () => {
    let resolveValidate: ((val: { valid: boolean }) => void) | null = null;
    (apiClient.get as jest.Mock).mockResolvedValue({ isVerified: false });
    (apiClient.post as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/api/registry/validate-code')) {
        return new Promise((resolve) => {
          resolveValidate = resolve;
        });
      }
      return Promise.resolve({ valid: false });
    });

    let resolveSubmit: (() => void) | null = null;
    const pendingContribute = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSubmit = resolve;
        })
    );

    const multiUnitPhysicalItem: RegistryItem = {
      ...mockSingleItem,
      id: 'multi-unit-a11y',
      isGroupGift: false,
      quantity: 3,
    };

    const { container, rerender } = render(
      <Overlay isOpen={true} onClose={mockOnClose}>
        <RegistryItemCard
          item={multiUnitPhysicalItem}
          onClose={mockOnClose}
          onContribute={pendingContribute}
        />
      </Overlay>
    );

    const nameInput = screen.getByLabelText(/Your Name/i) as HTMLInputElement;
    const emailInput = screen.getByLabelText(/Email Address/i) as HTMLInputElement;
    const unitSelect = screen.getByTestId('unit-quantity-select') as HTMLSelectElement;
    const codeInput = screen.getByPlaceholderText('ABCDEF12') as HTMLInputElement;

    expect(nameInput).toHaveAttribute('autocomplete', 'name');
    expect(emailInput).toHaveAttribute('autocomplete', 'email');

    expect(nameInput).toBeRequired();
    expect(nameInput).toHaveAttribute('aria-required', 'true');
    expect(unitSelect).toBeRequired();
    expect(unitSelect).toHaveAttribute('aria-required', 'true');

    // Visual asterisks on required labels are hidden from assistive tech
    const requiredLabels = Array.from(container.querySelectorAll('label[data-required="true"]'));
    expect(requiredLabels.length).toBeGreaterThanOrEqual(2);
    for (const label of requiredLabels) {
      const hiddenAsterisk = label.querySelector('[aria-hidden="true"]');
      expect(hiddenAsterisk).not.toBeNull();
      expect(hiddenAsterisk).toHaveTextContent('*');
    }

    // Explicit Enter verification retains focus on codeInput via readOnly + aria-busy
    codeInput.focus();
    fireEvent.change(codeInput, { target: { value: 'WRONG888' } });
    fireEvent.keyDown(codeInput, { key: 'Enter' });

    expect(codeInput).not.toBeDisabled();
    expect(codeInput).toHaveAttribute('readonly');
    expect(codeInput).toHaveAttribute('aria-busy', 'true');
    expect(document.activeElement).toBe(codeInput);

    resolveValidate!({ valid: false });

    await waitFor(() => {
      expect(screen.getByText(/Invalid invitation code/i)).toBeInTheDocument();
    });
    expect(codeInput).toHaveAttribute('aria-invalid', 'true');
    expect(codeInput).not.toHaveAttribute('readonly');
    expect(document.activeElement).toBe(codeInput);

    // Rerender group gift to verify Contribution Amount required semantics & submit focus retention
    rerender(
      <Overlay isOpen={true} onClose={mockOnClose}>
        <RegistryItemCard
          item={mockGroupItem}
          onClose={mockOnClose}
          onContribute={pendingContribute}
        />
      </Overlay>
    );

    const groupNameInput = screen.getByLabelText(/Your Name/i) as HTMLInputElement;
    const amountInput = screen.getByLabelText(/Contribution Amount/i) as HTMLInputElement;
    expect(amountInput).toBeRequired();
    expect(amountInput).toHaveAttribute('aria-required', 'true');

    fireEvent.change(groupNameInput, { target: { value: 'Alex Guest' } });
    amountInput.focus();
    fireEvent.change(amountInput, { target: { value: '50' } });
    fireEvent.submit(amountInput.closest('form')!);

    expect(amountInput).not.toBeDisabled();
    expect(amountInput).toHaveAttribute('readonly');
    expect(amountInput).toHaveAttribute('aria-busy', 'true');
    expect(document.activeElement).toBe(amountInput);

    expect(await axe(container)).toHaveNoViolations();

    resolveSubmit!();
    await waitFor(() => {
      expect(pendingContribute).toHaveBeenCalled();
    });
  });

  describe('WCAG 2.2 Registry Modal Accessibility', () => {
    it('passes item.name as fallbackAlt to MediaImage when media altText is empty', () => {
      const itemWithoutAlt: RegistryItem = {
        ...mockSingleItem,
        name: 'Handcrafted Ceramic Pitcher',
        image: createMockMedia({
          id: 'img-empty-alt',
          url: '/images/IMG_1024.jpg',
          altText: '',
          isDecorative: false,
        }),
      };

      render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard
            item={itemWithoutAlt}
            onClose={mockOnClose}
            onContribute={mockOnContribute}
          />
        </Overlay>
      );

      expect(screen.getByRole('img', { name: 'Handcrafted Ceramic Pitcher' })).toBeInTheDocument();
    });

    it('renders StripeCardPaymentSection as a named composite group without a dangling htmlFor attribute', async () => {
      const cardFundItem: RegistryItem = {
        ...mockGroupItem,
        itemType: 'CASH_FUND',
      };

      const { container } = render(
        <ThemeProvider initialThemeMode="dark">
          <Overlay isOpen={true} onClose={mockOnClose}>
            <RegistryItemCard
              item={cardFundItem}
              cardCheckoutEnabled={true}
              stripePublishableKey="pk_test_51MockValidPublishableKey1234567890"
              onClose={mockOnClose}
              onContribute={mockOnContribute}
            />
          </Overlay>
        </ThemeProvider>
      );

      const paymentGroup = await screen.findByRole('group', {
        name: /Card & Digital Wallet Details/i,
      });
      expect(paymentGroup).toBeInTheDocument();
      expect(within(paymentGroup).getByTestId('stripe-payment-element')).toBeInTheDocument();

      // Verify zero dangling htmlFor attributes across the entire form
      const allLabelsWithFor = Array.from(container.querySelectorAll('label[for]'));
      for (const label of allLabelsWithFor) {
        const targetId = label.getAttribute('for');
        expect(targetId).toBeTruthy();
        expect(container.querySelector(`[id="${targetId}"]`)).not.toBeNull();
      }

      expect(await axe(container)).toHaveNoViolations();
    });

    it('keeps invitation code Input focused with readOnly and aria-busy during auto-verification, moves focus to Clear on lock, and announces via FormMessage', async () => {
      let resolveValidation!: (val: { valid: boolean; code: string; guestName: string }) => void;
      (apiClient.get as jest.Mock).mockResolvedValue({ authenticated: false });
      (apiClient.post as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/api/registry/validate-code')) {
          return new Promise((resolve) => {
            resolveValidation = resolve;
          });
        }
        return Promise.resolve({ valid: false });
      });

      render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard
            item={mockSingleItem}
            onClose={mockOnClose}
            onContribute={mockOnContribute}
          />
        </Overlay>
      );

      const codeInput = screen.getByLabelText(/Invitation Code/i);
      codeInput.focus();
      expect(document.activeElement).toBe(codeInput);

      fireEvent.change(codeInput, { target: { value: 'FOCUS123' } });
      fireEvent.keyDown(codeInput, { key: 'Enter' });

      // While verification is in flight, input stays focused, read-only, and aria-busy (never disabled)
      await waitFor(() => {
        expect(codeInput).toHaveAttribute('aria-busy', 'true');
      });
      expect(codeInput).toHaveAttribute('readonly');
      expect(codeInput).not.toBeDisabled();
      expect(document.activeElement).toBe(codeInput);

      // Complete verification: input locks, focus moves deterministically to Clear button, FormMessage announces politely
      resolveValidation({ valid: true, code: 'FOCUS123', guestName: 'Casey Guest' });

      const verifiedNotice = await screen.findByText('Code verified! Name pre-filled.');
      expect(verifiedNotice).toHaveAttribute('role', 'status');
      expect(verifiedNotice).toHaveAttribute('aria-live', 'polite');

      const clearBtn = screen.getByRole('button', { name: 'Clear' });
      expect(document.activeElement).toBe(clearBtn);

      // Clicking Clear unlocks and restores focus to the code input
      fireEvent.click(clearBtn);
      await waitFor(() => {
        expect(codeInput).not.toBeDisabled();
      });
      expect(document.activeElement).toBe(codeInput);
    });

    it('announces contribution confirmation and receipt copy politely inside the modal dialog subtree', async () => {
      Object.assign(navigator, {
        clipboard: {
          writeText: jest.fn().mockResolvedValue(undefined),
        },
      });

      (apiClient.post as jest.Mock).mockResolvedValue({
        valid: true,
        code: 'INVITE26',
        guestName: 'Taylor Guest',
      });

      render(
        <ToastProvider>
          <Dialog isOpen={true} onClose={mockOnClose} aria-labelledby="registry-item-title-item-1">
            <RegistryItemCard
              item={mockSingleItem}
              titleId="registry-item-title-item-1"
              onClose={mockOnClose}
              onContribute={jest.fn().mockResolvedValue(undefined)}
            />
          </Dialog>
        </ToastProvider>
      );

      const dialog = screen.getByRole('dialog', { name: 'Single Item' });
      fireEvent.change(within(dialog).getByPlaceholderText('ABCDEF12'), {
        target: { value: 'INVITE26' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Verify' }));
      await within(dialog).findByText(/Code verified!/i);

      fireEvent.change(within(dialog).getByLabelText(/Your Name/i), {
        target: { value: 'Taylor Guest' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Claim Gift' }));

      const confirmation = await within(dialog).findByTestId('contribution-success-confirmation');
      const statusRegions = within(confirmation).getAllByRole('status');
      expect(statusRegions[0]).toHaveAttribute('aria-live', 'polite');
      expect(statusRegions[0]).toHaveTextContent(/Contribution Confirmed!/i);

      fireEvent.click(within(dialog).getByTestId('copy-receipt-button'));
      await waitFor(() => {
        expect(within(dialog).getByTestId('registry-modal-status')).toHaveTextContent(
          'Receipt copied to clipboard for Single Item.'
        );
      });
    });
  });
});
