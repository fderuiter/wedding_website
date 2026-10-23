'use client';

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { FormGroup, Label } from '@/components/ui/forms';
import { useToast } from '@/components/ui/ToastProvider';
import { useFormPersist } from '@/hooks/useFormPersist';
import {
  parseCsvContent,
  validateSingleCsvRow,
  generateSampleCsvTemplate,
  MAX_CSV_FILE_SIZE,
  ParsedCsvRow,
  ColumnMappingOptions,
} from '@/utils/csv';
import { DryRunValidationSummary, DryRunValidationResponse } from '@/features/registry/schemas';

interface CsvImportWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: () => void;
  existingCodes?: string[];
}

interface EditableRow {
  guestName: string;
  code: string;
  email: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  dietaryNotes: string;
  plusOneAllocations: string;
  plusOneFirstName: string;
  plusOneLastName: string;
  householdName: string;
  partyGroup: string;
  partyTags: string;
  extraFields: Record<string, string>;
}

interface CsvImportPersistedState {
  step: 1 | 2 | 3 | 4;
  fileName: string;
  csvHeaders: string[];
  rawRows: Record<string, string>[];
  guestNameCol: string;
  codeCol: string;
  emailCol: string;
  addressLine1Col: string;
  addressLine2Col: string;
  cityCol: string;
  stateCol: string;
  zipCodeCol: string;
  countryCol: string;
  dietaryNotesCol: string;
  plusOneCol: string;
  plusOneFirstNameCol: string;
  plusOneLastNameCol: string;
  householdNameCol: string;
  partyGroupCol: string;
  partyTagsCol: string;
  selectedExtraCols: string[];
  collisionStrategy: 'skip' | 'update' | 'reject';
  editableRows: EditableRow[];
}

const initialCsvImportState: CsvImportPersistedState = {
  step: 1,
  fileName: '',
  csvHeaders: [],
  rawRows: [],
  guestNameCol: '',
  codeCol: '',
  emailCol: '',
  addressLine1Col: '',
  addressLine2Col: '',
  cityCol: '',
  stateCol: '',
  zipCodeCol: '',
  countryCol: '',
  dietaryNotesCol: '',
  plusOneCol: '',
  plusOneFirstNameCol: '',
  plusOneLastNameCol: '',
  householdNameCol: '',
  partyGroupCol: '',
  partyTagsCol: '',
  selectedExtraCols: [],
  collisionStrategy: 'skip',
  editableRows: [],
};

const EDITABLE_MAPPING: ColumnMappingOptions = {
  guestNameCol: 'GuestNameField',
  codeCol: 'CodeField',
  emailCol: 'EmailField',
  addressLine1Col: 'AddressLine1Field',
  addressLine2Col: 'AddressLine2Field',
  cityCol: 'CityField',
  stateCol: 'StateField',
  zipCodeCol: 'ZipCodeField',
  countryCol: 'CountryField',
  dietaryNotesCol: 'DietaryNotesField',
  plusOneCol: 'PlusOneField',
  plusOneFirstNameCol: 'PlusOneFirstNameField',
  plusOneLastNameCol: 'PlusOneLastNameField',
  householdNameCol: 'HouseholdNameField',
  partyGroupCol: 'PartyGroupField',
  partyTagsCol: 'PartyTagsField',
};

const HOISTED_EDITABLE_MAPPED_COLS = new Set([
  'GuestNameField',
  'CodeField',
  'EmailField',
  'AddressLine1Field',
  'AddressLine2Field',
  'CityField',
  'StateField',
  'ZipCodeField',
  'CountryField',
  'DietaryNotesField',
  'PlusOneField',
  'PlusOneFirstNameField',
  'PlusOneLastNameField',
  'HouseholdNameField',
  'PartyGroupField',
  'PartyTagsField',
]);

function toRowRecord(r: EditableRow): Record<string, string> {
  const rowObj: Record<string, string> = {
    GuestNameField: r.guestName,
    CodeField: r.code,
    EmailField: r.email,
    AddressLine1Field: r.addressLine1,
    AddressLine2Field: r.addressLine2,
    CityField: r.city,
    StateField: r.state,
    ZipCodeField: r.zipCode,
    CountryField: r.country,
    DietaryNotesField: r.dietaryNotes,
    PlusOneField: r.plusOneAllocations,
    PlusOneFirstNameField: r.plusOneFirstName,
    PlusOneLastNameField: r.plusOneLastName,
    HouseholdNameField: r.householdName,
    PartyGroupField: r.partyGroup,
    PartyTagsField: r.partyTags,
  };
  if (r.extraFields) {
    Object.entries(r.extraFields).forEach(([k, v]) => {
      rowObj[k] = v;
    });
  }
  return rowObj;
}

function computeFullValidation(rows: EditableRow[], extraCols: string[], dbSet: Set<string>) {
  const freqMap = new Map<string, number>();
  rows.forEach((r) => {
    const rawCode = (r.code || '').trim().toUpperCase();
    if (rawCode) {
      freqMap.set(rawCode, (freqMap.get(rawCode) || 0) + 1);
    }
  });

  const mapping: ColumnMappingOptions = {
    ...EDITABLE_MAPPING,
    extraCols,
  };

  const parsed = rows.map((r, idx) =>
    validateSingleCsvRow(toRowRecord(r), idx, mapping, freqMap, dbSet, HOISTED_EDITABLE_MAPPED_COLS)
  );

  return { parsed, freqMap };
}

function computeSummaryFromRows(
  rows: ExtendedParsedCsvRow[],
  strategy: 'skip' | 'update' | 'reject'
): DryRunValidationSummary {
  const total = rows.length;
  const validCount = rows.filter((r) => r.isValid).length;
  const invalidCount = rows.filter((r) => !r.isValid).length;
  const duplicateCount = rows.filter(
    (r) =>
      r.isDuplicate ||
      r.existingGuestName ||
      r.warnings?.some((w) => w.includes('already exists') || w.includes('Duplicate')) ||
      r.errors?.some((e) => e.includes('Duplicate'))
  ).length;
  const updatedCount = rows.filter(
    (r) =>
      r.actionOutcome === 'update' ||
      (strategy === 'update' && r.warnings?.some((w) => w.includes('Will be updated')))
  ).length;
  const skippedCount = rows.filter(
    (r) =>
      r.actionOutcome === 'skip' ||
      (strategy === 'skip' && r.warnings?.some((w) => w.includes('Will be skipped')))
  ).length;
  const createdCount = validCount - updatedCount - skippedCount;

  return {
    total,
    validCount,
    invalidCount,
    duplicateCount,
    updatedCount,
    skippedCount,
    createdCount,
  };
}

type ExtendedParsedCsvRow = ParsedCsvRow & {
  isDuplicate?: boolean;
  existingGuestName?: string | null;
  actionOutcome?: 'create' | 'update' | 'skip' | 'reject' | 'invalid';
};

