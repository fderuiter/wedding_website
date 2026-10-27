import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Overlay } from '@/components/ui/Overlay';
import { ThemeProvider } from '@/components/ThemeProvider';
import RegistryItemCard from '../RegistryItemCard'; // Adjust the import path as necessary
import { RegistryItem, GuestSessionProvider } from '@/features/registry';
import { apiClient } from '@/lib/apiClient';
import { ToastProvider } from '@/components/ui/ToastProvider';

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
const mockSingleItem: RegistryItem = {
  id: 'item-1',
  name: 'Single Item',
  description: 'A nice single item.',
  price: 100,
  image: { id: 'm1', url: '/images/valid.jpg', altText: null, isDecorative: true, createdAt: new Date(), updatedAt: new Date() },
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
    expect(screen.getByRole('link', { name: 'View on Vendor Site' })).toHaveAttribute('href', 'https://example.com');
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

  it('renders correctly for a purchased single item', () => {
    render(<Overlay isOpen={true} onClose={mockOnClose}><RegistryItemCard item={mockPurchasedItem} onClose={mockOnClose} onContribute={mockOnContribute} /></Overlay>);

    expect(screen.getByText('Purchased Item')).toBeInTheDocument();
    expect(screen.getByText('This gift has been claimed!')).toBeInTheDocument();
    expect(screen.getByText('Claimed by: Generous Guest')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Claim This Gift' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Your Name/i)).not.toBeInTheDocument();
  });

  it('renders correctly for a fully funded group item', () => {
    render(<Overlay isOpen={true} onClose={mockOnClose}><RegistryItemCard item={mockFundedGroupItem} onClose={mockOnClose} onContribute={mockOnContribute} /></Overlay>);

    expect(screen.getByText('Funded Group Item')).toBeInTheDocument();
    expect(screen.getByText('This gift is fully funded!')).toBeInTheDocument();
    expect(screen.getByText('Thank you for your generosity!')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit Contribution' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Your Name/i)).not.toBeInTheDocument();

    // Verify contributors list
    expect(screen.getByText('Contributors:')).toBeInTheDocument();
    expect(screen.getByText('Contributor 1')).toBeInTheDocument();
    expect(screen.getByText('Contributor 2')).toBeInTheDocument();
    // Multiple instances of ($50.00)
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
    // Corrected button name
    fireEvent.click(screen.getByRole('button', { name: 'Claim Gift' }));
    expect(await screen.findByText('Name is required and must be under 100 characters.')).toBeInTheDocument();
    expect(mockOnContribute).not.toHaveBeenCalled();
  });

  it('shows error if contribution amount is invalid for group gift', async () => {
    render(<Overlay isOpen={true} onClose={mockOnClose}><RegistryItemCard item={mockGroupItem} onClose={mockOnClose} onContribute={mockOnContribute} /></Overlay>);
    fireEvent.change(screen.getByLabelText(/Your Name/i), { target: { value: 'Test User' } });
    fireEvent.change(screen.getByLabelText(/Contribution Amount/i), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Contribution' }));
    expect(await screen.findByText('Contribution amount must be a positive number.')).toBeInTheDocument();
    expect(mockOnContribute).not.toHaveBeenCalled();
  });

  it('shows error if contribution amount exceeds remaining for group gift', async () => {
    render(<Overlay isOpen={true} onClose={mockOnClose}><RegistryItemCard item={mockGroupItem} onClose={mockOnClose} onContribute={mockOnContribute} /></Overlay>);
    fireEvent.change(screen.getByLabelText(/Your Name/i), { target: { value: 'Test User' } });
    fireEvent.change(screen.getByLabelText(/Contribution Amount/i), { target: { value: '80' } }); // More than remaining 70
    fireEvent.click(screen.getByRole('button', { name: 'Submit Contribution' }));
    expect(await screen.findByText('Amount cannot exceed the remaining $70.00.')).toBeInTheDocument();
    expect(mockOnContribute).not.toHaveBeenCalled();
  });

  it('calls onContribute with correct details for single item claim', async () => {
    render(<Overlay isOpen={true} onClose={mockOnClose}><RegistryItemCard item={mockSingleItem} onClose={mockOnClose} onContribute={mockOnContribute} /></Overlay>);
    fireEvent.change(screen.getByLabelText(/Your Name/i), { target: { value: 'Claimer' } });
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

  it('allows entering a personal message and passes it to onContribute', async () => {
    render(
      <Overlay isOpen={true} onClose={mockOnClose}>
        <RegistryItemCard item={mockSingleItem} onClose={mockOnClose} onContribute={mockOnContribute} />
      </Overlay>
    );

    fireEvent.change(screen.getByLabelText(/Your Name/i), { target: { value: 'Jane Contributor' } });
    fireEvent.change(screen.getByLabelText(/Personal Message/i), { target: { value: 'So happy for you both!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Claim Gift' }));

    await waitFor(() => {
      expect(mockOnContribute).toHaveBeenCalledWith('item-1', 'Jane Contributor', 100, undefined, 'So happy for you both!');
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
    render(<Overlay isOpen={true} onClose={mockOnClose}><RegistryItemCard item={{...mockSingleItem, image: { id: 'm2', url: '/invalid-path.jpg', altText: null, isDecorative: true, createdAt: new Date(), updatedAt: new Date() }}} onClose={mockOnClose} onContribute={mockOnContribute} /></Overlay>);
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

    it('allows submission when invitation code field is empty (single gift claim)', async () => {
      render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard item={mockSingleItem} onClose={mockOnClose} onContribute={mockOnContribute} />
        </Overlay>
      );

      const nameInput = screen.getByLabelText(/Your Name/i);
      fireEvent.change(nameInput, { target: { value: 'Guest Contributor' } });

      const submitButton = screen.getByRole('button', { name: 'Claim Gift' });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockOnContribute).toHaveBeenCalledWith('item-1', 'Guest Contributor', 100);
      });
    });

    it('successfully validates invitation code, auto-populates guest name, and allows editing name input', async () => {
      (apiClient.get as jest.Mock).mockResolvedValue({
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
      
      // 'GOODCODE' is 8 characters, which triggers automatic validation on change
      fireEvent.change(codeInput, { target: { value: 'GOODCODE' } });

      await waitFor(() => {
        expect(apiClient.get).toHaveBeenCalledWith('/api/registry/validate-code?code=GOODCODE');
        expect(screen.getByText('Code verified! Name pre-filled.')).toBeInTheDocument();
      });

      const nameInput = screen.getByLabelText(/Your Name/i);
      expect(nameInput).toHaveValue('Jane Smith');
      expect(nameInput).not.toBeDisabled();
      expect(codeInput).toBeDisabled();
    });

    it('shows error message if invitation code is invalid', async () => {
      (apiClient.get as jest.Mock).mockRejectedValue(new Error('Invalid invitation code.'));

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
        expect(apiClient.get).toHaveBeenCalledWith('/api/registry/validate-code?code=BADCODE');
        expect(screen.getByText('Invalid invitation code.')).toBeInTheDocument();
      });

      const nameInput = screen.getByLabelText(/Your Name/i);
      expect(nameInput).not.toBeDisabled();
      expect(nameInput).toHaveValue('');
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

      render(
        <ToastProvider>
          <Overlay isOpen={true} onClose={mockOnClose}>
            <RegistryItemCard item={mockSingleItem} onClose={mockOnClose} onContribute={mockOnContribute} />
          </Overlay>
        </ToastProvider>
      );

      const shareButton = screen.getByRole('button', { name: `Share ${mockSingleItem.name}` });
      expect(shareButton).toBeInTheDocument();

      fireEvent.click(shareButton);

      await waitFor(() => {
        expect(mockWriteText).toHaveBeenCalledWith(
          expect.stringContaining(`?item=${mockSingleItem.id}`)
        );
      });
      expect(await screen.findByText('Link Copied!')).toBeInTheDocument();
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
    it('renders QR code canvas and deep link for Venmo handle', () => {
      const venmoItem: RegistryItem = {
        ...mockGroupItem,
        id: 'venmo-qr-1',
        name: 'Honeymoon Fund',
        itemType: 'CASH_FUND',
        paymentHandleType: 'Venmo',
        paymentHandle: '@happy-couple',
      };

      render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard item={venmoItem} onClose={mockOnClose} onContribute={mockOnContribute} />
        </Overlay>
      );

      const link = screen.getByRole('link', { name: /Open payment link for Venmo/i });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', 'https://venmo.com/u/happy-couple');

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

      const link = screen.getByRole('link', { name: /Open payment link for Cash App/i });
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

      const link = screen.getByRole('link', { name: /Open payment link for PayPal/i });
      expect(link).toHaveAttribute('href', 'https://paypal.me/happycouple');
      expect(screen.getByLabelText(/QR code to pay via PayPal/i)).toBeInTheDocument();
    });

    it('renders QR code canvas and deep link for Zelle email handle', () => {
      const zelleItem: RegistryItem = {
        ...mockGroupItem,
        id: 'zelle-qr-1',
        name: 'Furniture Fund',
        itemType: 'CASH_FUND',
        paymentHandleType: 'Zelle',
        paymentHandle: 'couple@example.com',
      };

      render(
        <Overlay isOpen={true} onClose={mockOnClose}>
          <RegistryItemCard item={zelleItem} onClose={mockOnClose} onContribute={mockOnContribute} />
        </Overlay>
      );

      const link = screen.getByRole('link', { name: /Open payment link for Zelle/i });
      expect(link.getAttribute('href')).toContain('mailto:couple@example.com');
      expect(screen.getByLabelText(/QR code to pay via Zelle/i)).toBeInTheDocument();
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
          true
        );
      });
    });
  });
});
