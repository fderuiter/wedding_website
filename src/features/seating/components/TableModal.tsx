'use client';

import React, { useMemo, useState } from 'react';
import { Dialog, useDirtyConfirmClose } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/ToastProvider';
import { SeatingTableDTO } from '../schemas';
import { resolveDetailedSeatAssignments } from '../seatLayout';
import { getGuestsHeadcount } from '../utils/seatingHelpers';

interface TableModalProps {
  isOpen: boolean;
  table: SeatingTableDTO | null;
  onClose: () => void;
  onSave: (tableData: Partial<SeatingTableDTO>) => void;
  onDelete?: (tableId: string) => void;
}

type TableShapeValue = SeatingTableDTO['shape'];

interface TableFormSnapshot {
  name: string;
  shape: TableShapeValue;
  capacity: number;
  width: number;
  height: number;
  rotation: number;
  x: number;
  y: number;
}

function createInitialTableSnapshot(table: SeatingTableDTO | null): TableFormSnapshot {
  return {
    name: table?.name ?? '',
    shape: (table?.shape as TableShapeValue) || 'round',
    capacity: table ? table.capacity : 8,
    width: table?.width || 120,
    height: table?.height || 120,
    rotation: table?.rotation || 0,
    x: table?.x || 0,
    y: table?.y || 0,
  };
}

function isTableFormDirty(current: TableFormSnapshot, initial: TableFormSnapshot): boolean {
  return (Object.keys(initial) as Array<keyof TableFormSnapshot>).some(
    (key) => current[key] !== initial[key]
  );
}

interface TableModalFormProps {
  table: SeatingTableDTO | null;
  onClose: () => void;
  onSave: (tableData: Partial<SeatingTableDTO>) => void;
  onDelete?: (tableId: string) => void;
  onDirtyChange: (_isDirty: boolean) => void;
}