interface EditableTableRowProps {
  row: ExtendedParsedCsvRow;
  editableRow: EditableRow;
  index: number;
  onCellEdit: (
    index: number,
    field:
      | 'guestName'
      | 'code'
      | 'email'
      | 'addressLine1'
      | 'addressLine2'
      | 'city'
      | 'state'
      | 'zipCode'
      | 'country'
      | 'dietaryNotes'
      | 'plusOneAllocations'
      | 'plusOneFirstName'
      | 'plusOneLastName'
      | 'householdName'
      | 'partyGroup'
      | 'partyTags',
    value: string
  ) => void;
  onExtraFieldEdit: (index: number, key: string, value: string) => void;
  onDeleteRow: (index: number) => void;
}

const EditableTableRow = React.memo(function EditableTableRow({
  row,
  editableRow,
  index,
  onCellEdit,
  onExtraFieldEdit,
  onDeleteRow,
}: EditableTableRowProps) {
  return (
    <tr
      className={
        !row.isValid || row.actionOutcome === 'invalid'
          ? 'bg-red-50/70 dark:bg-red-950/30 text-gray-900 dark:text-zinc-100'
          : row.actionOutcome === 'update'
            ? 'bg-blue-50/50 dark:bg-blue-950/20 text-gray-900 dark:text-zinc-100'
            : row.warnings && row.warnings.length > 0
              ? 'bg-amber-50/50 dark:bg-amber-950/20 text-gray-900 dark:text-zinc-100'
              : 'hover:bg-gray-50 dark:hover:bg-zinc-800/40 text-gray-900 dark:text-zinc-100'
      }
    >
      <td className="p-2 text-center font-mono text-gray-400 dark:text-zinc-500">{row.rowIndex}</td>
      <td className="p-2">
        <input
          type="text"
          value={editableRow?.guestName || ''}
          aria-label={`Guest Name for row ${row.rowIndex}`}
          onChange={(e) => onCellEdit(index, 'guestName', e.target.value)}
          className="w-full text-xs px-2 py-1 h-7 border rounded bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100"
        />
      </td>
      <td className="p-2">
        <input
          type="text"
          value={editableRow?.code || ''}
          aria-label={`Invitation Code for row ${row.rowIndex}`}
          placeholder="Auto-generate"
          onChange={(e) => onCellEdit(index, 'code', e.target.value)}
          className="w-full text-xs font-mono px-2 py-1 h-7 border rounded bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 uppercase"
        />
      </td>
      <td className="p-2">
        <input
          type="email"
          value={editableRow?.email || ''}
          aria-label={`Email for row ${row.rowIndex}`}
          placeholder="Optional"
          onChange={(e) => onCellEdit(index, 'email', e.target.value)}
          className="w-full text-xs px-2 py-1 h-7 border rounded bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100"
        />
      </td>
      <td className="p-2">
        <input
          type="text"
          value={editableRow?.addressLine1 || ''}
          aria-label={`Address Line 1 for row ${row.rowIndex}`}
          placeholder="Optional"
          onChange={(e) => onCellEdit(index, 'addressLine1', e.target.value)}
          className="w-full text-xs px-2 py-1 h-7 border rounded bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100"
        />
      </td>
      <td className="p-2">
        <input
          type="text"
          value={editableRow?.addressLine2 || ''}
          aria-label={`Address Line 2 for row ${row.rowIndex}`}
          placeholder="Optional"
          onChange={(e) => onCellEdit(index, 'addressLine2', e.target.value)}
          className="w-full text-xs px-2 py-1 h-7 border rounded bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100"
        />
      </td>
      <td className="p-2">
        <input
          type="text"
          value={editableRow?.city || ''}
          aria-label={`City for row ${row.rowIndex}`}
          placeholder="Optional"
          onChange={(e) => onCellEdit(index, 'city', e.target.value)}
          className="w-full text-xs px-2 py-1 h-7 border rounded bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100"
        />
      </td>
      <td className="p-2">
        <input
          type="text"
          value={editableRow?.state || ''}
          aria-label={`State for row ${row.rowIndex}`}
          placeholder="Optional"
          onChange={(e) => onCellEdit(index, 'state', e.target.value)}
          className="w-full text-xs px-2 py-1 h-7 border rounded bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100"
        />
      </td>
      <td className="p-2">
        <input
          type="text"
          value={editableRow?.zipCode || ''}
          aria-label={`ZIP Code for row ${row.rowIndex}`}
          placeholder="Optional"
          onChange={(e) => onCellEdit(index, 'zipCode', e.target.value)}
          className="w-full text-xs px-2 py-1 h-7 border rounded bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100"
        />
      </td>
      <td className="p-2">
        <input
          type="text"
          value={editableRow?.country || ''}
          aria-label={`Country for row ${row.rowIndex}`}
          placeholder="Optional"
          onChange={(e) => onCellEdit(index, 'country', e.target.value)}
          className="w-full text-xs px-2 py-1 h-7 border rounded bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100"
        />
      </td>
      <td className="p-2">
        <input
          type="text"
          value={editableRow?.dietaryNotes || ''}
          aria-label={`Dietary Notes for row ${row.rowIndex}`}
          placeholder="Optional"
          onChange={(e) => onCellEdit(index, 'dietaryNotes', e.target.value)}
          className="w-full text-xs px-2 py-1 h-7 border rounded bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100"
        />
      </td>
      <td className="p-2 text-center">
        <input
          type="number"
          min="0"
          value={editableRow?.plusOneAllocations ?? '0'}
          aria-label={`Plus-One Allocation for row ${row.rowIndex}`}
          onChange={(e) => onCellEdit(index, 'plusOneAllocations', e.target.value)}
          className="w-14 text-xs text-center px-1 py-1 h-7 border rounded bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100"
        />
      </td>
      <td className="p-2">
        <input
          type="text"
          value={editableRow?.plusOneFirstName || ''}
          aria-label={`Plus-One First Name for row ${row.rowIndex}`}
          placeholder="Optional"
          onChange={(e) => onCellEdit(index, 'plusOneFirstName', e.target.value)}
          className="w-full text-xs px-2 py-1 h-7 border rounded bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100"
        />
      </td>
      <td className="p-2">
        <input
          type="text"
          value={editableRow?.plusOneLastName || ''}
          aria-label={`Plus-One Last Name for row ${row.rowIndex}`}
          placeholder="Optional"
          onChange={(e) => onCellEdit(index, 'plusOneLastName', e.target.value)}
          className="w-full text-xs px-2 py-1 h-7 border rounded bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100"
        />
      </td>
      <td className="p-2">
        <input
          type="text"
          value={editableRow?.householdName || ''}
          aria-label={`Household Name for row ${row.rowIndex}`}
          placeholder="Optional"
          onChange={(e) => onCellEdit(index, 'householdName', e.target.value)}
          className="w-full text-xs px-2 py-1 h-7 border rounded bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100"
        />
      </td>
      <td className="p-2">
        <input
          type="text"
          value={editableRow?.partyGroup || ''}
          aria-label={`Party Group for row ${row.rowIndex}`}
          placeholder="Optional"
          onChange={(e) => onCellEdit(index, 'partyGroup', e.target.value)}
          className="w-full text-xs px-2 py-1 h-7 border rounded bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100"
        />
      </td>
      <td className="p-2">
        <input
          type="text"
          value={editableRow?.partyTags || ''}
          aria-label={`Party Tags for row ${row.rowIndex}`}
          placeholder="Comma-separated"
          onChange={(e) => onCellEdit(index, 'partyTags', e.target.value)}
          className="w-full text-xs px-2 py-1 h-7 border rounded bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100"
        />
      </td>
      <td className="p-2">
        {Object.keys(editableRow?.extraFields || {}).length > 0 ? (
          <div className="space-y-1">
            {Object.entries(editableRow.extraFields).map(([k, v]) => (
              <div key={k} className="flex items-center gap-1 text-[11px]">
                <span className="font-semibold text-gray-600 dark:text-zinc-400 truncate max-w-[60px]" title={k}>
                  {k}:
                </span>
                <input
                  type="text"
                  value={v}
                  aria-label={`Extra attribute ${k} for row ${row.rowIndex}`}
                  onChange={(e) => onExtraFieldEdit(index, k, e.target.value)}
                  className="w-20 text-[11px] px-1.5 py-0.5 h-6 border rounded bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100"
                />
              </div>
            ))}
          </div>
        ) : (
          <span className="text-gray-400 italic text-[11px]">None</span>
        )}
      </td>
      <td className="p-2 space-y-1">
        {/* Status Badge */}
        {!row.isValid || row.actionOutcome === 'invalid' ? (
          <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200">
            Invalid
          </span>
        ) : row.actionOutcome === 'update' ? (
          <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200">
            Update
          </span>
        ) : row.actionOutcome === 'skip' ? (
          <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
            Skip
          </span>
        ) : row.actionOutcome === 'reject' ? (
          <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200">
            Reject
          </span>
        ) : (
          <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200">
            Valid
          </span>
        )}

        {/* Existing Guest Collision Indicator */}
        {row.existingGuestName ? (
          <span className="block text-[10px] font-bold text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-800">
            Existing guest: {row.existingGuestName}
          </span>
        ) : row.isDuplicate ? (
          <span className="block text-[10px] font-bold text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-800">
            Duplicate code
          </span>
        ) : null}

        {/* Error Messages */}
        {row.errors && row.errors.map((err, ei) => (
          <span
            key={ei}
            className="block text-[10px] font-semibold text-red-600 dark:text-red-400"
          >
            ✕ {err}
          </span>
        ))}

        {/* Warning Messages */}
        {row.warnings && row.warnings.map((warn, wi) => (
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
          onClick={() => onDeleteRow(index)}
          className="text-red-500 hover:text-red-700 font-bold text-sm px-1"
          title="Remove row"
          aria-label={`Remove row ${row.rowIndex}`}
        >
          &times;
        </button>
      </td>
    </tr>
  );
});

export function CsvImportWizardModal({
  isOpen,
  onClose,
  onImportComplete,
  existingCodes = [],
}: CsvImportWizardModalProps) {
  const { addToast } = useToast();

  const [csvFormState, setCsvFormState, clearPersistedCsvState] = useFormPersist<CsvImportPersistedState>(
    'csv_import_wizard_draft',
    initialCsvImportState
  );

  const {
    step,
    fileName,
    csvHeaders,
    rawRows,
    guestNameCol,
    codeCol,
    emailCol,
    addressLine1Col,
    addressLine2Col,
    cityCol,
    stateCol,
    zipCodeCol,
    countryCol,
    dietaryNotesCol,
    plusOneCol,
    plusOneFirstNameCol,
    plusOneLastNameCol,
    householdNameCol,
    partyGroupCol,
    partyTagsCol,
    selectedExtraCols,
    collisionStrategy,
    editableRows,
  } = csvFormState;

  const setStep = (val: 1 | 2 | 3 | 4 | ((prev: 1 | 2 | 3 | 4) => 1 | 2 | 3 | 4)) => {
    setCsvFormState((prev) => ({
      ...prev,
      step: typeof val === 'function' ? val(prev.step) : val,
    }));
  };

  const setFileName = (val: string) => setCsvFormState((prev) => ({ ...prev, fileName: val }));
  const setCsvHeaders = (val: string[]) => setCsvFormState((prev) => ({ ...prev, csvHeaders: val }));
  const setRawRows = (val: Record<string, string>[]) => setCsvFormState((prev) => ({ ...prev, rawRows: val }));
  const setGuestNameCol = (val: string) => setCsvFormState((prev) => ({ ...prev, guestNameCol: val }));
  const setCodeCol = (val: string) => setCsvFormState((prev) => ({ ...prev, codeCol: val }));
  const setEmailCol = (val: string) => setCsvFormState((prev) => ({ ...prev, emailCol: val }));
  const setAddressLine1Col = (val: string) => setCsvFormState((prev) => ({ ...prev, addressLine1Col: val }));
  const setAddressLine2Col = (val: string) => setCsvFormState((prev) => ({ ...prev, addressLine2Col: val }));
  const setCityCol = (val: string) => setCsvFormState((prev) => ({ ...prev, cityCol: val }));
  const setStateCol = (val: string) => setCsvFormState((prev) => ({ ...prev, stateCol: val }));
  const setZipCodeCol = (val: string) => setCsvFormState((prev) => ({ ...prev, zipCodeCol: val }));
  const setCountryCol = (val: string) => setCsvFormState((prev) => ({ ...prev, countryCol: val }));
  const setDietaryNotesCol = (val: string) => setCsvFormState((prev) => ({ ...prev, dietaryNotesCol: val }));
  const setPlusOneCol = (val: string) => setCsvFormState((prev) => ({ ...prev, plusOneCol: val }));
  const setPlusOneFirstNameCol = (val: string) => setCsvFormState((prev) => ({ ...prev, plusOneFirstNameCol: val }));
  const setPlusOneLastNameCol = (val: string) => setCsvFormState((prev) => ({ ...prev, plusOneLastNameCol: val }));
  const setHouseholdNameCol = (val: string) => setCsvFormState((prev) => ({ ...prev, householdNameCol: val }));
  const setPartyGroupCol = (val: string) => setCsvFormState((prev) => ({ ...prev, partyGroupCol: val }));
  const setPartyTagsCol = (val: string) => setCsvFormState((prev) => ({ ...prev, partyTagsCol: val }));
  const setSelectedExtraCols = (
    val: string[] | ((prev: string[]) => string[])
  ) => {
    setCsvFormState((prev) => ({
      ...prev,
      selectedExtraCols: typeof val === 'function' ? val(prev.selectedExtraCols) : val,
    }));
  };
  const setCollisionStrategy = (val: 'skip' | 'update' | 'reject') =>
    setCsvFormState((prev) => ({ ...prev, collisionStrategy: val }));
  const setEditableRows = (
    val: EditableRow[] | ((prev: EditableRow[]) => EditableRow[])
  ) => {
    setCsvFormState((prev) => ({
      ...prev,
      editableRows: typeof val === 'function' ? val(prev.editableRows) : val,
    }));
  };

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [importSummary, setImportSummary] = useState<{
    total: number;
    imported: number;
    skipped: number;
    updated: number;
  } | null>(null);

  const existingDbSet = useMemo(() => new Set(existingCodes.map(c => c.toUpperCase())), [existingCodes]);

  const handleDownloadSample = () => {
    const sampleCsv = generateSampleCsvTemplate();
    const blob = new Blob([sampleCsv], { type: 'text/csv;charset=utf-8;' });
    if (typeof window !== 'undefined' && typeof window.URL?.createObjectURL === 'function') {
      let url: string | null = null;
      try {
        url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', 'guest_list_template.csv');
        link.setAttribute('aria-label', 'Download Sample CSV Template');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } finally {
        if (url && typeof window.URL?.revokeObjectURL === 'function') {
          try {
            window.URL.revokeObjectURL(url);
          } catch {
            // Ignore object URL revocation errors in test runners
          }
        }
      }
    }
  };

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
      setEmailCol(parsed.suggestedEmailCol || '');
      setAddressLine1Col(parsed.suggestedAddressLine1Col || '');
      setAddressLine2Col(parsed.suggestedAddressLine2Col || '');
      setCityCol(parsed.suggestedCityCol || '');
      setStateCol(parsed.suggestedStateCol || '');
      setZipCodeCol(parsed.suggestedZipCodeCol || '');
      setCountryCol(parsed.suggestedCountryCol || '');
      setDietaryNotesCol(parsed.suggestedDietaryNotesCol || '');
      setPlusOneCol(parsed.suggestedPlusOneCol || '');
      setPlusOneFirstNameCol(parsed.suggestedPlusOneFirstNameCol || '');
      setPlusOneLastNameCol(parsed.suggestedPlusOneLastNameCol || '');
      setHouseholdNameCol(parsed.suggestedHouseholdNameCol || '');
      setPartyGroupCol(parsed.suggestedPartyGroupCol || '');
      setPartyTagsCol(parsed.suggestedPartyTagsCol || '');

      const mappedStandard = new Set(
        [
          parsed.suggestedGuestNameCol,
          parsed.suggestedCodeCol,
          parsed.suggestedEmailCol,
          parsed.suggestedAddressLine1Col,
          parsed.suggestedAddressLine2Col,
          parsed.suggestedCityCol,
          parsed.suggestedStateCol,
          parsed.suggestedZipCodeCol,
          parsed.suggestedCountryCol,
          parsed.suggestedDietaryNotesCol,
          parsed.suggestedPlusOneCol,
          parsed.suggestedPlusOneFirstNameCol,
          parsed.suggestedPlusOneLastNameCol,
          parsed.suggestedHouseholdNameCol,
          parsed.suggestedPartyGroupCol,
          parsed.suggestedPartyTagsCol,
        ].filter(Boolean)
      );
      setSelectedExtraCols(parsed.headers.filter((h) => !mappedStandard.has(h)));
      setStep(2);
    };

    reader.readAsText(file, 'UTF-8');
  };

  const handleConfirmMapping = () => {
    if (!guestNameCol) {
      addToast('Please select a column for Guest Name.', 'error');
      return;
    }

    const initialMapped: EditableRow[] = rawRows.map((r) => {
      const extraFields: Record<string, string> = {};
      selectedExtraCols.forEach((col) => {
        if (r[col] !== undefined && r[col].trim() !== '') {
          extraFields[col] = r[col].trim();
        }
      });

      return {
        guestName: (r[guestNameCol] || '').trim(),
        code: codeCol ? (r[codeCol] || '').trim().toUpperCase() : '',
        email: emailCol ? (r[emailCol] || '').trim() : '',
        addressLine1: addressLine1Col ? (r[addressLine1Col] || '').trim() : '',
        addressLine2: addressLine2Col ? (r[addressLine2Col] || '').trim() : '',
        city: cityCol ? (r[cityCol] || '').trim() : '',
        state: stateCol ? (r[stateCol] || '').trim() : '',
        zipCode: zipCodeCol ? (r[zipCodeCol] || '').trim() : '',
        country: countryCol ? (r[countryCol] || '').trim() : '',
        dietaryNotes: dietaryNotesCol ? (r[dietaryNotesCol] || '').trim() : '',
        plusOneAllocations: plusOneCol ? (r[plusOneCol] || '').trim() : '0',
        plusOneFirstName: plusOneFirstNameCol ? (r[plusOneFirstNameCol] || '').trim() : '',
        plusOneLastName: plusOneLastNameCol ? (r[plusOneLastNameCol] || '').trim() : '',
        householdName: householdNameCol ? (r[householdNameCol] || '').trim() : '',
        partyGroup: partyGroupCol ? (r[partyGroupCol] || '').trim() : '',
        partyTags: partyTagsCol ? (r[partyTagsCol] || '').trim() : '',
        extraFields,
      };
    });

    setEditableRows(initialMapped);
    setStep(3);
  };

  // Dry-run server validation and status filter state
  const [isValidating, setIsValidating] = useState<boolean>(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'valid' | 'invalid' | 'duplicate' | 'update' | 'skip'>('all');
  const [serverSummary, setServerSummary] = useState<DryRunValidationSummary | null>(null);

  // Incremental row validation state
  const [validatedRows, setValidatedRows] = useState<ExtendedParsedCsvRow[]>([]);
  const codeFrequencyRef = useRef<Map<string, number>>(new Map());

  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const activeValidationPromiseRef = useRef<Promise<{ summary: DryRunValidationSummary; rows: ExtendedParsedCsvRow[] } | null> | null>(null);
  const prevStepRef = useRef<number>(step);
  const prevCollisionStrategyRef = useRef<'skip' | 'update' | 'reject'>(collisionStrategy);

  const editableRowsRef = useRef(editableRows);
  editableRowsRef.current = editableRows;

  const selectedExtraColsRef = useRef(selectedExtraCols);
  selectedExtraColsRef.current = selectedExtraCols;

  const existingDbSetRef = useRef(existingDbSet);
  existingDbSetRef.current = existingDbSet;

  const runDryRunValidation = useCallback(
    async (rows: EditableRow[], strategy: 'skip' | 'update' | 'reject') => {
      if (rows.length === 0) {
        setValidatedRows([]);
        setServerSummary(null);
        return null;
      }

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsValidating(true);

      const promise = (async () => {
        try {
          const payload = {
            records: rows.map((r) => ({
              guestName: r.guestName,
              code: r.code || undefined,
              email: r.email || undefined,
              addressLine1: r.addressLine1 || undefined,
              addressLine2: r.addressLine2 || undefined,
              city: r.city || undefined,
              state: r.state || undefined,
              zipCode: r.zipCode || undefined,
              country: r.country || undefined,
              dietaryNotes: r.dietaryNotes || undefined,
              plusOneAllocations: r.plusOneAllocations !== '' ? parseInt(r.plusOneAllocations, 10) : 0,
              plusOneFirstName: r.plusOneFirstName.trim() || undefined,
              plusOneLastName: r.plusOneLastName.trim() || undefined,
              householdName: r.householdName.trim() || undefined,
              partyGroup: r.partyGroup.trim() || undefined,
              partyTags: r.partyTags ? r.partyTags.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
              extraFields: Object.keys(r.extraFields || {}).length > 0 ? r.extraFields : undefined,
            })),
            collisionStrategy: strategy,
          };

          const res = await fetch('/api/admin/invitation-codes/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });

          if (controller.signal.aborted) {
            return null;
          }

          if (res.ok) {
            const data: DryRunValidationResponse = await res.json();
            if (controller.signal.aborted) {
              return null;
            }
            if (data && data.success && data.summary && data.rows) {
              const resultRows = data.rows as ExtendedParsedCsvRow[];
              setServerSummary(data.summary);
              setValidatedRows(resultRows);
              setIsValidating(false);
              return { summary: data.summary, rows: resultRows };
            }
          }
        } catch (err: any) {
          if (err.name === 'AbortError' || controller.signal.aborted) {
            return null;
          }
          // Fallback to local computation if fetch is unhandled / unreachable
        }

        if (controller.signal.aborted) {
          return null;
        }

        const { parsed, freqMap } = computeFullValidation(rows, selectedExtraColsRef.current, existingDbSetRef.current);
        codeFrequencyRef.current = freqMap;
        const localSummary = computeSummaryFromRows(parsed, strategy);
        setValidatedRows(parsed);
        setServerSummary(null);
        setIsValidating(false);
        return { summary: localSummary, rows: parsed };
      })();

      activeValidationPromiseRef.current = promise;
      return promise;
    },
    []
  );

  useEffect(() => {
    if (step === 3 && editableRows.length > 0) {
      const isStepChange = prevStepRef.current !== 3;
      const isStrategyChange = prevCollisionStrategyRef.current !== collisionStrategy;

      prevStepRef.current = step;
      prevCollisionStrategyRef.current = collisionStrategy;

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }

      if (isStepChange || isStrategyChange) {
        runDryRunValidation(editableRows, collisionStrategy);
      } else {
        debounceTimerRef.current = setTimeout(() => {
          runDryRunValidation(editableRows, collisionStrategy);
          debounceTimerRef.current = null;
        }, 400);
      }
    } else if (step !== 3) {
      prevStepRef.current = step;
      prevCollisionStrategyRef.current = collisionStrategy;

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      setValidatedRows([]);
      setServerSummary(null);
      codeFrequencyRef.current.clear();
    }

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [step, editableRows, collisionStrategy, runDryRunValidation]);

  const summary = useMemo(() => {
    if (serverSummary) {
      return serverSummary;
    }
    return computeSummaryFromRows(validatedRows, collisionStrategy);
  }, [serverSummary, validatedRows, collisionStrategy]);

  const filteredRows = useMemo(() => {
    if (statusFilter === 'valid') {
      return validatedRows.filter((r) => r.isValid);
    }
    if (statusFilter === 'invalid') {
      return validatedRows.filter((r) => !r.isValid);
    }
    if (statusFilter === 'duplicate') {
      return validatedRows.filter(
        (r) =>
          r.isDuplicate ||
          r.existingGuestName ||
          r.warnings?.some((w) => w.includes('already exists') || w.includes('Duplicate')) ||
          r.errors?.some((e) => e.includes('Duplicate'))
      );
    }
    if (statusFilter === 'update') {
      return validatedRows.filter(
        (r) => r.actionOutcome === 'update' || r.warnings?.some((w) => w.includes('Will be updated'))
      );
    }
    if (statusFilter === 'skip') {
      return validatedRows.filter(
        (r) => r.actionOutcome === 'skip' || r.warnings?.some((w) => w.includes('Will be skipped'))
      );
    }
    return validatedRows;
  }, [validatedRows, statusFilter]);

  const handleCellEdit = useCallback((
    index: number,
    field:
      | 'guestName'
      | 'code'
      | 'email'
      | 'addressLine1'
      | 'addressLine2'
      | 'city'
      | 'state'
      | 'zipCode'
      | 'country'
      | 'dietaryNotes'
      | 'plusOneAllocations'
      | 'plusOneFirstName'
      | 'plusOneLastName'
      | 'householdName'
      | 'partyGroup'
      | 'partyTags',
    value: string
  ) => {
    const updatedValue = field === 'code' ? value.toUpperCase() : value;
    const currentEditable = editableRowsRef.current;
    const oldRow = currentEditable[index];

    setEditableRows((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        [field]: updatedValue,
      };
      return next;
    });

    setValidatedRows((prevValidated) => {
      if (!prevValidated || prevValidated.length !== currentEditable.length) {
        return prevValidated;
      }

      const mapping: ColumnMappingOptions = {
        ...EDITABLE_MAPPING,
        extraCols: selectedExtraColsRef.current,
      };

      if (field !== 'code') {
        const updatedEditableRow = {
          ...currentEditable[index],
          [field]: value,
        };
        const nextValidated = [...prevValidated];
        nextValidated[index] = validateSingleCsvRow(
          toRowRecord(updatedEditableRow),
          index,
          mapping,
          codeFrequencyRef.current,
          existingDbSetRef.current,
          HOISTED_EDITABLE_MAPPED_COLS
        );
        return nextValidated;
      } else {
        const oldCode = (oldRow?.code || '').trim().toUpperCase();
        const newCode = (value || '').trim().toUpperCase();

        if (oldCode === newCode) return prevValidated;

        const freqMap = codeFrequencyRef.current;
        if (oldCode) {
          const count = freqMap.get(oldCode) || 0;
          if (count <= 1) freqMap.delete(oldCode);
          else freqMap.set(oldCode, count - 1);
        }
        if (newCode) {
          freqMap.set(newCode, (freqMap.get(newCode) || 0) + 1);
        }

        const nextValidated = [...prevValidated];
        const updatedEditableRow = {
          ...currentEditable[index],
          code: newCode,
        };

        for (let i = 0; i < currentEditable.length; i++) {
          const rCode = i === index ? newCode : (currentEditable[i].code || '').trim().toUpperCase();
          if (i === index || rCode === oldCode || rCode === newCode) {
            const rowToVal = i === index ? updatedEditableRow : currentEditable[i];
            nextValidated[i] = validateSingleCsvRow(
              toRowRecord(rowToVal),
              i,
              mapping,
              freqMap,
              existingDbSetRef.current,
              HOISTED_EDITABLE_MAPPED_COLS
            );
          }
        }

        return nextValidated;
      }
    });
  }, [setEditableRows]);

  const handleExtraFieldEdit = useCallback((index: number, key: string, value: string) => {
    const currentEditable = editableRowsRef.current;

    setEditableRows((prev) => {
      const next = [...prev];
      const updatedExtra = { ...next[index].extraFields, [key]: value };
      next[index] = {
        ...next[index],
        extraFields: updatedExtra,
      };
      return next;
    });

    setValidatedRows((prevValidated) => {
      if (!prevValidated || prevValidated.length !== currentEditable.length) return prevValidated;

      const mapping: ColumnMappingOptions = {
        ...EDITABLE_MAPPING,
        extraCols: selectedExtraColsRef.current,
      };

      const updatedEditableRow = {
        ...currentEditable[index],
        extraFields: { ...currentEditable[index].extraFields, [key]: value },
      };

      const nextValidated = [...prevValidated];
      nextValidated[index] = validateSingleCsvRow(
        toRowRecord(updatedEditableRow),
        index,
        mapping,
        codeFrequencyRef.current,
        existingDbSetRef.current,
        HOISTED_EDITABLE_MAPPED_COLS
      );
      return nextValidated;
    });
  }, [setEditableRows]);

  const handleDeleteRow = useCallback((index: number) => {
    const currentEditable = editableRowsRef.current;
    const deletedRow = currentEditable[index];
    const deletedCode = (deletedRow?.code || '').trim().toUpperCase();

    const remainingEditable = currentEditable.filter((_, i) => i !== index);
    setEditableRows(remainingEditable);

    setValidatedRows((prevValidated) => {
      if (!prevValidated) return [];

      const freqMap = codeFrequencyRef.current;
      if (deletedCode) {
        const count = freqMap.get(deletedCode) || 0;
        if (count <= 1) freqMap.delete(deletedCode);
        else freqMap.set(deletedCode, count - 1);
      }

      const mapping: ColumnMappingOptions = {
        ...EDITABLE_MAPPING,
        extraCols: selectedExtraColsRef.current,
      };

      const remainingValidated = prevValidated.filter((_, i) => i !== index);

      return remainingValidated.map((row, i) => {
        const rCode = (remainingEditable[i].code || '').trim().toUpperCase();
        if (rCode === deletedCode) {
          return validateSingleCsvRow(
            toRowRecord(remainingEditable[i]),
            i,
            mapping,
            freqMap,
            existingDbSetRef.current,
            HOISTED_EDITABLE_MAPPED_COLS
          );
        }
        return { ...row, rowIndex: i + 1 };
      });
    });
  }, [setEditableRows]);

  const toggleExtraCol = (header: string) => {
    setSelectedExtraCols((prev) =>
      prev.includes(header) ? prev.filter((h) => h !== header) : [...prev, header]
    );
  };

  const handleCommitBatch = async () => {
    if (editableRows.length === 0) {
      addToast('No records to import.', 'error');
      return;
    }

    let currentSummary = serverSummary || summary;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
      const res = await runDryRunValidation(editableRows, collisionStrategy);
      if (res) {
        currentSummary = res.summary;
      }
    } else if (activeValidationPromiseRef.current) {
      const res = await activeValidationPromiseRef.current;
      if (res) {
        currentSummary = res.summary;
      }
    }

    if (currentSummary.invalidCount > 0) {
      addToast('Please fix or remove invalid rows before submitting.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        records: editableRows.map((r) => ({
          guestName: r.guestName,
          code: r.code || undefined,
          email: r.email || undefined,
          addressLine1: r.addressLine1 || undefined,
          addressLine2: r.addressLine2 || undefined,
          city: r.city || undefined,
          state: r.state || undefined,
          zipCode: r.zipCode || undefined,
          country: r.country || undefined,
          dietaryNotes: r.dietaryNotes || undefined,
          plusOneAllocations: r.plusOneAllocations !== '' ? parseInt(r.plusOneAllocations, 10) : 0,
          plusOneFirstName: r.plusOneFirstName.trim() || undefined,
          plusOneLastName: r.plusOneLastName.trim() || undefined,
          householdName: r.householdName.trim() || undefined,
          partyGroup: r.partyGroup.trim() || undefined,
          partyTags: r.partyTags ? r.partyTags.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
          extraFields: Object.keys(r.extraFields || {}).length > 0 ? r.extraFields : undefined,
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
    clearPersistedCsvState();
    setCsvFormState(initialCsvImportState);
    setImportSummary(null);
    onClose();
  };

  // Get unmapped headers for custom field checkbox selection
  const mappedStandardHeaders = useMemo(() => {
    return new Set(
      [
        guestNameCol,
        codeCol,
        emailCol,
        addressLine1Col,
        addressLine2Col,
        cityCol,
        stateCol,
        zipCodeCol,
        countryCol,
        dietaryNotesCol,
        plusOneCol,
        plusOneFirstNameCol,
        plusOneLastNameCol,
        householdNameCol,
        partyGroupCol,
        partyTagsCol,
      ].filter(Boolean)
    );
  }, [
    guestNameCol,
    codeCol,
    emailCol,
    addressLine1Col,
    addressLine2Col,
    cityCol,
    stateCol,
    zipCodeCol,
    countryCol,
    dietaryNotesCol,
    plusOneCol,
    plusOneFirstNameCol,
    plusOneLastNameCol,
    householdNameCol,
    partyGroupCol,
    partyTagsCol,
  ]);

  const availableCustomHeaders = useMemo(() => {
    return csvHeaders.filter((h) => !mappedStandardHeaders.has(h));
  }, [csvHeaders, mappedStandardHeaders]);

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleResetModal}
      title={
        <div className="flex items-center justify-between">
          <span className="font-extrabold text-xl text-primary">Import Guest Invitation Codes</span>
          <span
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="text-xs font-semibold px-2.5 py-1 bg-gray-100 dark:bg-zinc-800 rounded-full text-gray-600 dark:text-zinc-300"
          >
            Step {step} of 4
          </span>
        </div>
      }
      className="max-w-4xl"
    >
      <div className="space-y-6">
        {/* Step Indicator */}
        <nav aria-label="Import progress">
          <ol className="flex justify-between items-center text-xs font-semibold border-b pb-3 text-gray-500 dark:text-zinc-400 border-gray-200 dark:border-zinc-800">
            <li>
              <span
                aria-current={step === 1 ? 'step' : undefined}
                className={step >= 1 ? 'text-primary font-bold' : 'text-gray-500 dark:text-zinc-400'}
              >
                1. Upload File
              </span>
            </li>
            <span aria-hidden="true">&rarr;</span>
            <li>
              <span
                aria-current={step === 2 ? 'step' : undefined}
                className={step >= 2 ? 'text-primary font-bold' : 'text-gray-500 dark:text-zinc-400'}
              >
                2. Map Columns
              </span>
            </li>
            <span aria-hidden="true">&rarr;</span>
            <li>
              <span
                aria-current={step === 3 ? 'step' : undefined}
                className={step >= 3 ? 'text-primary font-bold' : 'text-gray-500 dark:text-zinc-400'}
              >
                3. Review & Validate
              </span>
            </li>
            <span aria-hidden="true">&rarr;</span>
            <li>
              <span
                aria-current={step === 4 ? 'step' : undefined}
                className={step === 4 ? 'text-primary font-bold' : 'text-gray-500 dark:text-zinc-400'}
              >
                4. Complete
              </span>
            </li>
          </ol>
        </nav>

        {/* Step 1: File Upload */}
        {step === 1 && (
          <div className="space-y-4 py-2">
            <p className="text-sm text-gray-600 dark:text-zinc-300">
              Select a UTF-8 encoded <code>.csv</code> spreadsheet containing guest names and optional guest information (max 5 MB).
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
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-gray-500 dark:text-zinc-400">
                Need a starting point?
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDownloadSample}
                aria-label="Download Sample CSV Template"
                className="inline-flex items-center gap-1.5 text-xs font-semibold"
              >
                <span>📥</span> Download Sample CSV Template
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Multi-Column Mapping */}
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
                  className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-sm text-gray-900 dark:text-zinc-100"
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
                  className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-sm text-gray-900 dark:text-zinc-100"
                >
                  <option value="">-- Auto-Generate Blank Codes --</option>
                  {csvHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </FormGroup>

              <FormGroup>
                <Label htmlFor="map-email">Email Address Column (Optional)</Label>
                <select
                  id="map-email"
                  value={emailCol}
                  onChange={(e) => setEmailCol(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-sm text-gray-900 dark:text-zinc-100"
                >
                  <option value="">-- Unmapped --</option>
                  {csvHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </FormGroup>

              <FormGroup>
                <Label htmlFor="map-dietary-notes">Dietary Notes / Allergies (Optional)</Label>
                <select
                  id="map-dietary-notes"
                  value={dietaryNotesCol}
                  onChange={(e) => setDietaryNotesCol(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-sm text-gray-900 dark:text-zinc-100"
                >
                  <option value="">-- Unmapped --</option>
                  {csvHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </FormGroup>

              <FormGroup>
                <Label htmlFor="map-address-line1">Address Line 1 Column (Optional)</Label>
                <select
                  id="map-address-line1"
                  value={addressLine1Col}
                  onChange={(e) => setAddressLine1Col(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-sm"
                >
                  <option value="">-- Unmapped --</option>
                  {csvHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </FormGroup>

              <FormGroup>
                <Label htmlFor="map-address-line2">Address Line 2 Column (Optional)</Label>
                <select
                  id="map-address-line2"
                  value={addressLine2Col}
                  onChange={(e) => setAddressLine2Col(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-sm"
                >
                  <option value="">-- Unmapped --</option>
                  {csvHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </FormGroup>

              <FormGroup>
                <Label htmlFor="map-city">City Column (Optional)</Label>
                <select
                  id="map-city"
                  value={cityCol}
                  onChange={(e) => setCityCol(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-sm"
                >
                  <option value="">-- Unmapped --</option>
                  {csvHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </FormGroup>

              <FormGroup>
                <Label htmlFor="map-state">State / Province Column (Optional)</Label>
                <select
                  id="map-state"
                  value={stateCol}
                  onChange={(e) => setStateCol(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-sm"
                >
                  <option value="">-- Unmapped --</option>
                  {csvHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </FormGroup>

              <FormGroup>
                <Label htmlFor="map-zip-code">ZIP / Postal Code Column (Optional)</Label>
                <select
                  id="map-zip-code"
                  value={zipCodeCol}
                  onChange={(e) => setZipCodeCol(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-sm"
                >
                  <option value="">-- Unmapped --</option>
                  {csvHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </FormGroup>

              <FormGroup>
                <Label htmlFor="map-country">Country Column (Optional)</Label>
                <select
                  id="map-country"
                  value={countryCol}
                  onChange={(e) => setCountryCol(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-sm"
                >
                  <option value="">-- Unmapped --</option>
                  {csvHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </FormGroup>

              <FormGroup>
                <Label htmlFor="map-plus-ones">Plus-One Allocations Column (Optional)</Label>
                <select
                  id="map-plus-ones"
                  value={plusOneCol}
                  onChange={(e) => setPlusOneCol(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-sm text-gray-900 dark:text-zinc-100"
                >
                  <option value="">-- Default to 0 --</option>
                  {csvHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </FormGroup>

              <FormGroup>
                <Label htmlFor="map-plus-one-first-name">Plus-One First Name Column (Optional)</Label>
                <select
                  id="map-plus-one-first-name"
                  value={plusOneFirstNameCol}
                  onChange={(e) => setPlusOneFirstNameCol(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-sm"
                >
                  <option value="">-- Unmapped --</option>
                  {csvHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </FormGroup>

              <FormGroup>
                <Label htmlFor="map-plus-one-last-name">Plus-One Last Name Column (Optional)</Label>
                <select
                  id="map-plus-one-last-name"
                  value={plusOneLastNameCol}
                  onChange={(e) => setPlusOneLastNameCol(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-sm"
                >
                  <option value="">-- Unmapped --</option>
                  {csvHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </FormGroup>

              <FormGroup>
                <Label htmlFor="map-household-name">Household Name Column (Optional)</Label>
                <select
                  id="map-household-name"
                  value={householdNameCol}
                  onChange={(e) => setHouseholdNameCol(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-sm"
                >
                  <option value="">-- Unmapped --</option>
                  {csvHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </FormGroup>

              <FormGroup>
                <Label htmlFor="map-party-group">Party Side / Group Column (Optional)</Label>
                <select
                  id="map-party-group"
                  value={partyGroupCol}
                  onChange={(e) => setPartyGroupCol(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-sm"
                >
                  <option value="">-- Unmapped --</option>
                  {csvHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </FormGroup>

              <FormGroup>
                <Label htmlFor="map-party-tags">Party Tags Column (Optional)</Label>
                <select
                  id="map-party-tags"
                  value={partyTagsCol}
                  onChange={(e) => setPartyTagsCol(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-700 text-sm"
                >
                  <option value="">-- Unmapped --</option>
                  {csvHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </FormGroup>
            </div>

            {/* Custom Extra Headers Section */}
            {availableCustomHeaders.length > 0 && (
              <div className="bg-gray-50 dark:bg-zinc-800/80 p-3 rounded-lg border border-gray-200 dark:border-zinc-700 space-y-2">
                <h4 className="text-xs font-bold uppercase text-gray-600 dark:text-zinc-300">
                  Custom / Extra Metadata Columns to Include:
                </h4>
                <div className="flex flex-wrap gap-3 text-xs">
                  {availableCustomHeaders.map((header) => (
                    <label key={header} className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedExtraCols.includes(header)}
                        onChange={() => toggleExtraCol(header)}
                        className="rounded border-gray-300 dark:border-zinc-700 text-primary focus:ring-primary"
                      />
                      <span className="font-medium text-gray-700 dark:text-zinc-200">{header}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Preview snippet */}
            <div className="bg-gray-50 dark:bg-zinc-800 p-3 rounded-lg border border-gray-200 dark:border-zinc-700">
              <h4 className="text-xs font-bold uppercase text-gray-500 mb-2">Sample Data Preview (First 3 rows)</h4>
              <div className="space-y-1 text-xs">
                {rawRows.slice(0, 3).map((r, i) => (
                  <div key={i} className="flex flex-wrap justify-between py-1 border-b last:border-0 border-gray-200 dark:border-zinc-700 gap-2">
                    <span>
                      <strong>Name:</strong> {r[guestNameCol] || <em className="text-red-400">&lt;empty&gt;</em>}
                    </span>
                    <span>
                      <strong>Code:</strong> {codeCol && r[codeCol] ? r[codeCol] : <em className="text-amber-500">&lt;auto-generate&gt;</em>}
                    </span>
                    {emailCol && (
                      <span>
                        <strong>Email:</strong> {r[emailCol] || <em className="text-gray-400">&lt;none&gt;</em>}
                      </span>
                    )}
                    {dietaryNotesCol && (
                      <span>
                        <strong>Dietary:</strong> {r[dietaryNotesCol] || <em className="text-gray-400">&lt;none&gt;</em>}
                      </span>
                    )}
                    {plusOneCol && (
                      <span>
                        <strong>Plus-Ones:</strong> {r[plusOneCol] || '0'}
                      </span>
                    )}
                    {plusOneFirstNameCol && (
                      <span>
                        <strong>Plus-One First:</strong> {r[plusOneFirstNameCol] || <em className="text-gray-400">&lt;none&gt;</em>}
                      </span>
                    )}
                    {plusOneLastNameCol && (
                      <span>
                        <strong>Plus-One Last:</strong> {r[plusOneLastNameCol] || <em className="text-gray-400">&lt;none&gt;</em>}
                      </span>
                    )}
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
            <div className="flex flex-wrap items-center justify-between gap-3 bg-gray-50 dark:bg-zinc-800/80 p-3.5 rounded-xl border border-gray-200 dark:border-zinc-700">
              <div className="flex flex-wrap items-center gap-2.5 text-xs font-semibold">
                <span className="px-2.5 py-1 rounded bg-gray-200 dark:bg-zinc-700 text-gray-800 dark:text-zinc-200">
                  Total: {summary.total}
                </span>
                <span className="px-2.5 py-1 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                  Valid: {summary.validCount}
                </span>
                <span className={`px-2.5 py-1 rounded ${summary.invalidCount > 0 ? 'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 font-bold' : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-400'}`}>
                  Invalid: {summary.invalidCount}
                </span>
                <span className="px-2.5 py-1 rounded bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300">
                  Duplicates: {summary.duplicateCount}
                </span>
                <span className="px-2.5 py-1 rounded bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300">
                  Updated: {summary.updatedCount}
                </span>
                {isValidating && (
                  <span className="text-[11px] text-gray-500 italic animate-pulse">
                    Validating...
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs">
                {/* Status Filter */}
                <div className="flex items-center gap-1.5 font-medium">
                  <label htmlFor="status-filter-select" className="text-gray-600 dark:text-zinc-300">
                    Filter Status:
                  </label>
                  <select
                    id="status-filter-select"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as any)}
                    className="px-2 py-1 rounded border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-xs font-semibold text-gray-900 dark:text-zinc-100"
                  >
                    <option value="all">All Rows ({summary.total})</option>
                    <option value="valid">Valid ({summary.validCount})</option>
                    <option value="invalid">Invalid ({summary.invalidCount})</option>
                    <option value="duplicate">Duplicates ({summary.duplicateCount})</option>
                    <option value="update">Updates ({summary.updatedCount})</option>
                    <option value="skip">Skipped ({summary.skippedCount})</option>
                  </select>
                </div>

                {/* Collision Strategy */}
                <div className="flex items-center gap-1.5 font-medium">
                  <label htmlFor="collision-strategy" className="text-gray-600 dark:text-zinc-300">
                    Duplicate Action:
                  </label>
                  <select
                    id="collision-strategy"
                    value={collisionStrategy}
                    onChange={(e) => setCollisionStrategy(e.target.value as any)}
                    className="px-2 py-1 rounded border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-xs font-semibold text-gray-900 dark:text-zinc-100"
                  >
                    <option value="skip">Skip Duplicates</option>
                    <option value="update">Update Existing Records</option>
                    <option value="reject">Reject Batch on Duplicate</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Error Banner when invalid rows exist */}
            {summary.invalidCount > 0 && (
              <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 p-2.5 rounded-lg text-xs font-semibold flex items-center gap-2">
                <span>⚠️</span>
                <span>
                  Please fix or remove the {summary.invalidCount} invalid row(s) in the table before submitting the batch import.
                </span>
              </div>
            )}

            {/* Interactive Preview Table */}
            <div className="max-h-80 overflow-auto border border-gray-200 dark:border-zinc-700 rounded-lg">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-zinc-200 uppercase font-bold border-b border-gray-200 dark:border-zinc-700">
                  <tr>
                    <th scope="col" className="p-2 w-10 text-center">#</th>
                    <th scope="col" className="p-2 min-w-[120px]">Guest Name</th>
                    <th scope="col" className="p-2 min-w-[110px]">Invitation Code</th>
                    <th scope="col" className="p-2 min-w-[120px]">Email</th>
                    <th scope="col" className="p-2 min-w-[120px]">Address Line 1</th>
                    <th scope="col" className="p-2 min-w-[100px]">Address Line 2</th>
                    <th scope="col" className="p-2 min-w-[100px]">City</th>
                    <th scope="col" className="p-2 min-w-[80px]">State</th>
                    <th scope="col" className="p-2 min-w-[80px]">ZIP Code</th>
                    <th scope="col" className="p-2 min-w-[90px]">Country</th>
                    <th scope="col" className="p-2 min-w-[120px]">Dietary Notes</th>
                    <th scope="col" className="p-2 w-16 text-center">Plus-Ones</th>
                    <th scope="col" className="p-2 min-w-[120px]">Plus-One First Name</th>
                    <th scope="col" className="p-2 min-w-[120px]">Plus-One Last Name</th>
                    <th scope="col" className="p-2 min-w-[120px]">Household Name</th>
                    <th scope="col" className="p-2 min-w-[110px]">Party Group</th>
                    <th scope="col" className="p-2 min-w-[130px]">Party Tags</th>
                    <th scope="col" className="p-2 min-w-[130px]">Extra Attributes</th>
                    <th scope="col" className="p-2 min-w-[140px]">Validation Status</th>
                    <th scope="col" className="p-2 w-10 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
                  {filteredRows.map((row) => {
                    const realIdx = row.rowIndex - 1;
                    return (
                      <EditableTableRow
                        key={realIdx}
                        row={row}
                        editableRow={editableRows[realIdx]}
                        index={realIdx}
                        onCellEdit={handleCellEdit}
                        onExtraFieldEdit={handleExtraFieldEdit}
                        onDeleteRow={handleDeleteRow}
                      />
                    );
                  })}
                  {filteredRows.length === 0 && (
                    <tr>
                      <td colSpan={20} className="p-4 text-center text-gray-500">
                        {editableRows.length === 0 ? 'No rows remaining.' : 'No rows match the selected status filter.'}
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
                disabled={isSubmitting || isValidating || editableRows.length === 0 || summary.invalidCount > 0}
              >
                {isSubmitting ? 'Importing Batch...' : `Commit Import (${summary.validCount} rows)`}
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
