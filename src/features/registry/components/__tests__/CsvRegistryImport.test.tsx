import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CsvRegistryImport } from '../CsvRegistryImport';
import { apiClient } from '@/lib/apiClient';

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

describe('CsvRegistryImport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects files larger than 5MB with an error message', async () => {
    render(<CsvRegistryImport />);

    // Create a 6MB dummy file
    const largeFile = new File([new ArrayBuffer(6 * 1024 * 1024)], 'giant_catalog.csv', {
      type: 'text/csv',
    });

    const dropZone = screen.getByRole('button', { name: /Upload CSV file drop zone/i });
    fireEvent.drop(dropZone, {
      dataTransfer: {
        files: [largeFile],
      },
    });

    expect(
      await screen.findByText(/Uploaded CSV files must not exceed 5 megabytes in file size/i)
    ).toBeInTheDocument();
  });

  it('parses valid CSV file and displays items in preview table', async () => {
    render(<CsvRegistryImport />);

    const csvContent = `Product Name,Price,Category,Quantity,Vendor URL
Cast Iron Skillet,35.00,Kitchen,1,https://example.com/skillet
Wine Glasses Set,45.00,Dining,2,https://example.com/glasses`;

    const file = new File([csvContent], 'gifts.csv', { type: 'text/csv' });

    const dropZone = screen.getByRole('button', { name: /Upload CSV file drop zone/i });
    fireEvent.drop(dropZone, {
      dataTransfer: {
        files: [file],
      },
    });

    expect(await screen.findByText('Cast Iron Skillet')).toBeInTheDocument();
    expect(screen.getByText('Wine Glasses Set')).toBeInTheDocument();
    expect(screen.getByText('2 Ready to Import')).toBeInTheDocument();
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

    const dropZone = screen.getByRole('button', { name: /Upload CSV file drop zone/i });
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
  });
});
