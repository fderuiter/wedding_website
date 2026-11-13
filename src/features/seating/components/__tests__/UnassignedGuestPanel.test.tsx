import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { UnassignedGuestPanel } from '../UnassignedGuestPanel';
import { ToastProvider } from '@/components/ui/ToastProvider';
import { SeatingTableDTO } from '../../schemas';
import { InvitationCodeDTO } from '@/features/registry';

describe('UnassignedGuestPanel quick-assign modal component', () => {
  const mockUnassignedGuests: InvitationCodeDTO[] = [
    {
      id: 'guest-1',
      code: 'GUEST1',
      guestName: 'Jane Doe',
      used: false,
      plusOnesAllowed: 1,
    } as InvitationCodeDTO,
    {
      id: 'guest-2',
      code: 'GUEST2',
      guestName: 'John Smith',
      used: false,
      plusOnesAllowed: 0,
    } as InvitationCodeDTO,
  ];

  const mockTables: SeatingTableDTO[] = [
    {
      id: 'table-1',
      name: 'Table 1',
      shape: 'round',
      capacity: 8,
      x: 0,
      y: 0,
      invitationCodes: [],
    },
    {
      id: 'table-2',
      name: 'Table 2',
      shape: 'round',
      capacity: 8,
      x: 100,
      y: 100,
      invitationCodes: [],
    },
  ];

  const defaultProps = {
    unassignedGuests: mockUnassignedGuests,
    tables: mockTables,
    onAssignGuestToTable: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('opens quick-assign modal with role="dialog", aria-modal="true", and matching aria-labelledby when Assign is clicked', () => {
    render(<UnassignedGuestPanel {...defaultProps} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const assignBtns = screen.getAllByRole('button', { name: /assign/i });
    fireEvent.click(assignBtns[0]);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();

    const heading = screen.getByText('Assign Jane Doe');
    expect(heading).toHaveAttribute('id', labelledBy);
  });

  test('places focus on the table select dropdown when quick-assign modal opens', () => {
    render(<UnassignedGuestPanel {...defaultProps} />);

    const assignBtns = screen.getAllByRole('button', { name: /assign/i });
    fireEvent.click(assignBtns[0]);

    const tableSelect = screen.getByLabelText(/select reception table/i);
    expect(tableSelect).toHaveFocus();
  });

  test('closes quick-assign modal when pressing Escape key', async () => {
    render(<UnassignedGuestPanel {...defaultProps} />);

    const assignBtns = screen.getAllByRole('button', { name: /assign/i });
    fireEvent.click(assignBtns[0]);

    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  test('restores focus to Assign button when modal closes via Cancel button', async () => {
    render(<UnassignedGuestPanel {...defaultProps} />);

    const assignBtns = screen.getAllByRole('button', { name: /assign/i });
    const firstAssignBtn = assignBtns[0];
    firstAssignBtn.focus();
    fireEvent.click(firstAssignBtn);

    expect(screen.getByRole('dialog')).toBeInTheDocument();

    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(document.activeElement).toBe(firstAssignBtn);
  });

  test('calls onAssignGuestToTable and closes modal when submitting quick-assign form', async () => {
    render(<UnassignedGuestPanel {...defaultProps} />);

    const assignBtns = screen.getAllByRole('button', { name: /assign/i });
    fireEvent.click(assignBtns[0]);

    const confirmBtn = screen.getByRole('button', { name: /confirm assignment/i });
    fireEvent.click(confirmBtn);

    expect(defaultProps.onAssignGuestToTable).toHaveBeenCalledWith('guest-1', 'table-1');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  describe('Auto-Assign All button', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('renders "Auto-Assign All" button when unassigned guests exist', () => {
      render(<UnassignedGuestPanel {...defaultProps} />);
      const autoAssignBtn = screen.getByRole('button', { name: /auto-assign all/i });
      expect(autoAssignBtn).toBeInTheDocument();
    });

    test('does not render "Auto-Assign All" button when unassigned guests list is empty', () => {
      render(<UnassignedGuestPanel {...defaultProps} unassignedGuests={[]} />);
      const autoAssignBtn = screen.queryByRole('button', { name: /auto-assign all/i });
      expect(autoAssignBtn).not.toBeInTheDocument();
    });

    test('calls auto-assign API route, shows summary toast, updates local state, and notifies parent callback', async () => {
      const onAutoAssignComplete = jest.fn();
      const mockResult = {
        assignedCount: 2,
        unassignedCount: 0,
        assignedGuests: [
          { id: 'guest-1', guestName: 'Jane Doe', tableId: 'table-1', seatNumber: 1 },
          { id: 'guest-2', guestName: 'John Smith', tableId: 'table-1', seatNumber: 2 },
        ],
      };

      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: mockResult }),
      } as Response);

      render(
        <ToastProvider>
          <UnassignedGuestPanel
            {...defaultProps}
            onAutoAssignComplete={onAutoAssignComplete}
          />
        </ToastProvider>
      );

      // Initially Jane Doe and John Smith are in the unassigned list
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
      expect(screen.getByText('John Smith')).toBeInTheDocument();

      const autoAssignBtn = screen.getByRole('button', { name: /auto-assign all/i });
      fireEvent.click(autoAssignBtn);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/admin/seating/auto-assign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
      });

      // Check summary toast appears
      await waitFor(() => {
        expect(
          screen.getByText(/successfully auto-assigned 2 guests across reception tables/i)
        ).toBeInTheDocument();
      });

      // Verify local state updated (assigned guests removed from unassigned panel)
      await waitFor(() => {
        expect(screen.getByText(/all guests have been assigned to tables!/i)).toBeInTheDocument();
      });

      expect(onAutoAssignComplete).toHaveBeenCalledWith(mockResult);
    });

    test('shows error toast notification when auto-assign API returns an error', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        json: async () => ({ success: false, error: 'Database constraint violation' }),
      } as Response);

      render(
        <ToastProvider>
          <UnassignedGuestPanel {...defaultProps} />
        </ToastProvider>
      );

      const autoAssignBtn = screen.getByRole('button', { name: /auto-assign all/i });
      fireEvent.click(autoAssignBtn);

      await waitFor(() => {
        expect(
          screen.getByText(/database constraint violation/i)
        ).toBeInTheDocument();
      });

      // Guests should still be present because assignment failed
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    });
  });
});
