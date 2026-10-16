'use client';

import React, { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/Button';
import { useAdminMaintenance, ImportStage } from '@/hooks/admin/useAdminMaintenance';
import { useToast } from '@/components/ui/ToastProvider';

export default function MaintenanceHubPage() {
  const router = useRouter();
  const {
    preflightState,
    preflightSummary,
    diagnostics,
    validateFile,
    resetPreflight,

    importStage,
    importing,
    importError,
    importData,
    resetImport,

    exportData,
  } = useAdminMaintenance();

  const { confirm, addToast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleExport = () => {
    exportData();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    resetImport();
    if (e.target.files && e.target.files.length > 0) {
      const selected = e.target.files[0];
      setFile(selected);
      await validateFile(selected);
    } else {
      setFile(null);
      resetPreflight();
    }
  };

  const handleClearFile = () => {
    setFile(null);
    resetPreflight();
    resetImport();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || preflightState !== 'valid') {
      return;
    }

    if (
      !(await confirm(
        'WARNING: Importing data will completely overwrite the existing database state. Are you sure you want to proceed?'
      ))
    ) {
      return;
    }

    try {
      await importData(file);
      addToast('Database restoration completed successfully!', 'success');
    } catch {
      // Error is caught and stored in importError state
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const getProgressPercentage = (stage: ImportStage): number => {
    switch (stage) {
      case 'reading_file':
        return 20;
      case 'validating_schema':
        return 40;
      case 'restoring_database':
        return 70;
      case 'refetching_state':
        return 90;
      case 'complete':
        return 100;
      case 'error':
        return 100;
      default:
        return 0;
    }
  };

  const STAGES: { key: ImportStage; label: string }[] = [
    { key: 'reading_file', label: 'File Reading' },
    { key: 'validating_schema', label: 'Schema Validation' },
    { key: 'restoring_database', label: 'Database Restoration' },
    { key: 'refetching_state', label: 'Query Cache Refresh' },
    { key: 'complete', label: 'Complete' },
  ];

  const getStageIndex = (stage: ImportStage): number => {
    switch (stage) {
      case 'reading_file':
        return 0;
      case 'validating_schema':
        return 1;
      case 'restoring_database':
        return 2;
      case 'refetching_state':
        return 3;
      case 'complete':
        return 4;
      default:
        return -1;
    }
  };

  const isPreflightValidating =
    preflightState === 'reading_file' || preflightState === 'validating_schema';

  return (
    <div className="min-h-screen bg-[var(--color-background)] text-[var(--color-foreground)] py-10 px-2 sm:px-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-extrabold text-primary tracking-tight drop-shadow-lg">
            Maintenance Hub
          </h1>
          <Button variant="ghost" onClick={() => router.push('/admin/dashboard')}>
            Back to Dashboard
          </Button>
        </div>

        <div className="space-y-8">
          {/* Export Data Section */}
          <section className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg border border-primary dark:border-gray-700">
            <h2 className="text-2xl font-bold mb-4 text-primary">Export Data</h2>
            <p className="text-gray-600 dark:text-gray-300 mb-6">
              Download a complete JSON backup of your wedding database, including registry items, settings, unified contributors, and snapshot history. Keep this file in a safe place, as it may contain PII (Personally Identifiable Information).
            </p>
            <Button onClick={handleExport} size="lg">
              Export All Data
            </Button>
          </section>

          {/* Import Data Section */}
          <section className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg border border-primary dark:border-gray-700 space-y-6">
            <div>
              <h2 className="text-2xl font-bold mb-2 text-primary">Import Data</h2>
              <p className="text-gray-600 dark:text-gray-300">
                Restore your database from a previously exported JSON backup. <strong>Warning:</strong> This will overwrite all current data. Proceed with caution.
              </p>
            </div>

            <form onSubmit={handleImport} className="space-y-6">
              <div>
                <label
                  htmlFor="backup-file-input"
                  className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-2"
                >
                  Select JSON Backup File
                </label>
                <div className="flex items-center gap-3">
                  <input
                    id="backup-file-input"
                    type="file"
                    ref={fileInputRef}
                    accept=".json,application/json"
                    onChange={handleFileChange}
                    className="block w-full text-sm text-gray-500 dark:text-gray-400
                      file:mr-4 file:py-2 file:px-4
                      file:rounded-lg file:border-0
                      file:text-sm file:font-semibold
                      file:bg-secondary file:text-white
                      hover:file:brightness-90 cursor-pointer"
                  />
                  {file && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleClearFile}
                      disabled={importing}
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </div>

              {/* Pre-flight Validating Spinner */}
              {isPreflightValidating && (
                <div className="p-4 bg-blue-50 dark:bg-blue-950/40 rounded-xl border border-blue-200 dark:border-blue-800 flex items-center gap-3 text-blue-800 dark:text-blue-200 text-sm font-medium">
                  <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  <span>
                    {preflightState === 'reading_file'
                      ? 'Reading backup file...'
                      : 'Validating backup schema against DatabaseBackupSchema...'}
                  </span>
                </div>
              )}

              {/* Pre-flight Summary Card */}
              {preflightState === 'valid' && preflightSummary && (
                <div className="p-5 bg-emerald-50/80 dark:bg-emerald-950/30 rounded-xl border border-emerald-300 dark:border-emerald-800 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-200 dark:border-emerald-800/80 pb-3">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-600 text-white font-bold text-xs">
                        ✓
                      </span>
                      <h3 className="font-bold text-emerald-900 dark:text-emerald-100 text-base">
                        Pre-flight Inspection Passed
                      </h3>
                    </div>
                    <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-200 dark:bg-emerald-800 text-emerald-900 dark:text-emerald-100">
                      Ready for Import
                    </span>
                  </div>

                  {/* Metadata Header */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-emerald-950 dark:text-emerald-200">
                    <div>
                      <span className="text-gray-500 dark:text-gray-400 block font-semibold uppercase text-[10px]">
                        File Name
                      </span>
                      <span className="font-mono font-medium truncate block" title={preflightSummary.fileName}>
                        {preflightSummary.fileName}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500 dark:text-gray-400 block font-semibold uppercase text-[10px]">
                        File Size
                      </span>
                      <span className="font-semibold">{formatFileSize(preflightSummary.fileSize)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 dark:text-gray-400 block font-semibold uppercase text-[10px]">
                        Exported At
                      </span>
                      <span>{preflightSummary.exportedAt || 'N/A'}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 dark:text-gray-400 block font-semibold uppercase text-[10px]">
                        Total Records
                      </span>
                      <span className="font-bold text-emerald-800 dark:text-emerald-300">
                        {preflightSummary.totalRecords}
                      </span>
                    </div>
                  </div>

                  {/* Record Counts Badge Grid */}
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-900 dark:text-emerald-200 mb-2">
                      Backup Record Counts:
                    </h4>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div className="p-2 bg-white dark:bg-gray-800 rounded-lg border border-emerald-200 dark:border-emerald-800/60 shadow-xs flex justify-between items-center">
                        <span className="font-semibold text-gray-700 dark:text-gray-300">AppConfig:</span>
                        <span className="font-bold font-mono text-emerald-700 dark:text-emerald-400">
                          {preflightSummary.counts.appConfig}
                        </span>
                      </div>
                      <div className="p-2 bg-white dark:bg-gray-800 rounded-lg border border-emerald-200 dark:border-emerald-800/60 shadow-xs flex justify-between items-center">
                        <span className="font-semibold text-gray-700 dark:text-gray-300">Media:</span>
                        <span className="font-bold font-mono text-emerald-700 dark:text-emerald-400">
                          {preflightSummary.counts.media}
                        </span>
                      </div>
                      <div className="p-2 bg-white dark:bg-gray-800 rounded-lg border border-emerald-200 dark:border-emerald-800/60 shadow-xs flex justify-between items-center">
                        <span className="font-semibold text-gray-700 dark:text-gray-300">RegistryItems:</span>
                        <span className="font-bold font-mono text-emerald-700 dark:text-emerald-400">
                          {preflightSummary.counts.registryItem}
                        </span>
                      </div>
                      <div className="p-2 bg-white dark:bg-gray-800 rounded-lg border border-emerald-200 dark:border-emerald-800/60 shadow-xs flex justify-between items-center">
                        <span className="font-semibold text-gray-700 dark:text-gray-300">Contributors:</span>
                        <span className="font-bold font-mono text-emerald-700 dark:text-emerald-400">
                          {preflightSummary.counts.contributor}
                        </span>
                      </div>
                      <div className="p-2 bg-white dark:bg-gray-800 rounded-lg border border-emerald-200 dark:border-emerald-800/60 shadow-xs flex justify-between items-center">
                        <span className="font-semibold text-gray-700 dark:text-gray-300">Wedding Party:</span>
                        <span className="font-bold font-mono text-emerald-700 dark:text-emerald-400">
                          {preflightSummary.counts.weddingPartyMember}
                        </span>
                      </div>
                      <div className="p-2 bg-white dark:bg-gray-800 rounded-lg border border-emerald-200 dark:border-emerald-800/60 shadow-xs flex justify-between items-center">
                        <span className="font-semibold text-gray-700 dark:text-gray-300">Attractions:</span>
                        <span className="font-bold font-mono text-emerald-700 dark:text-emerald-400">
                          {preflightSummary.counts.attraction}
                        </span>
                      </div>
                      <div className="p-2 bg-white dark:bg-gray-800 rounded-lg border border-emerald-200 dark:border-emerald-800/60 shadow-xs flex justify-between items-center">
                        <span className="font-semibold text-gray-700 dark:text-gray-300">Content Nodes:</span>
                        <span className="font-bold font-mono text-emerald-700 dark:text-emerald-400">
                          {preflightSummary.counts.contentNode}
                        </span>
                      </div>
                      <div className="p-2 bg-white dark:bg-gray-800 rounded-lg border border-emerald-200 dark:border-emerald-800/60 shadow-xs flex justify-between items-center">
                        <span className="font-semibold text-gray-700 dark:text-gray-300">Seating Tables:</span>
                        <span className="font-bold font-mono text-emerald-700 dark:text-emerald-400">
                          {preflightSummary.counts.seatingTable}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Pre-flight Diagnostic Error Report Panel */}
              {preflightState === 'invalid' && diagnostics.length > 0 && (
                <div className="p-5 bg-red-50/90 dark:bg-red-950/40 rounded-xl border border-red-300 dark:border-red-800 space-y-4">
                  <div className="flex items-center gap-2 border-b border-red-200 dark:border-red-800/80 pb-3">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-600 text-white font-bold text-xs">
                      ✕
                    </span>
                    <h3 className="font-bold text-red-900 dark:text-red-100 text-base">
                      Pre-flight Validation Failed
                    </h3>
                  </div>

                  <p className="text-xs text-red-800 dark:text-red-200">
                    The selected backup file contains schema mismatch errors or invalid formatting. Pre-flight inspection prevented database restoration to protect against data corruption.
                  </p>

                  <div className="border border-red-200 dark:border-red-800 rounded-lg overflow-hidden bg-white dark:bg-gray-900">
                    <div className="bg-red-100/80 dark:bg-red-900/60 px-3 py-2 text-xs font-bold text-red-900 dark:text-red-200 grid grid-cols-12 gap-2">
                      <span className="col-span-4 sm:col-span-3">Schema Path</span>
                      <span className="col-span-8 sm:col-span-9">Error Diagnostics</span>
                    </div>
                    <div className="max-h-60 overflow-y-auto divide-y divide-red-100 dark:divide-red-900/40">
                      {diagnostics.map((diag, i) => (
                        <div key={i} className="p-3 text-xs grid grid-cols-12 gap-2 hover:bg-red-50/50 dark:hover:bg-red-950/30">
                          <span className="col-span-4 sm:col-span-3 font-mono text-[11px] font-bold text-red-700 dark:text-red-300 break-all">
                            {diag.path}
                          </span>
                          <span className="col-span-8 sm:col-span-9 text-gray-800 dark:text-gray-200">
                            {diag.message}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="p-3 bg-red-100/50 dark:bg-red-900/30 rounded-lg text-xs text-red-900 dark:text-red-200 font-medium">
                    💡 <strong>How to resolve:</strong> Please update the invalid fields in your JSON backup file or choose a valid export file before attempting restoration.
                  </div>
                </div>
              )}

              {/* Multi-Stage Progress State Tracking Panel */}
              {importStage !== 'idle' && (
                <div className="p-5 bg-white dark:bg-gray-900 rounded-xl border border-gray-300 dark:border-gray-700 space-y-4 shadow-md">
                  <div className="flex justify-between items-center">
                    <h3 className="font-bold text-base text-gray-900 dark:text-gray-100">
                      Restoration Stage Progress
                    </h3>
                    <span className="text-xs font-bold font-mono px-2.5 py-1 bg-gray-100 dark:bg-gray-800 rounded-full text-primary">
                      {getProgressPercentage(importStage)}%
                    </span>
                  </div>

                  {/* Accessible Progress Bar */}
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        importStage === 'error'
                          ? 'bg-red-600'
                          : importStage === 'complete'
                            ? 'bg-emerald-600'
                            : 'bg-primary'
                      }`}
                      style={{ width: `${getProgressPercentage(importStage)}%` }}
                      role="progressbar"
                      aria-valuenow={getProgressPercentage(importStage)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    />
                  </div>

                  {/* Live Status Region */}
                  <div
                    role="status"
                    aria-live="polite"
                    className="text-xs text-gray-600 dark:text-gray-300 font-medium"
                  >
                    Current Phase:{' '}
                    <strong className="text-primary">
                      {importStage === 'reading_file' && '1. Reading backup file contents...'}
                      {importStage === 'validating_schema' && '2. Executing schema validation checks...'}
                      {importStage === 'restoring_database' && '3. Restoring database tables within transaction scope...'}
                      {importStage === 'refetching_state' && '4. Refreshing React Query caches...'}
                      {importStage === 'complete' && '5. Database restoration successfully finished!'}
                      {importStage === 'error' && 'Restoration failed due to an error.'}
                    </strong>
                  </div>

                  {/* Stage Stepper List */}
                  <div className="space-y-2 pt-2 border-t border-gray-200 dark:border-gray-800 text-xs">
                    {STAGES.map((s, idx) => {
                      const currentIdx = getStageIndex(importStage);
                      const isPast = currentIdx > idx || importStage === 'complete';
                      const isCurrent = currentIdx === idx && importStage !== 'error';
                      const isFailed = importStage === 'error' && currentIdx === idx;

                      return (
                        <div key={s.key} className="flex items-center gap-3">
                          <span
                            className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                              isPast
                                ? 'bg-emerald-600 text-white'
                                : isCurrent
                                  ? 'bg-primary text-white animate-pulse'
                                  : isFailed
                                    ? 'bg-red-600 text-white'
                                    : 'bg-gray-200 dark:bg-gray-700 text-gray-500'
                            }`}
                          >
                            {isPast ? '✓' : isFailed ? '✕' : idx + 1}
                          </span>
                          <span
                            className={`font-semibold ${
                              isPast
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : isCurrent
                                  ? 'text-primary font-bold'
                                  : isFailed
                                    ? 'text-red-600 dark:text-red-400 font-bold'
                                    : 'text-gray-400 dark:text-gray-500'
                            }`}
                          >
                            {s.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Failure banner */}
                  {importStage === 'error' && importError && (
                    <div className="p-3 bg-red-100 dark:bg-red-950/60 rounded-lg text-xs font-semibold text-red-900 dark:text-red-200">
                      ✕ Error during restoration: {importError}
                    </div>
                  )}

                  {/* Completion banner */}
                  {importStage === 'complete' && (
                    <div className="p-3 bg-emerald-100 dark:bg-emerald-950/60 rounded-lg text-xs font-semibold text-emerald-900 dark:text-emerald-200 flex justify-between items-center">
                      <span>✓ Restoration complete. All data imported and query caches invalidated.</span>
                      <Button size="sm" variant="ghost" onClick={handleClearFile}>
                        Done
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Action Submit Button */}
              <div>
                <Button
                  type="submit"
                  variant="danger"
                  size="lg"
                  disabled={!file || preflightState !== 'valid' || importing}
                >
                  {isPreflightValidating
                    ? 'Validating File...'
                    : importing
                      ? 'Importing...'
                      : 'Import Data'}
                </Button>
              </div>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
