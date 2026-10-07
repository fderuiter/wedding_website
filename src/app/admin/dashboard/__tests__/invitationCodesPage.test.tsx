import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import InvitationCodesDashboardPage from '../invitation-codes/page';
import { ToastProvider } from '@/components/ui/ToastProvider';
import { useAdminInvitationCodes } from '@/hooks/admin/useAdminInvitationCodes';

// Mock next/navigation
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

// Mock hook
jest.mock('@/hooks/admin/useAdminInvitationCodes');

// Mock CsvImportWizardModal
jest.mock('@/components/admin/CsvImportWizardModal', () => ({
  CsvImportWizardModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => (
    isOpen ? (
      <div data-testid="csv-modal">
        <p>CSV Import Modal</p>
        <button onClick={onClose}>Close CSV Modal</button>
      </div>
    ) : null
  ),
}));

const mockCodes = [
  {
    id: 'code-1',
    guestName: 'Alice Smith',
    code: 'ALICE123',
    email: 'alice@example.com',
    used: false,
  },
  {
    id: 'code-2',
    guestName: 'Bob Jones',
    code: 'BOB456',
    email: 'bob@example.com',
    used: true,
  },
  {
    id: 'code-3',
    guestName: 'Charlie Brown',
    code: 'CHARLIE789',
    email: 'charlie@example.com',
    used: false,
  },
];

