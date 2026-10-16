'use client';

import React, { useState, useRef } from 'react';
import { SeatingTableDTO } from '../schemas';

interface FloorplanCanvasProps {
  tables: SeatingTableDTO[];
  selectedTableId: string | null;
  onSelectTable: (tableId: string | null) => void;
  onUpdateTablePosition: (tableId: string, x: number, y: number) => void;
  onDropGuestOnTable: (guestId: string, tableId: string, seatNumber?: number) => void;
  onUnassignGuest: (guestId: string) => void;
}

export function FloorplanCanvas({
  tables,
  selectedTableId,
  onSelectTable,
  onUpdateTablePosition,
  onDropGuestOnTable,
  onUnassignGuest,
}: FloorplanCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [draggingTableId, setDraggingTableId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Handle table mouse drag
  const handleTableMouseDown = (e: React.MouseEvent, table: SeatingTableDTO) => {
    e.stopPropagation();
    if (e.button !== 0) return; // Only primary click
    setDraggingTableId(table.id);
    onSelectTable(table.id);

    if (canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      setDragOffset({
        x: mouseX - table.x,
        y: mouseY - table.y,
      });
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (!draggingTableId || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const newX = Math.max(0, Math.min(rect.width - 120, e.clientX - rect.left - dragOffset.x));
    const newY = Math.max(0, Math.min(rect.height - 120, e.clientY - rect.top - dragOffset.y));
    onUpdateTablePosition(draggingTableId, Math.round(newX), Math.round(newY));
  };

  const handleCanvasMouseUp = () => {
    setDraggingTableId(null);
  };

  // HTML5 Drag and Drop for Guest Cards onto Table
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDropOnTable = (e: React.DragEvent, tableId: string, seatNumber?: number) => {
    e.preventDefault();
    e.stopPropagation();
    const guestId = e.dataTransfer.getData('text/plain');
    if (guestId) {
      onDropGuestOnTable(guestId, tableId, seatNumber);
    }
  };

  // Helper to render seat positions around table
  const renderSeats = (table: SeatingTableDTO) => {
    const seats = [];
    const capacity = table.capacity;
    const assignedGuests = table.invitationCodes || [];
    const isRound = table.shape === 'round';
    const width = table.width || 120;
    const height = table.height || 120;
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) / 2 + 18;

    for (let i = 1; i <= capacity; i++) {
      const assignedGuest = assignedGuests.find((g) => g.seatNumber === i) || assignedGuests[i - 1];

      let seatX = 0;
      let seatY = 0;

      if (isRound) {
        const angle = (i * 2 * Math.PI) / capacity - Math.PI / 2;
        seatX = cx + radius * Math.cos(angle);
        seatY = cy + radius * Math.sin(angle);
      } else {
        // Rectangular perimeter calculation
        const perimeterIndex = i - 1;
        const side = Math.floor((perimeterIndex / capacity) * 4);
        if (side === 0) {
          // Top
          seatX = (width / (capacity / 2 + 1)) * (perimeterIndex + 1);
          seatY = -16;
        } else if (side === 1) {
          // Right
          seatX = width + 16;
          seatY = (height / (capacity / 2 + 1)) * (perimeterIndex % (capacity / 2) + 1);
        } else if (side === 2) {
          // Bottom
          seatX = width - (width / (capacity / 2 + 1)) * ((perimeterIndex % (capacity / 2)) + 1);
          seatY = height + 16;
        } else {
          // Left
          seatX = -16;
          seatY = height - (height / (capacity / 2 + 1)) * ((perimeterIndex % (capacity / 2)) + 1);
        }
      }

      seats.push(
        <div
          key={i}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDropOnTable(e, table.id, i)}
          onDoubleClick={() => assignedGuest && onUnassignGuest(assignedGuest.id)}
          title={assignedGuest ? `Seat ${i}: ${assignedGuest.guestName} (Double click to unassign)` : `Seat ${i}: Empty (Drop guest here)`}
          className={`absolute transform -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full border text-xs font-semibold flex items-center justify-center transition-all ${
            assignedGuest
              ? 'shadow-sm hover:scale-110'
              : 'hover:border-primary hover:bg-[var(--floorplan-seat-unassigned-hover,#fef2f2)]'
          }`}
          style={
            assignedGuest
              ? {
                left: `${seatX}px`,
                top: `${seatY}px`,
                backgroundColor: 'var(--floorplan-seat-assigned-bg, var(--color-primary, #B91C1C))',
                color: 'var(--floorplan-seat-assigned-text, #ffffff)',
                borderColor: 'var(--floorplan-seat-assigned-bg, var(--color-primary, #B91C1C))',
              }
              : {
                left: `${seatX}px`,
                top: `${seatY}px`,
                backgroundColor: 'var(--floorplan-table-bg, #ffffff)',
                color: 'color-mix(in srgb, var(--color-foreground, #1f2937) 75%, transparent)',
                borderColor: 'var(--floorplan-table-border, #9ca3af)',
                borderStyle: 'dashed',
              }
          }
        >
          {assignedGuest ? (
            <span className="truncate px-0.5 text-[10px]" aria-label={`Seat ${i} ${assignedGuest.guestName}`}>
              {assignedGuest.guestName.split(' ')[0][0]}
              {assignedGuest.guestName.split(' ')[1]?.[0] || ''}
            </span>
          ) : (
            <span>{i}</span>
          )}
        </div>
      );
    }
    return seats;
  };

  return (
    <div
      ref={canvasRef}
      onMouseMove={handleCanvasMouseMove}
      onMouseUp={handleCanvasMouseUp}
      onClick={() => onSelectTable(null)}
      className="relative w-full h-[650px] rounded-xl overflow-hidden shadow-inner select-none print:border-none print:bg-[var(--print-bg)]"
      style={{
        backgroundColor: 'var(--canvas-bg, #f8fafc)',
        border: 'var(--canvas-border, 2px dashed #cbd5e1)',
        backgroundImage: 'radial-gradient(circle, var(--canvas-grid-dot, #cbd5e1) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }}
      aria-label="Interactive 2D Reception Floorplan Canvas"
      role="region"
    >
      {/* Canvas Header Banner */}
      <div
        className="absolute top-3 left-3 backdrop-blur border px-3 py-1.5 font-medium shadow-sm z-10 flex items-center gap-2 text-xs"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--floorplan-table-bg, #ffffff) 90%, transparent)',
          borderColor: 'var(--floorplan-table-border, #e5e7eb)',
          borderRadius: 'var(--floorplan-table-radius, 0.5rem)',
          color: 'var(--color-foreground, #374151)',
        }}
      >
        <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
        Drag tables to arrange floorplan. Drag guests onto table seats to assign.
      </div>

      {tables.map((table) => {
        const assignedCount = table.invitationCodes?.length || 0;
        const isSelected = selectedTableId === table.id;
        const isOverCapacity = assignedCount > table.capacity;

        return (
          <div
            key={table.id}
            onMouseDown={(e) => handleTableMouseDown(e, table)}
            onClick={(e) => {
              e.stopPropagation();
              onSelectTable(table.id);
            }}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDropOnTable(e, table.id)}
            className={`absolute cursor-move transition-all transform hover:scale-[1.02] ${
              isSelected ? 'ring-4 ring-primary ring-offset-2 z-20' : 'z-10'
            }`}
            style={{
              left: `${table.x}px`,
              top: `${table.y}px`,
              width: `${table.width || 120}px`,
              height: `${table.height || 120}px`,
              transform: `rotate(${table.rotation || 0}deg)`,
            }}
            tabIndex={0}
            role="button"
            aria-label={`${table.name}, shape ${table.shape}, capacity ${table.capacity}, seated ${assignedCount}`}
          >
            {/* Table Surface */}
            <div
              className={`w-full h-full border-2 flex flex-col items-center justify-center p-2 text-center shadow-md relative transition-colors ${
                table.shape === 'round' ? 'rounded-full' : ''
              }`}
              style={{
                backgroundColor: isOverCapacity
                  ? 'var(--floorplan-status-overcapacity-bg, #fef2f2)'
                  : 'var(--floorplan-table-bg, #ffffff)',
                borderColor: isOverCapacity
                  ? 'var(--floorplan-status-overcapacity-border, #ef4444)'
                  : 'var(--floorplan-table-border, #d1d5db)',
                borderRadius: table.shape === 'round'
                  ? '9999px'
                  : 'var(--floorplan-table-radius, 0.75rem)',
                color: isOverCapacity
                  ? 'var(--floorplan-status-overcapacity-border, #991b1b)'
                  : 'var(--color-foreground, #1f2937)',
              }}
            >
              <span className="font-bold text-xs truncate max-w-[90%]">{table.name}</span>
              <span
                className="text-[10px] font-medium"
                style={{
                  color: isOverCapacity
                    ? 'var(--floorplan-status-overcapacity-border, #991b1b)'
                    : 'color-mix(in srgb, var(--color-foreground, #1f2937) 65%, transparent)',
                }}
              >
                {assignedCount} / {table.capacity} seats
              </span>

              {/* Over capacity warning badge */}
              {isOverCapacity && (
                <span
                  className="absolute -top-2 -right-2 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-md animate-bounce"
                  style={{
                    backgroundColor: 'var(--floorplan-status-overcapacity-border, #dc2626)',
                  }}
                >
                  Over capacity!
                </span>
              )}
            </div>

            {/* Individual Seat Circles around table */}
            {renderSeats(table)}
          </div>
        );
      })}
    </div>
  );
}
