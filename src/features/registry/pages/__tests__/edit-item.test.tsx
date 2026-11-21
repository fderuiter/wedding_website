import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/ui/ToastProvider';
import EditRegistryItemPage from '../edit-item';

const mockPush = jest.fn();
let mockParamId = '1';
const mockItem = {
  id: '1',
  name: 'Mock Item',
  description: 'Test description',
  price: 25.5,
  quantity: 3,
  category: 'Kitchen',
  imageUrl: 'https://example.com/image.jpg',
  vendorUrl: 'https://vendor.com',
  isGroupGift: false,
};

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useParams: () => ({ id: mockParamId }),
}));

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

describe('EditRegistryItemPage', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    mockParamId = mockItem.id;
    (global.fetch as jest.Mock) = jest.fn((url: RequestInfo) => {
      if (typeof url === 'string') {
        if (url.includes('/api/admin/me')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ isAdmin: true }),
          });
        }
        if (url.includes('/api/registry/items')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([mockItem]),
          });
        }
      }
      return Promise.reject(new Error('Unknown URL'));
    }) as jest.Mock;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('prefills form fields with fetched data', async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ToastProvider>
          <EditRegistryItemPage />
        </ToastProvider>
      </QueryClientProvider>
    );

    expect(await screen.findByLabelText(/item name/i)).toHaveValue(mockItem.name);
    expect(screen.getByLabelText(/price/i)).toHaveValue(mockItem.price);
    expect(screen.getByLabelText(/quantity/i)).toHaveValue(mockItem.quantity);
    expect(screen.getByLabelText(/category/i)).toHaveValue(mockItem.category);
  });

  it('fetches gift past position 20 directly via /api/registry/items/:id single-item endpoint', async () => {
    mockParamId = 'gift-35';
    const gift35 = {
      ...mockItem,
      id: 'gift-35',
      name: 'Cast Iron Dutch Oven',
      price: 380,
      category: 'Kitchen',
    };

    const requestedUrls: string[] = [];
    (global.fetch as jest.Mock) = jest.fn((url: RequestInfo) => {
      const urlStr = String(url);
      requestedUrls.push(urlStr);
      if (urlStr === '/api/registry/items/gift-35') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: gift35 }),
        });
      }
      return Promise.reject(new Error(`Unexpected URL: ${urlStr}`));
    }) as jest.Mock;

    render(
      <QueryClientProvider client={createQueryClient()}>
        <ToastProvider>
          <EditRegistryItemPage />
        </ToastProvider>
      </QueryClientProvider>
    );

    expect(await screen.findByLabelText(/item name/i)).toHaveValue('Cast Iron Dutch Oven');
    expect(screen.getByLabelText(/price/i)).toHaveValue(380);
    expect(requestedUrls).toEqual(['/api/registry/items/gift-35']);
  });

  it('displays error message instead of hanging on loading when target item is not found', async () => {
    mockParamId = 'missing-gift-999';
    (global.fetch as jest.Mock) = jest.fn((url: RequestInfo) => {
      if (String(url) === '/api/registry/items/missing-gift-999') {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.resolve({ success: false, error: 'Item not found' }),
        });
      }
      return Promise.reject(new Error('Unexpected URL'));
    }) as jest.Mock;

    render(
      <QueryClientProvider client={createQueryClient()}>
        <ToastProvider>
          <EditRegistryItemPage />
        </ToastProvider>
      </QueryClientProvider>
    );

    expect(await screen.findByText(/Error: Item not found/i)).toBeInTheDocument();
  });

  it('supports retrying failed item loads via AdminViewState and preserves unsaved edits on submit error', async () => {
    mockParamId = 'gift-35';
    let getAttempts = 0;
    (global.fetch as jest.Mock) = jest.fn((url: RequestInfo, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr === '/api/registry/items/gift-35' && (!init || !init.method || init.method === 'GET')) {
        getAttempts += 1;
        if (getAttempts === 1) {
          return Promise.resolve({
            ok: false,
            status: 503,
            json: () => Promise.resolve({ success: false, error: 'Temporary outage' }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { ...mockItem, id: 'gift-35', name: 'Espresso Machine' } }),
        });
      }
      if (urlStr === '/api/registry/items/gift-35' && init?.method === 'PUT') {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ success: false, error: 'Database write conflict' }),
        });
      }
      return Promise.reject(new Error(`Unexpected URL: ${urlStr}`));
    }) as jest.Mock;

    render(
      <QueryClientProvider client={createQueryClient()}>
        <ToastProvider>
          <EditRegistryItemPage />
        </ToastProvider>
      </QueryClientProvider>
    );

    expect(await screen.findByText(/Error: Temporary outage/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    const nameInput = await screen.findByLabelText(/item name/i);
    expect(nameInput).toHaveValue('Espresso Machine');

    fireEvent.change(nameInput, { target: { value: 'Dual-Boiler Espresso Machine' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText(/Error: Database write conflict/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/item name/i)).toHaveValue('Dual-Boiler Espresso Machine');
  });

  it('redirects to /admin/dashboard/registry after saving item changes', async () => {
    mockParamId = 'gift-35';
    (global.fetch as jest.Mock) = jest.fn((url: RequestInfo, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr === '/api/registry/items/gift-35' && (!init || !init.method || init.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { ...mockItem, id: 'gift-35', name: 'Espresso Machine' } }),
        });
      }
      if (urlStr === '/api/registry/items/gift-35' && init?.method === 'PUT') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { ...mockItem, id: 'gift-35', name: 'Espresso Machine' } }),
        });
      }
      return Promise.reject(new Error(`Unexpected URL: ${urlStr}`));
    }) as jest.Mock;

    render(
      <QueryClientProvider client={createQueryClient()}>
        <ToastProvider>
          <EditRegistryItemPage />
        </ToastProvider>
      </QueryClientProvider>
    );

    await screen.findByLabelText(/item name/i);
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/admin/dashboard/registry');
    });
  });
});
