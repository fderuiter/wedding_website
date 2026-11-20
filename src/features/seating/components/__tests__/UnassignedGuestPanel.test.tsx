import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import { UnassignedGuestPanel } from '../UnassignedGuestPanel';
import { ToastProvider } from '@/components/ui/ToastProvider';
import { SeatingTableDTO } from '../../schemas';
import { InvitationCodeDTO } from '@/features/registry';
import { createMockInvitationCode } from '@/testing/factories/registryFactory';

expect.extend(toHaveNoViolations);

if (typeof window !== 'undefined' && typeof window.PointerEvent === 'undefined') {
  class JSDOMPointerEvent extends MouseEvent {
    pointerId: number;
    pointerType: string;

    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
      this.pointerType = params.pointerType ?? '';
    }
  }
  window.PointerEvent = JSDOMPointerEvent as unknown as typeof PointerEvent;
}

describe('UnassignedGuestPanel quick-assign modal component', () => {
  const mockUnassignedGuests: InvitationCodeDTO[] = [
    createMockInvitationCode({
      id: 'guest-1',
      code: 'GUEST1',
      guestName: 'Jane Doe',
      used: false,
      plusOneAllocations: 1,
    }),
    createMockInvitationCode({
      id: 'guest-2',
      code: 'GUEST2',
      guestName: 'John Smith',
      used: false,
      plusOneAllocations: 0,
    }),
  ];

  const mockTables: SeatingTableDTO[] = [
    {
      id: 'table-1',
      name: 'Table 1',
      shape: 'round',
      capacity: 8,
      x: 0,
      y: 0,
      width: 120,
      height: 120,
      rotation: 0,
      isSample: false,
      invitationCodes: [],
    },
    {
      id: 'table-2',
      name: 'Table 2',
      shape: 'round',
      capacity: 8,
      x: 100,
      y: 100,
      width: 120,
      height: 120,
      rotation: 0,
      isSample: false,
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

    test('calls auto-assign API route, shows summary toast, and notifies parent callback', async () => {
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

      const { rerender } = render(
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

      expect(onAutoAssignComplete).toHaveBeenCalledWith(mockResult);

      // Verify that when parent updates unassignedGuests via centralized state, panel displays empty state
      rerender(
        <ToastProvider>
          <UnassignedGuestPanel
            {...defaultProps}
            unassignedGuests={[]}
            onAutoAssignComplete={onAutoAssignComplete}
          />
        </ToastProvider>
      );

      await waitFor(() => {
        expect(screen.getByText(/all guests have been assigned to tables!/i)).toBeInTheDocument();
      });
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

    test('renders empty state notice with contrast-checked muted text token and passes axe audit', async () => {
      const { container } = render(
        <ToastProvider>
          <UnassignedGuestPanel {...defaultProps} unassignedGuests={[]} />
        </ToastProvider>
      );

      const emptyNotice = screen.getByText('All guests have been assigned to tables!');
      expect(emptyNotice).toBeInTheDocument();
      expect(emptyNotice.className).toContain('var(--color-muted-text');
      expect(emptyNotice.className).not.toContain('text-gray-400');
      expect(emptyNotice.className).not.toContain('text-gray-500');

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('Cross-panel pointer drag for unassigned guests', () => {
    const originalElementFromPoint = document.elementFromPoint;

    afterEach(() => {
      document.elementFromPoint = originalElementFromPoint;
    });

    test('renders floating drag chip after 8px threshold and assigns guest to target seat via elementFromPoint', () => {
      const onAssignGuestToTable = jest.fn();
      const mockSeatTarget = document.createElement('button');
      mockSeatTarget.setAttribute('data-table-id', 'table-2');
      mockSeatTarget.setAttribute('data-seat-number', '5');
      document.body.appendChild(mockSeatTarget);
      document.elementFromPoint = jest.fn().mockReturnValue(mockSeatTarget);

      try {
        render(
          <UnassignedGuestPanel
            {...defaultProps}
            onAssignGuestToTable={onAssignGuestToTable}
          />
        );

        const guestCards = screen.getAllByRole('listitem');
        const setPointerCaptureSpy = jest.fn();
        guestCards[0].setPointerCapture = setPointerCaptureSpy;

        fireEvent.pointerDown(guestCards[0], {
          pointerId: 3,
          pointerType: 'touch',
          button: 0,
          clientX: 40,
          clientY: 60,
        });
        expect(setPointerCaptureSpy).toHaveBeenCalledWith(3);
        expect(screen.queryByTestId('guest-drag-chip')).not.toBeInTheDocument();

        // Move past 8px threshold
        fireEvent.pointerMove(guestCards[0], {
          pointerId: 3,
          pointerType: 'touch',
          clientX: 180,
          clientY: 220,
        });

        const dragChip = screen.getByTestId('guest-drag-chip');
        expect(dragChip).toBeInTheDocument();
        expect(dragChip).toHaveTextContent('Jane Doe');
        expect(dragChip.className).toContain('pointer-events-none');
        expect(dragChip.style.left).toBe('180px');
        expect(dragChip.style.top).toBe('220px');

        fireEvent.pointerUp(guestCards[0], {
          pointerId: 3,
          pointerType: 'touch',
          clientX: 180,
          clientY: 220,
        });

        expect(document.elementFromPoint).toHaveBeenCalledWith(180, 220);
        expect(onAssignGuestToTable).toHaveBeenCalledWith('guest-1', 'table-2', 5);
        expect(screen.queryByTestId('guest-drag-chip')).not.toBeInTheDocument();
      } finally {
        mockSeatTarget.remove();
      }
    });

    test('assigns guest to table without seatNumber when dropped onto a data-table-id surface', () => {
      const onAssignGuestToTable = jest.fn();
      const mockTableSurface = document.createElement('div');
      mockTableSurface.setAttribute('data-table-id', 'table-1');
      const innerSpan = document.createElement('span');
      mockTableSurface.appendChild(innerSpan);
      document.body.appendChild(mockTableSurface);
      document.elementFromPoint = jest.fn().mockReturnValue(innerSpan);

      try {
        render(
          <UnassignedGuestPanel
            {...defaultProps}
            onAssignGuestToTable={onAssignGuestToTable}
          />
        );

        const guestCards = screen.getAllByRole('listitem');
        fireEvent.pointerDown(guestCards[1], {
          pointerId: 4,
          pointerType: 'touch',
          button: 0,
          clientX: 30,
          clientY: 40,
        });
        fireEvent.pointerMove(window, {
          pointerId: 4,
          clientX: 250,
          clientY: 300,
        });
        fireEvent.pointerUp(window, {
          pointerId: 4,
          clientX: 250,
          clientY: 300,
        });

        expect(onAssignGuestToTable).toHaveBeenCalledWith('guest-2', 'table-1');
      } finally {
        mockTableSurface.remove();
      }
    });

    test('ignores movements below the 8px drag threshold so touch scrolling and taps do not trigger drops', () => {
      const onAssignGuestToTable = jest.fn();
      const mockTableSurface = document.createElement('div');
      mockTableSurface.setAttribute('data-table-id', 'table-1');
      document.body.appendChild(mockTableSurface);
      document.elementFromPoint = jest.fn().mockReturnValue(mockTableSurface);

      try {
        render(
          <UnassignedGuestPanel
            {...defaultProps}
            onAssignGuestToTable={onAssignGuestToTable}
          />
        );

        const guestCards = screen.getAllByRole('listitem');
        fireEvent.pointerDown(guestCards[0], {
          pointerId: 5,
          pointerType: 'touch',
          button: 0,
          clientX: 50,
          clientY: 50,
        });
        // Move only 5px (< 8px threshold)
        fireEvent.pointerMove(guestCards[0], {
          pointerId: 5,
          pointerType: 'touch',
          clientX: 53,
          clientY: 54,
        });
        expect(screen.queryByTestId('guest-drag-chip')).not.toBeInTheDocument();

        fireEvent.pointerUp(guestCards[0], {
          pointerId: 5,
          pointerType: 'touch',
          clientX: 53,
          clientY: 54,
        });
        expect(onAssignGuestToTable).not.toHaveBeenCalled();
      } finally {
        mockTableSurface.remove();
      }
    });

    test('clears floating drag chip on pointerCancel and preserves HTML5 draggable attribute', () => {
      const onAssignGuestToTable = jest.fn();
      render(
        <UnassignedGuestPanel
          {...defaultProps}
          onAssignGuestToTable={onAssignGuestToTable}
        />
      );

      const guestCards = screen.getAllByRole('listitem');
      expect(guestCards[0]).toHaveAttribute('draggable', 'true');

      fireEvent.pointerDown(guestCards[0], {
        pointerId: 6,
        pointerType: 'touch',
        button: 0,
        clientX: 20,
        clientY: 20,
      });
      fireEvent.pointerMove(guestCards[0], {
        pointerId: 6,
        pointerType: 'touch',
        clientX: 120,
        clientY: 120,
      });
      expect(screen.getByTestId('guest-drag-chip')).toBeInTheDocument();

      fireEvent.pointerCancel(guestCards[0], { pointerId: 6, pointerType: 'touch' });
      expect(screen.queryByTestId('guest-drag-chip')).not.toBeInTheDocument();
      expect(onAssignGuestToTable).not.toHaveBeenCalled();
    });
  });
});
