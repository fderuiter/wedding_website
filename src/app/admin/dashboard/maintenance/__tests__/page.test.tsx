import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import MaintenanceHubPage from '../page';
import { useAdminMaintenance } from '@/hooks/admin/useAdminMaintenance';
import { useToast } from '@/components/ui/ToastProvider';

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}));

jest.mock('@/components/ui/ToastProvider', () => ({
  useToast: jest.fn(),
}));

jest.mock('@/hooks/admin/useAdminMaintenance', () => ({
  useAdminMaintenance: jest.fn(),
}));

describe('MaintenanceHubPage Pre-flight Validation & Progress Tracking', () => {
  const mockValidateFile = jest.fn();
  const mockResetPreflight = jest.fn();
  const mockImportData = jest.fn();
  const mockResetImport = jest.fn();
  const mockExportData = jest.fn();
  const mockConfirm = jest.fn();
  const mockAddToast = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useToast as jest.Mock).mockReturnValue({
      confirm: mockConfirm,
      addToast: mockAddToast,
    });

    (useAdminMaintenance as jest.Mock).mockReturnValue({
      preflightState: 'idle',
      preflightSummary: null,
      diagnostics: [],
      validateFile: mockValidateFile,
      resetPreflight: mockResetPreflight,

      importStage: 'idle',
      importing: false,
      importError: null,
      importData: mockImportData,
      resetImport: mockResetImport,

      exportData: mockExportData,
    });
  });

  test('renders Maintenance Hub heading and export/import sections', () => {
    render(<MaintenanceHubPage />);
    expect(screen.getByRole('heading', { level: 1, name: /Maintenance Hub/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Export Data/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Import Data/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export All Data/i })).toBeInTheDocument();
  });

  test('selecting a file triggers pre-flight validation', async () => {
    render(<MaintenanceHubPage />);
    const fileInput = screen.getByLabelText(/Select JSON Backup File/i);

    const testFile = new File(['{"appConfig": []}'], 'backup.json', { type: 'application/json' });
    fireEvent.change(fileInput, { target: { files: [testFile] } });

    expect(mockResetImport).toHaveBeenCalled();
    expect(mockValidateFile).toHaveBeenCalledWith(testFile);
  });

  test('displays Pre-flight Summary Card when validation succeeds', () => {
    (useAdminMaintenance as jest.Mock).mockReturnValue({
      preflightState: 'valid',
      preflightSummary: {
        fileName: 'backup-2026.json',
        fileSize: 2048,
        exportedAt: '10/16/2026, 12:00:00 PM',
        version: '1.0',
        schemaVersion: '1.0',
        counts: {
          appConfig: 1,
          media: 5,
          registryItem: 12,
          contributor: 3,
          weddingPartyMember: 4,
          attraction: 2,
          contentNode: 8,
          seatingTable: 6,
        },
        totalRecords: 41,
      },
      diagnostics: [],
      validateFile: mockValidateFile,
      resetPreflight: mockResetPreflight,

      importStage: 'idle',
      importing: false,
      importError: null,
      importData: mockImportData,
      resetImport: mockResetImport,

      exportData: mockExportData,
    });

    render(<MaintenanceHubPage />);

    expect(screen.getByText(/Pre-flight Inspection Passed/i)).toBeInTheDocument();
    expect(screen.getByText('backup-2026.json')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument(); // RegistryItems count
    expect(screen.getByText('3')).toBeInTheDocument(); // Contributors count
  });

  test('displays Inline Diagnostic Error Report Panel when schema validation fails', () => {
    (useAdminMaintenance as jest.Mock).mockReturnValue({
      preflightState: 'invalid',
      preflightSummary: null,
      diagnostics: [
        { path: 'registryItem.0.price', message: 'Number must be greater than 0' },
        { path: 'appConfig.0.baseUrl', message: 'Invalid url' },
      ],
      validateFile: mockValidateFile,
      resetPreflight: mockResetPreflight,

      importStage: 'idle',
      importing: false,
      importError: null,
      importData: mockImportData,
      resetImport: mockResetImport,

      exportData: mockExportData,
    });

    render(<MaintenanceHubPage />);

    expect(screen.getByText(/Pre-flight Validation Failed/i)).toBeInTheDocument();
    expect(screen.getByText('registryItem.0.price')).toBeInTheDocument();
    expect(screen.getByText('Number must be greater than 0')).toBeInTheDocument();
    expect(screen.getByText('appConfig.0.baseUrl')).toBeInTheDocument();
    expect(screen.getByText('Invalid url')).toBeInTheDocument();
  });

  test('displays multi-stage progress tracking panel during restoration execution', () => {
    (useAdminMaintenance as jest.Mock).mockReturnValue({
      preflightState: 'valid',
      preflightSummary: {
        fileName: 'backup.json',
        fileSize: 1024,
        exportedAt: null,
        version: null,
        schemaVersion: null,
        counts: { appConfig: 1, media: 0, registryItem: 0, contributor: 0, weddingPartyMember: 0, attraction: 0, contentNode: 0, seatingTable: 0 },
        totalRecords: 1,
      },
      diagnostics: [],
      validateFile: mockValidateFile,
      resetPreflight: mockResetPreflight,

      importStage: 'restoring_database',
      importing: true,
      importError: null,
      importData: mockImportData,
      resetImport: mockResetImport,

      exportData: mockExportData,
    });

    render(<MaintenanceHubPage />);

    expect(screen.getByText(/Restoration Stage Progress/i)).toBeInTheDocument();
    expect(screen.getByText(/70%/i)).toBeInTheDocument();
    expect(screen.getByText(/3. Restoring database tables within transaction scope.../i)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '70');
  });

  test('disables import button when preflight validation fails or is invalid', () => {
    (useAdminMaintenance as jest.Mock).mockReturnValue({
      preflightState: 'invalid',
      preflightSummary: null,
      diagnostics: [{ path: 'root', message: 'Invalid JSON' }],
      validateFile: mockValidateFile,
      resetPreflight: mockResetPreflight,

      importStage: 'idle',
      importing: false,
      importError: null,
      importData: mockImportData,
      resetImport: mockResetImport,

      exportData: mockExportData,
    });

    render(<MaintenanceHubPage />);

    const submitBtn = screen.getByRole('button', { name: /Import Data/i });
    expect(submitBtn).toBeDisabled();
  });
});
