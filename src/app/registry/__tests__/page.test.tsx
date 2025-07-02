import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RegistryPage from '../page';
import type { Contributor } from '@/types/registry';

jest.mock('next/image', () => {
  /* eslint-disable @next/next/no-img-element, @typescript-eslint/no-explicit-any */
  const MockImage = (props: any) => <img {...props} alt={props.alt || ''} />;
  MockImage.displayName = 'NextImage';
  return MockImage;
});

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() })
}));

const items = [
  {
    id: '1',
    name: 'Gift',
    description: '',
    category: 'Other',
    price: 100,
    image: '',
    vendorUrl: null,
    quantity: 1,
    isGroupGift: true,
    purchased: false,
    purchaserName: null,
    amountContributed: 0,
    contributors: [] as Contributor[]
  }
];

function setupFetch() {
  // minimal Response shape for fetch mocks
  type MockRes = { ok: boolean; json: () => Promise<unknown> };
  let resolveContribute: (v: MockRes) => void;
  const contributePromise = new Promise<MockRes>((res) => {
    resolveContribute = res;
  });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  global.fetch = jest.fn((url: string, _opts?: RequestInit) => {
    if (url.endsWith('/api/registry/items')) {
      return Promise.resolve({ ok: true, json: async () => items } as MockRes);
    }
    if (url.endsWith('/api/registry/contribute')) {
      return contributePromise;
    }
    return Promise.resolve({ ok: false, json: async () => ({}) } as MockRes);
  });
  return { resolveContribute: resolveContribute! };
}

describe('RegistryPage optimistic contribution', () => {
  it('updates UI optimistically after contributing', async () => {
    const { resolveContribute } = setupFetch();
    localStorage.setItem('isAdminLoggedIn', 'false');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <RegistryPage />
      </QueryClientProvider>
    );

    // Wait for items to load
    await waitFor(() => expect(screen.getByTestId('registry-card')).toBeInTheDocument());
    expect(screen.getByText(/Group Gift:/)).toHaveTextContent('$0.00');

    fireEvent.click(screen.getByTestId('registry-card'));

    await waitFor(() => expect(screen.getAllByRole('dialog').length).toBeGreaterThan(0));

    fireEvent.change(screen.getByPlaceholderText('Your Name'), { target: { value: 'Alice' } });
    fireEvent.change(screen.getByPlaceholderText(/Contribution Amount/), { target: { value: '20' } });

    fireEvent.click(screen.getByRole('button', { name: 'Submit Contribution' }));

    // Optimistic UI should update before resolve
    await waitFor(() => expect(screen.getByText(/Group Gift:/)).toHaveTextContent('$20.00'));

    // complete fetch
    resolveContribute({ ok: true, json: async () => items[0] });
  });
});
