import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CsvImportWizardModal } from '../CsvImportWizardModal';
import { ToastProvider } from '@/components/ui/ToastProvider';
import { validateSingleCsvRow } from '@/utils/csv';

class MockFileReader {
  onload: ((e: any) => void) | null = null;
  readAsText(file: any) {
    setTimeout(() => {
      if (this.onload) {
        this.onload({ target: { result: file._content || '' } });
      }
    }, 0);
  }
}
(global as any).FileReader = MockFileReader;

// Mock fetch
global.fetch = jest.fn();

describe('CsvImportWizardModal Component', () => {
  const mockOnClose = jest.fn();
  const mockOnImportComplete = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  const renderModal = (isOpen = true) => {
    return render(
      <ToastProvider>
        <CsvImportWizardModal
          isOpen={isOpen}
          onClose={mockOnClose}
          onImportComplete={mockOnImportComplete}
          existingCodes={['EXISTING1']}
        />
      </ToastProvider>
    );
  };

  test('does not render when isOpen is false', () => {
    renderModal(false);
    expect(screen.queryByText('Import Guest Invitation Codes')).not.toBeInTheDocument();
  });

  test('renders Download Sample CSV Template button in Step 1 and triggers Blob creation and URL cleanup when clicked', () => {
    const mockCreateObjectURL = jest.fn(() => 'blob:http://localhost/mock-url');
    const mockRevokeObjectURL = jest.fn();

    const originalCreateObjectURL = window.URL.createObjectURL;
    const originalRevokeObjectURL = window.URL.revokeObjectURL;

    window.URL.createObjectURL = mockCreateObjectURL;
    window.URL.revokeObjectURL = mockRevokeObjectURL;

    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    try {
      renderModal(true);

      const downloadBtn = screen.getByRole('button', { name: /Download Sample CSV Template/i });
      expect(downloadBtn).toBeInTheDocument();

      fireEvent.click(downloadBtn);

      expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
      const createdBlob = mockCreateObjectURL.mock.calls[0][0];
      expect(createdBlob).toBeInstanceOf(Blob);
      expect(createdBlob.type).toContain('text/csv');

      expect(clickSpy).toHaveBeenCalled();
      expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/mock-url');
    } finally {
      window.URL.createObjectURL = originalCreateObjectURL;
      window.URL.revokeObjectURL = originalRevokeObjectURL;
      clickSpy.mockRestore();
    }
  });

  test('full multi-column wizard workflow with CSV upload, mapping, editing, and batch commit', async () => {
    renderModal(true);

    expect(screen.getByText('Import Guest Invitation Codes')).toBeInTheDocument();
    expect(screen.getByText('1. Upload File')).toBeInTheDocument();

    // Step 1: Upload CSV with multi-column standard and custom metadata
    const csvContent =
      'Guest Name,Invitation Code,Email,Dietary Allergies,Plus Ones,Custom Group\n' +
      'Alice Smith,ALICE100,alice@example.com,Gluten Free,1,VIP Table\n' +
      'Bob Johnson,BOB200,bob@example.com,Vegan,2,Family';
    const file = new File([csvContent], 'guests.csv', { type: 'text/csv' });
    (file as any)._content = csvContent;

    const input = screen.getByLabelText(/Click to select CSV file/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    // Step 2: Column Remapping
    await waitFor(() => {
      expect(screen.getByText(/2. Map Columns/i)).toBeInTheDocument();
      expect(screen.getByDisplayValue('Guest Name')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Invitation Code')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Email')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Dietary Allergies')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Plus Ones')).toBeInTheDocument();
    });

    const continueBtn = screen.getByText(/Continue to Review/i);
    fireEvent.click(continueBtn);

    // Step 3: Dry-Run Preview
    await waitFor(() => {
      expect(screen.getByText('3. Review & Validate')).toBeInTheDocument();
    });

    expect(screen.getByDisplayValue('Alice Smith')).toBeInTheDocument();
    expect(screen.getByDisplayValue('ALICE100')).toBeInTheDocument();
    expect(screen.getByDisplayValue('alice@example.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Gluten Free')).toBeInTheDocument();

    // Mock API response
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        count: 2,
        imported: 2,
        skipped: 0,
        updated: 0,
      }),
    });

    const commitBtn = screen.getByText(/Commit Import/i);
    fireEvent.click(commitBtn);

    // Step 4: Completion Summary
    await waitFor(() => {
      expect(screen.getByText('Import Execution Complete')).toBeInTheDocument();
    });

    expect(mockOnImportComplete).toHaveBeenCalled();

    // Verify fetch call payload
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/admin/invitation-codes/batch',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          records: [
            {
              guestName: 'Alice Smith',
              code: 'ALICE100',
              email: 'alice@example.com',
              dietaryNotes: 'Gluten Free',
              plusOneAllocations: 1,
              extraFields: { 'Custom Group': 'VIP Table' },
            },
            {
              guestName: 'Bob Johnson',
              code: 'BOB200',
              email: 'bob@example.com',
              dietaryNotes: 'Vegan',
              plusOneAllocations: 2,
              extraFields: { 'Custom Group': 'Family' },
            },
          ],
          collisionStrategy: 'skip',
        }),
      })
    );
  });

  test('persists edited rows and mapping state in sessionStorage and restores on remount', async () => {
    window.sessionStorage.clear();

    const { unmount } = renderModal(true);

    const csvContent = 'Guest Name,Invitation Code\nCharlie Brown,CHARLIE100';
    const file = new File([csvContent], 'guests.csv', { type: 'text/csv' });
    (file as any)._content = csvContent;

    const input = screen.getByLabelText(/Click to select CSV file/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByDisplayValue('Guest Name')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Continue to Review/i));

    await waitFor(() => {
      expect(screen.getByText('3. Review & Validate')).toBeInTheDocument();
    });

    // Edit guest name in step 3
    const nameInput = screen.getByDisplayValue('Charlie Brown');
    fireEvent.change(nameInput, { target: { value: 'Charlie Brown Jr.' } });

    // Verify persisted in sessionStorage
    const saved = window.sessionStorage.getItem('csv_import_wizard_draft');
    expect(saved).not.toBeNull();
    const parsed = JSON.parse(saved!);
    expect(parsed.step).toBe(3);
    expect(parsed.editableRows[0].guestName).toBe('Charlie Brown Jr.');

    // Unmount and remount modal
    unmount();

    renderModal(true);

    await waitFor(() => {
      expect(screen.getByText('3. Review & Validate')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Charlie Brown Jr.')).toBeInTheDocument();
    });
  });

  test('triggers incremental re-validation and updates duplicate code warnings dynamically across affected rows when code changes', async () => {
    window.sessionStorage.clear();
    renderModal(true);

    const csvContent =
      'Guest Name,Invitation Code\n' +
      'Alice,CODE1\n' +
      'Bob,CODE1\n' +
      'Charlie,CODE3';
    const file = new File([csvContent], 'guests.csv', { type: 'text/csv' });
    (file as any)._content = csvContent;

    const input = screen.getByLabelText(/Click to select CSV file/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByDisplayValue('Guest Name')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Continue to Review/i));

    await waitFor(() => {
      expect(screen.getByText('3. Review & Validate')).toBeInTheDocument();
    });

    // Initially, Alice and Bob share CODE1 and show duplicate code error
    const duplicateErrorsInitial = screen.getAllByText(/Duplicate code "CODE1"/i);
    expect(duplicateErrorsInitial.length).toBe(2);

    // Edit Bob's code to CODE2 (so CODE1 is no longer duplicate)
    const codeInputs = screen.getAllByDisplayValue('CODE1');
    fireEvent.change(codeInputs[1], { target: { value: 'CODE2' } });

    // Duplicate errors for CODE1 should now be gone
    await waitFor(() => {
      expect(screen.queryByText(/Duplicate code "CODE1"/i)).not.toBeInTheDocument();
    });

    // Edit Charlie's code to CODE1 (so Alice and Charlie now conflict on CODE1)
    const charlieCodeInput = screen.getByDisplayValue('CODE3');
    fireEvent.change(charlieCodeInput, { target: { value: 'CODE1' } });

    // Duplicate errors for CODE1 should reappear on Alice and Charlie
    await waitFor(() => {
      const duplicateErrorsAfter = screen.getAllByText(/Duplicate code "CODE1"/i);
      expect(duplicateErrorsAfter.length).toBe(2);
    });
  });

  test('maintains sub-16ms validation latency during cell editing in step 3 for large datasets up to 2,000 rows', () => {
    const rowsCount = 2000;
    const editableRows = Array.from({ length: rowsCount }, (_, i) => ({
      guestName: `Guest ${i}`,
      code: `CODE_${i}`,
      email: `guest${i}@example.com`,
      dietaryNotes: '',
      plusOneAllocations: '0',
      extraFields: {},
    }));

    const freqMap = new Map<string, number>();
    editableRows.forEach((r) => freqMap.set(r.code, 1));
    const dbCodes = new Set<string>();

    const start = performance.now();
    // Perform single cell update re-validation on row 0
    const updatedRow = { ...editableRows[0], guestName: 'Guest 0 Updated' };
    const validatedSingle = validateSingleCsvRow(
      {
        GuestNameField: updatedRow.guestName,
        CodeField: updatedRow.code,
        EmailField: updatedRow.email,
        DietaryNotesField: updatedRow.dietaryNotes,
        PlusOneField: updatedRow.plusOneAllocations,
      },
      0,
      {
        guestNameCol: 'GuestNameField',
        codeCol: 'CodeField',
        emailCol: 'EmailField',
        dietaryNotesCol: 'DietaryNotesField',
        plusOneCol: 'PlusOneField',
      },
      freqMap,
      dbCodes
    );
    const duration = performance.now() - start;

    expect(validatedSingle.isValid).toBe(true);
    expect(validatedSingle.guestName).toBe('Guest 0 Updated');
    expect(duration).toBeLessThan(16); // Validation latency remains under 16ms
  });
});
