import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import InvitationCodesDashboardPage from '../invitation-codes/page';
import { getAttendanceStatus } from '@/features/registry';
import { ToastProvider } from '@/components/ui/ToastProvider';
import { useAdminInvitationCodes } from '@/hooks/admin/useAdminInvitationCodes';

expect.extend(toHaveNoViolations);

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
  const mockUpdate = jest.fn();
  const mockRemove = jest.fn();
  const mockRemoveBatch = jest.fn();
  const mockUpdateBatch = jest.fn();
  const mockBatchUpdateTags = jest.fn();
  const mockMergeDuplicates = jest.fn();
  const mockFetchAll = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useAdminInvitationCodes as jest.Mock).mockReturnValue({
      data: mockCodes,
      isLoading: false,
      error: null,
      create: mockCreate,
      update: mockUpdate,
      remove: mockRemove,
      removeBatch: mockRemoveBatch,
      updateBatch: mockUpdateBatch,
      batchUpdateTags: mockBatchUpdateTags,
      mergeDuplicates: mockMergeDuplicates,
      fetchAll: mockFetchAll,
    });
  });

  const createTestQueryClient = () =>
    new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

  const renderComponent = () => {
    const queryClient = createTestQueryClient();
    return render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <InvitationCodesDashboardPage />
        </ToastProvider>
      </QueryClientProvider>
    );
  };

  it('renders loading state', () => {
    (useAdminInvitationCodes as jest.Mock).mockReturnValue({
      data: [],
      isLoading: true,
      error: null,
      create: mockCreate,
      remove: mockRemove,
      removeBatch: mockRemoveBatch,
      updateBatch: mockUpdateBatch,
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
      removeBatch: mockRemoveBatch,
      updateBatch: mockUpdateBatch,
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

    const tabList = screen.getByRole('tablist', { name: 'Filter invitation codes by status' });
    expect(tabList).toBeInTheDocument();

    const allTab = screen.getByRole('tab', { name: 'All (5)' });
    const redeemedTab = screen.getByRole('tab', { name: 'Redeemed (1)' });
    const unusedTab = screen.getByRole('tab', { name: 'Unused (4)' });

    expect(allTab).toHaveAttribute('aria-selected', 'true');
    expect(redeemedTab).toHaveAttribute('aria-selected', 'false');
    expect(unusedTab).toHaveAttribute('aria-selected', 'false');
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

    expect(screen.getByRole('tablist', { name: 'Filter invitation codes by status' })).toBeInTheDocument();

    const redeemedTab = screen.getByRole('tab', { name: 'Redeemed (1)' });
    const unusedTab = screen.getByRole('tab', { name: 'Unused (4)' });
    const allTab = screen.getByRole('tab', { name: 'All (5)' });

    // Initial state
    expect(allTab).toHaveAttribute('aria-selected', 'true');
    expect(redeemedTab).toHaveAttribute('aria-selected', 'false');
    expect(unusedTab).toHaveAttribute('aria-selected', 'false');

    // Click Redeemed tab
    fireEvent.click(redeemedTab);
    expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
    expect(screen.queryByText('Charlie Brown')).not.toBeInTheDocument();
    expect(allTab).toHaveAttribute('aria-selected', 'false');
    expect(redeemedTab).toHaveAttribute('aria-selected', 'true');
    expect(unusedTab).toHaveAttribute('aria-selected', 'false');

    // Click Unused tab
    fireEvent.click(unusedTab);
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument();
    expect(screen.getByText('Charlie Brown')).toBeInTheDocument();
    expect(allTab).toHaveAttribute('aria-selected', 'false');
    expect(redeemedTab).toHaveAttribute('aria-selected', 'false');
    expect(unusedTab).toHaveAttribute('aria-selected', 'true');

    // Click All tab
    fireEvent.click(allTab);
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
    expect(screen.getByText('Charlie Brown')).toBeInTheDocument();
    expect(allTab).toHaveAttribute('aria-selected', 'true');
    expect(redeemedTab).toHaveAttribute('aria-selected', 'false');
    expect(unusedTab).toHaveAttribute('aria-selected', 'false');
  });

  it('combines text search and status filter tab', () => {
    renderComponent();

    const searchInput = screen.getByRole('textbox', { name: 'Search invitation codes' });
    const unusedTab = screen.getByRole('tab', { name: 'Unused (4)' });

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

  it('correctly derives guest RSVP attendance status via getAttendanceStatus', () => {
    // Explicit extraFields values
    expect(getAttendanceStatus({ used: true, extraFields: { attendanceStatus: 'attending' } })).toBe('attending');
    expect(getAttendanceStatus({ used: true, extraFields: { rsvpStatus: 'accepted' } })).toBe('attending');
    expect(getAttendanceStatus({ used: true, extraFields: { attending: true } })).toBe('attending');
    expect(getAttendanceStatus({ used: false, extraFields: { attendance: 'declined' } })).toBe('declined');
    expect(getAttendanceStatus({ used: true, extraFields: { status: 'rejected' } })).toBe('declined');
    expect(getAttendanceStatus({ used: false, extraFields: { attending: false } })).toBe('declined');
    expect(getAttendanceStatus({ used: false, extraFields: { rsvpStatus: 'pending' } })).toBe('pending');

    // Legacy fallback behavior (undefined or empty extraFields)
    expect(getAttendanceStatus({ used: true, extraFields: undefined })).toBe('attending');
    expect(getAttendanceStatus({ used: true, extraFields: null })).toBe('attending');
    expect(getAttendanceStatus({ used: true, extraFields: {} })).toBe('attending');
    expect(getAttendanceStatus({ used: false, extraFields: undefined })).toBe('pending');
    expect(getAttendanceStatus({ used: false, extraFields: null })).toBe('pending');
  });

  it('filters codes by RSVP attendance filter tabs (All, Attending, Declined, Pending)', () => {
    const rsvpMockCodes = [
      { id: '1', guestName: 'Alice Smith', code: 'A1', used: false }, // pending
      { id: '2', guestName: 'Bob Jones', code: 'B2', used: true, extraFields: { attendanceStatus: 'attending' } }, // attending
      { id: '3', guestName: 'Charlie Brown', code: 'C3', used: true, extraFields: { attendanceStatus: 'declined' } }, // declined
      { id: '4', guestName: 'Diana Prince', code: 'D4', used: false, extraFields: { rsvpStatus: 'pending' } }, // pending
    ];

    (useAdminInvitationCodes as jest.Mock).mockReturnValue({
      data: rsvpMockCodes,
      isLoading: false,
      error: null,
      create: mockCreate,
      remove: mockRemove,
      fetchAll: mockFetchAll,
    });

    renderComponent();

    const allAttendanceTab = screen.getByRole('button', { name: 'All attendance (4)' });
    const attendingTab = screen.getByRole('button', { name: 'Attending (1)' });
    const declinedTab = screen.getByRole('button', { name: 'Declined (1)' });
    const pendingTab = screen.getByRole('button', { name: 'Pending (2)' });

    // Click Attending tab
    fireEvent.click(attendingTab);
    expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
    expect(screen.queryByText('Charlie Brown')).not.toBeInTheDocument();
    expect(screen.queryByText('Diana Prince')).not.toBeInTheDocument();

    // Click Declined tab
    fireEvent.click(declinedTab);
    expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();
    expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument();
    expect(screen.getByText('Charlie Brown')).toBeInTheDocument();
    expect(screen.queryByText('Diana Prince')).not.toBeInTheDocument();

    // Click Pending tab
    fireEvent.click(pendingTab);
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument();
    expect(screen.queryByText('Charlie Brown')).not.toBeInTheDocument();
    expect(screen.getByText('Diana Prince')).toBeInTheDocument();

    // Click All Attendance tab
    fireEvent.click(allAttendanceTab);
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
    expect(screen.getByText('Charlie Brown')).toBeInTheDocument();
    expect(screen.getByText('Diana Prince')).toBeInTheDocument();
  });

  it('combines redemption status filter, attendance filter, and search query', () => {
    const mixedMockCodes = [
      { id: '1', guestName: 'Alice Smith', code: 'A1', used: true, extraFields: { attendanceStatus: 'attending' } },
      { id: '2', guestName: 'Bob Jones', code: 'B2', used: true, extraFields: { attendanceStatus: 'declined' } },
      { id: '3', guestName: 'Charlie Brown', code: 'C3', used: false },
    ];

    (useAdminInvitationCodes as jest.Mock).mockReturnValue({
      data: mixedMockCodes,
      isLoading: false,
      error: null,
      create: mockCreate,
      remove: mockRemove,
      fetchAll: mockFetchAll,
    });

    renderComponent();

    const searchInput = screen.getByRole('textbox', { name: 'Search invitation codes' });
    const redeemedTab = screen.getByRole('tab', { name: 'Redeemed (2)' });
    const declinedTab = screen.getByRole('button', { name: 'Declined (1)' });

    // Select Redeemed filter and Declined filter -> Bob Jones
    fireEvent.click(redeemedTab);
    fireEvent.click(declinedTab);
    expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
    expect(screen.queryByText('Charlie Brown')).not.toBeInTheDocument();

    // Search for "Alice" while on Redeemed + Declined -> empty state
    fireEvent.change(searchInput, { target: { value: 'Alice' } });
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
      removeBatch: mockRemoveBatch,
      updateBatch: mockUpdateBatch,
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

    // Guest Name and Code inputs
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
      expect(screen.getByText('Invitation code created successfully.')).toBeInTheDocument();
    });
  });

  it('supports shared 17-field inline creation with whitespace code omission, tag deduplication, maxLength attributes, row validation alerts, and dirty-close confirmation', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'code-new',
      guestName: 'Nora Valkyrie',
      code: 'AUTO999',
      used: false,
    });

    const { container } = renderComponent();

    fireEvent.click(screen.getByRole('button', { name: 'Generate New Code' }));
    expect(screen.getByRole('heading', { name: 'Generate Invitation Code' })).toBeInTheDocument();

    // Clean Cancel closes immediately without confirmation prompt
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(
      screen.queryByRole('heading', { name: 'Generate Invitation Code' })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    // Reopen inline form
    fireEvent.click(screen.getByRole('button', { name: 'Generate New Code' }));
    const axeResults = await axe(container);
    expect(axeResults).toHaveNoViolations();

    // Verify validation alert when guest name is blank
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Guest name is required.');
    expect(mockCreate).not.toHaveBeenCalled();

    // Populate fields including whitespace code, duplicate tags, plusOneAllocations, and dietaryNotes
    fireEvent.change(screen.getByPlaceholderText('e.g. John Doe'), {
      target: { value: '  Nora Valkyrie  ' },
    });
    fireEvent.change(screen.getByPlaceholderText('e.g. JOHN123'), {
      target: { value: '    ' },
    });
    fireEvent.change(screen.getByLabelText('Plus-One Allocations'), {
      target: { value: '2' },
    });
    fireEvent.change(screen.getByLabelText('Dietary Notes'), {
      target: { value: '  Nut allergy  ' },
    });
    fireEvent.change(screen.getByLabelText('Party Tags (Comma-Separated)'), {
      target: { value: ' VIP , Family , VIP ' },
    });

    // Dirty Cancel opens confirmation alertdialog; dismissing keeps draft intact
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    const discardDialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(discardDialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText('e.g. John Doe')).toHaveValue('  Nora Valkyrie  ');

    // Submit inline creation; whitespace code is omitted and duplicate tags are deduplicated
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith({
        guestName: 'Nora Valkyrie',
        used: false,
        plusOneAllocations: 2,
        dietaryNotes: 'Nut allergy',
        partyTags: ['VIP', 'Family'],
      });
      expect(mockCreate.mock.calls[0][0]).not.toHaveProperty('code');
      expect(screen.getByText('Invitation code created successfully.')).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: 'Generate Invitation Code' })
      ).not.toBeInTheDocument();
    });

    // Reopening starts with a clean reset draft
    fireEvent.click(screen.getByRole('button', { name: 'Generate New Code' }));
    expect(screen.getByPlaceholderText('e.g. John Doe')).toHaveValue('');
    expect(screen.getByLabelText('Plus-One Allocations')).toHaveValue(0);
    expect(screen.getByLabelText('Dietary Notes')).toHaveValue('');
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

  it('exports CSV file via server route when Export CSV button is clicked', () => {
    let clickedHref = '';
    const mockAnchorClick = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clickedHref = this.href;
    });

    renderComponent();

    const exportBtn = screen.getByRole('button', { name: 'Export CSV' });
    fireEvent.click(exportBtn);

    expect(mockAnchorClick).toHaveBeenCalledTimes(1);
    expect(clickedHref).toContain('/api/admin/invitation-codes/export');
    expect(screen.getByText('Invitation codes exported successfully.')).toBeInTheDocument();

    mockAnchorClick.mockRestore();
  });

  describe('Bulk Selection and Floating Action Bar', () => {
    it('updates selection count in floating toolbar as individual checkboxes are toggled', () => {
      renderComponent();

      expect(screen.queryByRole('region', { name: 'Batch actions toolbar' })).not.toBeInTheDocument();

      const aliceCheckbox = screen.getByRole('checkbox', { name: 'Select invitation code for Alice Smith' });
      const bobCheckbox = screen.getByRole('checkbox', { name: 'Select invitation code for Bob Jones' });

      fireEvent.click(aliceCheckbox);
      expect(screen.getByRole('region', { name: 'Batch actions toolbar' })).toBeInTheDocument();
      expect(screen.getByText('1 Selected')).toBeInTheDocument();

      fireEvent.click(bobCheckbox);
      expect(screen.getByText('2 Selected')).toBeInTheDocument();

      fireEvent.click(aliceCheckbox);
      expect(screen.getByText('1 Selected')).toBeInTheDocument();

      fireEvent.click(bobCheckbox);
      expect(screen.queryByRole('region', { name: 'Batch actions toolbar' })).not.toBeInTheDocument();
    });

    it('toggles Select All Filtered to check/uncheck all visible items and sets indeterminate state', () => {
      renderComponent();

      const selectAllCheckbox = screen.getByRole('checkbox', { name: 'Select all filtered invitation codes' }) as HTMLInputElement;

      // Select All
      fireEvent.click(selectAllCheckbox);
      expect(screen.getByText('5 Selected')).toBeInTheDocument();

      // Deselect All via header checkbox
      fireEvent.click(selectAllCheckbox);
      expect(screen.queryByRole('region', { name: 'Batch actions toolbar' })).not.toBeInTheDocument();

      // Check one item -> indeterminate state check
      const aliceCheckbox = screen.getByRole('checkbox', { name: 'Select invitation code for Alice Smith' });
      fireEvent.click(aliceCheckbox);
      expect(selectAllCheckbox.indeterminate).toBe(true);

      // Filter to Unused tab and select all filtered
      const unusedTab = screen.getByRole('tab', { name: /Unused/i });
      fireEvent.click(unusedTab);

      const selectAllFiltered = screen.getByRole('checkbox', { name: 'Select all filtered invitation codes' });
      fireEvent.click(selectAllFiltered);
      expect(screen.getByText('4 Selected')).toBeInTheDocument();
    });

    it('resets selection state when search filter or status tab changes', () => {
      renderComponent();

      const aliceCheckbox = screen.getByRole('checkbox', { name: 'Select invitation code for Alice Smith' });
      fireEvent.click(aliceCheckbox);
      expect(screen.getByText('1 Selected')).toBeInTheDocument();

      // Change search query
      const searchInput = screen.getByRole('textbox', { name: 'Search invitation codes' });
      fireEvent.change(searchInput, { target: { value: 'Alice' } });
      expect(screen.queryByRole('region', { name: 'Batch actions toolbar' })).not.toBeInTheDocument();

      // Select again and switch status filter tab
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select invitation code for Alice Smith' }));
      expect(screen.getByText('1 Selected')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('tab', { name: /Redeemed/i }));
      expect(screen.queryByRole('region', { name: 'Batch actions toolbar' })).not.toBeInTheDocument();
    });

    it('opens batch delete confirmation modal listing selected guest names preview and executes batch deletion', async () => {
      mockRemoveBatch.mockResolvedValueOnce(true);
      renderComponent();

      fireEvent.click(screen.getByRole('checkbox', { name: 'Select invitation code for Alice Smith' }));
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select invitation code for Bob Jones' }));

      // Click "Delete Selected" on toolbar
      const deleteSelectedBtn = screen.getByRole('button', { name: 'Delete Selected' });
      fireEvent.click(deleteSelectedBtn);

      // Modal open
      const modal = screen.getByRole('alertdialog', { name: 'Confirm Batch Deletion' });
      expect(modal).toBeInTheDocument();
      expect(modal).toHaveAttribute('aria-modal', 'true');
      expect(within(modal).getByText('Alice Smith')).toBeInTheDocument();
      expect(within(modal).getByText('Bob Jones')).toBeInTheDocument();

      // Click Confirm Delete in modal
      const confirmDeleteBtn = screen.getByRole('button', { name: 'Delete 2 Code(s)' });
      fireEvent.click(confirmDeleteBtn);

      await waitFor(() => {
        expect(mockRemoveBatch).toHaveBeenCalledWith(['code-1', 'code-2']);
        expect(screen.getByText('Successfully deleted 2 invitation code(s).')).toBeInTheDocument();
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      });

      expect(screen.queryByRole('region', { name: 'Batch actions toolbar' })).not.toBeInTheDocument();
    });

    it('supports batch status updates (Mark as Redeemed / Mark as Unused)', async () => {
      mockUpdateBatch.mockResolvedValue(true);
      renderComponent();

      fireEvent.click(screen.getByRole('checkbox', { name: 'Select invitation code for Alice Smith' }));
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select invitation code for Charlie Brown' }));

      // Mark as Redeemed
      fireEvent.click(screen.getByRole('button', { name: 'Mark as Redeemed' }));

      await waitFor(() => {
        expect(mockUpdateBatch).toHaveBeenCalledWith(['code-1', 'code-3'], { used: true });
        expect(screen.getByText('Marked 2 invitation code(s) as redeemed.')).toBeInTheDocument();
      });

      // Mark as Unused
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select invitation code for Bob Jones' }));
      fireEvent.click(screen.getByRole('button', { name: 'Mark as Unused' }));

      await waitFor(() => {
        expect(mockUpdateBatch).toHaveBeenCalledWith(['code-2'], { used: false });
        expect(screen.getByText('Marked 1 invitation code(s) as unused.')).toBeInTheDocument();
      });
    });

    it('exports selected invitation codes to CSV via server route', () => {
      let clickedHref = '';
      const mockAnchorClick = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        clickedHref = this.href;
      });

      renderComponent();

      fireEvent.click(screen.getByRole('checkbox', { name: 'Select invitation code for Alice Smith' }));
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select invitation code for Charlie Brown' }));

      fireEvent.click(screen.getByRole('button', { name: 'Export Selected CSV' }));

      expect(mockAnchorClick).toHaveBeenCalledTimes(1);
      expect(clickedHref).toContain('/api/admin/invitation-codes/export?ids=code-1%2Ccode-3');
      expect(screen.getByText('Exported 2 selected invitation code(s) to CSV.')).toBeInTheDocument();

      mockAnchorClick.mockRestore();
    });

    it('opens QR preview modal when View QR is clicked on a guest entry', () => {
      renderComponent();

      const viewQrButtons = screen.getAllByRole('button', { name: /View QR code for/i });
      expect(viewQrButtons.length).toBeGreaterThan(0);

      fireEvent.click(viewQrButtons[0]);

      expect(screen.getByRole('dialog', { name: 'Guest Invitation QR Preview' })).toBeInTheDocument();
      expect(screen.getByTestId('qr-modal-guest-name')).toHaveTextContent('Alice Smith');
      expect(screen.getByRole('button', { name: /Download QR code as PNG image/i })).toBeInTheDocument();
    });

    it('opens print labels modal from the global header and batch toolbar', () => {
      renderComponent();

      // From global header
      const globalPrintButton = screen.getByRole('button', { name: 'Print QR Labels' });
      fireEvent.click(globalPrintButton);

      expect(screen.getByRole('dialog', { name: 'Printable Invitation QR Labels' })).toBeInTheDocument();
      expect(screen.getByTestId('qr-print-sheet')).toBeInTheDocument();

      // Close modal
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));

      // Select 1 guest and open from batch toolbar
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select invitation code for Alice Smith' }));
      const batchToolbar = screen.getByRole('region', { name: 'Batch actions toolbar' });
      const batchPrintButton = within(batchToolbar).getByRole('button', { name: 'Print QR Labels' });
      fireEvent.click(batchPrintButton);

      expect(screen.getByRole('dialog', { name: 'Printable Invitation QR Labels' })).toBeInTheDocument();
      const labels = screen.getAllByTestId('qr-label-card');
      expect(labels.length).toBe(1);
      expect(within(labels[0]).getByText('Alice Smith')).toBeInTheDocument();
    });

    it('correctly transitions indeterminate state and updates row checkboxes during toggles and deselect all', () => {
      renderComponent();

      const selectAllCheckbox = screen.getByRole('checkbox', { name: 'Select all filtered invitation codes' }) as HTMLInputElement;
      const aliceCheckbox = screen.getByRole('checkbox', { name: 'Select invitation code for Alice Smith' }) as HTMLInputElement;
      const bobCheckbox = screen.getByRole('checkbox', { name: 'Select invitation code for Bob Jones' }) as HTMLInputElement;

      // Initially none selected
      expect(selectAllCheckbox.checked).toBe(false);
      expect(selectAllCheckbox.indeterminate).toBe(false);
      expect(aliceCheckbox.checked).toBe(false);
      expect(bobCheckbox.checked).toBe(false);

      // Select Alice -> partial selection (indeterminate)
      fireEvent.click(aliceCheckbox);
      expect(aliceCheckbox.checked).toBe(true);
      expect(bobCheckbox.checked).toBe(false);
      expect(selectAllCheckbox.indeterminate).toBe(true);
      expect(selectAllCheckbox.checked).toBe(false);

      // Select All Filtered -> all selected
      fireEvent.click(selectAllCheckbox);
      expect(selectAllCheckbox.checked).toBe(true);
      expect(selectAllCheckbox.indeterminate).toBe(false);
      expect(aliceCheckbox.checked).toBe(true);
      expect(bobCheckbox.checked).toBe(true);

      // Deselect Alice -> partial selection (indeterminate)
      fireEvent.click(aliceCheckbox);
      expect(aliceCheckbox.checked).toBe(false);
      expect(bobCheckbox.checked).toBe(true);
      expect(selectAllCheckbox.indeterminate).toBe(true);
      expect(selectAllCheckbox.checked).toBe(false);

      // Click Deselect All button
      const deselectBtn = screen.getByRole('button', { name: 'Deselect All' });
      fireEvent.click(deselectBtn);
      expect(selectAllCheckbox.checked).toBe(false);
      expect(selectAllCheckbox.indeterminate).toBe(false);
      expect(aliceCheckbox.checked).toBe(false);
      expect(bobCheckbox.checked).toBe(false);
    });

    it('manages party tags in bulk for selected invitation codes in a single batchUpdateTags call', async () => {
      mockBatchUpdateTags.mockResolvedValue({ success: true, count: 2 });
      renderComponent();

      fireEvent.click(screen.getByRole('checkbox', { name: 'Select invitation code for Alice Smith' }));
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select invitation code for Diana Prince' }));

      // Open Manage Tags modal
      fireEvent.click(screen.getByRole('button', { name: 'Manage Tags' }));
      expect(screen.getByText('Manage Party Tags (2 Selected)')).toBeInTheDocument();

      // Enter tag name and apply
      const tagInput = screen.getByPlaceholderText('e.g. VIP');
      fireEvent.change(tagInput, { target: { value: 'VIP' } });
      fireEvent.click(screen.getByRole('button', { name: 'Apply Tag Changes' }));

      await waitFor(() => {
        expect(mockBatchUpdateTags).toHaveBeenCalledTimes(1);
        expect(mockBatchUpdateTags).toHaveBeenCalledWith(['code-1', 'code-4'], ['VIP'], 'add');
        expect(mockUpdateBatch).not.toHaveBeenCalled();
        expect(screen.getByText('Updated tags for 2 code(s).')).toBeInTheDocument();
      });
    });

    it('tags 120 selected guests in a single batchUpdateTags request with one toast', async () => {
      const manyGuests = Array.from({ length: 120 }, (_, i) => ({
        id: `guest-${i + 1}`,
        guestName: `Guest ${i + 1}`,
        code: `CODE${i + 1}`,
        used: false,
        partyTags: ['Legacy'],
      }));
      mockBatchUpdateTags.mockResolvedValue({ success: true, count: 120 });

      (useAdminInvitationCodes as jest.Mock).mockReturnValue({
        data: manyGuests,
        isLoading: false,
        error: null,
        create: mockCreate,
        update: mockUpdate,
        remove: mockRemove,
        removeBatch: mockRemoveBatch,
        updateBatch: mockUpdateBatch,
        batchUpdateTags: mockBatchUpdateTags,
        fetchAll: mockFetchAll,
      });

      renderComponent();

      fireEvent.click(screen.getByRole('checkbox', { name: 'Select all filtered invitation codes' }));
      fireEvent.click(screen.getByRole('button', { name: 'Manage Tags' }));
      expect(screen.getByText('Manage Party Tags (120 Selected)')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('radio', { name: 'Remove Tag' }));
      fireEvent.change(screen.getByPlaceholderText('e.g. VIP'), { target: { value: '  Legacy  ' } });
      fireEvent.click(screen.getByRole('button', { name: 'Apply Tag Changes' }));

      await waitFor(() => {
        expect(mockBatchUpdateTags).toHaveBeenCalledTimes(1);
        expect(mockBatchUpdateTags).toHaveBeenCalledWith(
          manyGuests.map((g) => g.id),
          ['Legacy'],
          'remove'
        );
        expect(mockUpdateBatch).not.toHaveBeenCalled();
        expect(screen.getAllByText('Updated tags for 120 code(s).')).toHaveLength(1);
      });
    });

    it('sets household name in bulk for selected codes', async () => {
      mockUpdateBatch.mockResolvedValue(true);
      renderComponent();

      fireEvent.click(screen.getByRole('checkbox', { name: 'Select invitation code for Alice Smith' }));
      fireEvent.click(screen.getByRole('button', { name: 'Set Household' }));

      expect(screen.getByText('Set Household Name (1 Selected)')).toBeInTheDocument();

      const householdInput = screen.getByPlaceholderText('e.g. Smith Household');
      fireEvent.change(householdInput, { target: { value: 'Smith-Jones Household' } });
      fireEvent.click(screen.getByRole('button', { name: 'Apply Household Name' }));

      await waitFor(() => {
        expect(mockUpdateBatch).toHaveBeenCalledWith(['code-1'], { householdName: 'Smith-Jones Household' });
        expect(screen.getByText('Updated household name for 1 code(s).')).toBeInTheDocument();
      });
    });
  });

  describe('Modal Editors and Full Permission Sync', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('opens GuestEditorModal pre-filled with guest profile & address fields, warns on code edit, and saves without altering seating or redemption fields', async () => {
      const richGuest = {
        id: 'code-rich',
        guestName: 'Alice Smith',
        code: 'ALICE123',
        email: 'alice@example.com',
        householdName: 'Smith Family',
        partyGroup: 'Bridal Party',
        partyTags: ['VIP', 'Out of Town'],
        plusOneAllocations: 1,
        plusOneFirstName: 'Jordan',
        plusOneLastName: 'Smith',
        dietaryNotes: 'Gluten Free',
        addressLine1: '123 Maple St',
        addressLine2: 'Apt 2B',
        city: 'Seattle',
        state: 'WA',
        zipCode: '98101',
        country: 'USA',
        used: true,
        tableId: 'table-9',
        seatNumber: 5,
        extraFields: { attendanceStatus: 'attending' },
      };

      (useAdminInvitationCodes as jest.Mock).mockReturnValue({
        data: [richGuest],
        isLoading: false,
        error: null,
        create: mockCreate,
        update: mockUpdate.mockResolvedValueOnce({ ...richGuest, guestName: 'Alice M. Smith', code: 'ALICE999' }),
        remove: mockRemove,
        removeBatch: mockRemoveBatch,
        updateBatch: mockUpdateBatch,
        fetchAll: mockFetchAll,
      });

      renderComponent();

      fireEvent.click(screen.getByRole('button', { name: 'Edit guest Alice Smith' }));

      const dialog = screen.getByRole('dialog', { name: 'Edit Guest Details' });
      expect(dialog).toBeInTheDocument();

      // Verify pre-filled values across profile and address fields
      expect(within(dialog).getByLabelText('Guest Name *')).toHaveValue('Alice Smith');
      expect(within(dialog).getByLabelText('Invitation Code *')).toHaveValue('ALICE123');
      expect(within(dialog).getByLabelText('Email')).toHaveValue('alice@example.com');
      expect(within(dialog).getByLabelText('Household Name')).toHaveValue('Smith Family');
      expect(within(dialog).getByLabelText('Party Group')).toHaveValue('Bridal Party');
      expect(within(dialog).getByLabelText('Party Tags (Comma-Separated)')).toHaveValue('VIP, Out of Town');
      expect(within(dialog).getByLabelText('Plus-One Allocations')).toHaveValue(1);
      expect(within(dialog).getByLabelText('Plus-One First Name')).toHaveValue('Jordan');
      expect(within(dialog).getByLabelText('Plus-One Last Name')).toHaveValue('Smith');
      expect(within(dialog).getByLabelText('Dietary Notes')).toHaveValue('Gluten Free');
      expect(within(dialog).getByLabelText('Address Line 1')).toHaveValue('123 Maple St');
      expect(within(dialog).getByLabelText('Address Line 2')).toHaveValue('Apt 2B');
      expect(within(dialog).getByLabelText('City')).toHaveValue('Seattle');
      expect(within(dialog).getByLabelText('State / Province')).toHaveValue('WA');
      expect(within(dialog).getByLabelText('Zip / Postal Code')).toHaveValue('98101');
      expect(within(dialog).getByLabelText('Country')).toHaveValue('USA');

      // Warning is hidden when code matches original
      expect(within(dialog).queryByTestId('code-change-warning')).not.toBeInTheDocument();

      // Changing code triggers QR invalidation warning
      fireEvent.change(within(dialog).getByLabelText('Invitation Code *'), {
        target: { value: 'alice999' },
      });
      const warning = within(dialog).getByTestId('code-change-warning');
      expect(warning).toHaveTextContent('printed QR links');
      expect(warning).toHaveTextContent('ALICE123');

      // Edit guest name and city, clear address line 2
      fireEvent.change(within(dialog).getByLabelText('Guest Name *'), {
        target: { value: 'Alice M. Smith' },
      });
      fireEvent.change(within(dialog).getByLabelText('Address Line 2'), {
        target: { value: '' },
      });

      fireEvent.click(within(dialog).getByRole('button', { name: 'Save Guest Changes' }));

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledWith('code-rich', {
          guestName: 'Alice M. Smith',
          code: 'ALICE999',
          email: 'alice@example.com',
          householdName: 'Smith Family',
          partyGroup: 'Bridal Party',
          partyTags: ['VIP', 'Out of Town'],
          plusOneAllocations: 1,
          plusOneFirstName: 'Jordan',
          plusOneLastName: 'Smith',
          dietaryNotes: 'Gluten Free',
          addressLine1: '123 Maple St',
          addressLine2: null,
          city: 'Seattle',
          state: 'WA',
          zipCode: '98101',
          country: 'USA',
        });
        expect(screen.getByText('Guest details updated successfully.')).toBeInTheDocument();
      });

      // Verify payload does NOT touch tableId, seatNumber, used, or extraFields
      const savedPayload = mockUpdate.mock.calls[0][1];
      expect(savedPayload).not.toHaveProperty('tableId');
      expect(savedPayload).not.toHaveProperty('seatNumber');
      expect(savedPayload).not.toHaveProperty('used');
      expect(savedPayload).not.toHaveProperty('extraFields');
    });

    it('validates startTime and endTime in Manage Sub-Events modal and saves schedule times', async () => {
      global.fetch = jest.fn().mockImplementation((url: string, options?: any) => {
        if (url.startsWith('/api/admin/sub-events/access')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                success: true,
                data: {
                  subEvents: [
                    {
                      id: 'se-1',
                      title: 'Welcome Drinks',
                      startTime: '2026-09-18T17:00:00.000Z',
                      endTime: '2026-09-18T19:00:00.000Z',
                      isPrivate: true,
                      allowedInvitationCodeIds: [],
                    },
                  ],
                  invitationCodes: [],
                },
              }),
          });
        }
        if (url === '/api/admin/sub-events' && options?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: () =>
              Promise.resolve({
                id: 'se-2',
                title: 'Farewell Brunch',
                isPrivate: true,
              }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }) as any;

      renderComponent();

      fireEvent.click(screen.getByRole('button', { name: 'Manage Sub-Events' }));

      const dialog = await screen.findByRole('dialog', { name: 'Create New Sub-Event' });
      fireEvent.change(within(dialog).getByLabelText('Title *'), {
        target: { value: 'Farewell Brunch' },
      });
      fireEvent.change(within(dialog).getByLabelText('Start Time (Optional)'), {
        target: { value: '2026-09-20T12:00' },
      });
      fireEvent.change(within(dialog).getByLabelText('End Time (Optional)'), {
        target: { value: '2026-09-20T10:00' },
      });

      // Inline validation blocks saving when endTime precedes startTime
      expect(within(dialog).getByRole('alert')).toHaveTextContent(
        'End time cannot precede start time.'
      );
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create Sub-Event' }));
      expect(global.fetch).not.toHaveBeenCalledWith('/api/admin/sub-events', expect.anything());

      // Fix endTime so it follows startTime and submit
      fireEvent.change(within(dialog).getByLabelText('End Time (Optional)'), {
        target: { value: '2026-09-20T14:00' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create Sub-Event' }));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/admin/sub-events',
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('"title":"Farewell Brunch"'),
          })
        );
      });
    });

    it('loads complete private event permissions for >100 alphabetical guests and updates only the toggled event via batch endpoint', async () => {
      const largeGuestList = Array.from({ length: 105 }, (_, idx) => {
        const num = String(idx + 1).padStart(3, '0');
        return {
          id: `code-${num}`,
          guestName: idx === 104 ? 'Zoe Zimmerman' : `Guest ${num}`,
          code: `CODE${num}`,
          used: false,
        };
      });

      (useAdminInvitationCodes as jest.Mock).mockReturnValue({
        data: largeGuestList,
        isLoading: false,
        error: null,
        create: mockCreate,
        update: mockUpdate,
        remove: mockRemove,
        removeBatch: mockRemoveBatch,
        updateBatch: mockUpdateBatch,
        fetchAll: mockFetchAll,
      });

      global.fetch = jest.fn().mockImplementation((url: string, options?: any) => {
        if (url === '/api/admin/sub-events/access' && (!options?.method || options.method === 'GET')) {
          // Simulate backend returning paginated invitationCodes (first 25 only, NOT including code-105),
          // while subEvents carry uncapped allowedInvitationCodeIds including code-105!
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                success: true,
                data: {
                  subEvents: [
                    {
                      id: 'se-rehearsal',
                      title: 'Rehearsal Dinner',
                      isPrivate: true,
                      allowedInvitationCodeIds: ['code-001', 'code-105'],
                    },
                    {
                      id: 'se-welcome',
                      title: 'Welcome Party',
                      isPrivate: true,
                      allowedInvitationCodeIds: ['code-105'],
                    },
                  ],
                  invitationCodes: [
                    {
                      id: 'code-001',
                      code: 'CODE001',
                      guestName: 'Guest 001',
                      allowedSubEventIds: ['se-rehearsal'],
                    },
                  ],
                  pagination: { total: 105, page: 1, limit: 25, totalPages: 5 },
                },
              }),
          });
        }
        if (url === '/api/admin/sub-events/access/batch' && options?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true, data: { count: 1 } }),
          });
        }
        return Promise.resolve({ ok: false });
      }) as any;

      renderComponent();

      // Navigate to last page (page 3 of 3) to inspect the 105th alphabetical guest (Zoe Zimmerman)
      fireEvent.click(screen.getByRole('button', { name: 'Last page' }));

      // Wait for sub-event permissions on the 105th alphabetical guest (Zoe Zimmerman)
      const zoeRehearsalCheckbox = (await screen.findByRole('checkbox', {
        name: 'Toggle access for Rehearsal Dinner on Zoe Zimmerman',
      })) as HTMLInputElement;
      const zoeWelcomeCheckbox = screen.getByRole('checkbox', {
        name: 'Toggle access for Welcome Party on Zoe Zimmerman',
      }) as HTMLInputElement;

      expect(zoeRehearsalCheckbox).toBeChecked();
      expect(zoeWelcomeCheckbox).toBeChecked();

      // Uncheck Rehearsal Dinner on Zoe Zimmerman -> must call batch revoke ONLY for se-rehearsal and keep Welcome Party checked
      fireEvent.click(zoeRehearsalCheckbox);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/admin/sub-events/access/batch',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({
              invitationCodeIds: ['code-105'],
              subEventIds: ['se-rehearsal'],
              action: 'revoke',
            }),
          })
        );
      });

      expect(zoeRehearsalCheckbox).not.toBeChecked();
      expect(zoeWelcomeCheckbox).toBeChecked();
    });
  });

  describe('Central Dialog Accessibility, Focus Containment, and Dismissal', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('Set Household modal exposes accessible Dialog semantics, traps Tab focus, passes jest-axe, and closes on Escape/backdrop restoring focus', async () => {
      const { container } = renderComponent();

      fireEvent.click(screen.getByRole('checkbox', { name: 'Select invitation code for Alice Smith' }));
      const triggerBtn = screen.getByRole('button', { name: 'Set Household' });
      triggerBtn.focus();
      fireEvent.click(triggerBtn);

      const dialog = screen.getByRole('dialog', { name: 'Set Household Name (1 Selected)' });
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      const labelledBy = dialog.getAttribute('aria-labelledby');
      expect(labelledBy).toBeTruthy();
      expect(within(dialog).getByRole('heading', { level: 2 })).toHaveAttribute('id', labelledBy);

      const householdInput = within(dialog).getByLabelText('Household Name');
      const cancelBtn = within(dialog).getByRole('button', { name: 'Cancel' });
      const applyBtn = within(dialog).getByRole('button', { name: 'Apply Household Name' });

      // Initial focus moves immediately into input field
      expect(householdInput).toHaveFocus();

      // Tab wraps from last element to first, Shift+Tab wraps from first to last
      applyBtn.focus();
      fireEvent.keyDown(applyBtn, { key: 'Tab' });
      expect(householdInput).toHaveFocus();

      fireEvent.keyDown(householdInput, { key: 'Tab', shiftKey: true });
      expect(applyBtn).toHaveFocus();
      expect(cancelBtn).toBeInTheDocument();

      const axeResults = await axe(container);
      expect(axeResults).toHaveNoViolations();

      // Escape closes modal and restores focus to initiating control
      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: /Set Household Name/i })).not.toBeInTheDocument();
      });
      expect(triggerBtn).toHaveFocus();

      // Re-open and dismiss via backdrop click
      fireEvent.click(triggerBtn);
      const reopenedDialog = screen.getByRole('dialog', { name: 'Set Household Name (1 Selected)' });
      const backdrop = reopenedDialog.parentElement?.parentElement as HTMLElement;
      fireEvent.click(backdrop);
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: /Set Household Name/i })).not.toBeInTheDocument();
      });
      expect(mockUpdateBatch).not.toHaveBeenCalled();
    });

    it('Manage Party Tags modal exposes accessible Dialog semantics, traps Tab focus, passes jest-axe, and closes on Escape/backdrop', async () => {
      const { container } = renderComponent();

      fireEvent.click(screen.getByRole('checkbox', { name: 'Select invitation code for Alice Smith' }));
      const triggerBtn = screen.getByRole('button', { name: 'Manage Tags' });
      triggerBtn.focus();
      fireEvent.click(triggerBtn);

      const dialog = screen.getByRole('dialog', { name: 'Manage Party Tags (1 Selected)' });
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      const labelledBy = dialog.getAttribute('aria-labelledby');
      expect(within(dialog).getByRole('heading', { level: 2 })).toHaveAttribute('id', labelledBy);

      const addRadio = within(dialog).getByRole('radio', { name: 'Add Tag' });
      const applyBtn = within(dialog).getByRole('button', { name: 'Apply Tag Changes' });

      expect(addRadio).toHaveFocus();
      applyBtn.focus();
      fireEvent.keyDown(applyBtn, { key: 'Tab' });
      expect(addRadio).toHaveFocus();
      fireEvent.keyDown(addRadio, { key: 'Tab', shiftKey: true });
      expect(applyBtn).toHaveFocus();

      const axeResults = await axe(container);
      expect(axeResults).toHaveNoViolations();

      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: /Manage Party Tags/i })).not.toBeInTheDocument();
      });
      expect(triggerBtn).toHaveFocus();

      // Re-open and dismiss via backdrop click
      fireEvent.click(triggerBtn);
      const reopenedDialog = screen.getByRole('dialog', { name: 'Manage Party Tags (1 Selected)' });
      fireEvent.click(reopenedDialog.parentElement?.parentElement as HTMLElement);
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: /Manage Party Tags/i })).not.toBeInTheDocument();
      });
    });

    it('Batch Sub-Event Access modal exposes accessible Dialog semantics, traps Tab focus, passes jest-axe, submits batch update, and supports Escape/backdrop dismissal', async () => {
      global.fetch = jest.fn().mockImplementation((url: string, options?: any) => {
        if (url === '/api/admin/sub-events/access' && (!options?.method || options.method === 'GET')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                success: true,
                data: {
                  subEvents: [
                    { id: 'se-1', title: 'Rehearsal Dinner', isPrivate: true, allowedInvitationCodeIds: [] },
                  ],
                  invitationCodes: [],
                },
              }),
          });
        }
        if (url === '/api/admin/sub-events/access/batch' && options?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true, data: { count: 1 } }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }) as any;

      const { container } = renderComponent();
      await screen.findByRole('checkbox', { name: 'Toggle access for Rehearsal Dinner on Alice Smith' });

      fireEvent.click(screen.getByRole('checkbox', { name: 'Select invitation code for Alice Smith' }));
      const triggerBtn = screen.getByRole('button', { name: 'Sub-Event Access' });
      triggerBtn.focus();
      fireEvent.click(triggerBtn);

      const dialog = screen.getByRole('dialog', { name: 'Batch Sub-Event Access (1 Guests Selected)' });
      expect(dialog).toHaveAttribute('aria-modal', 'true');

      const actionSelect = within(dialog).getByLabelText('Batch sub-event action');
      const applyBtn = within(dialog).getByRole('button', { name: 'Apply Batch Access' });
      expect(actionSelect).toHaveFocus();

      applyBtn.focus();
      fireEvent.keyDown(applyBtn, { key: 'Tab' });
      expect(actionSelect).toHaveFocus();

      const axeResults = await axe(container);
      expect(axeResults).toHaveNoViolations();

      // Dismiss via Escape and restore focus
      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: /Batch Sub-Event Access/i })).not.toBeInTheDocument();
      });
      expect(triggerBtn).toHaveFocus();

      // Re-open, select event, and submit form
      fireEvent.click(triggerBtn);
      const reopened = screen.getByRole('dialog', { name: 'Batch Sub-Event Access (1 Guests Selected)' });
      fireEvent.change(within(reopened).getByLabelText('Batch sub-event action'), {
        target: { value: 'revoke' },
      });
      fireEvent.click(within(reopened).getByRole('checkbox', { name: /Rehearsal Dinner/i }));
      fireEvent.click(within(reopened).getByRole('button', { name: 'Apply Batch Access' }));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/admin/sub-events/access/batch',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({
              invitationCodeIds: ['code-1'],
              subEventIds: ['se-1'],
              action: 'revoke',
            }),
          })
        );
        expect(screen.queryByRole('dialog', { name: /Batch Sub-Event Access/i })).not.toBeInTheDocument();
      });
    });

    it('Confirm Batch Deletion modal uses alertdialog role, traps focus, passes jest-axe, and dismisses via Escape or backdrop without deleting', async () => {
      const { container } = renderComponent();

      fireEvent.click(screen.getByRole('checkbox', { name: 'Select invitation code for Alice Smith' }));
      const triggerBtn = screen.getByRole('button', { name: 'Delete Selected' });
      triggerBtn.focus();
      fireEvent.click(triggerBtn);

      const alertDialog = screen.getByRole('alertdialog', { name: 'Confirm Batch Deletion' });
      expect(alertDialog).toHaveAttribute('aria-modal', 'true');
      expect(alertDialog).toHaveAttribute('aria-describedby', 'batch-delete-modal-desc');

      const cancelBtn = within(alertDialog).getByRole('button', { name: 'Cancel' });
      const deleteBtn = within(alertDialog).getByRole('button', { name: 'Delete 1 Code(s)' });
      expect(cancelBtn).toHaveFocus();

      deleteBtn.focus();
      fireEvent.keyDown(deleteBtn, { key: 'Tab' });
      expect(cancelBtn).toHaveFocus();
      fireEvent.keyDown(cancelBtn, { key: 'Tab', shiftKey: true });
      expect(deleteBtn).toHaveFocus();

      const axeResults = await axe(container);
      expect(axeResults).toHaveNoViolations();

      // Backdrop click dismisses without deleting
      fireEvent.click(alertDialog.parentElement?.parentElement as HTMLElement);
      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      });
      expect(mockRemoveBatch).not.toHaveBeenCalled();

      // Re-open and dismiss via Escape restoring focus
      triggerBtn.focus();
      fireEvent.click(triggerBtn);
      expect(screen.getByRole('alertdialog', { name: 'Confirm Batch Deletion' })).toBeInTheDocument();
      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      });
      expect(triggerBtn).toHaveFocus();
      expect(mockRemoveBatch).not.toHaveBeenCalled();
    });

    it('Timeline Sub-Event modal traps focus, passes jest-axe, and restores focus to Manage Sub-Events on Escape and backdrop click', async () => {
      const { container } = renderComponent();

      const triggerBtn = screen.getByRole('button', { name: 'Manage Sub-Events' });
      triggerBtn.focus();
      fireEvent.click(triggerBtn);

      const dialog = screen.getByRole('dialog', { name: 'Create New Sub-Event' });
      expect(dialog).toHaveAttribute('aria-modal', 'true');

      const titleInput = within(dialog).getByLabelText('Title *');
      const submitBtn = within(dialog).getByRole('button', { name: 'Create Sub-Event' });
      expect(titleInput).toHaveFocus();

      submitBtn.focus();
      fireEvent.keyDown(submitBtn, { key: 'Tab' });
      expect(titleInput).toHaveFocus();

      const axeResults = await axe(container);
      expect(axeResults).toHaveNoViolations();

      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: 'Create New Sub-Event' })).not.toBeInTheDocument();
      });
      expect(triggerBtn).toHaveFocus();

      // Backdrop dismissal
      fireEvent.click(triggerBtn);
      const reopened = screen.getByRole('dialog', { name: 'Create New Sub-Event' });
      fireEvent.click(reopened.parentElement?.parentElement as HTMLElement);
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: 'Create New Sub-Event' })).not.toBeInTheDocument();
      });
    });
  });

  describe('Accessible Filter Primitives (ToggleButtonGroup and SegmentedTabs)', () => {
    it('exposes labelled group roles, aria-pressed states, SegmentedTabs keyboard navigation, and passes jest-axe', async () => {
      const taggedCodes = [
        {
          id: 'c1',
          guestName: 'Alice Smith',
          code: 'ALICE1',
          used: true,
          partyTags: ['VIP', 'Family'],
          addressLine1: '100 Main St',
          city: 'Chicago',
          state: 'IL',
          zipCode: '60601',
          country: 'USA',
          extraFields: { attendanceStatus: 'attending' },
        },
        {
          id: 'c2',
          guestName: 'Bob Jones',
          code: 'BOB2',
          used: false,
          partyTags: ['Friends'],
          extraFields: { attendanceStatus: 'pending' },
        },
      ];

      (useAdminInvitationCodes as jest.Mock).mockReturnValue({
        data: taggedCodes,
        isLoading: false,
        error: null,
        create: mockCreate,
        update: mockUpdate,
        remove: mockRemove,
        removeBatch: mockRemoveBatch,
        updateBatch: mockUpdateBatch,
        fetchAll: mockFetchAll,
      });

      const { container } = renderComponent();

      // 1. Party Tags group
      const tagsGroup = screen.getByRole('group', { name: /Party Tags/i });
      const allTagsBtn = within(tagsGroup).getByRole('button', { name: 'All Tags' });
      const vipTagBtn = within(tagsGroup).getByRole('button', { name: '#VIP' });

      expect(allTagsBtn).toHaveAttribute('aria-pressed', 'true');
      expect(vipTagBtn).toHaveAttribute('aria-pressed', 'false');

      fireEvent.click(vipTagBtn);
      expect(vipTagBtn).toHaveAttribute('aria-pressed', 'true');
      expect(allTagsBtn).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
      expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument();

      // Clicking active tag again toggles back to All Tags
      fireEvent.click(vipTagBtn);
      expect(allTagsBtn).toHaveAttribute('aria-pressed', 'true');
      expect(vipTagBtn).toHaveAttribute('aria-pressed', 'false');

      // 2. Address filter group
      const addressGroup = screen.getByRole('group', { name: /Address/i });
      const allAddrBtn = within(addressGroup).getByRole('button', { name: 'All Addresses' });
      const completeAddrBtn = within(addressGroup).getByRole('button', { name: /Address Complete/i });
      expect(allAddrBtn).toHaveAttribute('aria-pressed', 'true');
      expect(completeAddrBtn).toHaveAttribute('aria-pressed', 'false');

      fireEvent.click(completeAddrBtn);
      expect(completeAddrBtn).toHaveAttribute('aria-pressed', 'true');
      expect(allAddrBtn).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(allAddrBtn);

      // 3. Attendance filter group
      const attendanceGroup = screen.getByRole('group', { name: /Attendance/i });
      const allAttendBtn = within(attendanceGroup).getByRole('button', { name: /All attendance/i });
      const attendingBtn = within(attendanceGroup).getByRole('button', { name: /Attending/i });
      expect(allAttendBtn).toHaveAttribute('aria-pressed', 'true');
      expect(attendingBtn).toHaveAttribute('aria-pressed', 'false');

      // 4. Redemption SegmentedTabs + tabpanel linkage & keyboard navigation
      const allStatusTab = screen.getByRole('tab', { name: 'All (2)' });
      const redeemedStatusTab = screen.getByRole('tab', { name: 'Redeemed (1)' });
      const resultsPanel = screen.getByRole('tabpanel');

      expect(allStatusTab).toHaveAttribute('aria-controls', 'invitation-codes-results-panel');
      expect(resultsPanel).toHaveAttribute('id', 'invitation-codes-results-panel');
      expect(resultsPanel).toHaveAttribute('aria-labelledby', 'redemption-status-tab-all');

      allStatusTab.focus();
      fireEvent.keyDown(allStatusTab, { key: 'ArrowRight' });
      expect(redeemedStatusTab).toHaveFocus();
      expect(redeemedStatusTab).toHaveAttribute('aria-selected', 'true');
      expect(resultsPanel).toHaveAttribute('aria-labelledby', 'redemption-status-tab-redeemed');

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('forwards searchQuery, partyGroup, status, addressStatus, dietaryCategory, attendanceStatus, and partyTags into BroadcastModal without mapping searchQuery onto householdName', async () => {
      const originalFetch = global.fetch;
      const previewBodies: Array<Record<string, unknown>> = [];
      const fetchSpy = jest.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        if (url.includes('/api/admin/broadcast/preview')) {
          const rawBody =
            typeof init?.body === 'string'
              ? init.body
              : input instanceof Request
                ? await input.clone().text()
                : '';
          if (rawBody) {
            previewBodies.push(JSON.parse(rawBody) as Record<string, unknown>);
          }
          return new Response(
            JSON.stringify({
              subject: 'RSVP Reminder for Alice Smith',
              body: 'Hi Alice Smith, RSVP at https://wedding.example.com/guest?code=ALICE1',
              sampleGuestName: 'Alice Smith',
              destination: 'alice@example.com',
              recipientCount: 1,
              matchedCount: 1,
              missingContactCount: 0,
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }
          );
        }
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });
      global.fetch = fetchSpy as typeof fetch;

      try {
        const richCodes = [
          {
            id: 'c1',
            guestName: 'Alice Smith',
            householdName: 'The Smith Household',
            partyGroup: 'Bride',
            partyTags: ['VIP'],
            code: 'ALICE1',
            email: 'alice@example.com',
            dietaryNotes: 'Vegan',
            used: false,
            extraFields: { attendanceStatus: 'pending' },
          },
          {
            id: 'c2',
            guestName: 'Bob Jones',
            householdName: 'The Jones Household',
            partyGroup: 'Groom',
            partyTags: ['Friends'],
            code: 'BOB2',
            email: 'bob@example.com',
            dietaryNotes: 'Gluten Free',
            used: true,
            addressLine1: '100 Main St',
            city: 'Chicago',
            state: 'IL',
            zipCode: '60601',
            country: 'USA',
            extraFields: { attendanceStatus: 'attending' },
          },
        ];

        (useAdminInvitationCodes as jest.Mock).mockReturnValue({
          data: richCodes,
          isLoading: false,
          error: null,
          create: mockCreate,
          update: mockUpdate,
          remove: mockRemove,
          removeBatch: mockRemoveBatch,
          updateBatch: mockUpdateBatch,
          fetchAll: mockFetchAll,
        });

        renderComponent();

        // Activate all 7 dashboard filters
        fireEvent.change(screen.getByRole('textbox', { name: 'Search invitation codes' }), {
          target: { value: 'alice@example.com' },
        });
        fireEvent.change(screen.getByRole('combobox', { name: 'Filter by party side or group' }), {
          target: { value: 'Bride' },
        });
        fireEvent.change(screen.getByRole('combobox', { name: 'Filter by dietary category' }), {
          target: { value: 'vegan' },
        });

        const tagsGroup = screen.getByRole('group', { name: /Party Tags/i });
        fireEvent.click(within(tagsGroup).getByRole('button', { name: '#VIP' }));

        fireEvent.click(screen.getByRole('tab', { name: /Unused/i }));

        const addressGroup = screen.getByRole('group', { name: /Address/i });
        fireEvent.click(within(addressGroup).getByRole('button', { name: /Address Missing/i }));

        const attendanceGroup = screen.getByRole('group', { name: /Attendance/i });
        fireEvent.click(within(attendanceGroup).getByRole('button', { name: /Pending/i }));

        // Open BroadcastModal
        fireEvent.click(screen.getByRole('button', { name: 'Send Broadcast' }));

        const dialog = await screen.findByRole('dialog', { name: 'Compose Multi-Channel Broadcast' });
        expect(dialog).toBeInTheDocument();

        // Target Audience summary reflects all 7 forwarded filters and does NOT map searchQuery onto Household
        const banner = within(dialog).getByTestId('broadcast-audience-banner');
        expect(banner).toHaveTextContent('Search: "alice@example.com"');
        expect(banner).toHaveTextContent('Group: Bride');
        expect(banner).toHaveTextContent('Tags: [VIP]');
        expect(banner).toHaveTextContent('Redemption: unused');
        expect(banner).toHaveTextContent('Status: pending');
        expect(banner).toHaveTextContent('Address: missing');
        expect(banner).toHaveTextContent('Dietary: vegan');
        expect(within(dialog).queryByText(/Household:/i)).not.toBeInTheDocument();
        expect(within(dialog).getByTestId('broadcast-recipient-count')).toHaveTextContent(
          '1 matching recipient'
        );

        // Apply starter template with {{rsvpUrl}} to trigger preview/baseUrl check and verify API payload
        fireEvent.click(within(dialog).getByRole('button', { name: 'RSVP Reminder' }));

        await waitFor(() => {
          expect(previewBodies.length).toBeGreaterThan(0);
        });

        const latestPreviewBody = previewBodies[previewBodies.length - 1] as {
          targetFilters?: Record<string, unknown>;
        };
        expect(latestPreviewBody.targetFilters).toEqual({
          searchQuery: 'alice@example.com',
          partyGroup: 'Bride',
          status: 'unused',
          addressStatus: 'missing',
          dietaryCategory: 'vegan',
          attendanceStatus: 'pending',
          partyTags: ['VIP'],
        });
        expect(latestPreviewBody.targetFilters?.householdName).toBeUndefined();
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('saves phone in extraFields on manual code creation, passes all 7 active filters to BroadcastModal, and links to Broadcast Delivery Logs', async () => {
      mockCreate.mockResolvedValueOnce({ id: 'new-sms-guest' });
      const richCodes = [
        {
          id: 'g-match',
          guestName: 'Hannah Abbott',
          code: 'HANNAH1',
          email: 'hannah@example.com',
          used: false,
          addressLine1: '',
          city: '',
          state: '',
          zipCode: '',
          dietaryNotes: 'Gluten-free',
          partyGroup: 'Bride',
          partyTags: ['VIP'],
          extraFields: { attendanceStatus: 'pending' },
        },
        {
          id: 'g-other',
          guestName: 'Ian Other',
          code: 'IAN1',
          email: 'ian@example.com',
          used: true,
          addressLine1: '1 Main St',
          city: 'Boston',
          state: 'MA',
          zipCode: '02108',
          dietaryNotes: 'Vegan',
          partyGroup: 'Groom',
          partyTags: ['Friends'],
          extraFields: { attendanceStatus: 'attending', phone: '+15558889999' },
        },
      ];

      (useAdminInvitationCodes as jest.Mock).mockReturnValue({
        data: richCodes,
        isLoading: false,
        error: null,
        create: mockCreate,
        update: mockUpdate,
        remove: mockRemove,
        removeBatch: mockRemoveBatch,
        updateBatch: mockUpdateBatch,
        fetchAll: mockFetchAll,
      });

      renderComponent();

      // Verify direct Broadcast Delivery Logs link
      const logsLink = screen.getByRole('link', { name: /Broadcast Delivery Logs/i });
      expect(logsLink).toHaveAttribute('href', '/admin/dashboard/history?tab=broadcasts');

      // Manual create form validates and saves phone inside extraFields.phone
      fireEvent.click(screen.getByRole('button', { name: 'Generate New Code' }));
      fireEvent.change(screen.getByPlaceholderText('e.g. John Doe'), {
        target: { value: 'Manual SMS Guest' },
      });
      fireEvent.change(screen.getByPlaceholderText('e.g. +15551234567'), {
        target: { value: 'bad-phone' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
      expect(mockCreate).not.toHaveBeenCalled();

      fireEvent.change(screen.getByPlaceholderText('e.g. +15551234567'), {
        target: { value: '+1 (555) 777-8888' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            guestName: 'Manual SMS Guest',
            extraFields: { phone: '+15557778888' },
          })
        );
      });

      // Set all 7 active guest list filters
      fireEvent.change(screen.getByLabelText('Search invitation codes'), {
        target: { value: 'Hannah' },
      });
      fireEvent.change(screen.getByLabelText('Filter by party side or group'), {
        target: { value: 'Bride' },
      });
      fireEvent.change(screen.getByLabelText('Filter by dietary category'), {
        target: { value: 'gluten-free' },
      });
      fireEvent.click(
        within(screen.getByRole('group', { name: /Party Tags/i })).getByRole('button', {
          name: '#VIP',
        })
      );
      fireEvent.click(screen.getByRole('tab', { name: /Unused/i }));
      fireEvent.click(
        within(screen.getByRole('group', { name: /Address/i })).getByRole('button', {
          name: /Address Missing/i,
        })
      );
      fireEvent.click(
        within(screen.getByRole('group', { name: /Attendance/i })).getByRole('button', {
          name: /Pending/i,
        })
      );

      // Open Send Broadcast modal and verify all 7 filters + live audience counts
      fireEvent.click(screen.getByRole('button', { name: 'Send Broadcast' }));

      const modal = screen.getByRole('dialog', { name: 'Compose Multi-Channel Broadcast' });
      const banner = within(modal).getByTestId('broadcast-audience-banner');
      expect(banner).toHaveTextContent('Search: "Hannah"');
      expect(banner).toHaveTextContent('Redemption: unused');
      expect(banner).toHaveTextContent('Address: missing');
      expect(banner).toHaveTextContent('Status: pending');
      expect(banner).toHaveTextContent('Dietary: gluten-free');
      expect(banner).toHaveTextContent('Group: Bride');
      expect(banner).toHaveTextContent('Tags: [VIP]');
      expect(within(modal).getByTestId('broadcast-audience-counts')).toHaveTextContent(
        '1 matched guest'
      );
      expect(within(modal).getByTestId('broadcast-audience-counts')).toHaveTextContent(
        '0 missing email'
      );
    });

    it('exposes Merge Duplicates when >= 2 guests are selected, previews combined fields dynamically, submits mergeDuplicates, and passes jest-axe', async () => {
      mockMergeDuplicates.mockResolvedValueOnce({
        success: true,
        mergedCount: 1,
        record: mockCodes[1],
        transferredCounts: {
          contributors: 1,
          subEventAccesses: 1,
          subEventRsvps: 1,
          broadcastRecipients: 0,
          seatTransferred: false,
        },
      });

      const { container } = renderComponent();

      // Selecting 1 guest does not show Merge Duplicates
      const aliceCheckbox = screen.getByRole('checkbox', {
        name: 'Select invitation code for Alice Smith',
      });
      fireEvent.click(aliceCheckbox);
      expect(screen.queryByRole('button', { name: 'Merge Duplicates' })).not.toBeInTheDocument();

      // Selecting a 2nd guest exposes Merge Duplicates in the batch toolbar
      const bobCheckbox = screen.getByRole('checkbox', {
        name: 'Select invitation code for Bob Jones',
      });
      fireEvent.click(bobCheckbox);

      const mergeToolbarBtn = screen.getByRole('button', { name: 'Merge Duplicates' });
      expect(mergeToolbarBtn).toBeInTheDocument();

      fireEvent.click(mergeToolbarBtn);

      const dialog = screen.getByRole('dialog', {
        name: /Merge Duplicate Guests \(2 Selected\)/i,
      });
      expect(dialog).toBeInTheDocument();

      const previewCard = within(dialog).getByTestId('merge-preview-card');
      expect(previewCard).toHaveTextContent('ALICE123');
      expect(previewCard).toHaveTextContent('Alice Smith');
      expect(previewCard).toHaveTextContent('Gluten Free, Dairy Free; Vegan');

      // Switch primary guest radio button to Bob Jones
      const radios = within(dialog).getAllByRole('radio');
      expect(radios).toHaveLength(2);
      fireEvent.click(radios[1]);

      expect(previewCard).toHaveTextContent('BOB456');
      expect(previewCard).toHaveTextContent('Bob Jones');
      expect(previewCard).toHaveTextContent('Vegan; Gluten Free, Dairy Free');

      const axeResults = await axe(container);
      expect(axeResults).toHaveNoViolations();

      fireEvent.click(within(dialog).getByRole('button', { name: 'Merge 2 Guests' }));

      await waitFor(() => {
        expect(mockMergeDuplicates).toHaveBeenCalledWith('code-2', ['code-1']);
      });
    });

    it('paginates 250 imported invitations across 5 pages, searches across all 250 guests, and applies batch attendance overrides', async () => {
      const mockBatchAttendance = jest.fn().mockResolvedValue({
        success: true,
        data: { updatedCount: 250, status: 'attending' },
      });

      const imported250 = Array.from({ length: 250 }, (_, idx) => {
        const num = String(idx + 1).padStart(3, '0');
        return {
          id: `inv-${num}`,
          guestName: idx === 249 ? 'Zahara Zenith' : `Imported Guest ${num}`,
          code: `IMP${num}`,
          email: `guest${num}@example.com`,
          used: false,
        };
      });

      (useAdminInvitationCodes as jest.Mock).mockReturnValue({
        data: imported250,
        isLoading: false,
        error: null,
        create: mockCreate,
        update: mockUpdate,
        remove: mockRemove,
        removeBatch: mockRemoveBatch,
        updateBatch: mockUpdateBatch,
        batchUpdateTags: mockBatchUpdateTags,
        batchUpdateAttendance: mockBatchAttendance,
        mergeDuplicates: mockMergeDuplicates,
        fetchAll: mockFetchAll,
      });

      const { container } = renderComponent();

      // Page 1 shows first 50 of 250
      expect(screen.getByTestId('invitation-pagination-range')).toHaveTextContent(
        'Showing 1–50 of 250'
      );
      expect(screen.getByTestId('invitation-pagination-page-indicator')).toHaveTextContent(
        'Page 1 of 5'
      );
      expect(screen.getByText('Imported Guest 001')).toBeInTheDocument();
      expect(screen.queryByText('Zahara Zenith')).not.toBeInTheDocument();

      // Navigate to last page -> Zahara Zenith (#250) visible
      fireEvent.click(screen.getByRole('button', { name: 'Last page' }));
      expect(screen.getByTestId('invitation-pagination-range')).toHaveTextContent(
        'Showing 201–250 of 250'
      );
      expect(screen.getByText('Zahara Zenith')).toBeInTheDocument();

      // Search finds guest #250 from any page and resets to Page 1 of 1
      fireEvent.change(screen.getByLabelText('Search invitation codes'), {
        target: { value: 'Zahara' },
      });
      expect(screen.getByTestId('invitation-pagination-range')).toHaveTextContent(
        'Showing 1–1 of 1'
      );
      expect(screen.getByText('Zahara Zenith')).toBeInTheDocument();

      // Clear search and select all 250 filtered guests across pages for batch attendance
      fireEvent.change(screen.getByLabelText('Search invitation codes'), {
        target: { value: '' },
      });
      fireEvent.click(
        screen.getByRole('checkbox', { name: 'Select all filtered invitation codes' })
      );
      expect(screen.getByText('250 Selected')).toBeInTheDocument();

      const axeResults = await axe(container);
      expect(axeResults).toHaveNoViolations();

      fireEvent.click(screen.getByRole('button', { name: 'Mark Attending' }));

      await waitFor(() => {
        expect(mockBatchAttendance).toHaveBeenCalledWith(
          imported250.map((g) => g.id),
          'attending'
        );
        expect(screen.getByText('Marked 250 guest(s) as attending.')).toBeInTheDocument();
      });
    }, 20000);

    it('displays headcounts alongside household counts, skips declined rows in catering, counts kids tags & meal totals, and enriches guest cards', async () => {
      const enrichedCodes = [
        {
          id: 'g-attending-1',
          guestName: 'Elena Gilbert',
          code: 'ELENA01',
          used: true,
          dietaryNotes: 'Gluten-Free',
          extraFields: {
            attendanceStatus: 'attending',
            attendingPlusOneCount: 2,
            plusOneNames: ['Damon Salvatore', 'Bonnie Bennett'],
            dietaryTags: ['gluten-free', 'kids'],
            mealSummary: 'Reception - Elena Gilbert: Herb Salmon (gluten-free); Damon Salvatore: Filet Mignon; Bonnie Bennett: Kids Pasta (kids)',
            customAnswersSummary: 'Reception - Need shuttle?: Yes',
            eventRsvps: [
              {
                subEventId: 'se-rec',
                subEventTitle: 'Reception',
                status: 'attending',
                plusOneCount: 2,
              },
            ],
          },
        },
        {
          id: 'g-declined-1',
          guestName: 'Stefan Declined',
          code: 'STEFAN02',
          used: true,
          dietaryNotes: 'Vegan, Peanut Allergy',
          extraFields: {
            attendanceStatus: 'declined',
            dietaryTags: ['vegan', 'nut-free'],
          },
        },
      ];

      (useAdminInvitationCodes as jest.Mock).mockReturnValue({
        data: enrichedCodes,
        isLoading: false,
        error: null,
        create: mockCreate,
        update: mockUpdate,
        remove: mockRemove,
        removeBatch: mockRemoveBatch,
        updateBatch: mockUpdateBatch,
        batchUpdateTags: mockBatchUpdateTags,
        mergeDuplicates: mockMergeDuplicates,
        fetchAll: mockFetchAll,
      });

      global.fetch = jest.fn().mockImplementation((url: string) => {
        if (url === '/api/admin/sub-events/rsvp-summary') {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                success: true,
                data: {
                  global: {
                    totalInvitations: 2,
                    attendingHouseholds: 1,
                    declinedHouseholds: 1,
                    pendingHouseholds: 0,
                    attendingHeadcount: 3,
                    attendingPlusOnes: 2,
                    declinedHeadcount: 1,
                    pendingHeadcount: 0,
                    dietary: {
                      totalWithRestrictions: 1,
                      glutenFree: 1,
                      vegetarian: 0,
                      vegan: 0,
                      dairyFree: 0,
                      nutFree: 0,
                      halal: 0,
                      kosher: 0,
                      kids: 1,
                      other: 0,
                    },
                    mealTotals: [
                      {
                        optionId: 'meal-salmon',
                        label: 'Herb Salmon',
                        count: 1,
                        subEventId: 'se-rec',
                        subEventTitle: 'Reception',
                        dietaryTags: ['gluten-free'],
                      },
                      {
                        optionId: 'meal-steak',
                        label: 'Filet Mignon',
                        count: 1,
                        subEventId: 'se-rec',
                        subEventTitle: 'Reception',
                        dietaryTags: [],
                      },
                      {
                        optionId: 'meal-kids',
                        label: 'Kids Pasta',
                        count: 1,
                        subEventId: 'se-rec',
                        subEventTitle: 'Reception',
                        dietaryTags: ['kids'],
                      },
                    ],
                    questionBreakdowns: [
                      {
                        subEventId: 'se-rec',
                        subEventTitle: 'Reception',
                        questionId: 'q-shuttle',
                        prompt: 'Need shuttle?',
                        type: 'choice',
                        totalResponses: 1,
                        optionCounts: [
                          { option: 'Yes', count: 1 },
                          { option: 'No', count: 0 },
                        ],
                        textResponses: [],
                      },
                    ],
                  },
                  subEvents: [],
                },
              }),
          });
        }
        return Promise.resolve({ ok: false });
      }) as any;

      const { container } = renderComponent();

      // Headcount alongside household count
      await waitFor(() => {
        expect(screen.getByTestId('rsvp-headcount-summary')).toHaveTextContent(
          'Attending: 3 Guests (1 Household, +2 Plus-Ones)'
        );
      });

      // Declined Stefan's Vegan & Nut allergy notes skipped -> only 1 Guest with Dietary Notes, Kids = 1
      const cateringWidget = screen.getByTestId('catering-summary-widget');
      const mealTotalsEl = await within(cateringWidget).findByTestId('catering-meal-totals');
      expect(mealTotalsEl).toHaveTextContent('Herb Salmon:');
      expect(within(cateringWidget).getByText('1 Guest with Dietary Notes')).toBeInTheDocument();
      expect(within(cateringWidget).getByTestId('catering-kids-tile')).toHaveTextContent('1');
      expect(within(cateringWidget).getByTestId('catering-question-totals')).toHaveTextContent(
        'Reception: Need shuttle?'
      );

      // Enriched guest card details
      expect(screen.getByTestId('attending-plus-one-badge')).toHaveTextContent(
        '+2 Plus-Ones Attending'
      );
      expect(screen.getByTestId('plus-one-names')).toHaveTextContent(
        'Plus-One: Damon Salvatore, Bonnie Bennett'
      );
      expect(screen.getByTestId('guest-event-rsvp-pills')).toHaveTextContent(
        'Reception: Attending (+2)'
      );
      expect(screen.getByTestId('guest-meal-selections')).toHaveTextContent('Herb Salmon');
      expect(screen.getByTestId('guest-custom-answers')).toHaveTextContent('Need shuttle?: Yes');

      const axeResults = await axe(container);
      expect(axeResults).toHaveNoViolations();
    }, 20000);
  });
});

