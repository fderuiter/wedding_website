'use client';

import React, { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';
import { useToast } from '@/components/ui/ToastProvider';
import { RegistryPreviewTable, PreviewRegistryItem } from './RegistryPreviewTable';
import {
  parseRegistryCsv,
  generateRegistryCsvTemplate,
  MAX_REGISTRY_CSV_FILE_SIZE,
} from '../utils/csv';

export interface CsvRegistryImportProps {
  onSuccess?: () => void;
}

export const CsvRegistryImport: React.FC<CsvRegistryImportProps> = ({ onSuccess }) => {
  const router = useRouter();
  const { addToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [items, setItems] = useState<PreviewRegistryItem[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const processFile = (file: File) => {
    setErrorMessage(null);

    // Validate 5MB file size limit
    if (file.size > MAX_REGISTRY_CSV_FILE_SIZE) {
      setErrorMessage(
        `Uploaded CSV files must not exceed 5 megabytes in file size (Selected file is ${(
          file.size /
          (1024 * 1024)
        ).toFixed(2)} MB).`
      );
      return;
    }

    if (!file.name.toLowerCase().endsWith('.csv') && file.type !== 'text/csv') {
      setErrorMessage('Please upload a valid CSV (.csv) file.');
      return;
    }

    setFileName(file.name);
    setFileSize(file.size);
    setIsParsing(true);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const result = parseRegistryCsv(text);

        if (result.totalRows === 0) {
          setErrorMessage('The uploaded CSV file does not contain any data rows.');
          setItems([]);
        } else {
          setItems(result.rows);
          if (result.errorCount > 0) {
            addToast(
              `Parsed ${result.totalRows} items. ${result.errorCount} row(s) require attention before import.`,
              'info'
            );
          } else {
            addToast(`Successfully parsed all ${result.totalRows} items from CSV!`, 'success');
          }
        }
      } catch (err: any) {
        setErrorMessage(err?.message || 'Failed to parse CSV file.');
      } finally {
        setIsParsing(false);
      }
    };

    reader.onerror = () => {
      setErrorMessage('An error occurred while reading the file.');
      setIsParsing(false);
    };

    reader.readAsText(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleDownloadTemplate = () => {
    const templateContent = generateRegistryCsvTemplate();
    const blob = new Blob([templateContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'Registry_Import_Template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleUpdateItem = (id: string, updated: Partial<PreviewRegistryItem>) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updated } : item))
    );
  };

  const handleRemoveItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleRemoveInvalid = () => {
    setItems((prev) => prev.filter((item) => item.isValid));
  };

  const handleImport = async () => {
    const validItems = items.filter((it) => it.isValid);
    if (validItems.length === 0) {
      addToast('No valid items to import.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        items: validItems.map((it) => ({
          name: it.name,
          price: it.price || 0,
          quantity: it.quantity || 1,
          category: it.category || 'Uncategorized',
          description: it.description || '',
          vendorUrl: it.vendorUrl || undefined,
          imageUrl: it.imageUrl || '/images/placeholder.png',
          imageAlt: it.imageAlt || undefined,
          isGroupGift: it.isGroupGift,
          isMostWanted: it.isMostWanted,
        })),
      };

      await apiClient.post('/api/registry/items/batch', payload);

      addToast(`Successfully imported ${validItems.length} items to your registry!`, 'success');
      if (onSuccess) {
        onSuccess();
      } else {
        router.push('/admin/dashboard');
      }
    } catch (err: any) {
      addToast(`Failed to import items: ${err?.message || 'Unknown error'}`, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="csv-registry-import">
      {/* Upload Zone */}
      <div className="bg-white dark:bg-stone-900 p-6 rounded-lg border border-stone-200 dark:border-stone-700 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">
              Import Registry CSV File
            </h2>
            <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
              Upload a spreadsheet export from Zola, Joy, Amazon, Target, or a custom CSV (Max 5MB, up to 50 items simultaneously).
            </p>
          </div>

          <button
            type="button"
            onClick={handleDownloadTemplate}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-md hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors shrink-0"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download Sample CSV Template
          </button>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
            isDragOver
              ? 'border-amber-500 bg-amber-50/50 dark:bg-amber-950/20'
              : 'border-stone-300 dark:border-stone-700 hover:border-amber-400 hover:bg-stone-50 dark:hover:bg-stone-800/50'
          }`}
          role="button"
          tabIndex={0}
          aria-label="Upload CSV file drop zone"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            className="hidden"
            aria-hidden="true"
          />

          <svg
            className="w-10 h-10 text-stone-400 dark:text-stone-500 mb-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
              d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>

          {isParsing ? (
            <p className="text-sm font-medium text-amber-600 dark:text-amber-400 animate-pulse">
              Parsing CSV file...
            </p>
          ) : fileName ? (
            <div className="text-center">
              <p className="text-sm font-semibold text-stone-800 dark:text-stone-200">{fileName}</p>
              {fileSize && (
                <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                  {(fileSize / 1024).toFixed(1)} KB • Click or drag to replace file
                </p>
              )}
            </div>
          ) : (
            <div className="text-center">
              <p className="text-sm font-medium text-stone-700 dark:text-stone-300">
                <span className="text-amber-600 dark:text-amber-400 font-semibold underline">Click to upload</span> or drag and drop your CSV file here
              </p>
              <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
                Supports columns: Name, Price, Category, Quantity, Description, Vendor URL, Image URL
              </p>
            </div>
          )}
        </div>

        {errorMessage && (
          <div className="p-3 text-xs rounded bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300">
            {errorMessage}
          </div>
        )}
      </div>

      {/* Interactive Preview Table */}
      {items.length > 0 && (
        <RegistryPreviewTable
          items={items}
          onUpdateItem={handleUpdateItem}
          onRemoveItem={handleRemoveItem}
          onRemoveInvalid={handleRemoveInvalid}
          onImport={handleImport}
          isSubmitting={isSubmitting}
          submitLabel="Save Confirmed Items"
        />
      )}
    </div>
  );
};
