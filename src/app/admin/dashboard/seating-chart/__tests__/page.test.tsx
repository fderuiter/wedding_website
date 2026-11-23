import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import SeatingChartAdminPage from '../page';
import { useSeatingState } from '@/features/seating';

// Mock useSeatingState
jest.mock('@/features/seating', () => {
  const actual = jest.requireActual('@/features/seating');
  return {
    ...actual,
    useSeatingState: jest.fn(),
  };
});

describe('SeatingChartAdminPage Dialog integration', () => {
  const mockTable = {
    id: 'table-1',
    name: 'Table 1 - Head Table',
    shape: 'round' as const,
    capacity: 2,
    x: 100,
    y: 100,
    width: 100,
    height: 100,
    rotation: 0,
    assignedGuests: [],
  };

  const mockGuest = {
    id: 'guest-1',
    guestName: 'John Doe',
    code: 'ABC123',
    tableId: null,
    seatNumber: null,
    tier: 'standard',
    attending: true,
  };

  const mockAssignGuestToTable = jest.fn();
  const mockUnassignGuest = jest.fn();
  const mockSaveTable = jest.fn();
  const mockDeleteTable = jest.fn();
  const mockUpdateTablePosition = jest.fn();
  const mockUpdateTableRotation = jest.fn();
  const mockApplyAutoAssignResult = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useSeatingState as jest.Mock).mockReturnValue({
      tables: [mockTable],
      allGuests: [mockGuest],
      unassignedGuests: [mockGuest],
      isLoading: false,
      errorMsg: null,
      assignGuestToTable: mockAssignGuestToTable,
      unassignGuest: mockUnassignGuest,
      applyAutoAssignResult: mockApplyAutoAssignResult,
      saveTable: mockSaveTable,
      deleteTable: mockDeleteTable,
      updateTablePosition: mockUpdateTablePosition,
      updateTableRotation: mockUpdateTableRotation,
    });
  });

  test('renders seat assignment modal using Dialog with role="dialog", aria-modal="true", and dynamic aria-labelledby', () => {
    render(<SeatingChartAdminPage />);

    // Click the empty seat button to trigger the seat assignment modal
    const seatBtn = screen.getByRole('button', { name: 'Seat 1: Empty' });
    fireEvent.click(seatBtn);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();

    const heading = within(dialog).getByRole('heading', { level: 2 });
    expect(heading).toHaveAttribute('id', labelledBy);
    expect(heading).toHaveTextContent('Assign Guest to Table 1 - Head Table (Seat 1)');
  });

  test('traps keyboard Tab navigation inside the Dialog', () => {
    render(<SeatingChartAdminPage />);

    const seatBtn = screen.getByRole('button', { name: 'Seat 1: Empty' });
    fireEvent.click(seatBtn);

    const select = screen.getByLabelText(/select guest/i);
    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    const assignBtn = screen.getByRole('button', { name: /assign guest/i });

    // Focus starts on the select element (or first focusable element)
    expect(select).toHaveFocus();

    // Tab to cancel button
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    cancelBtn.focus();
    expect(cancelBtn).toHaveFocus();

    // Tab to assign button
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    assignBtn.focus();
    expect(assignBtn).toHaveFocus();

    // Tab from last element wraps to first element
    fireEvent.keyDown(assignBtn, { key: 'Tab' });
    expect(select).toHaveFocus();

    // Shift+Tab from first element wraps to last element
    fireEvent.keyDown(select, { key: 'Tab', shiftKey: true });
    expect(assignBtn).toHaveFocus();
  });

  test('closes active modal when pressing Escape key and restores focus to triggering seat button', async () => {
    render(<SeatingChartAdminPage />);

    const seatBtn = screen.getByRole('button', { name: 'Seat 1: Empty' });
    seatBtn.focus();
    fireEvent.click(seatBtn);

    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Press Escape to dismiss
    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(seatBtn).toHaveFocus();
  });

  test('submits guest assignment and closes dialog upon form submit', async () => {
    render(<SeatingChartAdminPage />);

    const seatBtn = screen.getByRole('button', { name: 'Seat 1: Empty' });
    fireEvent.click(seatBtn);

    const assignBtn = screen.getByRole('button', { name: /assign guest/i });
    fireEvent.click(assignBtn);

    expect(mockAssignGuestToTable).toHaveBeenCalledWith('guest-1', 'table-1', 1);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  test('renders notice and close button when all guests are assigned', async () => {
    (useSeatingState as jest.Mock).mockReturnValue({
      tables: [mockTable],
      allGuests: [mockGuest],
      unassignedGuests: [],
      isLoading: false,
      errorMsg: null,
      assignGuestToTable: mockAssignGuestToTable,
      unassignGuest: mockUnassignGuest,
      applyAutoAssignResult: mockApplyAutoAssignResult,
      saveTable: mockSaveTable,
      deleteTable: mockDeleteTable,
      updateTablePosition: mockUpdateTablePosition,
      updateTableRotation: mockUpdateTableRotation,
    });

    render(<SeatingChartAdminPage />);

    const seatBtn = screen.getByRole('button', { name: 'Seat 1: Empty' });
    fireEvent.click(seatBtn);

    expect(screen.getByText('All guests have already been assigned to tables.')).toBeInTheDocument();

    const closeBtn = screen.getByRole('button', { name: /close/i });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  test('flags declined seated guests with one-click Release Seat, renders dietary badges, and triggers Clear Seats + Undo', () => {
    const mockClearTableSeats = jest.fn();
    const mockUndoLastBatchAction = jest.fn();
    const mockAssignGuestsToTable = jest.fn();

    const tableWithSeatedGuests = {
      ...mockTable,
      capacity: 4,
      invitationCodes: [
        {
          id: 'g-declined-seated',
          guestName: 'Declined Cousin',
          code: 'DEC99',
          tableId: 'table-1',
          seatNumber: 1,
          used: true,
          extraFields: { attending: false },
          dietaryNotes: null,
        },
        {
          id: 'g-attending-diet',
          guestName: 'Vegan Aunt',
          code: 'VEG01',
          tableId: 'table-1',
          seatNumber: 2,
          used: true,
          extraFields: { attending: true },
          dietaryNotes: 'Strict Vegan',
        },
      ],
    };

    (useSeatingState as jest.Mock).mockReturnValue({
      tables: [tableWithSeatedGuests],
      allGuests: tableWithSeatedGuests.invitationCodes,
      unassignedGuests: [],
      isLoading: false,
      errorMsg: null,
      canUndo: true,
      undoLabel: 'Cleared 2 seats from Table 1',
      assignGuestToTable: mockAssignGuestToTable,
      assignGuestsToTable: mockAssignGuestsToTable,
      unassignGuest: mockUnassignGuest,
      clearTableSeats: mockClearTableSeats,
      undoLastBatchAction: mockUndoLastBatchAction,
      applyAutoAssignResult: mockApplyAutoAssignResult,
      saveTable: mockSaveTable,
      deleteTable: mockDeleteTable,
      updateTablePosition: mockUpdateTablePosition,
      updateTableRotation: mockUpdateTableRotation,
    });

    render(<SeatingChartAdminPage />);

    // Top banner flags declined seated guest
    expect(screen.getByTestId('declined-seated-alert')).toBeInTheDocument();

    // Select Table 1 to inspect seated guests
    fireEvent.click(screen.getByRole('button', { name: /Table 1 - Head Table, shape/i }));

    // Inspector flags declined guest and renders dietary badge for Vegan Aunt
    expect(screen.getByTestId('seated-declined-badge')).toHaveTextContent('RSVP Declined');
    expect(screen.getByTestId('inspector-dietary-badge')).toHaveTextContent('VG');

    // One-click Release Seat in inspector releases declined guest's seat
    const releaseBtn = screen.getByRole('button', {
      name: /Release seat for declined guest Declined Cousin/i,
    });
    fireEvent.click(releaseBtn);
    expect(mockUnassignGuest).toHaveBeenCalledWith('g-declined-seated');

    // Clear Seats empties the table without deleting it
    const clearBtn = screen.getByTestId('clear-table-seats-button');
    fireEvent.click(clearBtn);
    expect(mockClearTableSeats).toHaveBeenCalledWith('table-1');

    // Undo button restores previous seat snapshot
    const undoBtn = screen.getByTestId('seating-undo-button');
    expect(undoBtn).not.toBeDisabled();
    fireEvent.click(undoBtn);
    expect(mockUndoLastBatchAction).toHaveBeenCalledTimes(1);
  });

  test('renders plus-one seats & meal summaries in Selected Table Inspector, landmark inspector state, and caterer/Avery export links', () => {
    const tableWithPlusOneMeals = {
      ...mockTable,
      capacity: 4,
      invitationCodes: [
        {
          id: 'g-party-insp',
          guestName: 'Leslie Knope',
          code: 'WAFFLES99',
          tableId: 'table-1',
          seatNumber: 1,
          plusOneSeatNumbers: [2],
          used: true,
          dietaryNotes: 'Nut-Free',
          extraFields: {
            attending: true,
            plusOneNames: ['Ben Wyatt'],
            mealSelections: [
              { attendeeName: 'Leslie Knope', mealOptionLabel: 'Belgian Waffles' },
              { attendeeName: 'Ben Wyatt', mealOptionLabel: 'Calzone' },
            ],
          },
        },
      ],
    };

    const landmarkDj = {
      id: 'lm-dj',
      name: 'DJ Entertainment',
      shape: 'dj' as const,
      capacity: 0,
      x: 320,
      y: 100,
      width: 120,
      height: 80,
      rotation: 0,
      invitationCodes: [],
    };

    (useSeatingState as jest.Mock).mockReturnValue({
      tables: [tableWithPlusOneMeals, landmarkDj],
      allGuests: tableWithPlusOneMeals.invitationCodes,
      unassignedGuests: [],
      isLoading: false,
      errorMsg: null,
      canUndo: false,
      undoLabel: null,
      assignGuestToTable: mockAssignGuestToTable,
      assignGuestsToTable: jest.fn(),
      unassignGuest: mockUnassignGuest,
      clearTableSeats: jest.fn(),
      undoLastBatchAction: jest.fn(),
      applyAutoAssignResult: mockApplyAutoAssignResult,
      saveTable: mockSaveTable,
      deleteTable: mockDeleteTable,
      updateTablePosition: mockUpdateTablePosition,
      updateTableRotation: mockUpdateTableRotation,
    });

    render(<SeatingChartAdminPage />);

    // Verify new caterer & Avery export toolbar links
    expect(screen.getByRole('link', { name: 'Meal Counts CSV' })).toHaveAttribute(
      'href',
      '/api/admin/seating/export?format=meals'
    );
    expect(screen.getByRole('link', { name: 'Place Cards PDF' })).toHaveAttribute(
      'href',
      '/api/admin/seating/export?format=place-cards'
    );
    expect(screen.getByRole('link', { name: 'Escort Cards PDF' })).toHaveAttribute(
      'href',
      '/api/admin/seating/export?format=escort-cards'
    );

    // Select guest table -> shows meal summary & inline plus-one seat row without exposing WAFFLES99
    fireEvent.click(screen.getByRole('button', { name: /Table 1 - Head Table, shape/i }));
    expect(screen.getByTestId('inspector-meal-summary')).toHaveTextContent(
      'Belgian Waffles: 1, Calzone: 1'
    );
    expect(screen.getByTestId('inspector-plus-one-seat')).toHaveTextContent('Ben Wyatt');
    expect(screen.getByTestId('inspector-plus-one-seat')).toHaveTextContent('Seat 2');
    expect(screen.queryByText('WAFFLES99')).not.toBeInTheDocument();

    // Select DJ landmark -> shows zero-capacity landmark inspector state
    fireEvent.click(
      screen.getByRole('button', { name: /DJ Entertainment, landmark DJ Booth, 0 seats/i })
    );
    expect(
      screen.getByText(/Room landmark fixture — drag or rotate to position on floorplan\./i)
    ).toBeInTheDocument();
  });

  test('prefixes all seating export toolbar links with NEXT_PUBLIC_BASE_PATH on subpath deployments', () => {
    const previousBasePath = process.env.NEXT_PUBLIC_BASE_PATH;
    process.env.NEXT_PUBLIC_BASE_PATH = '/wedding_website/demo';
    try {
      render(<SeatingChartAdminPage />);

      expect(screen.getByRole('link', { name: 'Export Visual PDF' })).toHaveAttribute(
        'href',
        '/wedding_website/demo/api/admin/seating/export?format=pdf'
      );
      expect(screen.getByRole('link', { name: 'Export CSV' })).toHaveAttribute(
        'href',
        '/wedding_website/demo/api/admin/seating/export'
      );
      expect(screen.getByRole('link', { name: 'Meal Counts CSV' })).toHaveAttribute(
        'href',
        '/wedding_website/demo/api/admin/seating/export?format=meals'
      );
      expect(screen.getByRole('link', { name: 'Place Cards PDF' })).toHaveAttribute(
        'href',
        '/wedding_website/demo/api/admin/seating/export?format=place-cards'
      );
      expect(screen.getByRole('link', { name: 'Escort Cards PDF' })).toHaveAttribute(
        'href',
        '/wedding_website/demo/api/admin/seating/export?format=escort-cards'
      );
    } finally {
      if (previousBasePath === undefined) {
        delete process.env.NEXT_PUBLIC_BASE_PATH;
      } else {
        process.env.NEXT_PUBLIC_BASE_PATH = previousBasePath;
      }
    }
  });

  test('renders companion names, entrée selections, KIDS badges, and custom answers in table inspector', () => {
    const tableWithEnrichedGuest = {
      ...mockTable,
      capacity: 4,
      invitationCodes: [
        {
          id: 'g-enriched',
          guestName: 'Elena Gilbert',
          code: 'ELENA01',
          tableId: 'table-1',
          seatNumber: 1,
          used: true,
          dietaryNotes: null,
          extraFields: {
            attendanceStatus: 'attending',
            plusOneNames: ['Damon Salvatore', 'Bonnie Bennett'],
            dietaryTags: ['kids'],
            mealSummary:
              'Reception - Elena Gilbert: Herb Salmon; Bonnie Bennett: Kids Pasta (kids)',
            customAnswersSummary: 'Reception - Need shuttle?: Yes',
          },
        },
      ],
    };

    (useSeatingState as jest.Mock).mockReturnValue({
      tables: [tableWithEnrichedGuest],
      allGuests: tableWithEnrichedGuest.invitationCodes,
      unassignedGuests: [],
      isLoading: false,
      errorMsg: null,
      canUndo: false,
      undoLabel: null,
      assignGuestToTable: mockAssignGuestToTable,
      assignGuestsToTable: jest.fn(),
      unassignGuest: mockUnassignGuest,
      clearTableSeats: jest.fn(),
      undoLastBatchAction: jest.fn(),
      applyAutoAssignResult: mockApplyAutoAssignResult,
      saveTable: mockSaveTable,
      deleteTable: mockDeleteTable,
      updateTablePosition: mockUpdateTablePosition,
      updateTableRotation: mockUpdateTableRotation,
    });

    render(<SeatingChartAdminPage />);

    fireEvent.click(screen.getByRole('button', { name: /Table 1 - Head Table, shape/i }));

    expect(screen.getByTestId('inspector-companion-names')).toHaveTextContent(
      '+1: Damon Salvatore, Bonnie Bennett'
    );
    expect(screen.getByTestId('inspector-meal-selections')).toHaveTextContent('Herb Salmon');
    expect(screen.getByTestId('inspector-meal-selections')).toHaveTextContent('Kids Pasta');
    expect(screen.getByTestId('inspector-dietary-badge')).toHaveTextContent('KIDS');
    expect(screen.getByTestId('inspector-custom-answers')).toHaveTextContent(
      'Need shuttle?: Yes'
    );
  });

  it('prompts via alertdialog before deleting an occupied table from the inspector and shows party seat ranges', async () => {
    const mockClearTableSeats = jest.fn();
    const mockUndoLastBatchAction = jest.fn();
    const mockAssignGuestsToTable = jest.fn();

    const occupiedCoupleTable = {
      ...mockTable,
      capacity: 8,
      invitationCodes: [
        {
          id: 'g-couple-seated',
          guestName: 'Jordan Taylor',
          code: 'CPL10',
          tableId: 'table-1',
          seatNumber: 1,
          used: true,
          plusOneAllocations: 1,
          extraFields: {
            attending: true,
            plusOneCount: 1,
            plusOneNames: ['Morgan Taylor'],
          },
        },
      ],
    };

    (useSeatingState as jest.Mock).mockReturnValue({
      tables: [occupiedCoupleTable],
      allGuests: occupiedCoupleTable.invitationCodes,
      unassignedGuests: [],
      isLoading: false,
      errorMsg: null,
      canUndo: false,
      undoLabel: null,
      assignGuestToTable: mockAssignGuestToTable,
      assignGuestsToTable: mockAssignGuestsToTable,
      unassignGuest: mockUnassignGuest,
      clearTableSeats: mockClearTableSeats,
      undoLastBatchAction: mockUndoLastBatchAction,
      applyAutoAssignResult: mockApplyAutoAssignResult,
      saveTable: mockSaveTable,
      deleteTable: mockDeleteTable,
      updateTablePosition: mockUpdateTablePosition,
      updateTableRotation: mockUpdateTableRotation,
    });

    render(<SeatingChartAdminPage />);

    // Select occupied table via single-click on Seat 1 dot
    fireEvent.click(screen.getByLabelText('Seat 1: Jordan Taylor'));
    expect(mockUnassignGuest).not.toHaveBeenCalled();

    // Inspector shows 2 seated out of 8 capacity and Seats 1, 2 range with companion name
    expect(screen.getByText('(round, 8 capacity, 2 seated)')).toBeInTheDocument();
    expect(screen.getByText('Seats 1, 2: Jordan Taylor (+1: Morgan Taylor)')).toBeInTheDocument();

    // Clicking Delete Table on occupied table prompts for confirmation
    fireEvent.click(screen.getByRole('button', { name: 'Delete Table' }));
    const confirmDialog = await screen.findByRole('alertdialog');
    expect(confirmDialog).toHaveTextContent(/2 seated guests will become unassigned/i);
    expect(mockDeleteTable).not.toHaveBeenCalled();

    // Cancel keeps the table
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    expect(mockDeleteTable).not.toHaveBeenCalled();

    // Click Delete Table again and confirm
    fireEvent.click(screen.getByRole('button', { name: 'Delete Table' }));
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => {
      expect(mockDeleteTable).toHaveBeenCalledWith('table-1');
    });
  });

  test('supports single-pointer nudge controls and Place Table mode in Selected Table Inspector, clear search button, and Seat Household label-in-name', () => {
    const householdGuests = [
      {
        id: 'hh-1',
        guestName: 'Clara Oswald',
        code: 'HH01',
        householdName: 'Oswald Family',
        tableId: null,
        seatNumber: null,
        used: true,
        extraFields: { attending: true },
      },
      {
        id: 'hh-2',
        guestName: 'Danny Pink',
        code: 'HH02',
        householdName: 'Oswald Family',
        tableId: null,
        seatNumber: null,
        used: true,
        extraFields: { attending: true },
      },
    ];

    (useSeatingState as jest.Mock).mockReturnValue({
      tables: [mockTable],
      allGuests: householdGuests,
      unassignedGuests: householdGuests,
      isLoading: false,
      errorMsg: null,
      canUndo: false,
      undoLabel: null,
      assignGuestToTable: mockAssignGuestToTable,
      assignGuestsToTable: jest.fn(),
      unassignGuest: mockUnassignGuest,
      clearTableSeats: jest.fn(),
      undoLastBatchAction: jest.fn(),
      applyAutoAssignResult: mockApplyAutoAssignResult,
      saveTable: mockSaveTable,
      deleteTable: mockDeleteTable,
      updateTablePosition: mockUpdateTablePosition,
      updateTableRotation: mockUpdateTableRotation,
    });

    render(<SeatingChartAdminPage />);

    // WCAG 2.5.3 Label in Name: Seat Household accessible name starts with visible text "Seat Household"
    const seatHouseholdBtn = screen.getByRole('button', { name: /^Seat Household/i });
    expect(seatHouseholdBtn).toHaveAccessibleName('Seat Household for Oswald Family (2 guests)');

    // Global guest search input & >=24x24px clear button
    const searchInput = screen.getByLabelText(/Search all guests across floorplan and unassigned list/i);
    fireEvent.change(searchInput, { target: { value: 'Clara' } });
    const clearBtn = screen.getByRole('button', { name: 'Clear search query' });
    expect(clearBtn.className).toContain('!h-7');
    expect(clearBtn.className).toContain('!w-7');
    fireEvent.click(clearBtn);
    expect((searchInput as HTMLInputElement).value).toBe('');

    // Select table to reveal both floating and inspector position controls
    const tableNode = screen.getByRole('button', { name: /Table 1 - Head Table, shape round/i });
    fireEvent.click(tableNode);

    const inspectorControls = screen.getByTestId('inspector-position-controls');
    expect(within(inspectorControls).getByTestId('inspector-coordinates')).toHaveTextContent('X: 100, Y: 100');

    // Single-pointer directional nudges from Inspector summary bar
    fireEvent.click(within(inspectorControls).getByRole('button', { name: 'Nudge Table 1 - Head Table right' }));
    expect(mockUpdateTablePosition).toHaveBeenCalledWith('table-1', 120, 100);
    fireEvent.click(within(inspectorControls).getByRole('button', { name: 'Nudge Table 1 - Head Table down' }));
    expect(mockUpdateTablePosition).toHaveBeenCalledWith('table-1', 100, 120);

    // Toggle Place Table mode via pressed state and Escape to exit cleanly
    const placeBtn = within(inspectorControls).getByRole('button', { name: /^Place Table/i });
    expect(placeBtn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(placeBtn);
    expect(placeBtn).toHaveAttribute('aria-pressed', 'true');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(placeBtn).toHaveAttribute('aria-pressed', 'false');
  });
});
