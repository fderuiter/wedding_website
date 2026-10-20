import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { FloorplanCanvas } from '../FloorplanCanvas';
import { UnassignedGuestPanel } from '../UnassignedGuestPanel';
import { SeatingTableDTO } from '../../schemas';
import { InvitationCodeDTO } from '@/features/registry/schemas';

describe('Guest Indexing and Memoization Hooks', () => {
  const sampleTables: SeatingTableDTO[] = [
    {
      id: 'table-a',
      name: 'Table A',
      shape: 'round',
      capacity: 4,
      x: 100,
      y: 100,
      width: 120,
      height: 120,
      invitationCodes: [
        {
          id: 'g-1',
          code: 'CODE-1',
          guestName: 'Anna Smith',
          tableId: 'table-a',
          seatNumber: 1,
        } as InvitationCodeDTO,
        {
          id: 'g-2',
          code: 'CODE-2',
          guestName: 'Bernard Shaw',
          tableId: 'table-a',
          seatNumber: 2,
        } as InvitationCodeDTO,
      ],
    },
    {
      id: 'table-b',
      name: 'Table B',
      shape: 'rectangular',
      capacity: 6,
      x: 300,
      y: 100,
      width: 160,
      height: 120,
      invitationCodes: [
        {
          id: 'g-3',
          code: 'CODE-3',
          guestName: 'Clara Oswald',
          tableId: 'table-b',
          seatNumber: 1,
        } as InvitationCodeDTO,
      ],
    },
  ];

  const sampleUnassignedGuests: InvitationCodeDTO[] = [
    {
      id: 'g-4',
      code: 'CODE-4',
      guestName: 'Daniel Craig',
      tableId: null,
      partyTags: ['VIP', 'BrideFamily'],
    } as InvitationCodeDTO,
    {
      id: 'g-5',
      code: 'CODE-5',
      guestName: 'Eva Green',
      tableId: null,
      householdName: 'Green Household',
    } as InvitationCodeDTO,
  ];

  describe('FloorplanCanvas memoized seated matches', () => {
    it('returns zero seated matches and renders clean state when searchQuery is empty', () => {
      render(
        <FloorplanCanvas
          tables={sampleTables}
          selectedTableId={null}
          onSelectTable={() => {}}
          onUpdateTablePosition={() => {}}
          onDropGuestOnTable={() => {}}
          onUnassignGuest={() => {}}
          searchQuery=""
        />
      );

      expect(screen.getByText(/Drag tables to arrange floorplan/i)).toBeInTheDocument();
      expect(screen.queryByTestId('table-search-match-badge')).not.toBeInTheDocument();
      expect(screen.queryByTestId('matching-seat')).not.toBeInTheDocument();
    });

    it('identifies and highlights seated guest matches correctly when searchQuery matches guest name', () => {
      render(
        <FloorplanCanvas
          tables={sampleTables}
          selectedTableId={null}
          onSelectTable={() => {}}
          onUpdateTablePosition={() => {}}
          onDropGuestOnTable={() => {}}
          onUnassignGuest={() => {}}
          searchQuery="Anna"
        />
      );

      expect(screen.getByText(/1 seated match/i)).toBeInTheDocument();
      expect(screen.getByTestId('table-search-match-badge')).toBeInTheDocument();
      const matchSeat = screen.getByTestId('matching-seat');
      expect(matchSeat).toHaveAttribute('data-is-search-match', 'true');
    });

    it('triggers table position update on Arrow key navigation without search errors', () => {
      const onUpdateTablePosition = jest.fn();
      render(
        <FloorplanCanvas
          tables={sampleTables}
          selectedTableId={null}
          onSelectTable={() => {}}
          onUpdateTablePosition={onUpdateTablePosition}
          onDropGuestOnTable={() => {}}
          onUnassignGuest={() => {}}
          searchQuery=""
        />
      );

      const tableElement = screen.getByLabelText(/Table A/i);
      fireEvent.keyDown(tableElement, { key: 'ArrowRight' });

      expect(onUpdateTablePosition).toHaveBeenCalledWith('table-a', 110, 100);
    });
  });

  describe('UnassignedGuestPanel memoized filtering', () => {
    it('returns all unassigned guests when search query is empty', () => {
      render(
        <UnassignedGuestPanel
          unassignedGuests={sampleUnassignedGuests}
          tables={sampleTables}
          onAssignGuestToTable={() => {}}
          searchQuery=""
        />
      );

      expect(screen.getByText('Daniel Craig')).toBeInTheDocument();
      expect(screen.getByText('Eva Green')).toBeInTheDocument();
    });

    it('filters guests by household name', () => {
      render(
        <UnassignedGuestPanel
          unassignedGuests={sampleUnassignedGuests}
          tables={sampleTables}
          onAssignGuestToTable={() => {}}
          searchQuery="Green Household"
        />
      );

      expect(screen.getByText('Eva Green')).toBeInTheDocument();
      expect(screen.queryByText('Daniel Craig')).not.toBeInTheDocument();
    });

    it('filters guests by party tags', () => {
      render(
        <UnassignedGuestPanel
          unassignedGuests={sampleUnassignedGuests}
          tables={sampleTables}
          onAssignGuestToTable={() => {}}
          searchQuery="VIP"
        />
      );

      expect(screen.getByText('Daniel Craig')).toBeInTheDocument();
      expect(screen.queryByText('Eva Green')).not.toBeInTheDocument();
    });
  });
});
