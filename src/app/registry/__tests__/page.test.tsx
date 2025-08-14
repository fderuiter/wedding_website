import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RegistryPage from '../page';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RegistryItem } from '@/types/registry';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
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
});

