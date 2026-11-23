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
      assignGuestToTable: mockAssignGuestToTable,
      unassignGuest: mockUnassignGuest,
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
});
