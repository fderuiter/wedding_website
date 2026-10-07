'use client';

import React, { useState, useEffect } from 'react';
import { SeatingTableDTO } from '../schemas';

interface TableModalProps {
  isOpen: boolean;
  table: SeatingTableDTO | null;
  onClose: () => void;
  onSave: (tableData: Partial<SeatingTableDTO>) => void;
  onDelete?: (tableId: string) => void;
}

export function TableModal({
  isOpen,
  table,
  onClose,
  onSave,
  onDelete,
}: TableModalProps) {
  const [name, setName] = useState('');
  const [shape, setShape] = useState<'round' | 'rectangular' | 'square'>('round');
  const [capacity, setCapacity] = useState(8);
  const [width, setWidth] = useState(120);
  const [height, setHeight] = useState(120);
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    if (table) {
      setName(table.name);
      setShape(table.shape as any);
      setCapacity(table.capacity);
      setWidth(table.width || 120);
      setHeight(table.height || 120);
      setRotation(table.rotation || 0);
    } else {
      setName('');
      setShape('round');
      setCapacity(8);
      setWidth(120);
      setHeight(120);
      setRotation(0);
    }
  }, [table, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    onSave({
      ...(table ? { id: table.id } : {}),
      name: name.trim(),
      shape,
      capacity,
      width,
      height,
      rotation,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-md w-full shadow-2xl border border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">
          {table ? 'Edit Reception Table' : 'Create New Table'}
        </h2>

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
              onChange={(e) => setName(e.target.value)}
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
                onChange={(e) => setShape(e.target.value as any)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
              >
                <option value="round">Round</option>
                <option value="rectangular">Rectangular</option>
                <option value="square">Square</option>
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
                onChange={(e) => setCapacity(parseInt(e.target.value) || 1)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
              />
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
                onChange={(e) => setWidth(parseInt(e.target.value) || 120)}
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
                onChange={(e) => setHeight(parseInt(e.target.value) || 120)}
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
                onChange={(e) => setRotation(parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
            {table && onDelete ? (
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Are you sure you want to delete "${table.name}"? Assigned guests will become unassigned.`)) {
                    onDelete(table.id);
                    onClose();
                  }
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
                onClick={onClose}
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
      </div>
    </div>
  );
}
