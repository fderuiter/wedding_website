'use client';

import React, { useReducer, useMemo, useEffect, useRef, useCallback } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { FormGroup, Label, Input } from '@/components/ui/forms';
import { useToast } from '@/components/ui/ToastProvider';
import {
  parseCsvContent,
  validateSingleCsvRow,
  generateSampleCsvTemplate,
  combineFirstAndLastName,
  consolidateHouseholdCsvRows,
  generateFailedRowsCsv,
  MAX_CSV_FILE_SIZE,
  ParsedCsvRow,
  ColumnMappingOptions,
  type EditableCsvRow,
  type FailedCsvExportRow,
} from '@/utils/csv';
import type { DryRunValidationSummary, DryRunValidationResponse } from '@/features/registry';
import {
  normalizeInvitationCode,
  normalizePartyTags,
  type BatchInvitationCodeRecord,
  type InvitationCollisionStrategy,
} from '@/utils/invitationValidation';

interface CsvImportWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: () => void;
  existingCodes?: (string | undefined | null)[];
}

type EditableRow = EditableCsvRow;

interface CsvImportPersistedState {
  step: 1 | 2 | 3 | 4;
  fileName: string;
  csvHeaders: string[];
  rawRows: Record<string, string>[];
  guestNameCol: string;
  guestFirstNameCol: string;
  guestLastNameCol: string;
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
  groupByHousehold: boolean;
  collisionStrategy: InvitationCollisionStrategy;
  editableRows: EditableRow[];
  failedRows: FailedCsvExportRow[];
  importSummary?: {
    total: number;
    imported: number;
    skipped: number;
    updated: number;
    invalidSkipped?: number;
  } | null;
}

const initialCsvImportState: CsvImportPersistedState = {
  step: 1,
  fileName: '',
  csvHeaders: [],
  rawRows: [],
  guestNameCol: '',
  guestFirstNameCol: '',
  guestLastNameCol: '',
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
  groupByHousehold: false,
  collisionStrategy: 'skip',
  editableRows: [],
  failedRows: [],
  importSummary: null,
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
    const rawCode = normalizeInvitationCode(r.code);
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

function buildBatchImportPayload(
  rows: EditableRow[],
  collisionStrategy: InvitationCollisionStrategy
): { records: BatchInvitationCodeRecord[]; collisionStrategy: InvitationCollisionStrategy } {
  return {
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
      partyTags: r.partyTags ? normalizePartyTags(r.partyTags) : undefined,
      extraFields: Object.keys(r.extraFields || {}).length > 0 ? r.extraFields : undefined,
    })),
    collisionStrategy,
  };
}

type ExtendedParsedCsvRow = ParsedCsvRow & {
  isDuplicate?: boolean;
  existingGuestName?: string | null;
  actionOutcome?: 'create' | 'update' | 'skip' | 'reject' | 'invalid';
};

type EditableField =
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
  | 'partyTags';

interface EditableTableRowProps {
  row: ExtendedParsedCsvRow;
  editableRow: EditableRow;
  index: number;
  onCellEdit: (
    index: number,
    field: EditableField,
    value: string
  ) => void;
  onExtraFieldEdit: (index: number, key: string, value: string) => void;
  onDeleteRow: (index: number) => void;
}

function inferCsvErrorField(err: string): EditableField | null {
  const lower = err.toLowerCase();
  if (lower.includes('plus-one first') || lower.includes('plus one first')) {
    return 'plusOneFirstName';
  }
  if (lower.includes('plus-one last') || lower.includes('plus one last')) {
    return 'plusOneLastName';
  }
  if (lower.includes('plus-one') || lower.includes('plus one')) {
    return 'plusOneAllocations';
  }
  if (lower.includes('household')) {
    return 'householdName';
  }
  if (lower.includes('party group')) {
    return 'partyGroup';
  }
  if (lower.includes('party tag')) {
    return 'partyTags';
  }
  if (lower.includes('guest name')) {
    return 'guestName';
  }
  if (lower.includes('email')) {
    return 'email';
  }
  if (lower.includes('address line 1')) {
    return 'addressLine1';
  }
  if (lower.includes('address line 2')) {
    return 'addressLine2';
  }
  if (lower.includes('city')) {
    return 'city';
  }
  if (lower.includes('state')) {
    return 'state';
  }
  if (lower.includes('zip') || lower.includes('postal')) {
    return 'zipCode';
  }
  if (lower.includes('country')) {
    return 'country';
  }
  if (lower.includes('dietary')) {
    return 'dietaryNotes';
  }
  if (lower.includes('code')) {
    return 'code';
  }
  return null;
}

