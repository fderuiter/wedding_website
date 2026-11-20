import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AddRegistryItemPage from '../add-item';
import { apiClient } from '@/lib/apiClient';

jest.mock('@/lib/apiClient', () => ({
  apiClient: {
    post: jest.fn(),
  },
}));

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

jest.mock('@/hooks/admin/useAdminRegistry', () => ({
  useAdminRegistry: () => ({
    create: jest.fn(),
  }),
}));

describe('AddRegistryItemPage Tabbed Navigation', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    jest.clearAllMocks();
  });

  it('renders all three tabs: Single Item, Batch URLs, and CSV Import', () => {
    render(<AddRegistryItemPage />);

    const singleTab = screen.getByRole('tab', { name: /Single Item/i });
    const batchTab = screen.getByRole('tab', { name: /Batch URLs/i });
    const csvTab = screen.getByRole('tab', { name: /CSV Import/i });

    expect(singleTab).toBeInTheDocument();
    expect(batchTab).toBeInTheDocument();
    expect(csvTab).toBeInTheDocument();

    // Single item is selected by default
    expect(singleTab).toHaveAttribute('aria-selected', 'true');
    expect(batchTab).toHaveAttribute('aria-selected', 'false');
    expect(csvTab).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByTestId('form')).toBeInTheDocument();
  });

  it('switches to Batch URLs tab when clicked', () => {
    render(<AddRegistryItemPage />);

    const batchTab = screen.getByRole('tab', { name: /Batch URLs/i });
    fireEvent.click(batchTab);

    expect(batchTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('batch-url-scraper')).toBeInTheDocument();
    expect(screen.queryByTestId('form')).not.toBeInTheDocument();
  });

  it('switches to CSV Import tab when clicked', () => {
    render(<AddRegistryItemPage />);

    const csvTab = screen.getByRole('tab', { name: /CSV Import/i });
    fireEvent.click(csvTab);

    expect(csvTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('csv-registry-import')).toBeInTheDocument();
    expect(screen.queryByTestId('form')).not.toBeInTheDocument();
  });

  it('supports arrow key keyboard navigation across tabs', () => {
    render(<AddRegistryItemPage />);

    const singleTab = screen.getByRole('tab', { name: /Single Item/i });
    fireEvent.keyDown(singleTab, { key: 'ArrowRight' });

    const batchTab = screen.getByRole('tab', { name: /Batch URLs/i });
    expect(batchTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('batch-url-scraper')).toBeInTheDocument();

    fireEvent.keyDown(batchTab, { key: 'ArrowRight' });
    const csvTab = screen.getByRole('tab', { name: /CSV Import/i });
    expect(csvTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('csv-registry-import')).toBeInTheDocument();

    fireEvent.keyDown(csvTab, { key: 'ArrowLeft' });
    expect(batchTab).toHaveAttribute('aria-selected', 'true');
  });

  it('preserves batch URL and CSV preview drafts across mouse and keyboard tab switches and clears after import', async () => {
    const mockPost = apiClient.post as jest.Mock;
    mockPost
      .mockResolvedValueOnce({
        success: true,
        results: [
          {
            url: 'https://retailer.com/dutch-oven',
            success: true,
            data: {
              name: 'Enameled Dutch Oven',
              price: 320,
              imageUrl: 'https://retailer.com/oven.jpg',
              description: '6 qt cast iron',
              vendorUrl: 'https://retailer.com/dutch-oven',
              quantity: 1,
            },
          },
        ],
      })
      .mockResolvedValueOnce({ success: true, count: 1, items: [] });

    render(<AddRegistryItemPage />);

    // 1. Switch to Batch URLs tab, scrape URL, and edit row
    const batchTab = screen.getByRole('tab', { name: /Batch URLs/i });
    fireEvent.click(batchTab);

    fireEvent.change(screen.getByLabelText(/Product URLs textarea/i), {
      target: { value: 'https://retailer.com/dutch-oven' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Scrape Product URLs/i }));
    expect(await screen.findByText('Enameled Dutch Oven')).toBeInTheDocument();

    // 2. Switch to CSV Import tab via ArrowRight and upload CSV
    fireEvent.keyDown(batchTab, { key: 'ArrowRight' });
    const csvTab = screen.getByRole('tab', { name: /CSV Import/i });
    expect(csvTab).toHaveAttribute('aria-selected', 'true');

    const csvFile = new File(
      ['Product Name,Price,Category\nCrystal Carafe,65.00,Barware'],
      'barware.csv',
      { type: 'text/csv' }
    );
    fireEvent.drop(screen.getByRole('button', { name: /Upload CSV file drop zone/i }), {
      dataTransfer: { files: [csvFile] },
    });
    expect(await screen.findByText('Crystal Carafe')).toBeInTheDocument();
    expect(screen.getByText('barware.csv')).toBeInTheDocument();

    // 3. Switch back to Single Item tab, then back to Batch URLs and CSV Import to verify drafts remain intact
    fireEvent.click(screen.getByRole('tab', { name: /Single Item/i }));
    fireEvent.click(batchTab);
    expect(screen.getByLabelText(/Product URLs textarea/i)).toHaveValue(
      'https://retailer.com/dutch-oven'
    );
    expect(screen.getByText('Enameled Dutch Oven')).toBeInTheDocument();

    fireEvent.click(csvTab);
    expect(screen.getByText('barware.csv')).toBeInTheDocument();
    expect(screen.getByText('Crystal Carafe')).toBeInTheDocument();

    // 4. Import batch items and confirm sessionStorage is cleared
    fireEvent.click(batchTab);
    fireEvent.click(screen.getByRole('button', { name: /Save All to Registry \(1\)/i }));
    await waitFor(() => {
      expect(window.sessionStorage.getItem('registry_batch_url_draft')).toBeNull();
    });
  });
});
