import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import { CsvRegistryImport } from '../CsvRegistryImport';
import { apiClient } from '@/lib/apiClient';

expect.extend(toHaveNoViolations);

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}));

jest.mock('@/components/ui/ToastProvider', () => ({
  useToast: () => ({
    addToast: jest.fn(),
  }),
}));

jest.mock('@/lib/apiClient', () => ({
  apiClient: {
    post: jest.fn(),
  },
}));

const mockApiClientPost = apiClient.post as jest.Mock;
const csvPromptRegex = /Click to upload or drag and drop your CSV file here/i;

describe('CsvRegistryImport', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    jest.clearAllMocks();
  });

  it('rejects files larger than 5MB with an error message and passes jest-axe', async () => {
    const { container } = render(<CsvRegistryImport />);

    // Create a 6MB dummy file
    const largeFile = new File([new ArrayBuffer(6 * 1024 * 1024)], 'giant_catalog.csv', {
      type: 'text/csv',
    });

    const dropZone = screen.getByRole('button', { name: csvPromptRegex });
    expect(
      await axe(container, { rules: { 'label-content-name-mismatch': { enabled: true } } })
    ).toHaveNoViolations();

    fireEvent.drop(dropZone, {
      dataTransfer: {
        files: [largeFile],
      },
    });

    expect(
      await screen.findByText(/Uploaded CSV files must not exceed 5 megabytes in file size/i)
    ).toBeInTheDocument();
    expect(
      await axe(container, { rules: { 'label-content-name-mismatch': { enabled: true } } })
    ).toHaveNoViolations();
  });

  it('parses valid CSV file, updates dropzone accessible name during parsing, and displays items in preview table', async () => {
    const OriginalFileReader = global.FileReader;
    let triggerLoad!: () => void;

    class ControlledFileReader {
      onload: ((e: ProgressEvent<FileReader>) => void) | null = null;
      onerror: (() => void) | null = null;
      readAsText(blob: Blob) {
        triggerLoad = () => {
          const reader = new OriginalFileReader();
          reader.onload = (ev) => this.onload?.(ev);
          reader.readAsText(blob);
        };
      }
    }
    global.FileReader = ControlledFileReader as unknown as typeof FileReader;

    try {
      const { container } = render(<CsvRegistryImport />);

      const csvContent = `Product Name,Price,Category,Quantity,Vendor URL
Cast Iron Skillet,35.00,Kitchen,1,https://example.com/skillet
Wine Glasses Set,45.00,Dining,2,https://example.com/glasses`;

      const file = new File([csvContent], 'gifts.csv', { type: 'text/csv' });

      const dropZone = screen.getByRole('button', { name: csvPromptRegex });
      fireEvent.drop(dropZone, {
        dataTransfer: {
          files: [file],
        },
      });

      expect(screen.getByRole('button', { name: 'Parsing CSV file...' })).toBeInTheDocument();
      expect(
        await axe(container, { rules: { 'label-content-name-mismatch': { enabled: true } } })
      ).toHaveNoViolations();

      triggerLoad();

      expect(await screen.findByText('Cast Iron Skillet')).toBeInTheDocument();
      expect(screen.getByText('Wine Glasses Set')).toBeInTheDocument();
      expect(screen.getByText('2 Ready to Import')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'gifts.csv' })).toBeInTheDocument();
      expect(
        await axe(container, { rules: { 'label-content-name-mismatch': { enabled: true } } })
      ).toHaveNoViolations();
    } finally {
      global.FileReader = OriginalFileReader;
    }
  });

  it('downloads sample CSV template when button is clicked', () => {
    // Mock URL.createObjectURL and URL.revokeObjectURL
    const mockCreateObjectURL = jest.fn().mockReturnValue('blob:mock-url');
    const mockRevokeObjectURL = jest.fn();
    global.URL.createObjectURL = mockCreateObjectURL;
    global.URL.revokeObjectURL = mockRevokeObjectURL;

    render(<CsvRegistryImport />);

    const downloadBtn = screen.getByRole('button', { name: /Download Sample CSV Template/i });
    fireEvent.click(downloadBtn);

    expect(mockCreateObjectURL).toHaveBeenCalled();
  });

  it('persists confirmed items to database via batch API', async () => {
    mockApiClientPost.mockResolvedValueOnce({
      success: true,
      count: 1,
      items: [{ id: '1', name: 'Air Fryer' }],
    });

    const onSuccess = jest.fn();
    render(<CsvRegistryImport onSuccess={onSuccess} />);

    const csvContent = `Product Name,Price,Category
Air Fryer,99.99,Kitchen`;

    const file = new File([csvContent], 'gifts.csv', { type: 'text/csv' });

    const dropZone = screen.getByRole('button', { name: csvPromptRegex });
    fireEvent.drop(dropZone, {
      dataTransfer: {
        files: [file],
      },
    });

    const saveBtn = await screen.findByRole('button', { name: /Save Confirmed Items \(1\)/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockApiClientPost).toHaveBeenCalledWith('/api/registry/items/batch', {
        items: [
          expect.objectContaining({
            name: 'Air Fryer',
            price: 99.99,
            category: 'Kitchen',
          }),
        ],
      });
      expect(onSuccess).toHaveBeenCalled();
    });
    expect(window.sessionStorage.getItem('registry_csv_import_draft')).toBeNull();
  });

  it('preserves file metadata and edited preview rows across remounts and resets via Reset Draft', async () => {
    const { unmount } = render(<CsvRegistryImport />);

    const csvContent = `Product Name,Price,Category,Quantity
Linen Sheet Set,180.00,Bedroom,1`;
    const file = new File([csvContent], 'bedroom_registry.csv', { type: 'text/csv' });

    const dropZone = screen.getByRole('button', { name: csvPromptRegex });
    fireEvent.drop(dropZone, {
      dataTransfer: {
        files: [file],
      },
    });

    expect(await screen.findByText('Linen Sheet Set')).toBeInTheDocument();
    expect(screen.getByText('bedroom_registry.csv')).toBeInTheDocument();

    // Edit parsed row
    fireEvent.click(screen.getByRole('button', { name: 'Edit Linen Sheet Set' }));
    fireEvent.change(screen.getByPlaceholderText('Product name'), {
      target: { value: 'Organic Linen Sheet Set' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Done editing Organic Linen Sheet Set' }));
    expect(screen.getByText('Organic Linen Sheet Set')).toBeInTheDocument();

    unmount();

    // Remount and verify file metadata and edited row are preserved
    render(<CsvRegistryImport />);
    expect(screen.getByText('bedroom_registry.csv')).toBeInTheDocument();
    expect(screen.getByText('Organic Linen Sheet Set')).toBeInTheDocument();

    // Reset Draft clears metadata, rows, and sessionStorage
    fireEvent.click(screen.getByRole('button', { name: 'Reset Draft' }));
    expect(screen.queryByText('bedroom_registry.csv')).not.toBeInTheDocument();
    expect(screen.queryByText('Organic Linen Sheet Set')).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem('registry_csv_import_draft')).toBeNull();
  });
});