const EditableTableRow = React.memo(function EditableTableRow({
  row,
  editableRow,
  index,
  onCellEdit,
  onExtraFieldEdit,
  onDeleteRow,
}: EditableTableRowProps) {
  const cellErrorIds: Partial<Record<EditableField, string[]>> = {};
  if (row.errors && row.errors.length > 0) {
    for (let ei = 0; ei < row.errors.length; ei++) {
      const err = row.errors[ei];
      const errorId = `csv-row-${row.rowIndex}-error-${ei}`;
      let matched = false;
      if (row.fieldErrors) {
        const entries = Object.entries(row.fieldErrors) as Array<[EditableField, string[] | undefined]>;
        for (let k = 0; k < entries.length; k++) {
          const [fieldKey, msgs] = entries[k];
          if (msgs && msgs.includes(err)) {
            if (!cellErrorIds[fieldKey]) {
              cellErrorIds[fieldKey] = [errorId];
            } else {
              cellErrorIds[fieldKey]!.push(errorId);
            }
            matched = true;
          }
        }
      }
      if (!matched) {
        const inferredField = inferCsvErrorField(err);
        if (inferredField) {
          if (!cellErrorIds[inferredField]) {
            cellErrorIds[inferredField] = [errorId];
          } else {
            cellErrorIds[inferredField]!.push(errorId);
          }
        }
      }
    }
  }

  const getCellState = (field: EditableField): 'error' | 'warning' | 'default' => {
    if (cellErrorIds[field] && cellErrorIds[field]!.length > 0) {
      return 'error';
    }
    if (field === 'code' && row.warnings && row.warnings.length > 0) {
      return 'warning';
    }
    return 'default';
  };

  const getCellDescribedBy = (field: EditableField): string | undefined => {
    const ids = cellErrorIds[field];
    return ids && ids.length > 0 ? ids.join(' ') : undefined;
  };

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
        <Input
          type="text"
          value={editableRow?.guestName || ''}
          aria-label={`Guest Name for row ${row.rowIndex}`}
          aria-describedby={getCellDescribedBy('guestName')}
          onChange={(e) => onCellEdit(index, 'guestName', e.target.value)}
          sizeVariant="compact"
          state={getCellState('guestName')}
        />
      </td>
      <td className="p-2">
        <Input
          type="text"
          value={editableRow?.code || ''}
          aria-label={`Invitation Code for row ${row.rowIndex}`}
          aria-describedby={getCellDescribedBy('code')}
          placeholder={!editableRow?.code && row.code ? row.code : 'Auto-generate'}
          onChange={(e) => onCellEdit(index, 'code', e.target.value)}
          sizeVariant="compact"
          state={getCellState('code')}
          className="font-mono uppercase"
        />
      </td>
      <td className="p-2">
        <Input
          type="email"
          value={editableRow?.email || ''}
          aria-label={`Email for row ${row.rowIndex}`}
          aria-describedby={getCellDescribedBy('email')}
          placeholder="Optional"
          onChange={(e) => onCellEdit(index, 'email', e.target.value)}
          sizeVariant="compact"
          state={getCellState('email')}
        />
      </td>
      <td className="p-2">
        <Input
          type="text"
          value={editableRow?.addressLine1 || ''}
          aria-label={`Address Line 1 for row ${row.rowIndex}`}
          aria-describedby={getCellDescribedBy('addressLine1')}
          placeholder="Optional"
          onChange={(e) => onCellEdit(index, 'addressLine1', e.target.value)}
          sizeVariant="compact"
          state={getCellState('addressLine1')}
        />
      </td>
      <td className="p-2">
        <Input
          type="text"
          value={editableRow?.addressLine2 || ''}
          aria-label={`Address Line 2 for row ${row.rowIndex}`}
          aria-describedby={getCellDescribedBy('addressLine2')}
          placeholder="Optional"
          onChange={(e) => onCellEdit(index, 'addressLine2', e.target.value)}
          sizeVariant="compact"
          state={getCellState('addressLine2')}
        />
      </td>
      <td className="p-2">
        <Input
          type="text"
          value={editableRow?.city || ''}
          aria-label={`City for row ${row.rowIndex}`}
          aria-describedby={getCellDescribedBy('city')}
          placeholder="Optional"
          onChange={(e) => onCellEdit(index, 'city', e.target.value)}
          sizeVariant="compact"
          state={getCellState('city')}
        />
      </td>
      <td className="p-2">
        <Input
          type="text"
          value={editableRow?.state || ''}
          aria-label={`State for row ${row.rowIndex}`}
          aria-describedby={getCellDescribedBy('state')}
          placeholder="Optional"
          onChange={(e) => onCellEdit(index, 'state', e.target.value)}
          sizeVariant="compact"
          state={getCellState('state')}
        />
      </td>
      <td className="p-2">
        <Input
          type="text"
          value={editableRow?.zipCode || ''}
          aria-label={`ZIP Code for row ${row.rowIndex}`}
          aria-describedby={getCellDescribedBy('zipCode')}
          placeholder="Optional"
          onChange={(e) => onCellEdit(index, 'zipCode', e.target.value)}
          sizeVariant="compact"
          state={getCellState('zipCode')}
        />
      </td>
      <td className="p-2">
        <Input
          type="text"
          value={editableRow?.country || ''}
          aria-label={`Country for row ${row.rowIndex}`}
          aria-describedby={getCellDescribedBy('country')}
          placeholder="Optional"
          onChange={(e) => onCellEdit(index, 'country', e.target.value)}
          sizeVariant="compact"
          state={getCellState('country')}
        />
      </td>
      <td className="p-2">
        <Input
          type="text"
          value={editableRow?.dietaryNotes || ''}
          aria-label={`Dietary Notes for row ${row.rowIndex}`}
          aria-describedby={getCellDescribedBy('dietaryNotes')}
          placeholder="Optional"
          onChange={(e) => onCellEdit(index, 'dietaryNotes', e.target.value)}
          sizeVariant="compact"
          state={getCellState('dietaryNotes')}
        />
      </td>
      <td className="p-2 text-center">
        <Input
          type="number"
          min="0"
          value={editableRow?.plusOneAllocations ?? '0'}
          aria-label={`Plus-One Allocation for row ${row.rowIndex}`}
          aria-describedby={getCellDescribedBy('plusOneAllocations')}
          onChange={(e) => onCellEdit(index, 'plusOneAllocations', e.target.value)}
          sizeVariant="compact"
          state={getCellState('plusOneAllocations')}
          className="w-14 text-center px-1"
        />
      </td>
      <td className="p-2">
        <Input
          type="text"
          value={editableRow?.plusOneFirstName || ''}
          aria-label={`Plus-One First Name for row ${row.rowIndex}`}
          aria-describedby={getCellDescribedBy('plusOneFirstName')}
          placeholder="Optional"
          onChange={(e) => onCellEdit(index, 'plusOneFirstName', e.target.value)}
          sizeVariant="compact"
          state={getCellState('plusOneFirstName')}
        />
      </td>
      <td className="p-2">
        <Input
          type="text"
          value={editableRow?.plusOneLastName || ''}
          aria-label={`Plus-One Last Name for row ${row.rowIndex}`}
          aria-describedby={getCellDescribedBy('plusOneLastName')}
          placeholder="Optional"
          onChange={(e) => onCellEdit(index, 'plusOneLastName', e.target.value)}
          sizeVariant="compact"
          state={getCellState('plusOneLastName')}
        />
      </td>
      <td className="p-2">
        <Input
          type="text"
          value={editableRow?.householdName || ''}
          aria-label={`Household Name for row ${row.rowIndex}`}
          aria-describedby={getCellDescribedBy('householdName')}
          placeholder="Optional"
          onChange={(e) => onCellEdit(index, 'householdName', e.target.value)}
          sizeVariant="compact"
          state={getCellState('householdName')}
        />
      </td>
      <td className="p-2">
        <Input
          type="text"
          value={editableRow?.partyGroup || ''}
          aria-label={`Party Group for row ${row.rowIndex}`}
          aria-describedby={getCellDescribedBy('partyGroup')}
          placeholder="Optional"
          onChange={(e) => onCellEdit(index, 'partyGroup', e.target.value)}
          sizeVariant="compact"
          state={getCellState('partyGroup')}
        />
      </td>
      <td className="p-2">
        <Input
          type="text"
          value={editableRow?.partyTags || ''}
          aria-label={`Party Tags for row ${row.rowIndex}`}
          aria-describedby={getCellDescribedBy('partyTags')}
          placeholder="Comma-separated"
          onChange={(e) => onCellEdit(index, 'partyTags', e.target.value)}
          sizeVariant="compact"
          state={getCellState('partyTags')}
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
                <Input
                  type="text"
                  value={v}
                  aria-label={`Extra attribute ${k} for row ${row.rowIndex}`}
                  onChange={(e) => onExtraFieldEdit(index, k, e.target.value)}
                  sizeVariant="compact"
                  state="default"
                  className="w-20 text-[11px] h-6 px-1.5 py-0.5"
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
        {!editableRow?.code && row.code && (
          <span className="block text-[10px] font-mono font-bold text-blue-800 dark:text-blue-200 bg-blue-50 dark:bg-blue-950/60 px-1.5 py-0.5 rounded border border-blue-200 dark:border-blue-800">
            Matched code: {row.code}
          </span>
        )}

        {/* Error Messages */}
        {row.errors && row.errors.map((err, ei) => (
          <span
            key={ei}
            id={`csv-row-${row.rowIndex}-error-${ei}`}
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

interface WizardState extends CsvImportPersistedState {
  isValidating: boolean;
  validationSeq: number;
  serverSummary: DryRunValidationSummary | null;
  validatedRows: ExtendedParsedCsvRow[];
  statusFilter: 'all' | 'valid' | 'invalid' | 'duplicate' | 'update' | 'skip';
  codeFrequencyMap: Map<string, number>;
  isSubmitting: boolean;
  importSummary: {
    total: number;
    imported: number;
    skipped: number;
    updated: number;
    invalidSkipped?: number;
  } | null;
}

type WizardAction =
  | { type: 'SET_STEP'; step: 1 | 2 | 3 | 4 }
  | {
    type: 'FILE_UPLOADED';
    fileName: string;
    headers: string[];
    rawRows: Record<string, string>[];
    suggestedGuestNameCol: string;
    suggestedGuestFirstNameCol?: string;
    suggestedGuestLastNameCol?: string;
    guestFirstNameCol?: string;
    guestLastNameCol?: string;
    suggestedCodeCol: string;
    suggestedEmailCol: string;
    suggestedAddressLine1Col: string;
    suggestedAddressLine2Col: string;
    suggestedCityCol: string;
    suggestedStateCol: string;
    suggestedZipCodeCol: string;
    suggestedCountryCol: string;
    suggestedDietaryNotesCol: string;
    suggestedPlusOneCol: string;
    suggestedPlusOneFirstNameCol: string;
    suggestedPlusOneLastNameCol: string;
    suggestedHouseholdNameCol: string;
    suggestedPartyGroupCol: string;
    suggestedPartyTagsCol: string;
    selectedExtraCols: string[];
  }
  | { type: 'SET_COLUMN_MAPPING'; field: keyof CsvImportPersistedState; value: string }
  | { type: 'TOGGLE_EXTRA_COL'; header: string }
  | { type: 'SET_GROUP_BY_HOUSEHOLD'; enabled: boolean }
  | { type: 'SET_COLLISION_STRATEGY'; strategy: 'skip' | 'update' | 'reject' }
  | {
    type: 'CONFIRM_MAPPING';
    editableRows: EditableRow[];
    validatedRows: ExtendedParsedCsvRow[];
    freqMap: Map<string, number>;
  }
  | {
    type: 'EDIT_CELL';
    index: number;
    field: EditableField;
    value: string;
  }
  | {
    type: 'EDIT_EXTRA_FIELD';
    index: number;
    key: string;
    value: string;
  }
  | { type: 'DELETE_ROW'; index: number }
  | { type: 'SET_STATUS_FILTER'; filter: 'all' | 'valid' | 'invalid' | 'duplicate' | 'update' | 'skip' }
  | { type: 'VALIDATION_START'; seq: number }
  | {
    type: 'VALIDATION_SUCCESS';
    seq: number;
    summary: DryRunValidationSummary;
    rows: ExtendedParsedCsvRow[];
  }
  | {
    type: 'VALIDATION_LOCAL';
    seq: number;
    rows: ExtendedParsedCsvRow[];
    freqMap: Map<string, number>;
  }
  | { type: 'VALIDATION_ABORT'; seq?: number }
  | { type: 'COMMIT_START' }
  | {
    type: 'COMMIT_SUCCESS';
    summary: {
      total: number;
      imported: number;
      skipped: number;
      updated: number;
      invalidSkipped?: number;
    };
    failedRows: FailedCsvExportRow[];
  }
  | { type: 'COMMIT_FAILURE'; error?: string }
  | { type: 'RESET_MODAL' };

const initialWizardState: WizardState = {
  ...initialCsvImportState,
  importSummary: null,
  isValidating: false,
  validationSeq: 0,
  serverSummary: null,
  validatedRows: [],
  statusFilter: 'all',
  codeFrequencyMap: new Map(),
  isSubmitting: false,
};

function computeWizardSummary(
  serverSummary: DryRunValidationSummary | null,
  editableRows: EditableRow[],
  validatedRows: ExtendedParsedCsvRow[],
  collisionStrategy: 'skip' | 'update' | 'reject'
) {
  if (serverSummary) {
    return serverSummary;
  }
  const total = editableRows.length;
  const validCount = validatedRows.filter((r) => r.isValid).length;
  const invalidCount = validatedRows.filter((r) => !r.isValid).length;
  const duplicateCount = validatedRows.filter(
    (r) =>
      r.isDuplicate ||
      r.existingGuestName ||
      r.warnings?.some((w) => w.includes('already exists') || w.includes('Duplicate')) ||
      r.errors?.some((e) => e.includes('Duplicate'))
  ).length;
  const updatedCount = validatedRows.filter(
    (r) =>
      r.actionOutcome === 'update' ||
      (collisionStrategy === 'update' && r.warnings?.some((w) => w.includes('Will be updated')))
  ).length;
  const skippedCount = validatedRows.filter(
    (r) =>
      r.actionOutcome === 'skip' ||
      (collisionStrategy === 'skip' && r.warnings?.some((w) => w.includes('Will be skipped')))
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

function initWizardState(initial: WizardState, existingDbSet: Set<string>): WizardState {
  if (typeof window === 'undefined') return initial;
  try {
    const saved = window.sessionStorage.getItem('csv_import_wizard_draft');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (typeof parsed === 'object' && parsed !== null) {
        let validatedRows: ExtendedParsedCsvRow[] = [];
        let freqMap = new Map<string, number>();
        if (parsed.step === 3 && Array.isArray(parsed.editableRows) && parsed.editableRows.length > 0) {
          const res = computeFullValidation(parsed.editableRows, parsed.selectedExtraCols || [], existingDbSet);
          validatedRows = res.parsed;
          freqMap = res.freqMap;
        }
        return {
          ...initial,
          ...parsed,
          groupByHousehold: Boolean(parsed.groupByHousehold),
          failedRows: Array.isArray(parsed.failedRows) ? parsed.failedRows : [],
          importSummary: parsed.importSummary ?? null,
          validatedRows,
          codeFrequencyMap: freqMap,
        };
      }
    }
  } catch (err) {
    console.warn('initWizardState: Failed to read from sessionStorage:', err);
  }
  return initial;
}

function wizardReducer(
  state: WizardState,
  action: WizardAction,
  existingDbSet: Set<string>
): WizardState {
  switch (action.type) {
    case 'SET_STEP': {
      if (action.step !== 3) {
        return {
          ...state,
          step: action.step,
          validatedRows: [],
          serverSummary: null,
          codeFrequencyMap: new Map(),
          isValidating: false,
        };
      }
      return {
        ...state,
        step: action.step,
      };
    }
    case 'FILE_UPLOADED': {
      return {
        ...state,
        step: 2,
        fileName: action.fileName,
        csvHeaders: action.headers,
        rawRows: action.rawRows,
        guestNameCol: action.suggestedGuestNameCol,
        guestFirstNameCol: action.suggestedGuestFirstNameCol || action.guestFirstNameCol || '',
        guestLastNameCol: action.suggestedGuestLastNameCol || action.guestLastNameCol || '',
        codeCol: action.suggestedCodeCol,
        emailCol: action.suggestedEmailCol,
        addressLine1Col: action.suggestedAddressLine1Col,
        addressLine2Col: action.suggestedAddressLine2Col,
        cityCol: action.suggestedCityCol,
        stateCol: action.suggestedStateCol,
        zipCodeCol: action.suggestedZipCodeCol,
        countryCol: action.suggestedCountryCol,
        dietaryNotesCol: action.suggestedDietaryNotesCol,
        plusOneCol: action.suggestedPlusOneCol,
        plusOneFirstNameCol: action.suggestedPlusOneFirstNameCol,
        plusOneLastNameCol: action.suggestedPlusOneLastNameCol,
        householdNameCol: action.suggestedHouseholdNameCol,
        partyGroupCol: action.suggestedPartyGroupCol,
        partyTagsCol: action.suggestedPartyTagsCol,
        selectedExtraCols: action.selectedExtraCols,
      };
    }
    case 'SET_COLUMN_MAPPING': {
      return {
        ...state,
        [action.field]: action.value,
      };
    }
    case 'TOGGLE_EXTRA_COL': {
      return {
        ...state,
        selectedExtraCols: state.selectedExtraCols.includes(action.header)
          ? state.selectedExtraCols.filter((h) => h !== action.header)
          : [...state.selectedExtraCols, action.header],
      };
    }
    case 'SET_GROUP_BY_HOUSEHOLD': {
      return {
        ...state,
        groupByHousehold: action.enabled,
      };
    }
    case 'SET_COLLISION_STRATEGY': {
      return {
        ...state,
        collisionStrategy: action.strategy,
        serverSummary: null,
        validationSeq: state.validationSeq + 1,
      };
    }
    case 'CONFIRM_MAPPING': {
      return {
        ...state,
        editableRows: action.editableRows,
        validatedRows: action.validatedRows,
        codeFrequencyMap: action.freqMap,
        failedRows: [],
        serverSummary: null,
        step: 3,
      };
    }
    case 'EDIT_CELL': {
      const { index, field, value } = action;
      const updatedValue = field === 'code' ? value.toUpperCase() : value;
      const oldRow = state.editableRows[index];
      if (!oldRow) return state;

      const updatedEditableRows = [...state.editableRows];
      const updatedRow = {
        ...oldRow,
        [field]: updatedValue,
      };
      updatedEditableRows[index] = updatedRow;

      const mapping: ColumnMappingOptions = {
        ...EDITABLE_MAPPING,
        extraCols: state.selectedExtraCols,
      };

      const nextValidated = [...state.validatedRows];
      let nextFreqMap = state.codeFrequencyMap;

      if (field !== 'code') {
        if (nextValidated.length === updatedEditableRows.length) {
          nextValidated[index] = validateSingleCsvRow(
            toRowRecord(updatedRow),
            index,
            mapping,
            state.codeFrequencyMap,
            existingDbSet,
            HOISTED_EDITABLE_MAPPED_COLS
          );
        }
      } else {
        const oldCode = (oldRow.code || '').trim().toUpperCase();
        const newCode = (value || '').trim().toUpperCase();

        if (oldCode !== newCode) {
          nextFreqMap = new Map(state.codeFrequencyMap);
          if (oldCode) {
            const count = nextFreqMap.get(oldCode) || 0;
            if (count <= 1) nextFreqMap.delete(oldCode);
            else nextFreqMap.set(oldCode, count - 1);
          }
          if (newCode) {
            nextFreqMap.set(newCode, (nextFreqMap.get(newCode) || 0) + 1);
          }

          if (nextValidated.length === updatedEditableRows.length) {
            for (let i = 0; i < updatedEditableRows.length; i++) {
              const rCode = i === index ? newCode : (updatedEditableRows[i].code || '').trim().toUpperCase();
              if (i === index || rCode === oldCode || rCode === newCode) {
                const rowToVal = i === index ? updatedRow : updatedEditableRows[i];
                nextValidated[i] = validateSingleCsvRow(
                  toRowRecord(rowToVal),
                  i,
                  mapping,
                  nextFreqMap,
                  existingDbSet,
                  HOISTED_EDITABLE_MAPPED_COLS
                );
              }
            }
          }
        }
      }

      return {
        ...state,
        editableRows: updatedEditableRows,
        validatedRows: nextValidated,
        codeFrequencyMap: nextFreqMap,
        serverSummary: null,
        validationSeq: state.validationSeq + 1,
      };
    }
    case 'EDIT_EXTRA_FIELD': {
      const { index, key, value } = action;
      const oldRow = state.editableRows[index];
      if (!oldRow) return state;

      const updatedEditableRows = [...state.editableRows];
      const updatedRow = {
        ...oldRow,
        extraFields: { ...oldRow.extraFields, [key]: value },
      };
      updatedEditableRows[index] = updatedRow;

      const mapping: ColumnMappingOptions = {
        ...EDITABLE_MAPPING,
        extraCols: state.selectedExtraCols,
      };

      const nextValidated = [...state.validatedRows];
      if (nextValidated.length === updatedEditableRows.length) {
        nextValidated[index] = validateSingleCsvRow(
          toRowRecord(updatedRow),
          index,
          mapping,
          state.codeFrequencyMap,
          existingDbSet,
          HOISTED_EDITABLE_MAPPED_COLS
        );
      }

      return {
        ...state,
        editableRows: updatedEditableRows,
        validatedRows: nextValidated,
        serverSummary: null,
        validationSeq: state.validationSeq + 1,
      };
    }
    case 'DELETE_ROW': {
      const { index } = action;
      const deletedRow = state.editableRows[index];
      if (!deletedRow) return state;
      const deletedCode = (deletedRow.code || '').trim().toUpperCase();

      const remainingEditable = state.editableRows.filter((_, i) => i !== index);

      let nextFreqMap = state.codeFrequencyMap;
      if (deletedCode) {
        nextFreqMap = new Map(state.codeFrequencyMap);
        const count = nextFreqMap.get(deletedCode) || 0;
        if (count <= 1) nextFreqMap.delete(deletedCode);
        else nextFreqMap.set(deletedCode, count - 1);
      }

      const mapping: ColumnMappingOptions = {
        ...EDITABLE_MAPPING,
        extraCols: state.selectedExtraCols,
      };

      const remainingValidated = state.validatedRows.filter((_, i) => i !== index);
      const nextValidated = remainingValidated.map((row, i) => {
        const rCode = (remainingEditable[i].code || '').trim().toUpperCase();
        if (rCode === deletedCode) {
          return validateSingleCsvRow(
            toRowRecord(remainingEditable[i]),
            i,
            mapping,
            nextFreqMap,
            existingDbSet,
            HOISTED_EDITABLE_MAPPED_COLS
          );
        }
        return { ...row, rowIndex: i + 1 };
      });

      return {
        ...state,
        editableRows: remainingEditable,
        validatedRows: nextValidated,
        codeFrequencyMap: nextFreqMap,
        serverSummary: null,
        validationSeq: state.validationSeq + 1,
      };
    }
    case 'SET_STATUS_FILTER': {
      return {
        ...state,
        statusFilter: action.filter,
      };
    }
    case 'VALIDATION_START': {
      return {
        ...state,
        isValidating: true,
        validationSeq: action.seq,
      };
    }
    case 'VALIDATION_SUCCESS': {
      if (action.seq !== state.validationSeq) {
        return state;
      }
      return {
        ...state,
        serverSummary: action.summary,
        validatedRows: action.rows,
        isValidating: false,
      };
    }
    case 'VALIDATION_LOCAL': {
      if (action.seq !== state.validationSeq) {
        return state;
      }
      return {
        ...state,
        serverSummary: null,
        validatedRows: action.rows,
        codeFrequencyMap: action.freqMap,
        isValidating: false,
      };
    }
    case 'VALIDATION_ABORT': {
      return {
        ...state,
        isValidating: false,
      };
    }
    case 'COMMIT_START': {
      return {
        ...state,
        isSubmitting: true,
      };
    }
    case 'COMMIT_SUCCESS': {
      return {
        ...state,
        isSubmitting: false,
        importSummary: action.summary,
        failedRows: action.failedRows,
        step: 4,
      };
    }
    case 'COMMIT_FAILURE': {
      return {
        ...state,
        isSubmitting: false,
      };
    }
    case 'RESET_MODAL': {
      return {
        ...initialWizardState,
      };
    }
    default:
      return state;
  }
}

export function CsvImportWizardModal({
  isOpen,
  onClose,
  onImportComplete,
  existingCodes = [],
}: CsvImportWizardModalProps) {
  const { addToast } = useToast();

  const existingDbSet = useMemo(
    () =>
      new Set(
        (existingCodes || [])
          .filter((c): c is string => typeof c === 'string' && Boolean(c.trim()))
          .map((c) => c.trim().toUpperCase())
      ),
    [existingCodes]
  );

  const existingDbSetRef = useRef(existingDbSet);

  const [state, rawDispatch] = useReducer(
    (s: WizardState, a: WizardAction) => wizardReducer(s, a, existingDbSet),
    initialWizardState,
    (init) => initWizardState(init, existingDbSet)
  );

  const stateRef = useRef(state);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    existingDbSetRef.current = existingDbSet;
  }, [existingDbSet]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const dispatch = useCallback((action: WizardAction) => {
    stateRef.current = wizardReducer(stateRef.current, action, existingDbSetRef.current);
    rawDispatch(action);
  }, []);

  const {
    step,
    fileName,
    csvHeaders,
    rawRows,
    guestNameCol,
    guestFirstNameCol,
    guestLastNameCol,
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
    groupByHousehold,
    collisionStrategy,
    editableRows,
    failedRows,
    isValidating,
    serverSummary,
    validatedRows,
    statusFilter,
    isSubmitting,
    importSummary,
  } = state;

  // Sync draft state to sessionStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (
        step === 1 &&
        !fileName &&
        rawRows.length === 0 &&
        editableRows.length === 0 &&
        failedRows.length === 0 &&
        !importSummary
      ) {
        window.sessionStorage.removeItem('csv_import_wizard_draft');
        return;
      }
      const persisted: CsvImportPersistedState = {
        step,
        fileName,
        csvHeaders,
        rawRows,
        guestNameCol,
        guestFirstNameCol,
        guestLastNameCol,
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
        groupByHousehold,
        collisionStrategy,
        editableRows,
        failedRows,
        importSummary,
      };
      window.sessionStorage.setItem('csv_import_wizard_draft', JSON.stringify(persisted));
    } catch (err) {
      console.warn('Failed to write key "csv_import_wizard_draft" to sessionStorage:', err);
    }
  }, [
    step,
    fileName,
    csvHeaders,
    rawRows,
    guestNameCol,
    guestFirstNameCol,
    guestLastNameCol,
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
    groupByHousehold,
    collisionStrategy,
    editableRows,
    failedRows,
    importSummary,
  ]);

  const setStep = (s: 1 | 2 | 3 | 4) => dispatch({ type: 'SET_STEP', step: s });
  const setCollisionStrategy = (strategy: 'skip' | 'update' | 'reject') =>
    dispatch({ type: 'SET_COLLISION_STRATEGY', strategy });
  const setStatusFilter = (filter: 'all' | 'valid' | 'invalid' | 'duplicate' | 'update' | 'skip') =>
    dispatch({ type: 'SET_STATUS_FILTER', filter });
  const toggleExtraCol = (header: string) => dispatch({ type: 'TOGGLE_EXTRA_COL', header });

  const setGuestNameCol = (val: string) => dispatch({ type: 'SET_COLUMN_MAPPING', field: 'guestNameCol', value: val });
  const setGuestFirstNameCol = (val: string) => dispatch({ type: 'SET_COLUMN_MAPPING', field: 'guestFirstNameCol', value: val });
  const setGuestLastNameCol = (val: string) => dispatch({ type: 'SET_COLUMN_MAPPING', field: 'guestLastNameCol', value: val });
  const setCodeCol = (val: string) => dispatch({ type: 'SET_COLUMN_MAPPING', field: 'codeCol', value: val });
  const setEmailCol = (val: string) => dispatch({ type: 'SET_COLUMN_MAPPING', field: 'emailCol', value: val });
  const setAddressLine1Col = (val: string) => dispatch({ type: 'SET_COLUMN_MAPPING', field: 'addressLine1Col', value: val });
  const setAddressLine2Col = (val: string) => dispatch({ type: 'SET_COLUMN_MAPPING', field: 'addressLine2Col', value: val });
  const setCityCol = (val: string) => dispatch({ type: 'SET_COLUMN_MAPPING', field: 'cityCol', value: val });
  const setStateCol = (val: string) => dispatch({ type: 'SET_COLUMN_MAPPING', field: 'stateCol', value: val });
  const setZipCodeCol = (val: string) => dispatch({ type: 'SET_COLUMN_MAPPING', field: 'zipCodeCol', value: val });
  const setCountryCol = (val: string) => dispatch({ type: 'SET_COLUMN_MAPPING', field: 'countryCol', value: val });
  const setDietaryNotesCol = (val: string) => dispatch({ type: 'SET_COLUMN_MAPPING', field: 'dietaryNotesCol', value: val });
  const setPlusOneCol = (val: string) => dispatch({ type: 'SET_COLUMN_MAPPING', field: 'plusOneCol', value: val });
  const setPlusOneFirstNameCol = (val: string) => dispatch({ type: 'SET_COLUMN_MAPPING', field: 'plusOneFirstNameCol', value: val });
  const setPlusOneLastNameCol = (val: string) => dispatch({ type: 'SET_COLUMN_MAPPING', field: 'plusOneLastNameCol', value: val });
  const setHouseholdNameCol = (val: string) => dispatch({ type: 'SET_COLUMN_MAPPING', field: 'householdNameCol', value: val });
  const setPartyGroupCol = (val: string) => dispatch({ type: 'SET_COLUMN_MAPPING', field: 'partyGroupCol', value: val });
  const setPartyTagsCol = (val: string) => dispatch({ type: 'SET_COLUMN_MAPPING', field: 'partyTagsCol', value: val });

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

      const mappedStandard = new Set(
        [
          parsed.suggestedGuestNameCol,
          parsed.suggestedGuestFirstNameCol || parsed.guestFirstNameCol,
          parsed.suggestedGuestLastNameCol || parsed.guestLastNameCol,
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

      const selectedExtraCols = parsed.headers.filter((h) => !mappedStandard.has(h));

      dispatch({
        type: 'FILE_UPLOADED',
        fileName: file.name,
        headers: parsed.headers,
        rawRows: parsed.rows,
        suggestedGuestNameCol: parsed.suggestedGuestNameCol,
        suggestedGuestFirstNameCol: parsed.suggestedGuestFirstNameCol || parsed.guestFirstNameCol || '',
        suggestedGuestLastNameCol: parsed.suggestedGuestLastNameCol || parsed.guestLastNameCol || '',
        guestFirstNameCol: parsed.suggestedGuestFirstNameCol || parsed.guestFirstNameCol || '',
        guestLastNameCol: parsed.suggestedGuestLastNameCol || parsed.guestLastNameCol || '',
        suggestedCodeCol: parsed.suggestedCodeCol,
        suggestedEmailCol: parsed.suggestedEmailCol || '',
        suggestedAddressLine1Col: parsed.suggestedAddressLine1Col || '',
        suggestedAddressLine2Col: parsed.suggestedAddressLine2Col || '',
        suggestedCityCol: parsed.suggestedCityCol || '',
        suggestedStateCol: parsed.suggestedStateCol || '',
        suggestedZipCodeCol: parsed.suggestedZipCodeCol || '',
        suggestedCountryCol: parsed.suggestedCountryCol || '',
        suggestedDietaryNotesCol: parsed.suggestedDietaryNotesCol || '',
        suggestedPlusOneCol: parsed.suggestedPlusOneCol || '',
        suggestedPlusOneFirstNameCol: parsed.suggestedPlusOneFirstNameCol || '',
        suggestedPlusOneLastNameCol: parsed.suggestedPlusOneLastNameCol || '',
        suggestedHouseholdNameCol: parsed.suggestedHouseholdNameCol || '',
        suggestedPartyGroupCol: parsed.suggestedPartyGroupCol || '',
        suggestedPartyTagsCol: parsed.suggestedPartyTagsCol || '',
        selectedExtraCols,
      });
    };

    reader.readAsText(file, 'UTF-8');
  };

  const handleConfirmMapping = () => {
    if (!guestNameCol && !guestFirstNameCol && !guestLastNameCol) {
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

      let guestName = '';
      if (guestNameCol) {
        guestName = (r[guestNameCol] || '').trim();
      } else if (guestFirstNameCol || guestLastNameCol) {
        guestName = combineFirstAndLastName(
          guestFirstNameCol ? r[guestFirstNameCol] : '',
          guestLastNameCol ? r[guestLastNameCol] : ''
        );
      }

      return {
        guestName,
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

    const activeGroupByField: 'householdName' | 'partyGroup' | null = householdNameCol
      ? 'householdName'
      : partyGroupCol
        ? 'partyGroup'
        : null;

    const mappedRows =
      groupByHousehold && activeGroupByField
        ? consolidateHouseholdCsvRows(initialMapped, {
          groupBy: activeGroupByField,
          rawFirstNames: guestFirstNameCol
            ? rawRows.map((r) => (r[guestFirstNameCol] || '').trim())
            : undefined,
          rawLastNames: guestLastNameCol
            ? rawRows.map((r) => (r[guestLastNameCol] || '').trim())
            : undefined,
        })
        : initialMapped;

    const { parsed, freqMap } = computeFullValidation(
      mappedRows,
      selectedExtraCols,
      existingDbSetRef.current
    );

    dispatch({
      type: 'CONFIRM_MAPPING',
      editableRows: mappedRows,
      validatedRows: parsed,
      freqMap,
    });
  };

  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingValidationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const inFlightValidationRef = useRef<Promise<void> | null>(null);
  const prevStepRef = useRef<number | null>(null);
  const prevStrategyRef = useRef<'skip' | 'update' | 'reject' | null>(null);

  const runDryRunValidation = useCallback(
    async (rows: EditableRow[], strategy: 'skip' | 'update' | 'reject') => {
      if (rows.length === 0) {
        dispatch({ type: 'VALIDATION_LOCAL', seq: stateRef.current.validationSeq, rows: [], freqMap: new Map() });
        return;
      }

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      const seq = stateRef.current.validationSeq + 1;
      dispatch({ type: 'VALIDATION_START', seq });

      try {
        const payload = buildBatchImportPayload(rows, strategy);

        const res = await fetch('/api/admin/invitation-codes/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (controller.signal.aborted) {
          dispatch({ type: 'VALIDATION_ABORT', seq });
          return;
        }

        if (res.ok) {
          const data: DryRunValidationResponse = await res.json();
          if (controller.signal.aborted) {
            dispatch({ type: 'VALIDATION_ABORT', seq });
            return;
          }

          if (data && data.success && data.summary && data.rows) {
            dispatch({
              type: 'VALIDATION_SUCCESS',
              seq,
              summary: data.summary,
              rows: data.rows as ExtendedParsedCsvRow[],
            });
            return;
          }
        }
      } catch (err: unknown) {
        const isAbortError =
          typeof err === 'object' &&
          err !== null &&
          'name' in err &&
          (err as { name?: unknown }).name === 'AbortError';
        if (controller.signal.aborted || isAbortError) {
          dispatch({ type: 'VALIDATION_ABORT', seq });
          return;
        }
        // Fallback to local computation if fetch is unhandled / unreachable
      }

      if (controller.signal.aborted) {
        dispatch({ type: 'VALIDATION_ABORT', seq });
        return;
      }

      const { parsed, freqMap } = computeFullValidation(
        rows,
        stateRef.current.selectedExtraCols,
        existingDbSetRef.current
      );
      dispatch({
        type: 'VALIDATION_LOCAL',
        seq,
        rows: parsed,
        freqMap,
      });
    },
    [dispatch]
  );

  const executeValidation = useCallback(
    (rows: EditableRow[], strategy: 'skip' | 'update' | 'reject') => {
      const promise = runDryRunValidation(rows, strategy);
      inFlightValidationRef.current = promise;
      promise.finally(() => {
        if (inFlightValidationRef.current === promise) {
          inFlightValidationRef.current = null;
        }
      });
      return promise;
    },
    [runDryRunValidation]
  );

  useEffect(() => {
    if (step === 3 && editableRows.length > 0) {
      const isInitialStep3 = prevStepRef.current !== 3;
      const isStrategyChanged = prevStrategyRef.current !== collisionStrategy;

      prevStepRef.current = step;
      prevStrategyRef.current = collisionStrategy;

      if (pendingValidationTimerRef.current) {
        clearTimeout(pendingValidationTimerRef.current);
        pendingValidationTimerRef.current = null;
      }

      if (isInitialStep3 || isStrategyChanged) {
        executeValidation(editableRows, collisionStrategy);
      } else {
        pendingValidationTimerRef.current = setTimeout(() => {
          pendingValidationTimerRef.current = null;
          executeValidation(editableRows, collisionStrategy);
        }, 400);
      }
    } else if (step !== 3) {
      if (pendingValidationTimerRef.current) {
        clearTimeout(pendingValidationTimerRef.current);
        pendingValidationTimerRef.current = null;
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      prevStepRef.current = step;
      prevStrategyRef.current = collisionStrategy;
      dispatch({ type: 'VALIDATION_ABORT' });
    }

    return () => {
      if (pendingValidationTimerRef.current) {
        clearTimeout(pendingValidationTimerRef.current);
        pendingValidationTimerRef.current = null;
      }
    };
  }, [step, editableRows, collisionStrategy, executeValidation, dispatch]);

  useEffect(() => {
    return () => {
      if (pendingValidationTimerRef.current) {
        clearTimeout(pendingValidationTimerRef.current);
        pendingValidationTimerRef.current = null;
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  const flushPendingValidation = useCallback(async () => {
    if (pendingValidationTimerRef.current) {
      clearTimeout(pendingValidationTimerRef.current);
      pendingValidationTimerRef.current = null;
      const promise = executeValidation(stateRef.current.editableRows, stateRef.current.collisionStrategy);
      await promise;
    } else if (inFlightValidationRef.current) {
      await inFlightValidationRef.current;
    }
  }, [executeValidation]);

  const summary = useMemo(() => {
    return computeWizardSummary(serverSummary, editableRows, validatedRows, collisionStrategy);
  }, [serverSummary, editableRows, validatedRows, collisionStrategy]);

  const hasRejectCollision = useMemo(
    () =>
      collisionStrategy === 'reject' &&
      validatedRows.some((r) => r.actionOutcome === 'reject'),
    [collisionStrategy, validatedRows]
  );

  const currentFailedRows = useMemo<FailedCsvExportRow[]>(() => {
    const collected: FailedCsvExportRow[] = [];
    for (let i = 0; i < validatedRows.length; i++) {
      const vRow = validatedRows[i];
      const eRow = editableRows[i];
      if (vRow && eRow && !vRow.isValid) {
        collected.push({
          row: eRow,
          errors: vRow.errors && vRow.errors.length > 0 ? vRow.errors : ['Invalid row'],
        });
      }
    }
    return collected;
  }, [validatedRows, editableRows]);

  const handleDownloadFailedRows = useCallback(
    (rowsToExport: FailedCsvExportRow[]) => {
      if (rowsToExport.length === 0) return;
      const csvText = generateFailedRowsCsv(rowsToExport, selectedExtraCols);
      const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
      if (typeof window !== 'undefined' && typeof window.URL?.createObjectURL === 'function') {
        let url: string | null = null;
        try {
          url = window.URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.setAttribute('download', 'rows_to_fix.csv');
          link.setAttribute('aria-label', 'Download Rows to Fix');
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
    },
    [selectedExtraCols]
  );

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
    field: EditableField,
    value: string
  ) => {
    dispatch({ type: 'EDIT_CELL', index, field, value });
  }, [dispatch]);

  const handleExtraFieldEdit = useCallback((index: number, key: string, value: string) => {
    dispatch({ type: 'EDIT_EXTRA_FIELD', index, key, value });
  }, [dispatch]);

  const handleDeleteRow = useCallback((index: number) => {
    dispatch({ type: 'DELETE_ROW', index });
  }, [dispatch]);

  const handleCommitBatch = async () => {
    if (stateRef.current.editableRows.length === 0) {
      addToast('No records to import.', 'error');
      return;
    }

    await flushPendingValidation();

    const latest = stateRef.current;

    if (latest.isValidating) {
      addToast('Validation in progress. Please wait.', 'error');
      return;
    }

    const latestHasRejectCollision =
      latest.collisionStrategy === 'reject' &&
      latest.validatedRows.some((r) => r.actionOutcome === 'reject');

    if (latestHasRejectCollision) {
      addToast(
        'Duplicate invitation codes detected while "Reject Batch on Duplicate" is selected.',
        'error'
      );
      return;
    }

    const validEditableRows: EditableRow[] = [];
    const skippedFailedRows: FailedCsvExportRow[] = [];

    const rowsForEvaluation =
      latest.validatedRows.length === latest.editableRows.length
        ? latest.validatedRows
        : computeFullValidation(
          latest.editableRows,
          latest.selectedExtraCols,
          existingDbSetRef.current
        ).parsed;

    for (let i = 0; i < latest.editableRows.length; i++) {
      const vRow = rowsForEvaluation[i];
      const eRow = latest.editableRows[i];
      if (vRow && vRow.isValid) {
        validEditableRows.push(eRow);
      } else if (eRow) {
        skippedFailedRows.push({
          row: eRow,
          errors: vRow?.errors && vRow.errors.length > 0 ? vRow.errors : ['Invalid row'],
        });
      }
    }

    if (validEditableRows.length === 0) {
      addToast('Please fix or remove invalid rows before submitting.', 'error');
      return;
    }

    dispatch({ type: 'COMMIT_START' });
    try {
      const payload = buildBatchImportPayload(validEditableRows, latest.collisionStrategy);

      const res = await fetch('/api/admin/invitation-codes/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Batch import failed.');
      }

      dispatch({
        type: 'COMMIT_SUCCESS',
        summary: {
          total: data.count || validEditableRows.length,
          imported: data.imported || 0,
          skipped: data.skipped || 0,
          updated: data.updated || 0,
          invalidSkipped: skippedFailedRows.length,
        },
        failedRows: skippedFailedRows,
      });
      addToast('Batch CSV import completed successfully.', 'success');
      onImportComplete();
    } catch (err: unknown) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : typeof err === 'object' &&
              err !== null &&
              'message' in err &&
              typeof (err as { message?: unknown }).message === 'string' &&
              (err as { message: string }).message
            ? (err as { message: string }).message
            : '';
      dispatch({ type: 'COMMIT_FAILURE', error: message });
      addToast(message || 'Failed to execute batch import.', 'error');
    }
  };

  const handleResetModal = () => {
    if (typeof window !== 'undefined') {
      try {
        window.sessionStorage.removeItem('csv_import_wizard_draft');
      } catch (err) {
        console.warn('Failed to clear sessionStorage:', err);
      }
    }
    dispatch({ type: 'RESET_MODAL' });
    onClose();
  };

  // Get unmapped headers for custom field checkbox selection
  const mappedStandardHeaders = useMemo(() => {
    return new Set(
      [
        guestNameCol,
        guestFirstNameCol,
        guestLastNameCol,
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
    guestFirstNameCol,
    guestLastNameCol,
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
      <div className="space-y-6 max-h-[80vh] overflow-y-auto pr-1">
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
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                id="csv-file-input"
                onChange={handleFileUpload}
                className="hidden"
              />
              <label
                htmlFor="csv-file-input"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                className="cursor-pointer flex flex-col items-center justify-center space-y-2 rounded-lg focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
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
                <Label htmlFor="map-guest-first-name">Guest First Name Column (Optional)</Label>
                <select
                  id="map-guest-first-name"
                  value={guestFirstNameCol}
                  onChange={(e) => setGuestFirstNameCol(e.target.value)}
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
                <Label htmlFor="map-guest-last-name">Guest Last Name Column (Optional)</Label>
                <select
                  id="map-guest-last-name"
                  value={guestLastNameCol}
                  onChange={(e) => setGuestLastNameCol(e.target.value)}
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

            {/* Household / Party Consolidation Toggle */}
            <div className="bg-purple-50/70 dark:bg-purple-950/20 p-3.5 rounded-lg border border-purple-200 dark:border-purple-800/60">
              <label htmlFor="group-by-household-toggle" className="flex items-start gap-2.5 cursor-pointer">
                <input
                  id="group-by-household-toggle"
                  type="checkbox"
                  checked={groupByHousehold}
                  onChange={(e) =>
                    dispatch({ type: 'SET_GROUP_BY_HOUSEHOLD', enabled: e.target.checked })
                  }
                  className="mt-0.5 rounded border-gray-300 dark:border-zinc-700 text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                />
                <span className="space-y-0.5">
                  <span className="block text-xs font-bold text-gray-900 dark:text-zinc-100">
                    Consolidate rows sharing a Household or Party onto one invitation
                  </span>
                  <span className="block text-xs text-gray-600 dark:text-zinc-300">
                    {householdNameCol || partyGroupCol
                      ? `Rows sharing the same "${householdNameCol || partyGroupCol}" value will be grouped into one invitation with companion names, combined plus-one allocations, dietary notes, and tags.`
                      : 'Select a Household Name or Party Side / Group column above to consolidate multi-row households onto one invitation.'}
                  </span>
                </span>
              </label>
            </div>

            {/* Preview snippet */}
            <div className="bg-gray-50 dark:bg-zinc-800 p-3 rounded-lg border border-gray-200 dark:border-zinc-700">
              <h4 className="text-xs font-bold uppercase text-gray-500 mb-2">Sample Data Preview (First 3 rows)</h4>
              <div className="space-y-1 text-xs">
                {rawRows.slice(0, 3).map((r, i) => {
                  let previewName = '';
                  if (guestNameCol) {
                    previewName = (r[guestNameCol] || '').trim();
                  } else if (guestFirstNameCol || guestLastNameCol) {
                    previewName = combineFirstAndLastName(
                      guestFirstNameCol ? r[guestFirstNameCol] : '',
                      guestLastNameCol ? r[guestLastNameCol] : ''
                    );
                  }
                  return (
                    <div key={i} className="flex flex-wrap justify-between py-1 border-b last:border-0 border-gray-200 dark:border-zinc-700 gap-2">
                      <span>
                        <strong>Name:</strong> {previewName || <em className="text-red-400">&lt;empty&gt;</em>}
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
                  );
                })}
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
                    onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
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
                    onChange={(e) => setCollisionStrategy(e.target.value as InvitationCollisionStrategy)}
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
              <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 p-2.5 rounded-lg text-xs font-semibold flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span>⚠️</span>
                  <span>
                    {hasRejectCollision
                      ? `Duplicate collision(s) detected while "Reject Batch on Duplicate" is active. Change duplicate action or resolve ${summary.invalidCount} row(s).`
                      : summary.validCount > 0
                        ? `${summary.invalidCount} invalid row(s) have validation errors and will be skipped if you import now. Fix them inline or download them for cleanup.`
                        : `Please fix or remove the ${summary.invalidCount} invalid row(s) in the table before submitting the batch import.`}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleDownloadFailedRows(currentFailedRows)}
                  className="text-xs font-semibold shrink-0"
                >
                  Download Rows to Fix
                </Button>
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
                disabled={
                  isSubmitting ||
                  isValidating ||
                  editableRows.length === 0 ||
                  summary.validCount === 0 ||
                  hasRejectCollision
                }
              >
                {isSubmitting
                  ? 'Importing Batch...'
                  : summary.invalidCount > 0 && summary.validCount > 0 && !hasRejectCollision
                    ? `Import Valid Rows (${summary.validCount})`
                    : `Commit Import (${summary.validCount} rows)`}
              </Button>
            </div>
          </div>
        )}

        {/* Step 4: Completion Summary */}
        {step === 4 && (
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
                <div className="text-2xl font-black text-primary">{importSummary ? importSummary.imported : 0}</div>
                <div className="text-xs uppercase font-semibold text-gray-500">Imported</div>
              </div>
              <div>
                <div className="text-2xl font-black text-amber-600">{importSummary ? importSummary.skipped : 0}</div>
                <div className="text-xs uppercase font-semibold text-gray-500">Skipped</div>
              </div>
              <div>
                <div className="text-2xl font-black text-blue-600">{importSummary ? importSummary.updated : 0}</div>
                <div className="text-xs uppercase font-semibold text-gray-500">Updated</div>
              </div>
            </div>

            {failedRows.length > 0 && (
              <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 p-4 rounded-xl max-w-md mx-auto space-y-3">
                <p className="text-xs font-semibold">
                  {failedRows.length} invalid {failedRows.length === 1 ? 'row was' : 'rows were'} skipped during import. Download a CSV with validation errors to fix and re-upload.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleDownloadFailedRows(failedRows)}
                  className="text-xs font-semibold"
                >
                  Download Rows to Fix
                </Button>
              </div>
            )}

            <div className="pt-2">
              <Button onClick={handleResetModal}>Close Wizard</Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
