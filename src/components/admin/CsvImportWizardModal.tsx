'use client';

import React, { useState, useMemo } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { FormGroup, Label } from '@/components/ui/forms';
import { useToast } from '@/components/ui/ToastProvider';
import {
  parseCsvContent,
  validateCsvRows,
  MAX_CSV_FILE_SIZE,
  ParsedCsvRow,
} from '@/utils/csv';

interface CsvImportWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: () => void;
  existingCodes?: string[];
}

export function CsvImportWizardModal({
  isOpen,
  onClose,
  onImportComplete,
  existingCodes = [],
}: CsvImportWizardModalProps) {
  const { addToast } = useToast();

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [fileName, setFileName] = useState<string>('');
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [guestNameCol, setGuestNameCol] = useState<string>('');
  const [codeCol, setCodeCol] = useState<string>('');
  const [collisionStrategy, setCollisionStrategy] = useState<'skip' | 'update' | 'reject'>('skip');

  // Editable row states for Step 3
  const [editableRows, setEditableRows] = useState<Array<{ guestName: string; code: string }>>([]);

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [importSummary, setImportSummary] = useState<{
    total: number;
    imported: number;
    skipped: number;
    updated: number;
  } | null>(null);

  const existingDbSet = useMemo(() => new Set(existingCodes.map(c => c.toUpperCase())), [existingCodes]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_CSV_FILE_SIZE) {
      addToast('File size exceeds 5 MB limit. Please select a smaller file.', 'error');
      return;
    }

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      if (!text) {
        addToast('Selected file is empty.', 'error');
        return;
      }

      const parsed = parseCsvContent(text);
      if (parsed.headers.length === 0 || parsed.rows.length === 0) {
        addToast('No valid CSV rows or headers found in file.', 'error');
        return;
      }

      setCsvHeaders(parsed.headers);
      setRawRows(parsed.rows);
      setGuestNameCol(parsed.suggestedGuestNameCol);
      setCodeCol(parsed.suggestedCodeCol);
      setStep(2);
    };

    reader.readAsText(file, 'UTF-8');
  };

  const handleConfirmMapping = () => {
    if (!guestNameCol) {
      addToast('Please select a column for Guest Name.', 'error');
      return;
    }

    const initialMapped = rawRows.map((r) => ({
      guestName: (r[guestNameCol] || '').trim(),
      code: codeCol ? (r[codeCol] || '').trim().toUpperCase() : '',
    }));

    setEditableRows(initialMapped);
    setStep(3);
  };

  // Dry-run validation of editable rows
  const validatedRows: ParsedCsvRow[] = useMemo(() => {
    const recordsMap = editableRows.map((r) => ({
      GuestNameField: r.guestName,
      CodeField: r.code,
    }));
    return validateCsvRows(recordsMap, 'GuestNameField', 'CodeField', existingDbSet);
  }, [editableRows, existingDbSet]);

  const validCount = useMemo(() => validatedRows.filter((r) => r.isValid).length, [validatedRows]);
  const invalidCount = useMemo(() => validatedRows.filter((r) => !r.isValid).length, [validatedRows]);

  const handleCellEdit = (index: number, field: 'guestName' | 'code', value: string) => {
    setEditableRows((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        [field]: field === 'code' ? value.toUpperCase() : value,
      };
      return next;
    });
  };

  const handleDeleteRow = (index: number) => {
    setEditableRows((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCommitBatch = async () => {
    if (editableRows.length === 0) {
      addToast('No records to import.', 'error');
      return;
    }

    if (invalidCount > 0) {
      addToast('Please fix or remove invalid rows before submitting.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        records: editableRows.map((r) => ({
          guestName: r.guestName,
          code: r.code || undefined,
        })),
        collisionStrategy,
      };

      const res = await fetch('/api/admin/invitation-codes/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Batch import failed.');
      }

      setImportSummary({
        total: data.count || editableRows.length,
        imported: data.imported || 0,
        skipped: data.skipped || 0,
        updated: data.updated || 0,
      });
      setStep(4);
      addToast('Batch CSV import completed successfully.', 'success');
      onImportComplete();
    } catch (err: any) {
      addToast(err.message || 'Failed to execute batch import.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetModal = () => {
    setStep(1);
    setFileName('');
    setCsvHeaders([]);
    setRawRows([]);
    setGuestNameCol('');
    setCodeCol('');
    setEditableRows([]);
    setImportSummary(null);
    onClose();
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleResetModal}
      title={
        <div className="flex items-center justify-between">
          <span className="font-extrabold text-xl text-primary">Import Guest Invitation Codes</span>
          <span className="text-xs font-semibold px-2.5 py-1 bg-gray-100 dark:bg-zinc-800 rounded-full text-gray-600 dark:text-zinc-300">
            Step {step} of 4
          </span>
        </div>
      }
      className="max-w-3xl"
    >
      <div className="space-y-6">
        {/* Step Indicator */}
        <div className="flex justify-between items-center text-xs font-semibold border-b pb-3 text-gray-500 border-gray-200 dark:border-zinc-800">
          <span className={step >= 1 ? 'text-primary font-bold' : ''}>1. Upload File</span>
          <span>&rarr;</span>
          <span className={step >= 2 ? 'text-primary font-bold' : ''}>2. Map Columns</span>
          <span>&rarr;</span>
          <span className={step >= 3 ? 'text-primary font-bold' : ''}>3. Review & Validate</span>
          <span>&rarr;</span>
          <span className={step === 4 ? 'text-primary font-bold' : ''}>4. Complete</span>
        </div>

        {/* Step 1: File Upload */}
        {step === 1 && (
          <div className="space-y-4 py-2">
            <p className="text-sm text-gray-600 dark:text-zinc-300">
              Select a UTF-8 encoded <code>.csv</code> spreadsheet containing guest names and optional pre-assigned invitation codes (max 5 MB).
            </p>
            <div className="border-2 border-dashed border-gray-300 dark:border-zinc-700 rounded-xl p-8 text-center bg-gray-50 dark:bg-zinc-800/50 hover:bg-gray-100 dark:hover:bg-zinc-800 transition">
              <input
                type="file"
                accept=".csv,text/csv"
                id="csv-file-input"
                onChange={handleFileUpload}
                className="hidden"
              />
              <label
                htmlFor="csv-file-input"
                className="cursor-pointer flex flex-col items-center justify-center space-y-2"
              >
                <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center text-primary text-xl font-bold">
                  📄
                </div>
                <span className="font-semibold text-primary">Click to select CSV file</span>
                <span className="text-xs text-gray-500 dark:text-zinc-400">or drag and drop spreadsheet here</span>
              </label>
            </div>
          </div>
        )}

        {/* Step 2: Column Remapping */}
        {step === 2 && (
          <div className="space-y-4 py-2">
            <p className="text-sm text-gray-600 dark:text-zinc-300">
              Auto-detected column headers from <strong>{fileName}</strong> ({rawRows.length} rows found). Match CSV columns to guest fields:
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormGroup>
                <Label htmlFor="map-guest-name">Guest Name Column (Required)</Label>
                <select
                  id="map-guest-name"
                  value={guestNameCol}
                  onChange={(e) => setGuestNameCol(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-sm"
                >
                  <option value="">-- Select Column --</option>
                  {csvHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </FormGroup>

              <FormGroup>
                <Label htmlFor="map-invitation-code">Invitation Code Column (Optional)</Label>
                <select
                  id="map-invitation-code"
                  value={codeCol}
                  onChange={(e) => setCodeCol(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-sm"
                >
                  <option value="">-- Auto-Generate Blank Codes --</option>
                  {csvHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </FormGroup>
            </div>

            {/* Preview snippet */}
            <div className="bg-gray-50 dark:bg-zinc-800 p-3 rounded-lg border border-gray-200 dark:border-zinc-700">
              <h4 className="text-xs font-bold uppercase text-gray-500 mb-2">Sample Data Preview (First 3 rows)</h4>
              <div className="space-y-1 text-xs">
                {rawRows.slice(0, 3).map((r, i) => (
                  <div key={i} className="flex justify-between py-1 border-b last:border-0 border-gray-200 dark:border-zinc-700">
                    <span>
                      <strong>Name:</strong> {r[guestNameCol] || <em className="text-red-400">&lt;empty&gt;</em>}
                    </span>
                    <span>
                      <strong>Code:</strong> {codeCol && r[codeCol] ? r[codeCol] : <em className="text-amber-500">&lt;auto-generate&gt;</em>}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button onClick={handleConfirmMapping}>Continue to Review &rarr;</Button>
            </div>
          </div>
        )}

        {/* Step 3: Dry-Run Preview Table */}
        {step === 3 && (
          <div className="space-y-4 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-gray-50 dark:bg-zinc-800/80 p-3 rounded-xl border border-gray-200 dark:border-zinc-700">
              <div className="flex items-center gap-4 text-xs font-semibold">
                <span className="text-gray-700 dark:text-zinc-200">Total: {editableRows.length}</span>
                <span className="text-emerald-600 dark:text-emerald-400">Valid: {validCount}</span>
                <span className={invalidCount > 0 ? 'text-red-600 font-bold' : 'text-gray-500'}>
                  Invalid: {invalidCount}
                </span>
              </div>

              {/* Collision Strategy */}
              <div className="flex items-center gap-2 text-xs">
                <label htmlFor="collision-strategy" className="mb-0 text-gray-600 dark:text-zinc-300 font-medium">
                  Duplicate Code Action:
                </label>
                <select
                  id="collision-strategy"
                  value={collisionStrategy}
                  onChange={(e) => setCollisionStrategy(e.target.value as any)}
                  className="px-2 py-1 rounded border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-xs font-semibold"
                >
                  <option value="skip">Skip Duplicates</option>
                  <option value="update">Update Existing Records</option>
                  <option value="reject">Reject Batch on Duplicate</option>
                </select>
              </div>
            </div>

            {/* Interactive Preview Table */}
            <div className="max-h-72 overflow-y-auto border border-gray-200 dark:border-zinc-700 rounded-lg">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-zinc-200 uppercase font-bold border-b border-gray-200 dark:border-zinc-700">
                  <tr>
                    <th className="p-2 w-12 text-center">#</th>
                    <th className="p-2">Guest Name</th>
                    <th className="p-2">Invitation Code</th>
                    <th className="p-2">Validation Status</th>
                    <th className="p-2 w-12 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
                  {validatedRows.map((row, idx) => (
                    <tr
                      key={idx}
                      className={
                        !row.isValid
                          ? 'bg-red-50/70 dark:bg-red-950/30'
                          : row.warnings.length > 0
                            ? 'bg-amber-50/50 dark:bg-amber-950/20'
                            : 'hover:bg-gray-50 dark:hover:bg-zinc-800/40'
                      }
                    >
                      <td className="p-2 text-center font-mono text-gray-400">{row.rowIndex}</td>
                      <td className="p-2">
                        <input
                          type="text"
                          value={editableRows[idx]?.guestName || ''}
                          onChange={(e) => handleCellEdit(idx, 'guestName', e.target.value)}
                          className="w-full text-xs px-2 py-1 h-7 border rounded bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="text"
                          value={editableRows[idx]?.code || ''}
                          placeholder="Auto-generate"
                          onChange={(e) => handleCellEdit(idx, 'code', e.target.value)}
                          className="w-full text-xs font-mono px-2 py-1 h-7 border rounded bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 uppercase"
                        />
                      </td>
                      <td className="p-2 space-y-1">
                        {row.isValid ? (
                          <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200">
                            Valid
                          </span>
                        ) : (
                          row.errors.map((err, ei) => (
                            <span
                              key={ei}
                              className="block text-[10px] font-semibold text-red-600 dark:text-red-400"
                            >
                              ✕ {err}
                            </span>
                          ))
                        )}
                        {row.warnings.map((warn, wi) => (
                          <span
                            key={wi}
                            className="block text-[10px] font-medium text-amber-600 dark:text-amber-400"
                          >
                            ⚠ {warn}
                          </span>
                        ))}
                      </td>
                      <td className="p-2 text-center">
                        <button
                          type="button"
                          onClick={() => handleDeleteRow(idx)}
                          className="text-red-500 hover:text-red-700 font-bold text-sm px-1"
                          title="Remove row"
                        >
                          &times;
                        </button>
                      </td>
                    </tr>
                  ))}
                  {editableRows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-4 text-center text-gray-500">
                        No rows remaining.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between items-center pt-2">
              <Button variant="secondary" onClick={() => setStep(2)} disabled={isSubmitting}>
                Back
              </Button>
              <Button
                onClick={handleCommitBatch}
                disabled={isSubmitting || editableRows.length === 0 || invalidCount > 0}
              >
                {isSubmitting ? 'Importing Batch...' : `Commit Import (${validCount} rows)`}
              </Button>
            </div>
          </div>
        )}

        {/* Step 4: Completion Summary */}
        {step === 4 && importSummary && (
          <div className="space-y-6 py-4 text-center">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto text-3xl font-bold">
              ✓
            </div>
            <div>
              <h3 className="text-xl font-extrabold text-primary">Import Execution Complete</h3>
              <p className="text-sm text-gray-600 dark:text-zinc-300 mt-1">
                Batch creation processed without database wipes or data loss.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3 bg-gray-50 dark:bg-zinc-800 p-4 rounded-xl border border-gray-200 dark:border-zinc-700 text-center max-w-md mx-auto">
              <div>
                <div className="text-2xl font-black text-primary">{importSummary.imported}</div>
                <div className="text-xs uppercase font-semibold text-gray-500">Imported</div>
              </div>
              <div>
                <div className="text-2xl font-black text-amber-600">{importSummary.skipped}</div>
                <div className="text-xs uppercase font-semibold text-gray-500">Skipped</div>
              </div>
              <div>
                <div className="text-2xl font-black text-blue-600">{importSummary.updated}</div>
                <div className="text-xs uppercase font-semibold text-gray-500">Updated</div>
              </div>
            </div>

            <div className="pt-2">
              <Button onClick={handleResetModal}>Close Wizard</Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
