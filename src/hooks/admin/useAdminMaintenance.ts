'use client';

import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/features/admin';
import {
  DatabaseBackupSchema,
  formatZodIssues,
  reviveDates,
  PathDiagnostic,
} from '@/utils/backupValidation';

export type PreflightState = 'idle' | 'reading_file' | 'validating_schema' | 'valid' | 'invalid';

export type ImportStage =
  | 'idle'
  | 'reading_file'
  | 'validating_schema'
  | 'restoring_database'
  | 'refetching_state'
  | 'complete'
  | 'error';

export interface PreflightSummary {
  fileName: string;
  fileSize: number;
  exportedAt: string | null;
  version: string | null;
  schemaVersion: string | null;
  counts: {
    appConfig: number;
    media: number;
    registryItem: number;
    contributor: number;
    weddingPartyMember: number;
    attraction: number;
    contentNode: number;
    seatingTable: number;
  };
  totalRecords: number;
}

function readTextFromFile(file: File): Promise<string> {
  if (typeof file.text === 'function') {
    return file.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve((e.target?.result as string) || '');
    reader.onerror = () => reject(new Error('Failed to read file contents'));
    reader.readAsText(file);
  });
}

export function useAdminMaintenance() {
  const queryClient = useQueryClient();

  // Pre-flight state
  const [preflightState, setPreflightState] = useState<PreflightState>('idle');
  const [preflightSummary, setPreflightSummary] = useState<PreflightSummary | null>(null);
  const [diagnostics, setDiagnostics] = useState<PathDiagnostic[]>([]);

  // Import state machine
  const [importStage, setImportStage] = useState<ImportStage>('idle');
  const [importError, setImportError] = useState<string | null>(null);

  const exportData = () => {
    window.open('/api/admin/maintenance/export', '_blank');
  };

  const resetPreflight = useCallback(() => {
    setPreflightState('idle');
    setPreflightSummary(null);
    setDiagnostics([]);
  }, []);

  const resetImport = useCallback(() => {
    setImportStage('idle');
    setImportError(null);
  }, []);

  const validateFile = useCallback(async (file: File | null): Promise<boolean> => {
    if (!file) {
      resetPreflight();
      return false;
    }

    setPreflightState('reading_file');
    setDiagnostics([]);
    setPreflightSummary(null);

    try {
      const text = await readTextFromFile(file);
      let rawJson: any;

      try {
        rawJson = JSON.parse(text);
      } catch (parseErr: any) {
        setPreflightState('invalid');
        setDiagnostics([
          {
            path: 'JSON Syntax Error',
            message: parseErr?.message || 'Selected file is not valid JSON.',
          },
        ]);
        return false;
      }

      setPreflightState('validating_schema');
      // Yield execution so UI updates to validating_schema
      await new Promise((resolve) => setTimeout(resolve, 0));

      const revived = reviveDates(rawJson);
      const result = DatabaseBackupSchema.safeParse(revived);

      if (!result.success) {
        const pathDiagnostics = formatZodIssues(result.error);
        setPreflightState('invalid');
        setDiagnostics(pathDiagnostics);
        return false;
      }

      const data = result.data;
      const counts = {
        appConfig: data.appConfig?.length || 0,
        media: data.media?.length || 0,
        registryItem: data.registryItem?.length || 0,
        contributor: data.contributor?.length || 0,
        weddingPartyMember: data.weddingPartyMember?.length || 0,
        attraction: data.attraction?.length || 0,
        contentNode: data.contentNode?.length || 0,
        seatingTable: data.seatingTable?.length || 0,
      };

      const totalRecords = Object.values(counts).reduce((a, b) => a + b, 0);

      let formattedExportedAt: string | null = null;
      if (data.exportedAt) {
        try {
          const d = new Date(data.exportedAt);
          if (!isNaN(d.getTime())) {
            formattedExportedAt = d.toLocaleString();
          }
        } catch {
          formattedExportedAt = String(data.exportedAt);
        }
      }

      setPreflightSummary({
        fileName: file.name,
        fileSize: file.size,
        exportedAt: formattedExportedAt,
        version: data.version || null,
        schemaVersion: data.schemaVersion || null,
        counts,
        totalRecords,
      });

      setPreflightState('valid');
      return true;
    } catch (err: any) {
      setPreflightState('invalid');
      setDiagnostics([
        {
          path: 'File Read Error',
          message: err?.message || 'Failed to read backup file.',
        },
      ]);
      return false;
    }
  }, [resetPreflight]);

  const importData = useCallback(async (file: File) => {
    setImportError(null);

    try {
      // Step 1: reading_file
      setImportStage('reading_file');
      const text = await readTextFromFile(file);
      let rawJson: any;

      try {
        rawJson = JSON.parse(text);
      } catch (parseErr: any) {
        const msg = parseErr?.message || 'Selected file is not valid JSON.';
        setImportStage('error');
        setImportError(`JSON Parsing Error: ${msg}`);
        throw new Error(msg);
      }

      // Step 2: validating_schema
      setImportStage('validating_schema');
      await new Promise((resolve) => setTimeout(resolve, 50));

      const revived = reviveDates(rawJson);
      const result = DatabaseBackupSchema.safeParse(revived);

      if (!result.success) {
        const pathDiagnostics = formatZodIssues(result.error);
        const issueStr = pathDiagnostics.map((d) => `${d.path}: ${d.message}`).join(', ');
        setImportStage('error');
        setImportError(`Schema Validation Failed: ${issueStr}`);
        throw new Error(`Schema Validation Failed: ${issueStr}`);
      }

      // Step 3: restoring_database
      setImportStage('restoring_database');
      await apiClient.post('/api/admin/maintenance/import', rawJson);

      // Step 4: refetching_state
      setImportStage('refetching_state');
      await queryClient.invalidateQueries();

      // Step 5: complete
      setImportStage('complete');
    } catch (err: any) {
      setImportStage('error');
      if (!importError) {
        setImportError(err.message || 'An unexpected error occurred during import.');
      }
      throw err;
    }
  }, [queryClient, importError]);

  return {
    // Pre-flight
    preflightState,
    preflightSummary,
    diagnostics,
    validateFile,
    resetPreflight,

    // Multi-stage import
    importStage,
    importing:
      importStage === 'reading_file' ||
      importStage === 'validating_schema' ||
      importStage === 'restoring_database' ||
      importStage === 'refetching_state',
    importError,
    importData,
    resetImport,

    // Export
    exportData,
  };
}
