'use client';

import React, { useState } from 'react';
import { AccessibleExternalLink } from '@/components/ui/AccessibleExternalLink';
import { Button } from '@/components/ui/Button';
import { validateRegistryItemRow, parseRegistryPrice } from '../utils/csv';
import { withBasePath } from '@/lib/basePath';

export interface PreviewRegistryItem {
  id: string;
  name: string;
  price: number | undefined;
  category: string;
  description: string;
  vendorUrl: string;
  imageUrl: string;
  imageAlt?: string;
  quantity: number;
  isGroupGift: boolean;
  isMostWanted: boolean;
  paymentHandleType?: string;
  paymentHandle?: string;
  isValid: boolean;
  errors: string[];
}

interface RegistryPreviewTableProps {
  items: PreviewRegistryItem[];
  onUpdateItem: (id: string, updated: Partial<PreviewRegistryItem>) => void;
  onRemoveItem: (id: string) => void;
  onRemoveInvalid?: () => void;
  onImport: () => void;
  isSubmitting: boolean;
  submitLabel?: string;
}

export const RegistryPreviewTable: React.FC<RegistryPreviewTableProps> = ({
  items,
  onUpdateItem,
  onRemoveItem,
  onRemoveInvalid,
  onImport,
  isSubmitting,
  submitLabel = 'Import Valid Items',
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);

  const validCount = items.filter((item) => item.isValid).length;
  const invalidCount = items.length - validCount;

  const handleFieldChange = (
    id: string,
    field: keyof PreviewRegistryItem,
    rawVal: any
  ) => {
    const current = items.find((it) => it.id === id);
    if (!current) return;

    let updatedValue = rawVal;
    if (field === 'price') {
      updatedValue = parseRegistryPrice(rawVal);
    } else if (field === 'quantity') {
      const parsedQty = parseInt(rawVal, 10);
      updatedValue = isNaN(parsedQty) || parsedQty <= 0 ? 1 : parsedQty;
    }

    const merged = { ...current, [field]: updatedValue };
    const validation = validateRegistryItemRow(merged);

    onUpdateItem(id, {
      [field]: updatedValue,
      isValid: validation.isValid,
      errors: validation.errors,
    });
  };

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="w-full space-y-4" data-testid="registry-preview-table-container">
      {/* Header action bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 bg-stone-50 dark:bg-stone-800 rounded-lg border border-stone-200 dark:border-stone-700">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">
            Preview Items ({items.length})
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
            {validCount} Ready to Import
          </span>
          {invalidCount > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300">
              {invalidCount} Needs Attention
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          {invalidCount > 0 && onRemoveInvalid && (
            <button
              type="button"
              onClick={onRemoveInvalid}
              disabled={isSubmitting}
              className="px-3 py-1.5 text-xs font-medium text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-rose-300 dark:border-rose-800 rounded-md transition-colors"
            >
              Remove Invalid Items ({invalidCount})
            </button>
          )}

          <Button
            type="button"
            variant="secondary"
            onClick={onImport}
            disabled={validCount === 0 || isSubmitting}
            className="flex-1 sm:flex-initial shadow-sm"
          >
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <svg
                  aria-hidden="true"
                  className="animate-spin h-4 w-4 text-current"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Saving to Registry...
              </span>
            ) : (
              `${submitLabel} (${validCount})`
            )}
          </Button>
        </div>
      </div>

      {/* Table view */}
      <div className="overflow-x-auto rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900">
        <table className="min-w-full divide-y divide-stone-200 dark:divide-stone-700 text-left text-sm" role="table">
          <thead className="bg-stone-50 dark:bg-stone-800/80 text-xs font-semibold text-stone-600 dark:text-stone-300 uppercase tracking-wider">
            <tr>
              <th scope="col" className="px-3 py-3 w-16">Item</th>
              <th scope="col" className="px-4 py-3">Details</th>
              <th scope="col" className="px-3 py-3 w-28">Price</th>
              <th scope="col" className="px-3 py-3 w-36">Category</th>
              <th scope="col" className="px-3 py-3 w-20">Qty</th>
              <th scope="col" className="px-4 py-3 w-40">Status</th>
              <th scope="col" className="px-3 py-3 w-28 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200 dark:divide-stone-800">
            {items.map((item) => {
              const isEditing = editingId === item.id;

              return (
                <tr
                  key={item.id}
                  className={`hover:bg-stone-50/70 dark:hover:bg-stone-800/40 transition-colors ${
                    !item.isValid ? 'bg-rose-50/30 dark:bg-rose-950/10' : ''
                  }`}
                  data-testid={`preview-row-${item.id}`}
                >
                  {/* Thumbnail */}
                  <td className="px-3 py-3 align-top">
                    <div className="h-12 w-12 rounded border border-stone-200 dark:border-stone-700 overflow-hidden bg-stone-100 dark:bg-stone-800 flex items-center justify-center">
                      {item.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={withBasePath(item.imageUrl)}
                          alt={item.imageAlt || item.name || 'Product preview'}
                          className="h-full w-full object-cover"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).src = withBasePath('/images/placeholder.png');
                          }}
                        />
                      ) : (
                        <span className="text-xs text-muted-text">No img</span>
                      )}
                    </div>
                  </td>

                  {/* Details (Name, Vendor Link, Description) */}
                  <td className="px-4 py-3 align-top space-y-1">
                    {isEditing ? (
                      <div className="space-y-2">
                        <div>
                          <label className="block text-xs font-medium text-stone-600 dark:text-stone-300">
                            Name *
                          </label>
                          <input
                            type="text"
                            value={item.name}
                            onChange={(e) => handleFieldChange(item.id, 'name', e.target.value)}
                            placeholder="Product name"
                            className="mt-0.5 w-full rounded border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800 px-2.5 py-1 text-sm text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
                            aria-label={`Edit name for ${item.name || 'item'}`}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-stone-600 dark:text-stone-300">
                            Vendor URL
                          </label>
                          <input
                            type="text"
                            value={item.vendorUrl}
                            onChange={(e) => handleFieldChange(item.id, 'vendorUrl', e.target.value)}
                            placeholder="https://retailer.com/product"
                            className="mt-0.5 w-full rounded border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800 px-2.5 py-1 text-xs text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
                            aria-label="Edit vendor URL"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-stone-600 dark:text-stone-300">
                            Description
                          </label>
                          <textarea
                            value={item.description}
                            onChange={(e) => handleFieldChange(item.id, 'description', e.target.value)}
                            rows={2}
                            placeholder="Item description or notes..."
                            className="mt-0.5 w-full rounded border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800 px-2.5 py-1 text-xs text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
                            aria-label="Edit description"
                          />
                        </div>
                        <div className="flex items-center gap-4 text-xs">
                          <label className="inline-flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={item.isGroupGift}
                              onChange={(e) => handleFieldChange(item.id, 'isGroupGift', e.target.checked)}
                              className="rounded border-stone-300 text-amber-600 focus:ring-amber-500"
                            />
                            Allow Group Gifting
                          </label>
                          <label className="inline-flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={item.isMostWanted}
                              onChange={(e) => handleFieldChange(item.id, 'isMostWanted', e.target.checked)}
                              className="rounded border-stone-300 text-amber-600 focus:ring-amber-500"
                            />
                            Most Wanted
                          </label>
                        </div>
                        {item.isGroupGift && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                            <div>
                              <label className="block text-xs font-medium text-stone-600 dark:text-stone-300">
                                Payment Service
                              </label>
                              <select
                                value={item.paymentHandleType || ''}
                                onChange={(e) =>
                                  handleFieldChange(item.id, 'paymentHandleType', e.target.value)
                                }
                                className="mt-0.5 w-full rounded border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800 px-2 py-1 text-xs text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
                                aria-label="Edit payment service"
                              >
                                <option value="">Default / None</option>
                                <option value="Venmo">Venmo</option>
                                <option value="PayPal">PayPal</option>
                                <option value="Cash App">Cash App</option>
                                <option value="Zelle">Zelle</option>
                                <option value="Custom">Custom / Other</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-stone-600 dark:text-stone-300">
                                Payment Handle
                              </label>
                              <input
                                type="text"
                                value={item.paymentHandle || ''}
                                onChange={(e) =>
                                  handleFieldChange(item.id, 'paymentHandle', e.target.value)
                                }
                                placeholder="@couple-handle"
                                className="mt-0.5 w-full rounded border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800 px-2.5 py-1 text-xs text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
                                aria-label="Edit payment handle"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="font-medium text-stone-900 dark:text-stone-100">
                          {item.name || <span className="text-rose-500 italic">No name provided</span>}
                        </div>
                        {item.description && (
                          <div className="text-xs text-stone-500 dark:text-stone-400 line-clamp-2">
                            {item.description}
                          </div>
                        )}
                        {item.vendorUrl && (
                          <div>
                            <AccessibleExternalLink
                              href={item.vendorUrl}
                              className="text-xs text-secondary-text underline hover:decoration-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring,var(--color-secondary,#B45309))] focus-visible:ring-offset-1 focus-visible:forced-colors:outline focus-visible:forced-colors:outline-2 rounded-xs truncate max-w-xs inline-block"
                            >
                              {item.vendorUrl}
                            </AccessibleExternalLink>
                          </div>
                        )}
                        <div className="flex items-center gap-2 pt-0.5">
                          {item.isGroupGift && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
                              Group Gift
                            </span>
                          )}
                          {item.isGroupGift && item.paymentHandle && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300">
                              {item.paymentHandleType ? `${item.paymentHandleType}: ` : ''}
                              {item.paymentHandle}
                            </span>
                          )}
                          {item.isMostWanted && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                              ★ Most Wanted
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </td>

                  {/* Price */}
                  <td className="px-3 py-3 align-top whitespace-nowrap">
                    {isEditing ? (
                      <div className="relative">
                        <span className="absolute inset-y-0 left-0 pl-2 flex items-center text-xs text-muted-text pointer-events-none">
                          $
                        </span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={item.price !== undefined ? item.price : ''}
                          onChange={(e) => handleFieldChange(item.id, 'price', e.target.value)}
                          placeholder="0.00"
                          className="w-24 pl-5 pr-2 py-1 text-sm rounded border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
                          aria-label="Edit price"
                        />
                      </div>
                    ) : (
                      <span className="font-semibold text-stone-900 dark:text-stone-100">
                        {item.price !== undefined ? `$${item.price.toFixed(2)}` : (
                          <span className="text-rose-500 italic text-xs">Missing price</span>
                        )}
                      </span>
                    )}
                  </td>

                  {/* Category */}
                  <td className="px-3 py-3 align-top">
                    {isEditing ? (
                      <input
                        type="text"
                        value={item.category}
                        onChange={(e) => handleFieldChange(item.id, 'category', e.target.value)}
                        placeholder="Category"
                        className="w-32 px-2 py-1 text-xs rounded border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
                        aria-label="Edit category"
                      />
                    ) : (
                      <span className="inline-block px-2 py-0.5 rounded text-xs bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300">
                        {item.category || 'Uncategorized'}
                      </span>
                    )}
                  </td>

                  {/* Quantity */}
                  <td className="px-3 py-3 align-top whitespace-nowrap">
                    {isEditing ? (
                      <input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) => handleFieldChange(item.id, 'quantity', e.target.value)}
                        className="w-16 px-2 py-1 text-xs rounded border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
                        aria-label="Edit quantity"
                      />
                    ) : (
                      <span className="text-stone-700 dark:text-stone-300 font-medium">
                        {item.quantity || 1}
                      </span>
                    )}
                  </td>

                  {/* Status / Errors */}
                  <td className="px-4 py-3 align-top">
                    {item.isValid ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                        </svg>
                        Valid
                      </span>
                    ) : (
                      <div className="space-y-1">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                          Invalid
                        </span>
                        <ul className="text-[11px] text-rose-600 dark:text-rose-400 list-disc list-inside space-y-0.5">
                          {item.errors.map((err, errIdx) => (
                            <li key={errIdx}>{err}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="px-3 py-3 align-top text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingId(isEditing ? null : item.id)}
                        className="text-xs font-medium text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100 px-2 py-1 rounded hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
                        aria-label={isEditing ? `Done editing ${item.name}` : `Edit ${item.name}`}
                      >
                        {isEditing ? 'Done' : 'Edit'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveItem(item.id)}
                        className="text-xs font-medium text-rose-600 hover:text-rose-800 dark:text-rose-400 dark:hover:text-rose-300 px-2 py-1 rounded hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                        aria-label={`Remove ${item.name || 'item'}`}
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
