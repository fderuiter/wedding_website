import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import { UnassignedGuestPanel } from '../UnassignedGuestPanel';
import { ToastProvider } from '@/components/ui/ToastProvider';
import { SeatingTableDTO } from '../../schemas';
import { InvitationCodeDTO } from '@/features/registry';
import { createMockInvitationCode } from '@/testing/factories/registryFactory';

expect.extend(toHaveNoViolations);

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

    test('passes includePending: false when "Include pending RSVPs in auto-assign" is unchecked', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { assignedCount: 1, unassignedCount: 0, assignedGuests: [] },
        }),
      } as Response);

      render(
        <ToastProvider>
          <UnassignedGuestPanel {...defaultProps} />
        </ToastProvider>
      );

      const includePendingCheckbox = screen.getByLabelText(/include pending rsvps in auto-assign/i);
      expect(includePendingCheckbox).toBeChecked();

      fireEvent.click(includePendingCheckbox);
      expect(includePendingCheckbox).not.toBeChecked();

      fireEvent.click(screen.getByRole('button', { name: /auto-assign all/i }));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/admin/seating/auto-assign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ includePending: false }),
        });
      });
    });
  });

  describe('RSVP filters, household grouping, dietary badges, and accessibility', () => {
    const richGuests: InvitationCodeDTO[] = [
      createMockInvitationCode({
        id: 'hh-1',
        code: 'VANCE1',
        guestName: 'Eleanor Vance',
        householdName: 'Vance Family',
        partyGroup: 'Bride Family',
        partyTags: ['vip', 'family'],
        dietaryNotes: 'Gluten-Free, Nut Allergy',
        used: true,
        extraFields: { attending: true },
      }),
      createMockInvitationCode({
        id: 'hh-2',
        code: 'VANCE2',
        guestName: 'Arthur Vance',
        householdName: 'Vance Family',
        partyGroup: 'Bride Family',
        partyTags: ['family'],
        dietaryNotes: null,
        used: true,
        extraFields: { attending: true, dietaryTags: ['dairy-free'] },
      }),
      createMockInvitationCode({
        id: 'solo-pending',
        code: 'PEND1',
        guestName: 'Chloe Bennett',
        householdName: null,
        partyGroup: 'College Friends',
        partyTags: ['friends'],
        dietaryNotes: 'Vegan',
        used: false,
        extraFields: null,
      }),
      createMockInvitationCode({
        id: 'declined-1',
        code: 'DECL1',
        guestName: 'Declined Person',
        used: true,
        extraFields: { attending: false },
      }),
      createMockInvitationCode({
        id: 'addr-1',
        code: 'ADDR1',
        guestName: 'Address Only Entry',
        used: false,
        partyTags: ['address-collection'],
      }),
    ];

    test('excludes declined and address-collection guests and filters by RSVP status, partyGroup, and partyTags', () => {
      render(<UnassignedGuestPanel {...defaultProps} unassignedGuests={richGuests} />);

      // Declined and address-collection guests are hidden from panel
      expect(screen.queryByText('Declined Person')).not.toBeInTheDocument();
      expect(screen.queryByText('Address Only Entry')).not.toBeInTheDocument();
      expect(screen.getByText('3 unassigned')).toBeInTheDocument();

      // Filter by RSVP Status = Attending
      const rsvpSelect = screen.getByLabelText(/rsvp status/i);
      fireEvent.change(rsvpSelect, { target: { value: 'attending' } });
      expect(screen.getByText('Eleanor Vance')).toBeInTheDocument();
      expect(screen.queryByText('Chloe Bennett')).not.toBeInTheDocument();

      // Filter by RSVP Status = Pending
      fireEvent.change(rsvpSelect, { target: { value: 'pending' } });
      expect(screen.getByText('Chloe Bennett')).toBeInTheDocument();
      expect(screen.queryByText('Eleanor Vance')).not.toBeInTheDocument();

      // Reset RSVP to All Eligible, filter by Party Group
      fireEvent.change(rsvpSelect, { target: { value: 'all' } });
      const groupSelect = screen.getByLabelText(/party group/i);
      fireEvent.change(groupSelect, { target: { value: 'College Friends' } });
      expect(screen.getByText('Chloe Bennett')).toBeInTheDocument();
      expect(screen.queryByText('Eleanor Vance')).not.toBeInTheDocument();

      // Reset Party Group, filter by Party Tag
      fireEvent.change(groupSelect, { target: { value: 'all' } });
      const tagSelect = screen.getByLabelText(/party tag/i);
      fireEvent.change(tagSelect, { target: { value: 'vip' } });
      expect(screen.getByText('Eleanor Vance')).toBeInTheDocument();
      expect(screen.queryByText('Chloe Bennett')).not.toBeInTheDocument();
    });

    test('groups household members and assigns entire household via Seat Household modal', async () => {
      const onAssignGuestsToTable = jest.fn().mockResolvedValue(true);

      render(
        <UnassignedGuestPanel
          {...defaultProps}
          unassignedGuests={richGuests}
          onAssignGuestsToTable={onAssignGuestsToTable}
        />
      );

      expect(screen.getByTestId('household-group-card')).toBeInTheDocument();

      const seatHouseholdBtn = screen.getByRole('button', {
        name: /seat vance family household \(2 guests\)/i,
      });
      fireEvent.click(seatHouseholdBtn);

      const confirmBtn = screen.getByRole('button', { name: /confirm household seating/i });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(onAssignGuestsToTable).toHaveBeenCalledWith(['hh-1', 'hh-2'], 'table-1');
      });
    });

    test('renders dietary badges and passes jest-axe accessibility audit when populated', async () => {
      const { container } = render(
        <ToastProvider>
          <UnassignedGuestPanel {...defaultProps} unassignedGuests={richGuests} />
        </ToastProvider>
      );

      const dietaryBadges = screen.getAllByTestId('guest-dietary-badge');
      expect(dietaryBadges.length).toBeGreaterThanOrEqual(4); // GF, NF on Eleanor + DF on Arthur + VG on Chloe
      expect(dietaryBadges.map((b) => b.textContent).join(' ')).toContain('GF');
      expect(dietaryBadges.map((b) => b.textContent).join(' ')).toContain('NF');
      expect(dietaryBadges.map((b) => b.textContent).join(' ')).toContain('DF');
      expect(dietaryBadges.map((b) => b.textContent).join(' ')).toContain('VG');
      const dfBadge = dietaryBadges.find((b) => b.textContent?.includes('DF'));
      expect(dfBadge).toHaveAttribute('title', 'Dairy-Free');

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });
});
