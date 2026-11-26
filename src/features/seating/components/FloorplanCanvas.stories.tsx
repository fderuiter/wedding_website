import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { FloorplanCanvas } from './FloorplanCanvas';
import type { SeatingTableDTO } from '../schemas';

const mockTables: SeatingTableDTO[] = [
  {
    id: 'tbl-1',
    name: 'Head Table',
    shape: 'head',
    capacity: 6,
    x: 250,
    y: 90,
    width: 280,
    height: 90,
    rotation: 0,
    isSample: false,
    invitationCodes: [
      { id: 'inv-1', code: 'BRIDE01', guestName: 'Taylor Morgan', seatNumber: 1, dietaryNotes: 'Gluten-Free', maxGuests: 1, confirmedGuests: 1 } as any,
      { id: 'inv-2', code: 'GROOM01', guestName: 'Jordan Lee', seatNumber: 2, maxGuests: 1, confirmedGuests: 1 } as any,
      { id: 'inv-3', code: 'MAID01', guestName: 'Samira Patel', seatNumber: 3, dietaryNotes: 'Vegan', maxGuests: 1, confirmedGuests: 1 } as any,
      { id: 'inv-4', code: 'BEST01', guestName: 'Marcus Chen', seatNumber: 4, maxGuests: 1, confirmedGuests: 1 } as any,
    ],
  },
  {
    id: 'tbl-2',
    name: 'Table 1 - Family',
    shape: 'round',
    capacity: 8,
    x: 120,
    y: 260,
    width: 130,
    height: 130,
    rotation: 0,
    isSample: false,
    invitationCodes: [
      { id: 'inv-5', code: 'FAM01', guestName: 'Eleanor Vance', maxGuests: 2, confirmedGuests: 2 } as any,
      { id: 'inv-6', code: 'FAM02', guestName: 'Arthur Vance', maxGuests: 1, confirmedGuests: 1 } as any,
    ],
  },
  {
    id: 'tbl-3',
    name: 'Table 2 - College Friends',
    shape: 'round',
    capacity: 8,
    x: 360,
    y: 330,
    width: 130,
    height: 130,
    rotation: 0,
    isSample: false,
    invitationCodes: [
      { id: 'inv-7', code: 'COL01', guestName: 'Lucas Grey', maxGuests: 2, confirmedGuests: 2 } as any,
      { id: 'inv-8', code: 'COL02', guestName: 'Chloe Bennett', maxGuests: 2, confirmedGuests: 2 } as any,
    ],
  },
  {
    id: 'tbl-4',
    name: 'Table 3 - Colleagues',
    shape: 'square',
    capacity: 4,
    x: 580,
    y: 260,
    width: 110,
    height: 110,
    rotation: 0,
    isSample: false,
    invitationCodes: [],
  },
];

function InteractiveFloorplanStory() {
  const [tables, setTables] = useState<SeatingTableDTO[]>(mockTables);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const handleUpdatePosition = (tableId: string, x: number, y: number) => {
    setTables((prev) =>
      prev.map((t) => (t.id === tableId ? { ...t, x, y } : t))
    );
  };

  const handleUpdateRotation = (tableId: string, rotation: number) => {
    setTables((prev) =>
      prev.map((t) => (t.id === tableId ? { ...t, rotation } : t))
    );
  };

  const handleDropGuest = (guestId: string, tableId: string) => {
    console.log(`Drop guest ${guestId} on table ${tableId}`);
  };

  const handleUnassignGuest = (guestId: string) => {
    console.log(`Unassign guest ${guestId}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 bg-white dark:bg-gray-800 p-3 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
        <input
          type="text"
          placeholder="Filter seated guests..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="px-3 py-1.5 text-sm border rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white"
        />
        <div className="text-xs text-gray-500 dark:text-gray-400">
          Selected Table: <span className="font-semibold text-gray-900 dark:text-gray-100">{selectedTableId || 'None'}</span>
        </div>
      </div>
      <div className="h-[600px] border border-gray-300 dark:border-gray-700 rounded-xl overflow-hidden shadow-inner bg-gray-50 dark:bg-gray-900">
        <FloorplanCanvas
          tables={tables}
          selectedTableId={selectedTableId}
          onSelectTable={setSelectedTableId}
          onUpdateTablePosition={handleUpdatePosition}
          onUpdateTableRotation={handleUpdateRotation}
          onDropGuestOnTable={handleDropGuest}
          onUnassignGuest={handleUnassignGuest}
          searchQuery={searchQuery}
        />
      </div>
    </div>
  );
}

const meta: Meta<typeof FloorplanCanvas> = {
  title: 'Features/Seating/FloorplanCanvas',
  component: FloorplanCanvas,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof FloorplanCanvas>;

export const Interactive: Story = {
  render: () => <InteractiveFloorplanStory />,
};

export const StaticLayout: Story = {
  render: () => (
    <div className="h-[550px] border border-gray-300 dark:border-gray-700 rounded-xl overflow-hidden bg-gray-50 dark:bg-gray-900">
      <FloorplanCanvas
        tables={mockTables}
        selectedTableId="tbl-1"
        onSelectTable={() => {}}
        onUpdateTablePosition={() => {}}
        onDropGuestOnTable={() => {}}
        onUnassignGuest={() => {}}
      />
    </div>
  ),
};
