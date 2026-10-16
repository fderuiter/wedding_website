import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SeatingChartAdminPage from '@/app/admin/dashboard/seating-chart/page';
import { FloorplanCanvas } from '../FloorplanCanvas';
import { UnassignedGuestPanel } from '../UnassignedGuestPanel';
import { SeatingTableDTO } from '../../schemas';
import { InvitationCodeDTO } from '@/features/registry';

// Mock fetch for SeatingChartAdminPage testing
const mockTables: SeatingTableDTO[] = [
  {
    id: 'table-1',
    name: 'Head Table',
    shape: 'round',
    capacity: 6,
    x: 50,
    y: 50,
    width: 120,
    height: 120,
    invitationCodes: [
      {
        id: 'guest-1',
        code: 'INV-JOHN',
        guestName: 'John Doe',
        tableId: 'table-1',
        seatNumber: 1,
      } as InvitationCodeDTO,
      {
        id: 'guest-2',
        code: 'INV-ALICE',
        guestName: 'Alice Walker',
        tableId: 'table-1',
        seatNumber: 2,
      } as InvitationCodeDTO,
    ],
  },
  {
    id: 'table-2',
    name: 'VIP Table',
    shape: 'square',
    capacity: 4,
    x: 250,
    y: 50,
    width: 120,
    height: 120,
    invitationCodes: [],
  },
];

const mockAllGuests: InvitationCodeDTO[] = [
  ...mockTables[0].invitationCodes!,
  {
    id: 'guest-3',
    code: 'INV-BOB',
    guestName: 'Bob Smith',
    tableId: null,
  } as InvitationCodeDTO,
  {
    id: 'guest-4',
    code: 'INV-CHARLIE',
    guestName: 'Charlie Brown',
    tableId: null,
  } as InvitationCodeDTO,
];

