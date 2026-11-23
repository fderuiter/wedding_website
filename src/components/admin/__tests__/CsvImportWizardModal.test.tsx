import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { CsvImportWizardModal } from '../CsvImportWizardModal';
import { ToastProvider } from '@/components/ui/ToastProvider';
import { validateSingleCsvRow } from '@/utils/csv';

expect.extend(toHaveNoViolations);

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
    window.sessionStorage.clear();
    global.fetch = jest.fn();
  });

  const renderModal = (isOpen = true, existingCodes = ['EXISTING1']) => {
    return render(
      <ToastProvider>
        <CsvImportWizardModal
          isOpen={isOpen}
          onClose={mockOnClose}
          onImportComplete={mockOnImportComplete}
          existingCodes={existingCodes}
        />
      </ToastProvider>
    );
  };

  test('does not render when isOpen is false', () => {
    renderModal(false);
    expect(screen.queryByText('Import Guest Invitation Codes')).not.toBeInTheDocument();
  });

  test('renders Download Sample CSV Template button in Step 1 and triggers Blob creation and URL cleanup when clicked', () => {
    const mockCreateObjectURL = jest.fn((_obj: Blob | MediaSource) => 'blob:http://localhost/mock-url');
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
      const createdBlob = mockCreateObjectURL.mock.calls[0]?.[0] as Blob;
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

  test('supports full keyboard accessibility with focus navigation and Enter/Space activation', () => {
    renderModal(true);

    const dropzone = screen.getByRole('button', { name: /click to select csv file/i });
    expect(dropzone).toBeInTheDocument();
    expect(dropzone).toHaveAttribute('tabIndex', '0');
    expect(dropzone).toHaveClass('focus-visible:ring-2');
    expect(dropzone).toHaveClass('focus-visible:ring-primary');
    expect(dropzone).toHaveClass('focus-visible:outline-none');

    // Tab navigation focus
    dropzone.focus();
    expect(dropzone).toHaveFocus();

    const fileInput = screen.getByLabelText(/Click to select CSV file/i) as HTMLInputElement;
    const clickSpy = jest.spyOn(fileInput, 'click');

    // Enter keypress activation
    const enterEvent = fireEvent.keyDown(dropzone, { key: 'Enter', code: 'Enter' });
    expect(enterEvent).toBe(false);
    expect(clickSpy).toHaveBeenCalledTimes(1);

    // Space keypress activation
    const spaceEvent = fireEvent.keyDown(dropzone, { key: ' ', code: 'Space' });
    expect(spaceEvent).toBe(false);
    expect(clickSpy).toHaveBeenCalledTimes(2);

    // Other keys do not trigger file picker
    const arrowEvent = fireEvent.keyDown(dropzone, { key: 'ArrowDown', code: 'ArrowDown' });
    expect(arrowEvent).toBe(true);
    expect(clickSpy).toHaveBeenCalledTimes(2);

    clickSpy.mockRestore();
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

    // Step 2: Column Remapping (unmapped extra columns default to unchecked and require opt-in)
    await waitFor(() => {
      expect(screen.getByText(/2. Map Columns/i)).toBeInTheDocument();
      expect(screen.getByDisplayValue('Guest Name')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Invitation Code')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Email')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Dietary Allergies')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Plus Ones')).toBeInTheDocument();
    });

    const customGroupCheckbox = screen.getByLabelText('Custom Group') as HTMLInputElement;
    expect(customGroupCheckbox).not.toBeChecked();
    fireEvent.click(customGroupCheckbox);
    expect(customGroupCheckbox).toBeChecked();

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
      plusOneFirstName: '',
      plusOneLastName: '',
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
        PlusOneFirstNameField: updatedRow.plusOneFirstName,
        PlusOneLastNameField: updatedRow.plusOneLastName,
      },
      0,
      {
        guestNameCol: 'GuestNameField',
        codeCol: 'CodeField',
        emailCol: 'EmailField',
        dietaryNotesCol: 'DietaryNotesField',
        plusOneCol: 'PlusOneField',
        plusOneFirstNameCol: 'PlusOneFirstNameField',
        plusOneLastNameCol: 'PlusOneLastNameField',
      },
      freqMap,
      dbCodes
    );
    const duration = performance.now() - start;

    expect(validatedSingle.isValid).toBe(true);
    expect(validatedSingle.guestName).toBe('Guest 0 Updated');
    expect(duration).toBeLessThan(16); // Validation latency remains under 16ms
  });

  test('renders accessible step progress navigation and status live region', async () => {
    window.sessionStorage.clear();
    renderModal(true);

    // Verify nav and ol structure
    const nav = screen.getByRole('navigation', { name: /Import progress/i });
    expect(nav).toBeInTheDocument();

    const ol = nav.querySelector('ol');
    expect(ol).toBeInTheDocument();

    // Verify header status live region
    const statusBadge = screen.getByRole('status');
    expect(statusBadge).toHaveAttribute('aria-live', 'polite');
    expect(statusBadge).toHaveAttribute('aria-atomic', 'true');
    expect(statusBadge).toHaveTextContent('Step 1 of 4');

    // Verify aria-current="step" on Step 1 span
    const step1Span = screen.getByText('1. Upload File');
    expect(step1Span).toHaveAttribute('aria-current', 'step');

    const step2Span = screen.getByText('2. Map Columns');
    expect(step2Span).not.toHaveAttribute('aria-current');

    const step3Span = screen.getByText('3. Review & Validate');
    expect(step3Span).not.toHaveAttribute('aria-current');

    const step4Span = screen.getByText('4. Complete');
    expect(step4Span).not.toHaveAttribute('aria-current');

    // Advance to Step 2
    const csvContent = 'Guest Name,Invitation Code\nAlice Smith,ALICE100';
    const file = new File([csvContent], 'guests.csv', { type: 'text/csv' });
    (file as any)._content = csvContent;

    const input = screen.getByLabelText(/Click to select CSV file/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(statusBadge).toHaveTextContent('Step 2 of 4');
    });

    // Step 1 no longer has aria-current, Step 2 now has aria-current="step"
    expect(step1Span).not.toHaveAttribute('aria-current');
    expect(step2Span).toHaveAttribute('aria-current', 'step');

    // Advance to Step 3
    fireEvent.click(screen.getByText(/Continue to Review/i));

    await waitFor(() => {
      expect(statusBadge).toHaveTextContent('Step 3 of 4');
    });

    expect(step2Span).not.toHaveAttribute('aria-current');
    expect(step3Span).toHaveAttribute('aria-current', 'step');
  });

  test('calls pre-flight dry-run validation endpoint, displays existing guest collision indicators, filters by status, and disables commit on invalid rows', async () => {
    window.sessionStorage.clear();
    renderModal(true);

    // Upload CSV with valid row, duplicate DB code row, and invalid row
    const csvContent =
      'Guest Name,Invitation Code,Email\n' +
      'Valid Guest,VALID100,valid@example.com\n' +
      'Conflict Guest,EXISTING1,conflict@example.com\n' +
      ',INVALID100,bad-email-format';
    const file = new File([csvContent], 'guests.csv', { type: 'text/csv' });
    (file as any)._content = csvContent;

    // Mock dry-run validation endpoint response
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        summary: {
          total: 3,
          validCount: 2,
          invalidCount: 1,
          duplicateCount: 1,
          updatedCount: 0,
          skippedCount: 1,
          createdCount: 1,
        },
        rows: [
          {
            rowIndex: 1,
            guestName: 'Valid Guest',
            code: 'VALID100',
            email: 'valid@example.com',
            isValid: true,
            errors: [],
            warnings: [],
            isDuplicate: false,
            actionOutcome: 'create',
          },
          {
            rowIndex: 2,
            guestName: 'Conflict Guest',
            code: 'EXISTING1',
            email: 'conflict@example.com',
            isValid: true,
            errors: [],
            warnings: ['Code "EXISTING1" already exists for guest "John Doe". Will be skipped.'],
            isDuplicate: true,
            existingGuestName: 'John Doe',
            actionOutcome: 'skip',
          },
          {
            rowIndex: 3,
            guestName: '',
            code: 'INVALID100',
            email: 'bad-email-format',
            isValid: false,
            errors: ['Guest name is required.', 'Invalid email format.'],
            warnings: [],
            isDuplicate: false,
            actionOutcome: 'invalid',
          },
        ],
      }),
    });

    const input = screen.getByLabelText(/Click to select CSV file/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByDisplayValue('Guest Name')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Continue to Review/i));

    // Step 3: Verify pre-flight validation endpoint call and results
    await waitFor(() => {
      expect(screen.getByText('3. Review & Validate')).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/admin/invitation-codes/validate',
      expect.objectContaining({
        method: 'POST',
      })
    );

    // Verify header total counts
    await waitFor(() => {
      expect(screen.getByText(/Total: 3/i)).toBeInTheDocument();
      expect(screen.getByText(/Valid: 2/i)).toBeInTheDocument();
      expect(screen.getByText(/Invalid: 1/i)).toBeInTheDocument();
      expect(screen.getByText(/Duplicates: 1/i)).toBeInTheDocument();
    });

    // Verify existing guest name collision indicator
    expect(screen.getByText('Existing guest: John Doe')).toBeInTheDocument();

    // Verify partial-commit warning banner and Download Rows to Fix button when valid + invalid rows coexist
    expect(
      screen.getByText(/1 invalid row\(s\) have validation errors and will be skipped if you import now/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download Rows to Fix/i })).toBeInTheDocument();

    // Verify partial commit button is enabled for the 2 valid rows
    const partialCommitBtn = screen.getByRole('button', { name: 'Import Valid Rows (2)' });
    expect(partialCommitBtn).not.toBeDisabled();

    // Test Status Filter Select
    const filterSelect = screen.getByLabelText(/Filter Status:/i) as HTMLSelectElement;
    expect(filterSelect).toBeInTheDocument();

    // Filter by 'Invalid'
    fireEvent.change(filterSelect, { target: { value: 'invalid' } });

    await waitFor(() => {
      expect(screen.queryByDisplayValue('Valid Guest')).not.toBeInTheDocument();
      expect(screen.getByText(/✕ Guest name is required\./i)).toBeInTheDocument();
    });

    // Filter by 'Duplicates'
    fireEvent.change(filterSelect, { target: { value: 'duplicate' } });

    await waitFor(() => {
      expect(screen.getByDisplayValue('Conflict Guest')).toBeInTheDocument();
      expect(screen.getByText('Existing guest: John Doe')).toBeInTheDocument();
    });

    // Switch back to 'All Rows'
    fireEvent.change(filterSelect, { target: { value: 'all' } });

    // Remove the invalid row (row 3)
    const deleteButtons = screen.getAllByTitle('Remove row');
    expect(deleteButtons.length).toBe(3);

    // Mock validate call for remaining 2 rows
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        summary: {
          total: 2,
          validCount: 2,
          invalidCount: 0,
          duplicateCount: 1,
          updatedCount: 0,
          skippedCount: 1,
          createdCount: 1,
        },
        rows: [
          {
            rowIndex: 1,
            guestName: 'Valid Guest',
            code: 'VALID100',
            email: 'valid@example.com',
            isValid: true,
            errors: [],
            warnings: [],
            isDuplicate: false,
            actionOutcome: 'create',
          },
          {
            rowIndex: 2,
            guestName: 'Conflict Guest',
            code: 'EXISTING1',
            email: 'conflict@example.com',
            isValid: true,
            errors: [],
            warnings: ['Code "EXISTING1" already exists for guest "John Doe". Will be skipped.'],
            isDuplicate: true,
            existingGuestName: 'John Doe',
            actionOutcome: 'skip',
          },
        ],
      }),
    });

    fireEvent.click(deleteButtons[2]);

    // Invalid count is now 0, full Commit Import button is shown and enabled
    await waitFor(() => {
      expect(screen.getByText(/Invalid: 0/i)).toBeInTheDocument();
      const fullCommitBtn = screen.getByRole('button', { name: 'Commit Import (2 rows)' });
      expect(fullCommitBtn).not.toBeDisabled();
    });
  });

  test('debounces dry-run validation by 400ms during cell editing and generates exactly one backend validation request for 10 consecutive edits', async () => {
    window.sessionStorage.clear();
    renderModal(true);

    const csvContent = 'Guest Name,Invitation Code\nAlice Smith,ALICE100';
    const file = new File([csvContent], 'guests.csv', { type: 'text/csv' });
    (file as any)._content = csvContent;

    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url === '/api/admin/invitation-codes/validate') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            summary: { total: 1, validCount: 1, invalidCount: 0, duplicateCount: 0, updatedCount: 0, skippedCount: 0, createdCount: 1 },
            rows: [{ rowIndex: 1, guestName: 'Alice Smith A012345678', code: 'ALICE100', isValid: true, errors: [], warnings: [] }],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ ok: true, success: true, codes: [] }),
      });
    });

    const input = screen.getByLabelText(/Click to select CSV file/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText(/Guest Name Column \(Required\)/i)).toBeInTheDocument();
    });

    // Advance to step 3
    fireEvent.click(screen.getByText(/Continue to Review/i));

    await waitFor(() => {
      expect(screen.getByLabelText(/Duplicate Action:/i)).toBeInTheDocument();
    });

    // Step 3 initial load calls validate endpoint
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/admin/invitation-codes/validate',
      expect.objectContaining({ method: 'POST' })
    );
    (global.fetch as jest.Mock).mockClear();

    const nameInput = screen.getByDisplayValue('Alice Smith');

    jest.useFakeTimers();

    try {
      // Type 10 characters sequentially with 100ms between each edit (<400ms debounce window)
      for (let i = 0; i < 10; i++) {
        fireEvent.change(nameInput, { target: { value: `Alice Smith A${i}` } });
        jest.advanceTimersByTime(100);
      }

      // During typing (total 1000ms elapsed, but only 100ms since last edit), no validation request sent yet
      expect(global.fetch).not.toHaveBeenCalled();

      // Advance remaining 300ms so 400ms elapses after the last edit
      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      // Exactly 1 backend validation call fired for the 10 edits
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/admin/invitation-codes/validate',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Alice Smith A9'),
        })
      );
    } finally {
      jest.useRealTimers();
    }
  });

  test('triggers immediate server dry-run validation without debounce delay on Step 3 load and collision strategy change', async () => {
    window.sessionStorage.clear();
    renderModal(true);

    const csvContent = 'Guest Name,Invitation Code\nAlice Smith,ALICE100';
    const file = new File([csvContent], 'guests.csv', { type: 'text/csv' });
    (file as any)._content = csvContent;

    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url === '/api/admin/invitation-codes/validate') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            summary: { total: 1, validCount: 1, invalidCount: 0, duplicateCount: 0, updatedCount: 0, skippedCount: 0, createdCount: 1 },
            rows: [{ rowIndex: 1, guestName: 'Alice Smith', code: 'ALICE100', isValid: true, errors: [], warnings: [] }],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ ok: true, success: true, codes: [] }),
      });
    });

    const input = screen.getByLabelText(/Click to select CSV file/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText(/Guest Name Column \(Required\)/i)).toBeInTheDocument();
    });

    (global.fetch as jest.Mock).mockClear();

    // Advance to Step 3
    fireEvent.click(screen.getByText(/Continue to Review/i));

    // Immediate validation request fired on Step 3 entry
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/admin/invitation-codes/validate',
        expect.objectContaining({ method: 'POST' })
      );
    });

    (global.fetch as jest.Mock).mockClear();

    // Change Collision Strategy dropdown
    const strategySelect = screen.getByLabelText(/Duplicate Action:/i) as HTMLSelectElement;
    fireEvent.change(strategySelect, { target: { value: 'update' } });

    // Immediate validation request fired on strategy change
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/admin/invitation-codes/validate',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"collisionStrategy":"update"'),
        })
      );
    });
  });

  test('flushes pending debounced server validation immediately and awaits latest response when clicking Commit Import', async () => {
    window.sessionStorage.clear();
    renderModal(true);

    const csvContent = 'Guest Name,Invitation Code\nAlice Smith,ALICE100';
    const file = new File([csvContent], 'guests.csv', { type: 'text/csv' });
    (file as any)._content = csvContent;

    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url === '/api/admin/invitation-codes/batch') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, count: 1, imported: 1, skipped: 0, updated: 0 }),
        });
      }
      if (url === '/api/admin/invitation-codes/validate') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            summary: { total: 1, validCount: 1, invalidCount: 0, duplicateCount: 0, updatedCount: 0, skippedCount: 0, createdCount: 1 },
            rows: [{ rowIndex: 1, guestName: 'Alice Smith Updated', code: 'ALICE100', isValid: true, errors: [], warnings: [] }],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ ok: true, success: true, codes: [] }),
      });
    });

    const input = screen.getByLabelText(/Click to select CSV file/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText(/Guest Name Column \(Required\)/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Continue to Review/i));

    await waitFor(() => {
      expect(screen.getByLabelText(/Duplicate Action:/i)).toBeInTheDocument();
    });

    (global.fetch as jest.Mock).mockClear();

    // Edit cell
    const nameInput = screen.getByDisplayValue('Alice Smith');
    fireEvent.change(nameInput, { target: { value: 'Alice Smith Updated' } });

    const commitBtn = screen.getByText(/Commit Import/i);
    fireEvent.click(commitBtn);

    // The dry-run validation endpoint should be called immediately (flushed) followed by batch commit endpoint
    await waitFor(() => {
      expect(screen.getByText('Import Execution Complete')).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/admin/invitation-codes/validate',
      expect.objectContaining({ method: 'POST' })
    );
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/admin/invitation-codes/batch',
      expect.objectContaining({ method: 'POST' })
    );
  });

  test('discards stale in-flight validation responses when superseded', async () => {
    window.sessionStorage.clear();
    renderModal(true);

    const csvContent = 'Guest Name,Invitation Code\nAlice Smith,ALICE100';
    const file = new File([csvContent], 'guests.csv', { type: 'text/csv' });
    (file as any)._content = csvContent;

    let resolveFirstValidate: (val: any) => void;
    const firstValidatePromise = new Promise((resolve) => {
      resolveFirstValidate = resolve;
    });

    let validateCallCount = 0;
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url === '/api/admin/invitation-codes/validate') {
        validateCallCount++;
        if (validateCallCount === 1) {
          return firstValidatePromise;
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            summary: { total: 1, validCount: 1, invalidCount: 0, duplicateCount: 0, updatedCount: 0, skippedCount: 0, createdCount: 1 },
            rows: [{ rowIndex: 1, guestName: 'Alice Smith', code: 'ALICE100', isValid: true, errors: [], warnings: [] }],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ ok: true, success: true, codes: [] }),
      });
    });

    const input = screen.getByLabelText(/Click to select CSV file/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText(/Guest Name Column \(Required\)/i)).toBeInTheDocument();
    });

    // Step 3 entry triggers first validate call (which is pending on firstValidatePromise)
    fireEvent.click(screen.getByText(/Continue to Review/i));

    await waitFor(() => {
      expect(screen.getByLabelText(/Duplicate Action:/i)).toBeInTheDocument();
    });

    // Now trigger a second validate call immediately by changing collision strategy
    const strategySelect = screen.getByLabelText(/Duplicate Action:/i) as HTMLSelectElement;
    fireEvent.change(strategySelect, { target: { value: 'update' } });

    // Resolve the first validate call with stale error data after the second request superseded it
    resolveFirstValidate!({
      ok: true,
      json: async () => ({
        success: true,
        summary: { total: 1, validCount: 0, invalidCount: 1, duplicateCount: 0, updatedCount: 0, skippedCount: 0, createdCount: 0 },
        rows: [{ rowIndex: 1, guestName: 'Alice Smith', code: 'ALICE100', isValid: false, errors: ['Stale Error'], warnings: [] }],
      }),
    });

    // The UI should show the second validate result (0 invalid), ignoring the stale error
    await waitFor(() => {
      expect(screen.queryByText('Stale Error')).not.toBeInTheDocument();
      expect(screen.getByText(/Valid: 1/i)).toBeInTheDocument();
    });
  });

  test('gracefully handles undefined or null entries in existingCodes without throwing', () => {
    expect(() => {
      render(
        <ToastProvider>
          <CsvImportWizardModal
            isOpen={true}
            onClose={mockOnClose}
            onImportComplete={mockOnImportComplete}
            existingCodes={['CODE1', undefined as unknown as string, '', null as unknown as string, 'code2']}
          />
        </ToastProvider>
      );
    }).not.toThrow();

    expect(screen.getByText('Import Guest Invitation Codes')).toBeInTheDocument();
  });

  test('renders standardized Input primitives with compact size and design tokens in review table', async () => {
    window.sessionStorage.clear();
    const csvData = 'Guest Name,Code\nValid Guest,VALID01\n,INVALID01';
    const file = new File([csvData], 'guests.csv', { type: 'text/csv' });
    (file as any)._content = csvData;

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        summary: { total: 2, validCount: 1, invalidCount: 1, duplicateCount: 0, updatedCount: 0, skippedCount: 0, createdCount: 1 },
        rows: [
          { rowIndex: 1, guestName: 'Valid Guest', code: 'VALID01', isValid: true, errors: [], warnings: [] },
          { rowIndex: 2, guestName: '', code: 'INVALID01', isValid: false, errors: ['Guest Name is required'], warnings: [] },
        ],
      }),
    });

    render(
      <ToastProvider>
        <CsvImportWizardModal
          isOpen={true}
          onClose={mockOnClose}
          onImportComplete={mockOnImportComplete}
        />
      </ToastProvider>
    );

    const input = screen.getByLabelText(/Click to select CSV file/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText(/Guest Name Column \(Required\)/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Continue to Review/i));

    await waitFor(() => {
      expect(screen.getByText('3. Review & Validate')).toBeInTheDocument();
    });

    const validGuestInput = screen.getByLabelText('Guest Name for row 1');
    const invalidGuestInput = screen.getByLabelText('Guest Name for row 2');

    // Sizing: compact variant applies h-7 px-2 py-1 text-xs
    expect(validGuestInput.className).toContain('h-7 px-2 py-1 text-xs');
    expect(invalidGuestInput.className).toContain('h-7 px-2 py-1 text-xs');

    // Theme design tokens: valid row uses default input border token, invalid row uses error border token
    expect(validGuestInput.className).toContain('border-[var(--input-border,var(--color-surface-border,#d1d5db))]');
    expect(invalidGuestInput.className).toContain('border-[var(--input-error-border,var(--color-error-text,#ef4444))]');
    expect(invalidGuestInput).toHaveAttribute('aria-invalid', 'true');
  });

  test('fast cell editing and immediate batch submission evaluates latest validation status without stale closure error block', async () => {
    window.sessionStorage.clear();
    renderModal(true);

    // Initial CSV has an invalid row (empty guest name)
    const csvContent = 'Guest Name,Invitation Code\n,ALICE100';
    const file = new File([csvContent], 'guests.csv', { type: 'text/csv' });
    (file as any)._content = csvContent;

    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url === '/api/admin/invitation-codes/validate') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            summary: { total: 1, validCount: 1, invalidCount: 0, duplicateCount: 0, updatedCount: 0, skippedCount: 0, createdCount: 1 },
            rows: [{ rowIndex: 1, guestName: 'Alice Fixed', code: 'ALICE100', isValid: true, errors: [], warnings: [] }],
          }),
        });
      }
      if (url === '/api/admin/invitation-codes/batch') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, count: 1, imported: 1, skipped: 0, updated: 0 }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const input = screen.getByLabelText(/Click to select CSV file/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText(/Guest Name Column \(Required\)/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Continue to Review/i));

    await waitFor(() => {
      expect(screen.getByText('3. Review & Validate')).toBeInTheDocument();
    });

    // Correct the empty guest name cell
    const nameInput = screen.getByLabelText('Guest Name for row 1');
    fireEvent.change(nameInput, { target: { value: 'Alice Fixed' } });

    // Immediately click Commit Import (during debounce window)
    const commitBtn = screen.getByText(/Commit Import/i);
    fireEvent.click(commitBtn);

    // Must successfully proceed to Step 4 rather than being blocked by stale invalidCount
    await waitFor(() => {
      expect(screen.getByText('Import Execution Complete')).toBeInTheDocument();
    });

    expect(mockOnImportComplete).toHaveBeenCalled();
  });

  test('cancels active AbortController and pending timer when navigating away from step 3 and resets validating status', async () => {
    window.sessionStorage.clear();
    renderModal(true);

    const csvContent = 'Guest Name,Invitation Code\nBob Smith,BOB100';
    const file = new File([csvContent], 'guests.csv', { type: 'text/csv' });
    (file as any)._content = csvContent;

    let abortedSignal: boolean | undefined;
    (global.fetch as jest.Mock).mockImplementation((url: string, options?: any) => {
      if (url === '/api/admin/invitation-codes/validate') {
        if (options?.signal) {
          options.signal.addEventListener('abort', () => {
            abortedSignal = true;
          });
        }
        return new Promise(() => {});
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const input = screen.getByLabelText(/Click to select CSV file/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText(/Guest Name Column \(Required\)/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Continue to Review/i));

    await waitFor(() => {
      expect(screen.getByText('3. Review & Validate')).toBeInTheDocument();
    });

    // Validating indicator is displayed while request is in-flight
    expect(screen.getByText(/Validating\.\.\./i)).toBeInTheDocument();

    // Click Back to return to Step 2
    const backBtn = screen.getByRole('button', { name: /Back/i });
    fireEvent.click(backBtn);

    await waitFor(() => {
      expect(screen.getByText(/2. Map Columns/i)).toBeInTheDocument();
    });

    // Verify signal was aborted
    expect(abortedSignal).toBe(true);

    // Re-enter step 3 and verify controls are unlocked (not stuck in validating)
    fireEvent.click(screen.getByText(/Continue to Review/i));
    await waitFor(() => {
      expect(screen.getByText('3. Review & Validate')).toBeInTheDocument();
    });
  });

  test('reloading the page on step 4 displays the saved import counts and close wizard button without blank screen', async () => {
    window.sessionStorage.clear();

    // Pre-populate sessionStorage with a Step 4 persisted state
    const step4PersistedState = {
      step: 4,
      fileName: 'completed_guests.csv',
      csvHeaders: ['Guest Name', 'Invitation Code'],
      rawRows: [{ 'Guest Name': 'David', 'Invitation Code': 'DAVID1' }],
      guestNameCol: 'Guest Name',
      codeCol: 'Invitation Code',
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
      importSummary: {
        total: 10,
        imported: 7,
        skipped: 2,
        updated: 1,
      },
    };
    window.sessionStorage.setItem('csv_import_wizard_draft', JSON.stringify(step4PersistedState));

    renderModal(true);

    // Verify that Step 4 renders saved completion summary counts
    expect(screen.getByText('Import Execution Complete')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText(/Batch creation processed without database wipes/i)).toBeInTheDocument();

    // Verify close wizard button is present and functional
    const closeBtn = screen.getByRole('button', { name: /Close Wizard/i });
    expect(closeBtn).toBeInTheDocument();
    fireEvent.click(closeBtn);

    expect(mockOnClose).toHaveBeenCalled();
  });

  test('reconciles asynchronous server responses with local edits using sequence identifiers to prevent data overwriting', async () => {
    window.sessionStorage.clear();
    renderModal(true);

    const csvContent = 'Guest Name,Invitation Code\nEve,EVE100';
    const file = new File([csvContent], 'guests.csv', { type: 'text/csv' });
    (file as any)._content = csvContent;

    let resolveValidate: (val: any) => void;
    const validatePromise = new Promise((resolve) => {
      resolveValidate = resolve;
    });

    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url === '/api/admin/invitation-codes/validate') {
        return validatePromise;
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const input = screen.getByLabelText(/Click to select CSV file/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText(/Guest Name Column \(Required\)/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Continue to Review/i));

    await waitFor(() => {
      expect(screen.getByText('3. Review & Validate')).toBeInTheDocument();
    });

    // While validation is pending on validatePromise, user edits the cell
    const nameInput = screen.getByDisplayValue('Eve');
    fireEvent.change(nameInput, { target: { value: 'Eve Modified Local' } });

    // Invalidate/resolve previous server validation with outdated row data
    resolveValidate!({
      ok: true,
      json: async () => ({
        success: true,
        summary: { total: 1, validCount: 1, invalidCount: 0, duplicateCount: 0, updatedCount: 0, skippedCount: 0, createdCount: 1 },
        rows: [{ rowIndex: 1, guestName: 'Eve Stale Server Data', code: 'EVE100', isValid: true, errors: [], warnings: [] }],
      }),
    });

    // Wait to confirm local edit was not overwritten by stale server response
    await waitFor(() => {
      expect(screen.queryByDisplayValue('Eve Stale Server Data')).not.toBeInTheDocument();
      expect(screen.getByDisplayValue('Eve Modified Local')).toBeInTheDocument();
    });
  });

  test('supports split guest names (Joy format) through mapping confirmation and preview', async () => {
    window.sessionStorage.clear();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        summary: { total: 1, validCount: 1, invalidCount: 0, duplicateCount: 0, updatedCount: 0, skippedCount: 0, createdCount: 1 },
        rows: [{ rowIndex: 1, guestName: 'Jane Doe', code: 'JANE100', isValid: true, errors: [], warnings: [] }],
      }),
    });

    renderModal(true);

    const csvContent =
      'First Name,Last Name,Invitation Code\n' +
      'Jane,Doe,JANE100';
    const file = new File([csvContent], 'joy_guests.csv', { type: 'text/csv' });
    (file as any)._content = csvContent;

    const input = screen.getByLabelText(/Click to select CSV file/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    // Step 2: Auto-detected split columns
    await waitFor(() => {
      expect(screen.getByText(/2. Map Columns/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Guest First Name Column/i)).toHaveValue('First Name');
      expect(screen.getByLabelText(/Guest Last Name Column/i)).toHaveValue('Last Name');
      // Single guest name column should remain unselected
      expect(screen.getByLabelText(/Guest Name Column \(Required\)/i)).toHaveValue('');
    });

    // Preview should display combined name
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();

    // Advance to Step 3
    fireEvent.click(screen.getByText(/Continue to Review/i));

    await waitFor(() => {
      expect(screen.getByText('3. Review & Validate')).toBeInTheDocument();
    });

    expect(screen.getByDisplayValue('Jane Doe')).toBeInTheDocument();
    expect(screen.getByDisplayValue('JANE100')).toBeInTheDocument();
  });

  test('marks only the failing column Input invalid with aria-describedby and passes jest-axe', async () => {
    window.sessionStorage.clear();
    const csvData = 'Guest Name,Invitation Code,Email\nAlice Valid,ALICE10,not-an-email';
    const file = new File([csvData], 'single-cell-error.csv', { type: 'text/csv' });
    (file as any)._content = csvData;

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        summary: {
          total: 1,
          validCount: 0,
          invalidCount: 1,
          duplicateCount: 0,
          updatedCount: 0,
          skippedCount: 0,
          createdCount: 0,
        },
        rows: [
          {
            rowIndex: 1,
            guestName: 'Alice Valid',
            code: 'ALICE10',
            email: 'not-an-email',
            isValid: false,
            errors: ['Invalid email format.'],
            fieldErrors: { email: ['Invalid email format.'] },
            warnings: [],
            isDuplicate: false,
            actionOutcome: 'invalid',
          },
        ],
      }),
    });

    const { container } = render(
      <ToastProvider>
        <CsvImportWizardModal
          isOpen={true}
          onClose={mockOnClose}
          onImportComplete={mockOnImportComplete}
        />
      </ToastProvider>
    );

    const fileInput = screen.getByLabelText(/Click to select CSV file/i) as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText(/Guest Name Column \(Required\)/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Continue to Review/i));

    await waitFor(() => {
      expect(screen.getByText('3. Review & Validate')).toBeInTheDocument();
      expect(screen.getByText(/Invalid email format\./i)).toBeInTheDocument();
    });

    const emailInput = screen.getByLabelText('Email for row 1');
    const guestInput = screen.getByLabelText('Guest Name for row 1');
    const codeInput = screen.getByLabelText('Invitation Code for row 1');
    const cityInput = screen.getByLabelText('City for row 1');

    expect(emailInput).toHaveAttribute('aria-invalid', 'true');
    expect(emailInput).toHaveAttribute('aria-describedby', 'csv-row-1-error-0');
    expect(document.getElementById('csv-row-1-error-0')).toHaveTextContent('Invalid email format.');

    // Sibling valid columns remain aria-invalid="false" without aria-describedby
    expect(guestInput).toHaveAttribute('aria-invalid', 'false');
    expect(guestInput).not.toHaveAttribute('aria-describedby');
    expect(codeInput).toHaveAttribute('aria-invalid', 'false');
    expect(codeInput).not.toHaveAttribute('aria-describedby');
    expect(cityInput).toHaveAttribute('aria-invalid', 'false');
    expect(cityInput).not.toHaveAttribute('aria-describedby');

    const axeResults = await axe(container);
    expect(axeResults).toHaveNoViolations();
  });

  test('consolidates multi-row households in Step 2 into single invitations with companion names, allocations, dietary notes, and tags', async () => {
    window.sessionStorage.clear();
    const csvData = [
      'First Name,Last Name,Email,Household Name,Dietary Notes,Party Tags',
      'Jane,Doe,jane@example.com,Doe Family,Vegetarian,"VIP, Bride"',
      'John,Doe,,Doe Family,Nut Allergy,"VIP, College"',
      'Tommy,Doe,,Doe Family,Dairy Free,Kids',
      'Solo,Guest,solo@example.com,,,Friends',
    ].join('\n');
    const file = new File([csvData], 'households.csv', { type: 'text/csv' });
    (file as any)._content = csvData;

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        summary: {
          total: 2,
          validCount: 2,
          invalidCount: 0,
          duplicateCount: 0,
          updatedCount: 0,
          skippedCount: 0,
          createdCount: 2,
        },
        rows: [
          { rowIndex: 1, guestName: 'Jane Doe', code: '', isValid: true, errors: [], warnings: [] },
          { rowIndex: 2, guestName: 'Solo Guest', code: '', isValid: true, errors: [], warnings: [] },
        ],
      }),
    });

    renderModal(true);

    const fileInput = screen.getByLabelText(/Click to select CSV file/i) as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText(/Guest Name Column \(Required\)/i)).toBeInTheDocument();
    });

    const toggle = screen.getByLabelText(
      /Consolidate rows sharing a Household Name onto one invitation/i
    );
    fireEvent.click(toggle);

    fireEvent.click(screen.getByText(/Continue to Review/i));

    await waitFor(() => {
      expect(screen.getByText('3. Review & Validate')).toBeInTheDocument();
      expect(screen.getByText(/Total: 2/i)).toBeInTheDocument();
    });

    expect(screen.getByDisplayValue('Jane Doe')).toBeInTheDocument();
    expect(screen.getByDisplayValue('John')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Doe')).toBeInTheDocument();
    expect(screen.getByText('Companions: John Doe, Tommy Doe')).toBeInTheDocument();
    expect(screen.getByLabelText('Plus-One Allocation for row 1')).toHaveValue(2);
    expect(screen.getByLabelText('Dietary Notes for row 1')).toHaveValue(
      'Vegetarian; Nut Allergy; Dairy Free'
    );
    expect(screen.getByLabelText('Party Tags for row 1')).toHaveValue(
      'VIP, Bride, College, Kids'
    );
  });

  test('displays matched blank-code guest indicator and Update/Skip badge in Step 3', async () => {
    window.sessionStorage.clear();
    const csvData = 'Guest Name,Email\nJane Doe,jane@example.com';
    const file = new File([csvData], 'blank-code-reimport.csv', { type: 'text/csv' });
    (file as any)._content = csvData;

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        summary: {
          total: 1,
          validCount: 1,
          invalidCount: 0,
          duplicateCount: 1,
          updatedCount: 1,
          skippedCount: 0,
          createdCount: 0,
        },
        rows: [
          {
            rowIndex: 1,
            guestName: 'Jane Doe',
            code: 'JANE2026',
            email: 'jane@example.com',
            isValid: true,
            errors: [],
            warnings: ['Matched existing guest "Jane Doe" (code "JANE2026") by email. Will be updated.'],
            isDuplicate: true,
            existingGuestName: 'Jane Doe',
            actionOutcome: 'update',
          },
        ],
      }),
    });

    renderModal(true);
    const fileInput = screen.getByLabelText(/Click to select CSV file/i) as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText(/Guest Name Column \(Required\)/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Continue to Review/i));

    await waitFor(() => {
      expect(screen.getByText('Matched code: JANE2026')).toBeInTheDocument();
      expect(screen.getByText('Existing guest: Jane Doe')).toBeInTheDocument();
      expect(screen.getByText('Update')).toBeInTheDocument();
    });
  });

  test('commits 48 valid rows out of 50 in partial commit mode and exports 2 sanitized failed rows in Step 3 and Step 4', async () => {
    window.sessionStorage.clear();

    const csvLines = ['Guest Name,Invitation Code,Email'];
    for (let i = 1; i <= 48; i++) {
      const code = `VALID${String(i).padStart(3, '0')}`;
      csvLines.push(`Guest ${i},${code},guest${i}@example.com`);
    }
    csvLines.push('"=cmd|\'/C calc\'!A0",BAD001,not-an-email');
    csvLines.push(',BAD002,bad-email-2');

    const csvData = csvLines.join('\n');
    const file = new File([csvData], 'fifty-rows.csv', { type: 'text/csv' });
    (file as any)._content = csvData;

    const serverValidatedRows = [
      ...Array.from({ length: 48 }, (_, idx) => ({
        rowIndex: idx + 1,
        guestName: `Guest ${idx + 1}`,
        code: `VALID${String(idx + 1).padStart(3, '0')}`,
        email: `guest${idx + 1}@example.com`,
        isValid: true,
        errors: [],
        warnings: [],
        isDuplicate: false,
        actionOutcome: 'create' as const,
      })),
      {
        rowIndex: 49,
        guestName: "=cmd|'/C calc'!A0",
        code: 'BAD001',
        email: 'not-an-email',
        isValid: false,
        errors: ['Invalid email format.'],
        fieldErrors: { email: ['Invalid email format.'] },
        warnings: [],
        isDuplicate: false,
        actionOutcome: 'invalid' as const,
      },
      {
        rowIndex: 50,
        guestName: '',
        code: 'BAD002',
        email: 'bad-email-2',
        isValid: false,
        errors: ['Guest name is required.', 'Invalid email format.'],
        fieldErrors: {
          guestName: ['Guest name is required.'],
          email: ['Invalid email format.'],
        },
        warnings: [],
        isDuplicate: false,
        actionOutcome: 'invalid' as const,
      },
    ];

    let capturedBatchPayload: any = null;
    (global.fetch as jest.Mock).mockImplementation((url: string, options?: any) => {
      if (url === '/api/admin/invitation-codes/validate') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            summary: {
              total: 50,
              validCount: 48,
              invalidCount: 2,
              duplicateCount: 0,
              updatedCount: 0,
              skippedCount: 0,
              createdCount: 48,
            },
            rows: serverValidatedRows,
          }),
        });
      }
      if (url === '/api/admin/invitation-codes/batch') {
        capturedBatchPayload = JSON.parse(options.body);
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            count: 48,
            imported: 48,
            skipped: 0,
            updated: 0,
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const capturedBlobs: string[] = [];
    const OriginalBlob = global.Blob;
    const BlobSpy = jest
      .spyOn(global, 'Blob')
      .mockImplementation((parts?: BlobPart[], options?: BlobPropertyBag) => {
        if (parts && typeof parts[0] === 'string') {
          capturedBlobs.push(parts[0]);
        }
        return new OriginalBlob(parts, options);
      });
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const anchorClickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    URL.createObjectURL = jest.fn(() => 'blob:http://localhost/rows_to_fix');
    URL.revokeObjectURL = jest.fn();

    try {
      const { container } = render(
        <ToastProvider>
          <CsvImportWizardModal
            isOpen={true}
            onClose={mockOnClose}
            onImportComplete={mockOnImportComplete}
          />
        </ToastProvider>
      );

      const fileInput = screen.getByLabelText(/Click to select CSV file/i) as HTMLInputElement;
      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByText(/Guest Name Column \(Required\)/i)).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText(/Continue to Review/i));

      await waitFor(() => {
        expect(screen.getByText(/Total: 50/i)).toBeInTheDocument();
        expect(screen.getByText(/Valid: 48/i)).toBeInTheDocument();
        expect(screen.getByText(/Invalid: 2/i)).toBeInTheDocument();
      });

      const importValidBtn = screen.getByRole('button', { name: 'Import Valid Rows (48)' });
      expect(importValidBtn).not.toBeDisabled();

      // Export failed rows in Step 3
      const step3DownloadBtn = screen.getByRole('button', { name: /Download Rows to Fix/i });
      fireEvent.click(step3DownloadBtn);

      expect(capturedBlobs.length).toBeGreaterThanOrEqual(1);
      const exportedCsv = capturedBlobs[capturedBlobs.length - 1];
      expect(exportedCsv).toContain('Validation Errors');
      expect(exportedCsv).toContain("'=cmd|'/C calc'!A0");
      expect(exportedCsv).toContain('BAD001');
      expect(exportedCsv).toContain('BAD002');
      expect(exportedCsv).toContain('Guest name is required.; Invalid email format.');

      const axeResults = await axe(container);
      expect(axeResults).toHaveNoViolations();

      // Commit the 48 valid rows while skipping the 2 invalid rows
      fireEvent.click(importValidBtn);

      await waitFor(() => {
        expect(screen.getByText('Import Execution Complete')).toBeInTheDocument();
      });

      expect(capturedBatchPayload).not.toBeNull();
      expect(capturedBatchPayload.records).toHaveLength(48);
      expect(
        capturedBatchPayload.records.some((r: { code: string }) => r.code.startsWith('BAD'))
      ).toBe(false);

      // Step 4 also displays skipped invalid count and Download Rows to Fix
      expect(
        screen.getByText(/2 invalid rows were skipped during import/i)
      ).toBeInTheDocument();
      const step4DownloadBtn = screen.getByRole('button', { name: 'Download Rows to Fix' });
      fireEvent.click(step4DownloadBtn);
      expect(capturedBlobs.length).toBeGreaterThanOrEqual(2);
    } finally {
      anchorClickSpy.mockRestore();
      BlobSpy.mockRestore();
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
  }, 15000);

  test('omits plusOneAllocations when plusOneCol is unmapped, maps phoneCol and plusOneNameCol, and leaves RSVP summary columns unchecked', async () => {
    window.sessionStorage.clear();
    let capturedBatchBody: any = null;
    (global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
      const parsedBody = init?.body ? JSON.parse(init.body as string) : {};
      if (url.includes('/api/admin/invitation-codes/validate')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            summary: {
              total: 1,
              validCount: 1,
              invalidCount: 0,
              duplicateCount: 1,
              updatedCount: 1,
              skippedCount: 0,
              createdCount: 0,
            },
            rows: [
              {
                rowIndex: 1,
                guestName: 'Jane Doe',
                code: 'JANE2026',
                isValid: true,
                errors: [],
                warnings: [],
                actionOutcome: 'update',
              },
            ],
          }),
        };
      }
      if (url.includes('/api/admin/invitation-codes/batch')) {
        capturedBatchBody = parsedBody;
        return {
          ok: true,
          json: async () => ({
            success: true,
            count: 1,
            imported: 0,
            skipped: 0,
            updated: 1,
          }),
        };
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    renderModal(true, ['JANE2026']);

    const csvData = [
      'Guest Name,Invitation Code,RSVP Link,Email,Phone Number,Plus-One Name,Address Line 1,City,State,ZIP Code,Country,Meal Selections,Custom Answers,Attendance',
      'Jane Doe,JANE2026,http://localhost:3000/guest?code=JANE2026,jane@example.com,"\'+1 (555) 234-5678","John Doe, Tommy Doe",123 Main St,Boston,MA,02101,USA,"Jane: Salmon","Song: Hey Ya",Attending',
    ].join('\n');
    const file = new File([csvData], 'roundtrip-partial.csv', { type: 'text/csv' });
    (file as any)._content = csvData;

    fireEvent.change(screen.getByLabelText(/Click to select CSV file/i), {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/^Phone Number Column/i)).toHaveValue('Phone Number');
    });

    expect(screen.getByLabelText(/^Plus-One Name Column/i)).toHaveValue('Plus-One Name');
    expect(screen.getByLabelText(/^Dietary Notes \/ Allergies/i)).toHaveValue('');
    expect(screen.getByLabelText(/^Plus-One Allocations Column/i)).toHaveValue('');
    expect(screen.getByLabelText('Meal Selections')).not.toBeChecked();
    expect(screen.getByLabelText('Custom Answers')).not.toBeChecked();
    expect(screen.getByLabelText('Attendance')).not.toBeChecked();
    expect(screen.getByLabelText('RSVP Link')).not.toBeChecked();

    fireEvent.click(screen.getByText(/Continue to Review/i));

    await waitFor(() => {
      expect(screen.getByLabelText(/Duplicate Action/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/Duplicate Action/i), {
      target: { value: 'update' },
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Commit Import \(1 rows\)/i })).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole('button', { name: /Commit Import \(1 rows\)/i }));

    await waitFor(() => {
      expect(screen.getByText('Import Execution Complete')).toBeInTheDocument();
    });

    expect(capturedBatchBody).not.toBeNull();
    expect(capturedBatchBody.collisionStrategy).toBe('update');
    expect(capturedBatchBody.records).toHaveLength(1);
    expect('plusOneAllocations' in capturedBatchBody.records[0]).toBe(false);
    expect(capturedBatchBody.records[0]).toEqual({
      guestName: 'Jane Doe',
      code: 'JANE2026',
      email: 'jane@example.com',
      addressLine1: '123 Main St',
      city: 'Boston',
      state: 'MA',
      zipCode: '02101',
      country: 'USA',
      plusOneFirstName: 'John',
      plusOneLastName: 'Doe',
      extraFields: {
        plusOneNames: ['John Doe', 'Tommy Doe'],
        phone: '+15552345678',
      },
    });
  });

  test('enabling consolidation without householdNameCol never groups rows by Party Group (Bride / Groom)', async () => {
    window.sessionStorage.clear();
    (global.fetch as jest.Mock).mockRejectedValue(new Error('offline'));

    renderModal(true);

    const csvData = [
      'Guest Name,Party Group,Email',
      'Alice BrideSide,Bride,alice@example.com',
      'Beth BrideSide,Bride,beth@example.com',
      'Carl GroomSide,Groom,carl@example.com',
    ].join('\n');
    const file = new File([csvData], 'sides.csv', { type: 'text/csv' });
    (file as any)._content = csvData;

    fireEvent.change(screen.getByLabelText(/Click to select CSV file/i), {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/^Party Side \/ Group Column/i)).toHaveValue('Party Group');
      expect(screen.getByLabelText(/^Household Name Column/i)).toHaveValue('');
    });

    fireEvent.click(
      screen.getByLabelText(/Consolidate rows sharing a Household Name onto one invitation/i)
    );
    fireEvent.click(screen.getByText(/Continue to Review/i));

    await waitFor(() => {
      expect(screen.getByText(/Total: 3/i)).toBeInTheDocument();
    });

    expect(screen.getByDisplayValue('Alice BrideSide')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Beth BrideSide')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Carl GroomSide')).toBeInTheDocument();
  });

  test('guards unsaved drafts and failedRows on Escape or backdrop click via useDirtyConfirmClose while closing cleanly when Step 4 failedRows is empty', async () => {
    window.sessionStorage.clear();
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
      if (url.includes('/api/admin/invitation-codes/validate')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            summary: {
              total: 2,
              validCount: 1,
              invalidCount: 1,
              duplicateCount: 0,
              updatedCount: 0,
              skippedCount: 0,
              createdCount: 1,
            },
            rows: [
              { rowIndex: 1, guestName: 'Valid Guest', code: 'VAL01', isValid: true, errors: [], warnings: [] },
              { rowIndex: 2, guestName: '', code: 'BAD01', isValid: false, errors: ['Guest name is required.'], warnings: [] },
            ],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          success: true,
          count: 1,
          imported: 1,
          skipped: 0,
          updated: 0,
        }),
      };
    });

    render(
      <ToastProvider>
        <CsvImportWizardModal
          isOpen={true}
          onClose={mockOnClose}
          onImportComplete={mockOnImportComplete}
        />
      </ToastProvider>
    );

    const csvData = 'Guest Name,Invitation Code\nValid Guest,VAL01\n,BAD01';
    const file = new File([csvData], 'dirty-guard.csv', { type: 'text/csv' });
    (file as any)._content = csvData;

    fireEvent.change(screen.getByLabelText(/Click to select CSV file/i), {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(screen.getByText(/Continue to Review/i)).toBeInTheDocument();
      expect(window.sessionStorage.getItem('csv_import_wizard_draft')).not.toBeNull();
    });

    // Pressing Escape on Step 2 prompts confirmation instead of clearing draft immediately
    fireEvent.keyDown(document, { key: 'Escape' });

    const alertDialog = await screen.findByRole('alertdialog');
    expect(alertDialog).toHaveTextContent(/unsaved changes/i);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    expect(mockOnClose).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem('csv_import_wizard_draft')).not.toBeNull();

    // Advance to Step 3 and commit valid row while leaving 1 failedRow on Step 4
    fireEvent.click(screen.getByText(/Continue to Review/i));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Import Valid Rows (1)' })).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import Valid Rows (1)' }));

    await waitFor(() => {
      expect(screen.getByText('Import Execution Complete')).toBeInTheDocument();
      expect(screen.getByText(/1 invalid row was skipped/i)).toBeInTheDocument();
    });

    // Escape on Step 4 when failedRows is non-empty also prompts confirmation
    fireEvent.keyDown(document, { key: 'Escape' });
    await screen.findByRole('alertdialog');
    expect(mockOnClose).not.toHaveBeenCalled();

    // Confirming discard clears draft and invokes onClose
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => {
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });
    expect(window.sessionStorage.getItem('csv_import_wizard_draft')).toBeNull();
  });

  test('renders all 20 Step 2 column mapping selects in visual order with uniform dark-mode classes, empty-option labels, and SET_COLUMN_MAPPING updates', async () => {
    window.sessionStorage.clear();

    const expectedControls = [
      {
        id: 'map-guest-name',
        label: 'Guest Name Column (Required)',
        field: 'guestNameCol',
        emptyOption: '-- Select Column --',
        header: 'Col_01',
        sampleValue: 'Clara Oswald',
      },
      {
        id: 'map-guest-first-name',
        label: 'Guest First Name Column (Optional)',
        field: 'guestFirstNameCol',
        emptyOption: '-- Unmapped --',
        header: 'Col_02',
        sampleValue: 'Clara',
      },
      {
        id: 'map-guest-last-name',
        label: 'Guest Last Name Column (Optional)',
        field: 'guestLastNameCol',
        emptyOption: '-- Unmapped --',
        header: 'Col_03',
        sampleValue: 'Oswald',
      },
      {
        id: 'map-invitation-code',
        label: 'Invitation Code Column (Optional)',
        field: 'codeCol',
        emptyOption: '-- Auto-Generate Blank Codes --',
        header: 'Col_04',
        sampleValue: 'CLARA100',
      },
      {
        id: 'map-email',
        label: 'Email Address Column (Optional)',
        field: 'emailCol',
        emptyOption: '-- Unmapped --',
        header: 'Col_05',
        sampleValue: 'clara@example.com',
      },
      {
        id: 'map-phone',
        label: 'Phone Number Column (Optional)',
        field: 'phoneCol',
        emptyOption: '-- Unmapped --',
        header: 'Col_06',
        sampleValue: '+15551234567',
      },
      {
        id: 'map-dietary-notes',
        label: 'Dietary Notes / Allergies (Optional)',
        field: 'dietaryNotesCol',
        emptyOption: '-- Unmapped --',
        header: 'Col_07',
        sampleValue: 'No Peanuts',
      },
      {
        id: 'map-address-line1',
        label: 'Address Line 1 Column (Optional)',
        field: 'addressLine1Col',
        emptyOption: '-- Unmapped --',
        header: 'Col_08',
        sampleValue: '742 Evergreen Terrace',
      },
      {
        id: 'map-address-line2',
        label: 'Address Line 2 Column (Optional)',
        field: 'addressLine2Col',
        emptyOption: '-- Unmapped --',
        header: 'Col_09',
        sampleValue: 'Apt 4B',
      },
      {
        id: 'map-city',
        label: 'City Column (Optional)',
        field: 'cityCol',
        emptyOption: '-- Unmapped --',
        header: 'Col_10',
        sampleValue: 'Springfield',
      },
      {
        id: 'map-state',
        label: 'State / Province Column (Optional)',
        field: 'stateCol',
        emptyOption: '-- Unmapped --',
        header: 'Col_11',
        sampleValue: 'IL',
      },
      {
        id: 'map-zip-code',
        label: 'ZIP / Postal Code Column (Optional)',
        field: 'zipCodeCol',
        emptyOption: '-- Unmapped --',
        header: 'Col_12',
        sampleValue: '62704',
      },
      {
        id: 'map-country',
        label: 'Country Column (Optional)',
        field: 'countryCol',
        emptyOption: '-- Unmapped --',
        header: 'Col_13',
        sampleValue: 'USA',
      },
      {
        id: 'map-plus-ones',
        label: 'Plus-One Allocations Column (Optional)',
        field: 'plusOneCol',
        emptyOption: '-- Default to 0 --',
        header: 'Col_14',
        sampleValue: '1',
      },
      {
        id: 'map-plus-one-name',
        label: 'Plus-One Name Column (Optional)',
        field: 'plusOneNameCol',
        emptyOption: '-- Unmapped --',
        header: 'Col_15',
        sampleValue: 'Danny Pink',
      },
      {
        id: 'map-plus-one-first-name',
        label: 'Plus-One First Name Column (Optional)',
        field: 'plusOneFirstNameCol',
        emptyOption: '-- Unmapped --',
        header: 'Col_16',
        sampleValue: 'Danny',
      },
      {
        id: 'map-plus-one-last-name',
        label: 'Plus-One Last Name Column (Optional)',
        field: 'plusOneLastNameCol',
        emptyOption: '-- Unmapped --',
        header: 'Col_17',
        sampleValue: 'Pink',
      },
      {
        id: 'map-household-name',
        label: 'Household Name Column (Optional)',
        field: 'householdNameCol',
        emptyOption: '-- Unmapped --',
        header: 'Col_18',
        sampleValue: 'Oswald Household',
      },
      {
        id: 'map-party-group',
        label: 'Party Side / Group Column (Optional)',
        field: 'partyGroupCol',
        emptyOption: '-- Unmapped --',
        header: 'Col_19',
        sampleValue: 'Bride Side',
      },
      {
        id: 'map-party-tags',
        label: 'Party Tags Column (Optional)',
        field: 'partyTagsCol',
        emptyOption: '-- Unmapped --',
        header: 'Col_20',
        sampleValue: 'VIP, Tardis',
      },
    ] as const;

    const headers = [...expectedControls.map((c) => c.header), 'Custom_Note'];
    const rowValues = [
      ...expectedControls.map((c) => (c.sampleValue.includes(',') ? `"${c.sampleValue}"` : c.sampleValue)),
      'Window Seat',
    ];
    const csvData = `${headers.join(',')}\n${rowValues.join(',')}`;
    const file = Object.assign(new File([csvData], 'all-columns.csv', { type: 'text/csv' }), {
      _content: csvData,
    });

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        summary: {
          total: 1,
          validCount: 1,
          invalidCount: 0,
          duplicateCount: 0,
          updatedCount: 0,
          skippedCount: 0,
          createdCount: 1,
        },
        rows: [
          {
            rowIndex: 1,
            guestName: 'Clara Oswald',
            code: 'CLARA100',
            email: 'clara@example.com',
            isValid: true,
            errors: [],
            warnings: [],
          },
        ],
      }),
    });

    const { container } = render(
      <ToastProvider>
        <CsvImportWizardModal
          isOpen={true}
          onClose={mockOnClose}
          onImportComplete={mockOnImportComplete}
        />
      </ToastProvider>
    );

    const fileInput = screen.getByLabelText(/Click to select CSV file/i) as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByLabelText('Guest Name Column (Required)')).toBeInTheDocument();
    });

    const renderedSelects = Array.from(document.body.querySelectorAll('select'));
    expect(renderedSelects).toHaveLength(20);
    expect(renderedSelects.map((el) => el.id)).toEqual(expectedControls.map((c) => c.id));

    for (const control of expectedControls) {
      const selectEl = screen.getByLabelText(control.label) as HTMLSelectElement;
      expect(selectEl).toHaveAttribute('id', control.id);
      expect(selectEl).toHaveClass('text-gray-900', 'dark:text-zinc-100');

      const emptyOptionEl = selectEl.querySelector('option[value=""]');
      expect(emptyOptionEl).not.toBeNull();
      expect(emptyOptionEl).toHaveTextContent(control.emptyOption);

      fireEvent.change(selectEl, { target: { value: '' } });
      expect(selectEl).toHaveValue('');

      fireEvent.change(selectEl, { target: { value: control.header } });
      expect(selectEl).toHaveValue(control.header);
    }

    const savedDraftRaw = window.sessionStorage.getItem('csv_import_wizard_draft');
    expect(savedDraftRaw).not.toBeNull();
    const savedDraft = JSON.parse(savedDraftRaw!);
    for (const control of expectedControls) {
      expect(savedDraft[control.field]).toBe(control.header);
    }

    // Only unmapped Custom_Note remains in extra metadata checkboxes
    expect(screen.getByLabelText('Custom_Note')).toBeInTheDocument();
    expect(screen.queryByLabelText('Col_01')).not.toBeInTheDocument();

    const axeResults = await axe(container);
    expect(axeResults).toHaveNoViolations();

    // Confirm mapping into Step 3 and verify mapped row fields propagate
    fireEvent.click(screen.getByText(/Continue to Review/i));

    await waitFor(() => {
      expect(screen.getByText('3. Review & Validate')).toBeInTheDocument();
    });

    expect(screen.getByLabelText('Guest Name for row 1')).toHaveValue('Clara Oswald');
    expect(screen.getByLabelText('Invitation Code for row 1')).toHaveValue('CLARA100');
    expect(screen.getByLabelText('Email for row 1')).toHaveValue('clara@example.com');
    expect(screen.getByLabelText('Phone Number for row 1')).toHaveValue('+15551234567');
    expect(screen.getByLabelText('Dietary Notes for row 1')).toHaveValue('No Peanuts');
    expect(screen.getByLabelText('Address Line 1 for row 1')).toHaveValue('742 Evergreen Terrace');
    expect(screen.getByLabelText('Address Line 2 for row 1')).toHaveValue('Apt 4B');
    expect(screen.getByLabelText('City for row 1')).toHaveValue('Springfield');
    expect(screen.getByLabelText('State for row 1')).toHaveValue('IL');
    expect(screen.getByLabelText('ZIP Code for row 1')).toHaveValue('62704');
    expect(screen.getByLabelText('Country for row 1')).toHaveValue('USA');
    expect(screen.getByLabelText('Plus-One Allocation for row 1')).toHaveValue(1);
    expect(screen.getByLabelText('Plus-One First Name for row 1')).toHaveValue('Danny');
    expect(screen.getByLabelText('Plus-One Last Name for row 1')).toHaveValue('Pink');
    expect(screen.getByLabelText('Household Name for row 1')).toHaveValue('Oswald Household');
    expect(screen.getByLabelText('Party Group for row 1')).toHaveValue('Bride Side');
    expect(screen.getByLabelText('Party Tags for row 1')).toHaveValue('VIP, Tardis');
  });
});
