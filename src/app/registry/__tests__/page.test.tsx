import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RegistryPage from '../page';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RegistryItem } from '@/types/registry';

const pushMock = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

jest.mock('framer-motion', () => ({
  __esModule: true,
  motion: new Proxy(
    {},
    {
      get: (_target, prop) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (props: any) => React.createElement(prop as string, props),
    }
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('RegistryPage', () => {
  const items: RegistryItem[] = [
    {
      id: '1',
      name: 'Toaster',
      description: 'Makes toast',
      category: 'Kitchen',
      price: 30,
      image: '/img1',
      vendorUrl: null,
      quantity: 1,
      isGroupGift: false,
      purchased: false,
      amountContributed: 0,
      contributors: [],
    },
    {
      id: '2',
      name: 'Lamp',
      description: 'Lights room',
      category: 'Bedroom',
      price: 50,
      image: '/img2',
      vendorUrl: null,
      quantity: 1,
      isGroupGift: false,
      purchased: false,
      amountContributed: 0,
      contributors: [],
    },
    {
      id: '3',
      name: 'Mixer',
      description: 'Mixes things',
      category: 'Kitchen',
      price: 150,
      image: '/img3',
      vendorUrl: null,
      quantity: 1,
      isGroupGift: true,
      purchased: false,
      amountContributed: 0,
      contributors: [],
    },
  ];

  const originalFetch = global.fetch;

  beforeEach(() => {
    pushMock.mockReset();
    localStorage.setItem('isAdminLoggedIn', 'false');
    jest.spyOn(window, 'alert').mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = (url: string, options?: RequestInit) => {
      if (url === '/api/registry/items') {
        return Promise.resolve({
          ok: true,
          json: async () => items,
        } as Response);
      }
      if (url === '/api/registry/contribute') {
        return new Promise((_, reject) => setTimeout(() => reject(new Error('Contribution failed')), 0));
      }
      return originalFetch(url, options);
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = originalFetch;
  });

  function setup() {
    const queryClient = new QueryClient();
    return render(
      <QueryClientProvider client={queryClient}>
        <RegistryPage />
      </QueryClientProvider>
    );
  }

  it('renders items and filters by category and price', async () => {
    setup();

    await waitFor(() => expect(screen.getByText('Toaster')).toBeInTheDocument());
    expect(screen.getByText('Lamp')).toBeInTheDocument();
    expect(screen.getByText('Mixer')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Kitchen'));
    expect(screen.getByText('Toaster')).toBeInTheDocument();
    expect(screen.getByText('Mixer')).toBeInTheDocument();
    expect(screen.queryByText('Lamp')).not.toBeInTheDocument();

    const sliders = screen.getAllByRole('slider');
    fireEvent.change(sliders[1], { target: { value: '100' } });

    expect(screen.getByText('Toaster')).toBeInTheDocument();
    expect(screen.queryByText('Mixer')).not.toBeInTheDocument();
  });

  it('optimistically updates contribution and rolls back on error', async () => {
    setup();
    await screen.findByText('Mixer');

    fireEvent.click(screen.getByText('Mixer'));

    fireEvent.change(screen.getByPlaceholderText('Your Name'), { target: { value: 'Alice' } });
    fireEvent.change(screen.getByPlaceholderText(/Contribution Amount/), { target: { value: '10' } });

    fireEvent.click(screen.getByRole('button', { name: /submit contribution/i }));

    await waitFor(() => expect(screen.getByText(/Group Gift:/).textContent).toContain('$10.00'));

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith('Error: Could not process contribution.');
      expect(screen.getByText(/Group Gift:/).textContent).toContain('$0.00');
    });
  });

  it('navigates to edit page when Edit is clicked', async () => {
    const item: RegistryItem = {
      id: '10',
      name: 'Plate',
      description: 'Ceramic plate',
      category: 'Kitchen',
      price: 20,
      image: '/img',
      vendorUrl: null,
      quantity: 1,
      isGroupGift: false,
      purchased: false,
      amountContributed: 0,
      contributors: [],
    };

    // Mock fetch for initial items
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [item],
    });

    localStorage.setItem('isAdminLoggedIn', 'true');
    setup();
    await screen.findByText('Plate');

    fireEvent.click(screen.getByLabelText('Edit Plate'));

    expect(pushMock).toHaveBeenCalledWith(`/registry/edit-item/${item.id}`);
  });

  it('deletes item when confirmed', async () => {
    const item: RegistryItem = {
      id: '11',
      name: 'Fork',
      description: 'Silver fork',
      category: 'Kitchen',
      price: 5,
      image: '/img',
      vendorUrl: null,
      quantity: 1,
      isGroupGift: false,
      purchased: false,
      amountContributed: 0,
      contributors: [],
    };

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [item] })
      .mockResolvedValueOnce({ ok: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = fetchMock;

    jest.spyOn(window, 'confirm').mockReturnValue(true);
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});

    localStorage.setItem('isAdminLoggedIn', 'true');
    setup();
    await screen.findByText('Fork');

    fireEvent.click(screen.getByLabelText('Delete Fork'));

    await waitFor(() => expect(screen.queryByText('Fork')).not.toBeInTheDocument());
    expect(alertSpy).toHaveBeenCalledWith('Item deleted successfully.');
  });

  it('shows error when delete fails', async () => {
    const item: RegistryItem = {
      id: '12',
      name: 'Spoon',
      description: 'Wooden spoon',
      category: 'Kitchen',
      price: 3,
      image: '/img',
      vendorUrl: null,
      quantity: 1,
      isGroupGift: false,
      purchased: false,
      amountContributed: 0,
      contributors: [],
    };

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [item] })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'fail' }),
      });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = fetchMock;

    jest.spyOn(window, 'confirm').mockReturnValue(true);
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});

    localStorage.setItem('isAdminLoggedIn', 'true');
    setup();
    await screen.findByText('Spoon');

    fireEvent.click(screen.getByLabelText('Delete Spoon'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Error deleting item: fail'));
    expect(screen.getByText('Spoon')).toBeInTheDocument();
  });

  it('shows error message when items fetch fails', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: false });

    localStorage.setItem('isAdminLoggedIn', 'true');

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <RegistryPage />
      </QueryClientProvider>
    );

    await screen.findByText(/Error loading registry/i);
  });
});