describe('Global Seating Guest Search', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('FloorplanCanvas visual search highlighting', () => {
    it('highlights matching assigned table seat and displays match badge on table when searching by name', () => {
      render(
        <FloorplanCanvas
          tables={mockTables}
          selectedTableId={null}
          onSelectTable={() => {}}
          onUpdateTablePosition={() => {}}
          onDropGuestOnTable={() => {}}
          onUnassignGuest={() => {}}
          searchQuery="John"
        />
      );

      // Verify canvas banner indicates 1 seated match
      expect(screen.getByText(/Searching “John”:/i)).toBeInTheDocument();
      expect(screen.getByText(/1 seated match/i)).toBeInTheDocument();

      // Verify table search match badge
      expect(screen.getByTestId('table-search-match-badge')).toBeInTheDocument();

      // Verify matching seat highlight
      const matchingSeat = screen.getByTestId('matching-seat');
      expect(matchingSeat).toBeInTheDocument();
      expect(matchingSeat.getAttribute('data-is-search-match')).toBe('true');
      expect(matchingSeat.getAttribute('title')).toContain('John Doe (Search Match!');
    });

    it('highlights matching assigned seat when searching by invitation code', () => {
      render(
        <FloorplanCanvas
          tables={mockTables}
          selectedTableId={null}
          onSelectTable={() => {}}
          onUpdateTablePosition={() => {}}
          onDropGuestOnTable={() => {}}
          onUnassignGuest={() => {}}
          searchQuery="INV-ALICE"
        />
      );

      expect(screen.getByTestId('table-search-match-badge')).toBeInTheDocument();
      const matchingSeat = screen.getByTestId('matching-seat');
      expect(matchingSeat).toBeInTheDocument();
      expect(matchingSeat.getAttribute('title')).toContain('Alice Walker (Search Match!');
    });

    it('shows zero matches status when search query does not match any seated guest', () => {
      render(
        <FloorplanCanvas
          tables={mockTables}
          selectedTableId={null}
          onSelectTable={() => {}}
          onUpdateTablePosition={() => {}}
          onDropGuestOnTable={() => {}}
          onUnassignGuest={() => {}}
          searchQuery="NONEXISTENT"
        />
      );

      expect(screen.getByText(/No matching seated guests on floorplan/i)).toBeInTheDocument();
      expect(screen.queryByTestId('table-search-match-badge')).not.toBeInTheDocument();
      expect(screen.queryByTestId('matching-seat')).not.toBeInTheDocument();
    });
  });

  describe('UnassignedGuestPanel global search synchronization', () => {
    const unassignedGuests = mockAllGuests.filter((g) => !g.tableId);

    it('filters unassigned guest list according to global searchQuery', () => {
      render(
        <UnassignedGuestPanel
          unassignedGuests={unassignedGuests}
          tables={mockTables}
          onAssignGuestToTable={() => {}}
          searchQuery="Bob"
          onSearchQueryChange={() => {}}
        />
      );

      expect(screen.getByText('Bob Smith')).toBeInTheDocument();
      expect(screen.queryByText('Charlie Brown')).not.toBeInTheDocument();
    });

    it('triggers onSearchQueryChange when user types in panel input', () => {
      const handleSearchChange = jest.fn();
      render(
        <UnassignedGuestPanel
          unassignedGuests={unassignedGuests}
          tables={mockTables}
          onAssignGuestToTable={() => {}}
          searchQuery="Bo"
          onSearchQueryChange={handleSearchChange}
        />
      );

      const input = screen.getByLabelText('Search unassigned guests');
      fireEvent.change(input, { target: { value: 'Bob' } });

      expect(handleSearchChange).toHaveBeenCalledWith('Bob');
    });

    it('renders empty feedback message when zero unassigned guests match search', () => {
      render(
        <UnassignedGuestPanel
          unassignedGuests={unassignedGuests}
          tables={mockTables}
          onAssignGuestToTable={() => {}}
          searchQuery="John"
          onSearchQueryChange={() => {}}
        />
      );

      expect(screen.getByText('No unassigned guests match "John".')).toBeInTheDocument();
    });
  });

  describe('SeatingChartAdminPage global search integration', () => {
    beforeEach(() => {
      global.fetch = jest.fn((url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.endsWith('/api/admin/seating-tables')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockTables),
          } as Response);
        }
        if (urlStr.endsWith('/api/admin/invitation-codes')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockAllGuests),
          } as Response);
        }
        return Promise.reject(new Error(`Unknown URL: ${urlStr}`));
      }) as jest.Mock;
    });

    it('filters unassigned guests and highlights seated guests when typing into global search bar', async () => {
      render(<SeatingChartAdminPage />);

      await waitFor(() => {
        expect(screen.getByText('Interactive Seating Chart & Reception Floorplan')).toBeInTheDocument();
        expect(screen.getAllByText('Head Table').length).toBeGreaterThan(0);
      });

      // Type into global search input
      const globalSearchInput = screen.getByLabelText(
        'Search all guests across floorplan and unassigned list'
      );
      fireEvent.change(globalSearchInput, { target: { value: 'John' } });

      // Verify search match summary badge
      expect(screen.getByText(/Found 1 match \(1 seated, 0 unassigned\)/i)).toBeInTheDocument();

      // Verify Floorplan Canvas highlights John Doe's seat
      expect(screen.getByTestId('matching-seat')).toBeInTheDocument();

      // Verify Unassigned Guest Panel shows empty message
      expect(screen.getByText('No unassigned guests match "John".')).toBeInTheDocument();

      // Now search for "Bob" (unassigned guest)
      fireEvent.change(globalSearchInput, { target: { value: 'Bob' } });

      expect(screen.getByText(/Found 1 match \(0 seated, 1 unassigned\)/i)).toBeInTheDocument();
      expect(screen.getAllByText('Bob Smith').length).toBeGreaterThan(0);
      expect(screen.queryByTestId('matching-seat')).not.toBeInTheDocument();

      // Clear search query using clear button
      const clearButton = screen.getByLabelText('Clear search query');
      fireEvent.click(clearButton);

      expect(screen.getAllByText('Bob Smith').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Charlie Brown').length).toBeGreaterThan(0);
      expect(screen.queryByTestId('matching-seat')).not.toBeInTheDocument();
    });
  });
});
