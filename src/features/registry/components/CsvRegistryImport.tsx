'use client';

import React, { useState } from 'react';
import Dropzone from '@/components/Dropzone';
import { useToast } from '@/components/ui/ToastProvider';
import { useFormPersist } from '@/hooks/useFormPersist';
import { RegistryPreviewTable, PreviewRegistryItem } from './RegistryPreviewTable';
import { useRegistryPreviewImport } from '../hooks/useRegistryPreviewImport';
import {
  parseRegistryCsv,
  generateRegistryCsvTemplate,
  MAX_REGISTRY_CSV_FILE_SIZE,
} from '../utils/csv';

export interface CsvRegistryImportProps {
  onSuccess?: () => void;
}

interface CsvRegistryImportDraft {
  fileName: string | null;
  fileSize: number | null;
  items: PreviewRegistryItem[];
}

const INITIAL_CSV_DRAFT: CsvRegistryImportDraft = {
  fileName: null,
  fileSize: null,
  items: [],
};

export const CsvRegistryImport: React.FC<CsvRegistryImportProps> = ({ onSuccess }) => {
  const { addToast } = useToast();

  const [draft, setDraft, clearPersistedState] = useFormPersist<CsvRegistryImportDraft>(
    'registry_csv_import_draft',
    INITIAL_CSV_DRAFT
  );
  const { fileName, fileSize, items } = draft;
  const [isParsing, setIsParsing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const setFileName = (nextFileName: string | null) => {
    setDraft((prev) => ({ ...prev, fileName: nextFileName }));
  };

  const setFileSize = (nextFileSize: number | null) => {
    setDraft((prev) => ({ ...prev, fileSize: nextFileSize }));
  };

  const resetPersistedDraft = () => {
    setDraft(INITIAL_CSV_DRAFT);
    clearPersistedState();
  };

  const {
    isSubmitting,
    setItems,
    handleUpdateItem,
    handleRemoveItem,
    handleRemoveInvalid,
    handleImport,
  } = useRegistryPreviewImport({
    items,
    setDraft,
    onResetDraft: resetPersistedDraft,
    onSuccess,
    includePaymentHandles: true,
    formatSuccessToast: (validCount) =>
      `Successfully imported ${validCount} items to your registry!`,
  });

  const hasDraft = Boolean(fileName) || items.length > 0;

  const handleResetDraft = () => {
    setErrorMessage(null);
    resetPersistedDraft();
  };

  const validateCsvFile = (file: File): string | null => {
    if (file.size > MAX_REGISTRY_CSV_FILE_SIZE) {
      return `Uploaded CSV files must not exceed 5 megabytes in file size (Selected file is ${(
        file.size /
        (1024 * 1024)
      ).toFixed(2)} MB).`;
    }

    if (!file.name.toLowerCase().endsWith('.csv') && file.type !== 'text/csv') {
      return 'Please upload a valid CSV (.csv) file.';
    }

    return null;
  };

  const processFile = (file: File) => {
    setErrorMessage(null);
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

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {hasDraft && (
              <button
                type="button"
                onClick={handleResetDraft}
                disabled={isParsing || isSubmitting}
                className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-stone-700 dark:text-stone-200 bg-white dark:bg-stone-800 border border-stone-300 dark:border-stone-600 rounded-md hover:bg-stone-50 dark:hover:bg-stone-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Reset Draft
              </button>
            )}
            <button
              type="button"
              onClick={handleDownloadTemplate}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-md hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors shrink-0"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download Sample CSV Template
            </button>
          </div>
        </div>

        {/* Shared Dropzone */}
        <Dropzone
          uploadUrl={null}
          maxSize={MAX_REGISTRY_CSV_FILE_SIZE}
          acceptTypes={['text/csv']}
          allowedExtensions={['.csv']}
          validate={validateCsvFile}
          onFileSelect={processFile}
          onUploadError={setErrorMessage}
          busy={isParsing}
          busyLabel="Parsing CSV file..."
          error={errorMessage}
          disabled={isSubmitting}
          label={
            fileName ? (
              <span className="font-semibold text-stone-800 dark:text-stone-200">{fileName}</span>
            ) : (
              <>
                <span className="text-amber-600 dark:text-amber-400 font-semibold underline">
                  Click to upload
                </span>{' '}
                or drag and drop your CSV file here
              </>
            )
          }
          hint={
            fileName
              ? fileSize
                ? `${(fileSize / 1024).toFixed(1)} KB • Click or drag to replace file`
                : 'Click or drag to replace file'
              : 'Supports columns: Name, Price, Category, Quantity, Description, Vendor URL, Image URL, Payment Service, Payment Handle'
          }
        />
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
