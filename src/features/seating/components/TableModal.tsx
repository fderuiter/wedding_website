'use client';

import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog, useDirtyConfirmClose } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/forms';
import { useToast } from '@/components/ui/ToastProvider';
import { SeatingTableDTO } from '../schemas';
import {
  computeScaledTableDimensions,
  computeTableMinBounds,
  resolveDetailedSeatAssignments,
} from '../seatLayout';
import {
  getDefaultShapeDimensions,
  getGuestsHeadcount,
  isLandmarkTableShape,
} from '../utils/seatingHelpers';

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
  const initialShape = ((table?.shape as TableShapeValue) || 'round');
  const defaultCap = isLandmarkTableShape(initialShape) ? 0 : 8;
  const resolvedCapacity = table ? table.capacity : defaultCap;
  const resolvedWidth = table?.width || 120;
  const resolvedHeight = table?.height || 120;
  const resolvedRotation = table?.rotation || 0;
  const { minX, minY } = computeTableMinBounds({
    shape: initialShape,
    capacity: resolvedCapacity,
    width: resolvedWidth,
    height: resolvedHeight,
    rotation: resolvedRotation,
  });
  return {
    name: table?.name ?? '',
    shape: initialShape,
    capacity: resolvedCapacity,
    width: resolvedWidth,
    height: resolvedHeight,
    rotation: resolvedRotation,
    x: table ? Math.max(minX, table.x) : minX,
    y: table ? Math.max(minY, table.y) : minY,
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

  const isLandmark = isLandmarkTableShape(shape);
  const scaledBounds = useMemo(
    () =>
      computeScaledTableDimensions({
        shape,
        capacity: isLandmark ? 0 : capacity,
        width,
        height,
        rotation,
      }),
    [shape, isLandmark, capacity, width, height, rotation]
  );
  const minBounds = useMemo(
    () =>
      computeTableMinBounds({
        shape,
        capacity: isLandmark ? 0 : capacity,
        width,
        height,
        rotation,
      }),
    [shape, isLandmark, capacity, width, height, rotation]
  );
  const isPerimeterAutoScaled =
    !isLandmark && (scaledBounds.width > width || scaledBounds.height > height);
  const currentSeatedCount = useMemo(
    () => getGuestsHeadcount(table?.invitationCodes || []),
    [table?.invitationCodes]
  );

  const seatsAboveNewCapacity = useMemo(() => {
    if (isLandmark || !table?.invitationCodes || table.invitationCodes.length === 0) {
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
  }, [isLandmark, table, initialSnapshot.capacity, capacity]);

  const handleShapeChange = (val: TableShapeValue) => {
    const nextIsLandmark = isLandmarkTableShape(val);
    const prevWasLandmark = isLandmarkTableShape(shape) || capacity === 0;
    let nextCapacity = capacity;
    let nextWidth = width;
    let nextHeight = height;

    if (nextIsLandmark) {
      const defaults = getDefaultShapeDimensions(val);
      nextCapacity = 0;
      if (!table) {
        nextWidth = defaults.width;
        nextHeight = defaults.height;
      }
    } else if (prevWasLandmark) {
      const defaults = getDefaultShapeDimensions(val);
      nextCapacity = defaults.defaultCapacity;
    }

    const nextMinBounds = computeTableMinBounds({
      shape: val,
      capacity: nextIsLandmark ? 0 : nextCapacity,
      width: nextWidth,
      height: nextHeight,
      rotation,
    });
    const nextX =
      !table && x === minBounds.minX ? nextMinBounds.minX : Math.max(nextMinBounds.minX, x);
    const nextY =
      !table && y === minBounds.minY ? nextMinBounds.minY : Math.max(nextMinBounds.minY, y);

    setShape(val);
    setCapacity(nextCapacity);
    setWidth(nextWidth);
    setHeight(nextHeight);
    setX(nextX);
    setY(nextY);

    const nextSnapshot: TableFormSnapshot = {
      ...currentSnapshot,
      shape: val,
      capacity: nextCapacity,
      width: nextWidth,
      height: nextHeight,
      x: nextX,
      y: nextY,
    };
    onDirtyChange(isTableFormDirty(nextSnapshot, initialSnapshot));
  };

  const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!name.trim()) return;

    if (!isLandmark && table && capacity < currentSeatedCount) {
      const confirmed = await confirm(
        `Warning: This table currently has ${currentSeatedCount} seated guest${currentSeatedCount === 1 ? '' : 's'}, which exceeds the new capacity of ${capacity}. Are you sure you want to save?`
      );
      if (!confirmed) {
        return;
      }
    } else if (!isLandmark && table && seatsAboveNewCapacity.length > 0) {
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
      capacity: isLandmark ? 0 : capacity,
      width,
      height,
      rotation,
      x: Math.max(minBounds.minX, x),
      y: Math.max(minBounds.minY, y),
    });
    onClose();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="table-name" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
          Table Name
        </label>
        <Input
          id="table-name"
          type="text"
          sizeVariant="compact"
          required
          value={name}
          onChange={(e) => {
            const val = e.target.value;
            setName(val);
            updateSnapshotField('name', val);
          }}
          placeholder="e.g. Table 1 - Family or Dance Floor"
          className="h-9 px-3 py-2 text-xs rounded-lg border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
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
            onChange={(e) => handleShapeChange(e.target.value as TableShapeValue)}
            className="w-full px-3 py-2 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          >
            <optgroup label="Guest Tables">
              <option value="round">Round</option>
              <option value="rectangular">Rectangular</option>
              <option value="square">Square</option>
              <option value="head">Head Table (1-Sided)</option>
              <option value="sweetheart">Sweetheart (1-Sided)</option>
            </optgroup>
            <optgroup label="Room Landmarks (0 Seats)">
              <option value="dance-floor">Dance Floor (Landmark)</option>
              <option value="bar">Bar (Landmark)</option>
              <option value="dj">DJ Booth (Landmark)</option>
              <option value="buffet">Buffet (Landmark)</option>
              <option value="cake">Cake Table (Landmark)</option>
            </optgroup>
          </select>
        </div>

        <div>
          <label htmlFor="table-capacity" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
            Seating Capacity
          </label>
          <Input
            id="table-capacity"
            type="number"
            sizeVariant="compact"
            min={isLandmark ? 0 : 1}
            max={isLandmark ? 0 : 50}
            disabled={isLandmark}
            value={isLandmark ? 0 : capacity}
            onChange={(e) => {
              if (isLandmark) return;
              const val = parseInt(e.target.value) || 1;
              setCapacity(val);
              updateSnapshotField('capacity', val);
            }}
            className="h-9 px-3 py-2 text-xs rounded-lg border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 disabled:opacity-60 disabled:cursor-not-allowed"
          />
          {isLandmark && (
            <p className="mt-1 text-[11px] text-gray-600 dark:text-gray-400" data-testid="landmark-capacity-note">
              Room landmarks have 0 guest seats.
            </p>
          )}
          {!isLandmark && table && capacity < currentSeatedCount ? (
            <p className="mt-1 text-[11px] text-warning-text font-medium" data-testid="capacity-warning">
              Warning: Table has {currentSeatedCount} seated guest{currentSeatedCount === 1 ? '' : 's'}. Lowering capacity below {currentSeatedCount} exceeds current occupancy.
            </p>
          ) : table && seatsAboveNewCapacity.length > 0 ? (
            <p className="mt-1 text-[11px] text-warning-text font-medium" data-testid="capacity-warning">
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
          <Input
            id="table-width"
            type="number"
            sizeVariant="compact"
            min={60}
            max={400}
            value={width}
            onChange={(e) => {
              const val = parseInt(e.target.value) || 120;
              setWidth(val);
              updateSnapshotField('width', val);
            }}
            className="h-9 px-3 py-2 text-xs rounded-lg border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          />
        </div>

        <div>
          <label htmlFor="table-height" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
            Height (px)
          </label>
          <Input
            id="table-height"
            type="number"
            sizeVariant="compact"
            min={60}
            max={400}
            value={height}
            onChange={(e) => {
              const val = parseInt(e.target.value) || 120;
              setHeight(val);
              updateSnapshotField('height', val);
            }}
            className="h-9 px-3 py-2 text-xs rounded-lg border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          />
        </div>

        <div>
          <label htmlFor="table-rotation" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
            Rotation (°)
          </label>
          <Input
            id="table-rotation"
            type="number"
            sizeVariant="compact"
            min={0}
            max={360}
            value={rotation}
            onChange={(e) => {
              const val = parseInt(e.target.value) || 0;
              setRotation(val);
              updateSnapshotField('rotation', val);
            }}
            className="h-9 px-3 py-2 text-xs rounded-lg border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          />
        </div>
      </div>

      {isPerimeterAutoScaled && (
        <p
          data-testid="scaled-bounds-note"
          className="text-[11px] text-gray-600 dark:text-gray-300"
        >
          Rendered floorplan &amp; PDF bounds automatically expand to {scaledBounds.width} × {scaledBounds.height} px so all {capacity} seats remain separated.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="table-x" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
            X Position (px)
          </label>
          <Input
            id="table-x"
            type="number"
            sizeVariant="compact"
            min={minBounds.minX}
            max={2000}
            value={Math.max(minBounds.minX, x)}
            onChange={(e) => {
              const parsed = parseInt(e.target.value, 10);
              const val = Number.isNaN(parsed) ? minBounds.minX : parsed;
              setX(val);
              updateSnapshotField('x', val);
            }}
            className="h-9 px-3 py-2 text-xs rounded-lg border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          />
        </div>
        <div>
          <label htmlFor="table-y" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
            Y Position (px)
          </label>
          <Input
            id="table-y"
            type="number"
            sizeVariant="compact"
            min={minBounds.minY}
            max={2000}
            value={Math.max(minBounds.minY, y)}
            onChange={(e) => {
              const parsed = parseInt(e.target.value, 10);
              const val = Number.isNaN(parsed) ? minBounds.minY : parsed;
              setY(val);
              updateSnapshotField('y', val);
            }}
            className="h-9 px-3 py-2 text-xs rounded-lg border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          />
        </div>
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
        {table && onDelete ? (
          <Button
            type="button"
            variant="danger"
            size="sm"
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
            className="px-3 py-2 text-xs font-medium"
          >
            Delete Table
          </Button>
        ) : (
          <div></div>
        )}

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRequestClose}
            className="px-4 py-2 text-xs font-medium text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            className="px-4 py-2 text-xs font-medium"
          >
            {table ? 'Save Changes' : 'Create Table'}
          </Button>
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