function TableModalForm({
  table,
  onClose,
  onSave,
  onDelete,
  onDirtyChange,
}: TableModalFormProps) {
  const { confirm } = useToast();
  const initialSnapshot = useMemo(() => createInitialTableSnapshot(table), [table]);
  const [name, setName] = useState(initialSnapshot.name);
  const [shape, setShape] = useState<TableShapeValue>(initialSnapshot.shape);
  const [capacity, setCapacity] = useState(initialSnapshot.capacity);
  const [width, setWidth] = useState(initialSnapshot.width);
  const [height, setHeight] = useState(initialSnapshot.height);
  const [rotation, setRotation] = useState(initialSnapshot.rotation);
  const [x, setX] = useState(initialSnapshot.x);
  const [y, setY] = useState(initialSnapshot.y);

  const currentSnapshot: TableFormSnapshot = {
    name,
    shape,
    capacity,
    width,
    height,
    rotation,
    x,
    y,
  };
  const isDirty = isTableFormDirty(currentSnapshot, initialSnapshot);
  const handleRequestClose = useDirtyConfirmClose(isDirty, onClose);

  const updateSnapshotField = <K extends keyof TableFormSnapshot>(
    field: K,
    value: TableFormSnapshot[K]
  ) => {
    const next = { ...currentSnapshot, [field]: value };
    onDirtyChange(isTableFormDirty(next, initialSnapshot));
  };

  const currentSeatedCount = useMemo(
    () => getGuestsHeadcount(table?.invitationCodes || []),
    [table?.invitationCodes]
  );

  const seatsAboveNewCapacity = useMemo(() => {
    if (!table?.invitationCodes || table.invitationCodes.length === 0) {
      return [] as number[];
    }
    const baselineMaxCap = Math.max(initialSnapshot.capacity, table.capacity);
    const resolvedAtOriginal = resolveDetailedSeatAssignments(
      table.invitationCodes,
      baselineMaxCap
    );
    const highSeats: number[] = [];
    resolvedAtOriginal.forEach((_entry, seatNum) => {
      if (seatNum > capacity) {
        highSeats.push(seatNum);
      }
    });
    for (const guest of table.invitationCodes) {
      if (
        typeof guest.seatNumber === 'number' &&
        guest.seatNumber > capacity &&
        !highSeats.includes(guest.seatNumber)
      ) {
        highSeats.push(guest.seatNumber);
      }
    }
    return highSeats.sort((a, b) => a - b);
  }, [table, initialSnapshot.capacity, capacity]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    if (table && capacity < currentSeatedCount) {
      const confirmed = await confirm(
        `Warning: This table currently has ${currentSeatedCount} seated guest${currentSeatedCount === 1 ? '' : 's'}, which exceeds the new capacity of ${capacity}. Are you sure you want to save?`
      );
      if (!confirmed) {
        return;
      }
    } else if (table && seatsAboveNewCapacity.length > 0) {
      const seatListLabel = seatsAboveNewCapacity.map((s) => `Seat ${s}`).join(', ');
      const confirmed = await confirm(
        `Warning: Lowering capacity to ${capacity} will repack ${seatListLabel} into seats 1–${capacity}. Are you sure you want to save?`
      );
      if (!confirmed) {
        return;
      }
    }

    onSave({
      ...(table ? { id: table.id } : {}),
      name: name.trim(),
      shape,
      capacity,
      width,
      height,
      rotation,
      x,
      y,
    });
    onClose();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="table-name" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
          Table Name
        </label>
        <input
          id="table-name"
          type="text"
          required
          value={name}
          onChange={(e) => {
            const val = e.target.value;
            setName(val);
            updateSnapshotField('name', val);
          }}
          placeholder="e.g. Table 1 - Family"
          className="w-full px-3 py-2 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="table-shape" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
            Table Shape
          </label>
          <select
            id="table-shape"
            value={shape}
            onChange={(e) => {
              const val = e.target.value as TableShapeValue;
              setShape(val);
              updateSnapshotField('shape', val);
            }}
            className="w-full px-3 py-2 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          >
            <option value="round">Round</option>
            <option value="rectangular">Rectangular</option>
            <option value="square">Square</option>
            <option value="head">Head Table (1-Sided)</option>
            <option value="sweetheart">Sweetheart (1-Sided)</option>
          </select>
        </div>

        <div>
          <label htmlFor="table-capacity" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
            Seating Capacity
          </label>
          <input
            id="table-capacity"
            type="number"
            min={1}
            max={50}
            value={capacity}
            onChange={(e) => {
              const val = parseInt(e.target.value) || 1;
              setCapacity(val);
              updateSnapshotField('capacity', val);
            }}
            className="w-full px-3 py-2 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          />
          {table && capacity < currentSeatedCount ? (
            <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400 font-medium" data-testid="capacity-warning">
              Warning: Table has {currentSeatedCount} seated guest{currentSeatedCount === 1 ? '' : 's'}. Lowering capacity below {currentSeatedCount} exceeds current occupancy.
            </p>
          ) : table && seatsAboveNewCapacity.length > 0 ? (
            <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400 font-medium" data-testid="capacity-warning">
              Warning: Lowering capacity to {capacity} will repack {seatsAboveNewCapacity.map((s) => `Seat ${s}`).join(', ')} into seats 1–{capacity}.
            </p>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label htmlFor="table-width" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
            Width (px)
          </label>
          <input
            id="table-width"
            type="number"
            min={60}
            max={400}
            value={width}
            onChange={(e) => {
              const val = parseInt(e.target.value) || 120;
              setWidth(val);
              updateSnapshotField('width', val);
            }}
            className="w-full px-3 py-2 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          />
        </div>

        <div>
          <label htmlFor="table-height" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
            Height (px)
          </label>
          <input
            id="table-height"
            type="number"
            min={60}
            max={400}
            value={height}
            onChange={(e) => {
              const val = parseInt(e.target.value) || 120;
              setHeight(val);
              updateSnapshotField('height', val);
            }}
            className="w-full px-3 py-2 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          />
        </div>

        <div>
          <label htmlFor="table-rotation" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
            Rotation (°)
          </label>
          <input
            id="table-rotation"
            type="number"
            min={0}
            max={360}
            value={rotation}
            onChange={(e) => {
              const val = parseInt(e.target.value) || 0;
              setRotation(val);
              updateSnapshotField('rotation', val);
            }}
            className="w-full px-3 py-2 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="table-x" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
            X Position (px)
          </label>
          <input
            id="table-x"
            type="number"
            min={0}
            max={2000}
            value={x}
            onChange={(e) => {
              const val = parseInt(e.target.value) || 0;
              setX(val);
              updateSnapshotField('x', val);
            }}
            className="w-full px-3 py-2 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
          />
        </div>
        <div>
          <label htmlFor="table-y" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
            Y Position (px)
          </label>
          <input
            id="table-y"
            type="number"
            min={0}
            max={2000}
            value={y}
            onChange={(e) => {
              const val = parseInt(e.target.value) || 0;
              setY(val);
              updateSnapshotField('y', val);
            }}
            className="w-full px-3 py-2 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
          />
        </div>
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
        {table && onDelete ? (
          <button
            type="button"
            onClick={() => {
              void (async () => {
                const confirmed = await confirm(
                  `Are you sure you want to delete "${table.name}"? Assigned guests will become unassigned.`
                );
                if (confirmed) {
                  onDelete(table.id);
                  onClose();
                }
              })();
            }}
            className="px-3 py-2 text-xs font-medium bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900 rounded-lg border border-red-200 dark:border-red-800 transition-colors"
          >
            Delete Table
          </button>
        ) : (
          <div></div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleRequestClose}
            className="px-4 py-2 text-xs font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-4 py-2 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors shadow-xs"
          >
            {table ? 'Save Changes' : 'Create Table'}
          </button>
        </div>
      </div>
    </form>
  );
}

export function TableModal({
  isOpen,
  table,
  onClose,
  onSave,
  onDelete,
}: TableModalProps) {
  const titleText = table ? 'Edit Reception Table' : 'Create New Table';
  const formKey = `${isOpen ? 'open' : 'closed'}-${table?.id ?? 'new'}`;
  const [dirtyEntry, setDirtyEntry] = useState<{ key: string; isDirty: boolean }>({
    key: '',
    isDirty: false,
  });
  const isDirty = dirtyEntry.key === formKey && dirtyEntry.isDirty;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      isDirty={isDirty}
      title={titleText}
      className="max-w-md w-full"
    >
      <TableModalForm
        key={formKey}
        table={table}
        onClose={onClose}
        onSave={onSave}
        onDelete={onDelete}
        onDirtyChange={(nextDirty) => setDirtyEntry({ key: formKey, isDirty: nextDirty })}
      />
    </Dialog>
  );
}