describe('InvitationCodesDashboardPage', () => {
  const mockCreate = jest.fn();
  const mockRemove = jest.fn();
  const mockFetchAll = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useAdminInvitationCodes as jest.Mock).mockReturnValue({
      data: mockCodes,
      isLoading: false,
      error: null,
      create: mockCreate,
      remove: mockRemove,
      fetchAll: mockFetchAll,
    });
  });

  const renderComponent = () =>
    render(
      <ToastProvider>
        <InvitationCodesDashboardPage />
      </ToastProvider>
    );

  it('renders loading state', () => {
    (useAdminInvitationCodes as jest.Mock).mockReturnValue({
      data: [],
      isLoading: true,
      error: null,
      create: mockCreate,
      remove: mockRemove,
      fetchAll: mockFetchAll,
    });

    renderComponent();
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders error state', () => {
    (useAdminInvitationCodes as jest.Mock).mockReturnValue({
      data: [],
      isLoading: false,
      error: new Error('Failed to fetch codes'),
      create: mockCreate,
      remove: mockRemove,
      fetchAll: mockFetchAll,
    });

    renderComponent();
    expect(screen.getByText('Error: Failed to fetch codes')).toBeInTheDocument();
  });

  it('renders invitation codes list and correct status counts', () => {
    renderComponent();

    expect(screen.getByText('Pre-Authorized Guest Invitation Codes')).toBeInTheDocument();
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
    expect(screen.getByText('Charlie Brown')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'All (3)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Redeemed (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unused (2)' })).toBeInTheDocument();
  });

  it('filters codes by text search query (guest name, code, email) with trim and case-insensitivity', () => {
    renderComponent();

    const searchInput = screen.getByRole('textbox', { name: 'Search invitation codes' });

    // Search by guest name with whitespace and uppercase
    fireEvent.change(searchInput, { target: { value: '  ALICE ' } });
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument();
    expect(screen.queryByText('Charlie Brown')).not.toBeInTheDocument();

    // Search by code
    fireEvent.change(searchInput, { target: { value: 'bob456' } });
    expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
    expect(screen.queryByText('Charlie Brown')).not.toBeInTheDocument();

    // Search by email
    fireEvent.change(searchInput, { target: { value: 'charlie@example.com' } });
    expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();
    expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument();
    expect(screen.getByText('Charlie Brown')).toBeInTheDocument();
  });

  it('filters codes by status filter tabs (All, Redeemed, Unused)', () => {
    renderComponent();

    const redeemedTab = screen.getByRole('button', { name: 'Redeemed (1)' });
    const unusedTab = screen.getByRole('button', { name: 'Unused (2)' });
    const allTab = screen.getByRole('button', { name: 'All (3)' });

    // Click Redeemed tab
    fireEvent.click(redeemedTab);
    expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
    expect(screen.queryByText('Charlie Brown')).not.toBeInTheDocument();

    // Click Unused tab
    fireEvent.click(unusedTab);
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument();
    expect(screen.getByText('Charlie Brown')).toBeInTheDocument();

    // Click All tab
    fireEvent.click(allTab);
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
    expect(screen.getByText('Charlie Brown')).toBeInTheDocument();
  });

  it('combines text search and status filter tab', () => {
    renderComponent();

    const searchInput = screen.getByRole('textbox', { name: 'Search invitation codes' });
    const unusedTab = screen.getByRole('button', { name: 'Unused (2)' });

    // Switch to Unused tab
    fireEvent.click(unusedTab);

    // Search for "Alice" while on Unused tab
    fireEvent.change(searchInput, { target: { value: 'Alice' } });
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument();
    expect(screen.queryByText('Charlie Brown')).not.toBeInTheDocument();

    // Search for "Bob" (who is redeemed) while on Unused tab -> should show empty filter state
    fireEvent.change(searchInput, { target: { value: 'Bob' } });
    expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();
    expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument();
    expect(screen.getByText('No invitation codes match your search or filter criteria.')).toBeInTheDocument();
  });

  it('shows appropriate empty states when codes array is empty vs when filter produces no matches', () => {
    // Case 1: Database has codes, but search matches nothing
    renderComponent();
    const searchInput = screen.getByRole('textbox', { name: 'Search invitation codes' });
    fireEvent.change(searchInput, { target: { value: 'nonexistent' } });
    expect(screen.getByText('No invitation codes match your search or filter criteria.')).toBeInTheDocument();

    // Case 2: Database has 0 codes
    (useAdminInvitationCodes as jest.Mock).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      create: mockCreate,
      remove: mockRemove,
      fetchAll: mockFetchAll,
    });

    renderComponent();
    expect(screen.getByText('No invitation codes found.')).toBeInTheDocument();
  });

  it('handles generating a new invitation code', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'code-4',
      guestName: 'David Miller',
      code: 'DAVID123',
      used: false,
    });

    renderComponent();

    fireEvent.click(screen.getByRole('button', { name: 'Generate New Code' }));
    expect(screen.getByRole('heading', { name: 'Generate Invitation Code' })).toBeInTheDocument();

    const inputs = screen.getAllByRole('textbox');
    // inputs[0] is searchInput, inputs[1] is Guest Name, inputs[2] is Code
    const guestNameInput = screen.getByPlaceholderText('e.g. John Doe');
    const codeInput = screen.getByPlaceholderText('e.g. JOHN123');

    fireEvent.change(guestNameInput, { target: { value: 'David Miller' } });
    fireEvent.change(codeInput, { target: { value: 'david123' } });

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith({
        guestName: 'David Miller',
        code: 'DAVID123',
        used: false,
      });
    });
  });

  it('handles deleting an invitation code after confirmation', async () => {
    mockRemove.mockResolvedValueOnce(true);

    renderComponent();

    const deleteBtn = screen.getByRole('button', { name: 'Delete code for Alice Smith' });
    fireEvent.click(deleteBtn);

    // Confirm dialog
    const confirmBtn = await screen.findByRole('button', { name: 'Confirm' });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockRemove).toHaveBeenCalledWith('code-1');
    });
  });

  it('opens and closes CSV import wizard modal', () => {
    renderComponent();

    fireEvent.click(screen.getByRole('button', { name: 'Import CSV' }));
    expect(screen.getByTestId('csv-modal')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close CSV Modal' }));
    expect(screen.queryByTestId('csv-modal')).not.toBeInTheDocument();
  });

  it('navigates back to dashboard when Back to Dashboard button is clicked', () => {
    renderComponent();

    fireEvent.click(screen.getByRole('button', { name: 'Back to Dashboard' }));
    expect(mockPush).toHaveBeenCalledWith('/admin/dashboard');
  });
});
