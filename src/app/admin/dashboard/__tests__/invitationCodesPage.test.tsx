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
    dietaryNotes: 'Gluten Free, Dairy Free',
    used: false,
  },
  {
    id: 'code-2',
    guestName: 'Bob Jones',
    code: 'BOB456',
    email: 'bob@example.com',
    dietaryNotes: 'Vegan',
    used: true,
  },
  {
    id: 'code-3',
    guestName: 'Charlie Brown',
    code: 'CHARLIE789',
    email: 'charlie@example.com',
    dietaryNotes: 'Vegetarian, Nut allergy',
    used: false,
  },
  {
    id: 'code-4',
    guestName: 'Diana Prince',
    code: 'DIANA101',
    email: 'diana@example.com',
    dietaryNotes: 'Kosher option',
    used: false,
  },
  {
    id: 'code-5',
    guestName: 'Evan Wright',
    code: 'EVAN202',
    email: 'evan@example.com',
    dietaryNotes: '   ',
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

    expect(screen.getByRole('button', { name: 'All (5)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Redeemed (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unused (4)' })).toBeInTheDocument();
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
    const unusedTab = screen.getByRole('button', { name: 'Unused (4)' });
    const allTab = screen.getByRole('button', { name: 'All (5)' });

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
    const unusedTab = screen.getByRole('button', { name: 'Unused (4)' });

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

  it('renders catering summary header widget with aggregated totals', () => {
    renderComponent();

    const widget = screen.getByTestId('catering-summary-widget');
    expect(widget).toBeInTheDocument();
    expect(screen.getByText('Catering & Dietary Summary')).toBeInTheDocument();

    // 4 guests have non-whitespace dietary notes (Alice, Bob, Charlie, Diana)
    expect(screen.getByText('4 Guests with Dietary Notes')).toBeInTheDocument();
  });

  it('filters codes by dietary category select dropdown', () => {
    renderComponent();

    const select = screen.getByRole('combobox', { name: 'Filter by dietary category' });

    // Filter by Gluten-Free
    fireEvent.change(select, { target: { value: 'gluten-free' } });
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument();
    expect(screen.queryByText('Charlie Brown')).not.toBeInTheDocument();

    // Filter by Vegan
    fireEvent.change(select, { target: { value: 'vegan' } });
    expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();

    // Filter by Vegetarian
    fireEvent.change(select, { target: { value: 'vegetarian' } });
    expect(screen.getByText('Charlie Brown')).toBeInTheDocument();

    // Filter by Dairy-Free
    fireEvent.change(select, { target: { value: 'dairy-free' } });
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();

    // Filter by Nut-Free / Allergy
    fireEvent.change(select, { target: { value: 'nut-free' } });
    expect(screen.getByText('Charlie Brown')).toBeInTheDocument();

    // Filter by Other
    fireEvent.change(select, { target: { value: 'other' } });
    expect(screen.getByText('Diana Prince')).toBeInTheDocument();
    expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();

    // Filter by Has Dietary Restriction
    fireEvent.change(select, { target: { value: 'has_restriction' } });
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
    expect(screen.getByText('Charlie Brown')).toBeInTheDocument();
    expect(screen.getByText('Diana Prince')).toBeInTheDocument();
    expect(screen.queryByText('Evan Wright')).not.toBeInTheDocument();
  });

  it('filters codes by text search in dietary notes', () => {
    renderComponent();

    const searchInput = screen.getByRole('textbox', { name: 'Search invitation codes' });

    fireEvent.change(searchInput, { target: { value: 'Kosher' } });
    expect(screen.getByText('Diana Prince')).toBeInTheDocument();
    expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: 'Dairy' } });
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
  });

  it('renders dietary badge on guest cards with non-empty dietary notes and omits empty/whitespace notes', () => {
    renderComponent();

    const badges = screen.getAllByTestId('dietary-badge');
    expect(badges).toHaveLength(4); // Alice, Bob, Charlie, Diana
    expect(badges[0]).toHaveTextContent('Dietary: Gluten Free, Dairy Free');
    expect(badges[1]).toHaveTextContent('Dietary: Vegan');

    // Evan Wright has whitespace dietary notes, so no badge should be rendered on Evan's card
    const evanCard = screen.getByText('Evan Wright').closest('div');
    expect(evanCard?.querySelector('[data-testid="dietary-badge"]')).toBeNull();
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

  it('exports CSV file when Export CSV button is clicked with guest records present', () => {
    const mockCreateObjectURL = jest.fn(() => 'blob:http://localhost/mock-url');
    const mockRevokeObjectURL = jest.fn();
    const originalCreateObjectURL = window.URL.createObjectURL;
    const originalRevokeObjectURL = window.URL.revokeObjectURL;

    window.URL.createObjectURL = mockCreateObjectURL;
    window.URL.revokeObjectURL = mockRevokeObjectURL;

    const mockAnchorClick = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderComponent();

    const exportBtn = screen.getByRole('button', { name: 'Export CSV' });
    fireEvent.click(exportBtn);

    expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
    expect(mockAnchorClick).toHaveBeenCalledTimes(1);
    expect(mockRevokeObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Invitation codes exported successfully.')).toBeInTheDocument();

    mockAnchorClick.mockRestore();
    window.URL.createObjectURL = originalCreateObjectURL;
    window.URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it('shows warning toast and aborts export when Export CSV is clicked with empty codes list', () => {
    const mockCreateObjectURL = jest.fn();
    const originalCreateObjectURL = window.URL.createObjectURL;
    window.URL.createObjectURL = mockCreateObjectURL;

    (useAdminInvitationCodes as jest.Mock).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      create: mockCreate,
      remove: mockRemove,
      fetchAll: mockFetchAll,
    });

    renderComponent();

    const exportBtn = screen.getByRole('button', { name: 'Export CSV' });
    fireEvent.click(exportBtn);

    expect(screen.getByText('No invitation codes to export.')).toBeInTheDocument();
    expect(mockCreateObjectURL).not.toHaveBeenCalled();

    window.URL.createObjectURL = originalCreateObjectURL;
  });
});

