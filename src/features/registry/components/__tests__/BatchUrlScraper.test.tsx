import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { BatchUrlScraper } from '../BatchUrlScraper';
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

describe('BatchUrlScraper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('updates the URL counter as URLs are entered', () => {
    render(<BatchUrlScraper />);

    const textarea = screen.getByLabelText(/Product URLs textarea/i);
    expect(screen.getByText('0 / 20 URLs entered')).toBeInTheDocument();

    fireEvent.change(textarea, {
      target: {
        value: 'https://example.com/p1\nhttps://example.com/p2\nhttps://example.com/p3',
      },
    });

    expect(screen.getByText('3 / 20 URLs entered')).toBeInTheDocument();
  });

  it('shows an error if more than 20 URLs are entered', () => {
    render(<BatchUrlScraper />);

    const textarea = screen.getByLabelText(/Product URLs textarea/i);
    const urls = Array.from({ length: 22 }, (_, i) => `https://example.com/item-${i}`).join('\n');

    fireEvent.change(textarea, { target: { value: urls } });

    expect(screen.getByText('22 / 20 URLs entered')).toBeInTheDocument();
    expect(screen.getByText('Please reduce your list to 20 or fewer URLs')).toBeInTheDocument();
  });

  it('calls batch scrape API and renders preview table on success', async () => {
    mockApiClientPost.mockResolvedValueOnce({
      success: true,
      results: [
        {
          url: 'https://retailer.com/toaster',
          success: true,
          data: {
            name: 'Deluxe Toaster',
            price: 49.99,
            imageUrl: 'https://retailer.com/toaster.jpg',
            description: '2-slice toaster',
            vendorUrl: 'https://retailer.com/toaster',
            quantity: 1,
          },
        },
        {
          url: 'https://retailer.com/failed-404',
          success: false,
          error: 'URL_NOT_FOUND: Product URL could not be found.',
        },
      ],
      total: 2,
      successful: 1,
      failed: 1,
    });

    render(<BatchUrlScraper />);

    const textarea = screen.getByLabelText(/Product URLs textarea/i);
    fireEvent.change(textarea, {
      target: {
        value: 'https://retailer.com/toaster\nhttps://retailer.com/failed-404',
      },
    });

    const scrapeBtn = screen.getByRole('button', { name: /Scrape Product URLs/i });
    fireEvent.click(scrapeBtn);

    await waitFor(() => {
      expect(mockApiClientPost).toHaveBeenCalledWith('/api/registry/scrape/batch', {
        urls: ['https://retailer.com/toaster', 'https://retailer.com/failed-404'],
      });
    });

    expect(await screen.findByText('Deluxe Toaster')).toBeInTheDocument();
    expect(screen.getByText('1 Ready to Import')).toBeInTheDocument();
    expect(screen.getByText('1 Needs Attention')).toBeInTheDocument();
  });

  it('persists valid items when Save All to Registry is clicked', async () => {
    mockApiClientPost
      .mockResolvedValueOnce({
        success: true,
        results: [
          {
            url: 'https://retailer.com/mixer',
            success: true,
            data: {
              name: 'Stand Mixer',
              price: 299.99,
              imageUrl: '',
              description: '',
              vendorUrl: 'https://retailer.com/mixer',
              quantity: 1,
            },
          },
        ],
        total: 1,
        successful: 1,
        failed: 0,
      })
      .mockResolvedValueOnce({
        success: true,
        count: 1,
        items: [{ id: 'item-1', name: 'Stand Mixer' }],
      });

    const onSuccess = jest.fn();
    render(<BatchUrlScraper onSuccess={onSuccess} />);

    const textarea = screen.getByLabelText(/Product URLs textarea/i);
    fireEvent.change(textarea, { target: { value: 'https://retailer.com/mixer' } });

    fireEvent.click(screen.getByRole('button', { name: /Scrape Product URLs/i }));

    const saveBtn = await screen.findByRole('button', { name: /Save All to Registry \(1\)/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockApiClientPost).toHaveBeenCalledWith('/api/registry/items/batch', {
        items: [
          expect.objectContaining({
            name: 'Stand Mixer',
            price: 299.99,
            quantity: 1,
          }),
        ],
      });
      expect(onSuccess).toHaveBeenCalled();
    });
  });
});
