import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CsvImportWizardModal } from '../CsvImportWizardModal';
import { ToastProvider } from '@/components/ui/ToastProvider';

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
});
