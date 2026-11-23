import React from 'react';
import { render as tlRender, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe } from 'jest-axe';
import { QueryClient, QueryClientProvider, MutationCache } from '@tanstack/react-query';
import type { DropResult } from '@hello-pangea/dnd';
import { ToastProvider, useToast } from '@/components/ui/ToastProvider';
import AdminRegistryPage from '../page';
import type { RegistryItem } from '@/features/registry';
import { checkAdminClient as mockCheckAdminClient } from '@/core/auth/auth.client';
import { createMockMedia } from '@/testing/factories/mediaFactory';
import { createMockContributor, createMockRegistryItem } from '@/testing/factories/registryFactory';

let capturedDragEndHandlers: Array<(_result: DropResult) => void> = [];

jest.mock('@hello-pangea/dnd', () => {
  const actual = jest.requireActual('@hello-pangea/dnd');
  const ActualDragDropContext = actual.DragDropContext;
  return {
    ...actual,
    DragDropContext: (props: React.ComponentProps<typeof ActualDragDropContext>) => {
      capturedDragEndHandlers.push(props.onDragEnd);
      return <ActualDragDropContext {...props} />;
    },
  };
});

const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
    push: mockPush,
  }),
}));

jest.mock('@/core/auth/auth.client');
(mockCheckAdminClient as jest.Mock).mockResolvedValue(true);

const mockItem: RegistryItem = createMockRegistryItem({
  id: '1',
  name: 'Sample Item',
  description: 'desc',
  category: 'Home',
  price: 100,
  image: createMockMedia({ url: '/img.jpg', altText: 'Sample Item' }),
  vendorUrl: null,
  quantity: 1,
  isGroupGift: false,
  purchased: false,
  amountContributed: 0,
  contributors: [],
});

const mockFetch = jest.fn();

beforeEach(() => {
  capturedDragEndHandlers = [];
  (global.fetch as unknown) = mockFetch as unknown as typeof fetch;
  (window.fetch as unknown) = mockFetch as unknown as typeof fetch;
  (mockCheckAdminClient as jest.Mock).mockResolvedValue(true);
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('AdminRegistryPage', () => {
  const renderWithProviders = (ui: React.ReactElement) => {
    return tlRender(
      <ToastProvider>
        <TestWrapper>{ui}</TestWrapper>
      </ToastProvider>
    );
  };

  const TestWrapper = ({ children }: { children: React.ReactNode }) => {
    const { addToast } = useToast();
    const queryClient = React.useMemo(
      () =>
        new QueryClient({
          defaultOptions: { queries: { retry: false } },
          mutationCache: new MutationCache({
            onSuccess: (_data, _variables, _context, mutation) => {
              if (mutation.meta?.successMessage)
                addToast(mutation.meta.successMessage as string, 'success');
            },
            onError: (_err, _variables, _context, mutation) => {
              addToast((mutation.meta?.errorMessage as string) || 'Failed to delete item', 'error');
            },
          }),
        }),
      [addToast]
    );

    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };

  it('shows admin controls', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [mockItem],
    });

    const { unmount } = renderWithProviders(<AdminRegistryPage />);

    expect(await screen.findByRole('button', { name: 'Add New Item' })).toBeInTheDocument();
    expect(
      (await screen.findAllByRole('button', { name: 'Edit registry item: Sample Item' })).length
    ).toBeGreaterThan(0);
    expect(
      (await screen.findAllByRole('button', { name: 'Delete registry item: Sample Item' })).length
    ).toBeGreaterThan(0);

    unmount();
  });

  it('renders loading state while fetching items', async () => {
    let resolveFetch: (value: unknown) => void;
    mockFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );

    renderWithProviders(<AdminRegistryPage />);
    expect(screen.getByText('Loading items...')).toBeInTheDocument();
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    await act(async () => {
      resolveFetch({
        ok: true,
        json: async () => [mockItem],
      });
    });

    expect((await screen.findAllByText('Sample Item')).length).toBeGreaterThan(0);
  });

  it('shows error when item fetch fails', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });

    renderWithProviders(<AdminRegistryPage />);

    expect(await screen.findByText(/Error: API Error/i)).toBeInTheDocument();
  });

  it('deletes item successfully', async () => {
    let items = [mockItem];
    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/registry/items?limit=500') {
        return Promise.resolve({ ok: true, json: async () => items });
      }
      if (url === `/api/registry/items/${mockItem.id}` && options?.method === 'DELETE') {
        items = [];
        return Promise.resolve({ ok: true });
      }
      return Promise.reject(new Error(`Unhandled request: ${url}`));
    });

    renderWithProviders(<AdminRegistryPage />);

    expect((await screen.findAllByText('Sample Item')).length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete registry item: Sample Item' })[0]);

    const confirmButton = await screen.findByRole('button', { name: 'Confirm' });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(screen.queryAllByText('Sample Item').length).toBe(0);
    });

    expect(await screen.findByText('Deleted registry item successfully.')).toBeInTheDocument();
  });

  it('shows error and keeps item when delete fails', async () => {
    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/registry/items?limit=500') {
        return Promise.resolve({ ok: true, json: async () => [mockItem] });
      }
      if (url === `/api/registry/items/${mockItem.id}` && options?.method === 'DELETE') {
        return Promise.resolve({ ok: false, json: async () => ({ error: 'Delete failed' }) });
      }
      return Promise.reject(new Error(`Unhandled request: ${url}`));
    });

    renderWithProviders(<AdminRegistryPage />);

    expect((await screen.findAllByText('Sample Item')).length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete registry item: Sample Item' })[0]);

    const confirmButton = await screen.findByRole('button', { name: 'Confirm' });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(screen.getByText('Failed to delete item')).toBeInTheDocument();
    });

    expect(screen.getAllByText('Sample Item').length).toBeGreaterThan(0);
  });

  it('navigates to add registry item page when Add New Item is clicked', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [mockItem],
    });

    renderWithProviders(<AdminRegistryPage />);

    const addButton = await screen.findByRole('button', { name: 'Add New Item' });
    fireEvent.click(addButton);

    expect(mockPush).toHaveBeenCalledWith('/registry/add-item');
  });

  it('navigates to edit registry item page when Edit is clicked', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [mockItem],
    });

    renderWithProviders(<AdminRegistryPage />);

    const editButtons = await screen.findAllByRole('button', {
      name: 'Edit registry item: Sample Item',
    });
    fireEvent.click(editButtons[0]);

    expect(mockPush).toHaveBeenCalledWith('/registry/edit-item/1');
  });

  it('toggles Most Wanted priority inline and moves promoted item ahead of standard items', async () => {
    const itemA = createMockRegistryItem({
      id: 'item-a',
      name: 'Toaster Oven',
      isMostWanted: false,
      displayOrder: 0,
    });
    const itemB = createMockRegistryItem({
      id: 'item-b',
      name: 'Espresso Machine',
      isMostWanted: false,
      displayOrder: 1,
    });

    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/registry/items?limit=500') {
        return Promise.resolve({ ok: true, json: async () => [itemA, itemB] });
      }
      if (url === '/api/admin/registry-items/item-b' && options?.method === 'PUT') {
        const body = JSON.parse(String(options.body));
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: 'item-b', isMostWanted: body.isMostWanted }),
        });
      }
      return Promise.reject(new Error(`Unhandled request: ${url}`));
    });

    renderWithProviders(<AdminRegistryPage />);

    const priorityButtons = await screen.findAllByRole('button', {
      name: 'Most Wanted: Espresso Machine',
    });
    expect(priorityButtons[0]).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(priorityButtons[0]);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/admin/registry-items/item-b',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ isMostWanted: true }),
        })
      );
    });

    const updatedButtons = screen.getAllByRole('button', {
      name: 'Most Wanted: Espresso Machine',
    });
    expect(updatedButtons[0]).toHaveAttribute('aria-pressed', 'true');

    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Espresso Machine');
    expect(rows[2]).toHaveTextContent('Toaster Oven');
    const liveRegion = screen.getByTestId('registry-live-announcement');
    expect(liveRegion).toHaveAttribute('role', 'status');
    expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    expect(liveRegion).toHaveTextContent('Marked Espresso Machine as Most Wanted');
  });

  it('rolls back Most Wanted priority toggle when the API update fails', async () => {
    const itemA = createMockRegistryItem({
      id: 'item-a',
      name: 'Toaster Oven',
      isMostWanted: false,
      displayOrder: 0,
    });
    const itemB = createMockRegistryItem({
      id: 'item-b',
      name: 'Espresso Machine',
      isMostWanted: false,
      displayOrder: 1,
    });

    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/registry/items?limit=500') {
        return Promise.resolve({ ok: true, json: async () => [itemA, itemB] });
      }
      if (url === '/api/admin/registry-items/item-b' && options?.method === 'PUT') {
        return Promise.resolve({ ok: false, json: async () => ({ error: 'Update failed' }) });
      }
      return Promise.reject(new Error(`Unhandled request: ${url}`));
    });

    renderWithProviders(<AdminRegistryPage />);

    const priorityButtons = await screen.findAllByRole('button', {
      name: 'Most Wanted: Espresso Machine',
    });
    fireEvent.click(priorityButtons[0]);

    await waitFor(() => {
      expect(screen.getByText('Failed to update registry item priority.')).toBeInTheDocument();
    });

    expect(
      screen.getAllByRole('button', { name: 'Most Wanted: Espresso Machine' })[0]
    ).toHaveAttribute('aria-pressed', 'false');
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Toaster Oven');
    expect(rows[2]).toHaveTextContent('Espresso Machine');
  });

  it('reorders items via arrow buttons within priority groups and announces live updates', async () => {
    const mw1 = createMockRegistryItem({
      id: 'mw-1',
      name: 'Priority One',
      isMostWanted: true,
      displayOrder: 0,
    });
    const mw2 = createMockRegistryItem({
      id: 'mw-2',
      name: 'Priority Two',
      isMostWanted: true,
      displayOrder: 1,
    });
    const std1 = createMockRegistryItem({
      id: 'std-1',
      name: 'Standard One',
      isMostWanted: false,
      displayOrder: 0,
    });
    const std2 = createMockRegistryItem({
      id: 'std-2',
      name: 'Standard Two',
      isMostWanted: false,
      displayOrder: 1,
    });

    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/registry/items?limit=500') {
        return Promise.resolve({ ok: true, json: async () => [mw1, mw2, std1, std2] });
      }
      if (url === '/api/admin/registry-items' && options?.method === 'PUT') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
      }
      return Promise.reject(new Error(`Unhandled request: ${url}`));
    });

    renderWithProviders(<AdminRegistryPage />);

    expect(
      (await screen.findAllByRole('button', { name: 'Move Priority One up' }))[0]
    ).toBeDisabled();
    expect(
      screen.getAllByRole('button', { name: 'Move Priority One down' })[0]
    ).not.toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Move Priority Two down' })[0]).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Move Standard One up' })[0]).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Move Standard Two down' })[0]).toBeDisabled();

    fireEvent.click(screen.getAllByRole('button', { name: 'Move Standard One down' })[0]);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/admin/registry-items',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            action: 'reorder',
            orderedIds: ['mw-1', 'mw-2', 'std-2', 'std-1'],
          }),
        })
      );
    });

    expect(screen.getByTestId('registry-live-announcement')).toHaveTextContent(
      'Moved Standard One down to position 2 of 2'
    );
    const rowsAfterDown = within(screen.getByRole('table')).getAllByRole('row');
    expect(rowsAfterDown[3]).toHaveTextContent('Standard Two');
    expect(rowsAfterDown[4]).toHaveTextContent('Standard One');

    fireEvent.click(screen.getAllByRole('button', { name: 'Move Priority Two up' })[0]);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/admin/registry-items',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            action: 'reorder',
            orderedIds: ['mw-2', 'mw-1', 'std-2', 'std-1'],
          }),
        })
      );
    });
    expect(screen.getByTestId('registry-live-announcement')).toHaveTextContent(
      'Moved Priority Two up to position 1 of 2'
    );
  });

  it('reorders items on drag end within a priority group and ignores cross-group drops', async () => {
    const mw1 = createMockRegistryItem({
      id: 'mw-1',
      name: 'Priority One',
      isMostWanted: true,
      displayOrder: 0,
    });
    const std1 = createMockRegistryItem({
      id: 'std-1',
      name: 'Standard One',
      isMostWanted: false,
      displayOrder: 1,
    });
    const std2 = createMockRegistryItem({
      id: 'std-2',
      name: 'Standard Two',
      isMostWanted: false,
      displayOrder: 2,
    });

    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/registry/items?limit=500') {
        return Promise.resolve({ ok: true, json: async () => [mw1, std1, std2] });
      }
      if (url === '/api/admin/registry-items' && options?.method === 'PUT') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
      }
      return Promise.reject(new Error(`Unhandled request: ${url}`));
    });

    renderWithProviders(<AdminRegistryPage />);
    await screen.findAllByText('Standard One');

    const latestHandler = capturedDragEndHandlers[capturedDragEndHandlers.length - 1];
    expect(latestHandler).toBeDefined();

    await act(async () => {
      latestHandler({
        draggableId: 'mw-1',
        type: 'DEFAULT',
        source: { droppableId: 'desktop-registry-items', index: 0 },
        destination: { droppableId: 'desktop-registry-items', index: 2 },
        reason: 'DROP',
        mode: 'FLUID',
        combine: null,
      });
    });

    expect(mockFetch).not.toHaveBeenCalledWith('/api/admin/registry-items', expect.anything());

    const activeHandler = capturedDragEndHandlers[capturedDragEndHandlers.length - 1];
    await act(async () => {
      activeHandler({
        draggableId: 'std-1',
        type: 'DEFAULT',
        source: { droppableId: 'desktop-registry-items', index: 1 },
        destination: { droppableId: 'desktop-registry-items', index: 2 },
        reason: 'DROP',
        mode: 'FLUID',
        combine: null,
      });
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/admin/registry-items',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            action: 'reorder',
            orderedIds: ['mw-1', 'std-2', 'std-1'],
          }),
        })
      );
    });

    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows[2]).toHaveTextContent('Standard Two');
    expect(rows[3]).toHaveTextContent('Standard One');
  });

  it('rolls back optimistic item order when reorder mutation fails', async () => {
    const std1 = createMockRegistryItem({
      id: 'std-1',
      name: 'First Gift',
      isMostWanted: false,
      displayOrder: 0,
    });
    const std2 = createMockRegistryItem({
      id: 'std-2',
      name: 'Second Gift',
      isMostWanted: false,
      displayOrder: 1,
    });

    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/registry/items?limit=500') {
        return Promise.resolve({ ok: true, json: async () => [std1, std2] });
      }
      if (url === '/api/admin/registry-items' && options?.method === 'PUT') {
        return Promise.resolve({ ok: false, json: async () => ({ error: 'Reorder failed' }) });
      }
      return Promise.reject(new Error(`Unhandled request: ${url}`));
    });

    renderWithProviders(<AdminRegistryPage />);
    const moveDownButtons = await screen.findAllByRole('button', { name: 'Move First Gift down' });
    fireEvent.click(moveDownButtons[0]);

    await waitFor(() => {
      expect(screen.getByText('Failed to reorder registry items.')).toBeInTheDocument();
    });

    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('First Gift');
    expect(rows[2]).toHaveTextContent('Second Gift');
  });

  it('passes jest-axe accessibility checks with inline priority toggles and reorder controls', async () => {
    const priorityItem = createMockRegistryItem({
      id: 'a11y-1',
      name: 'Priority Dutch Oven',
      isMostWanted: true,
      displayOrder: 0,
    });
    const standardItem = createMockRegistryItem({
      id: 'a11y-2',
      name: 'Linen Napkin Set',
      isMostWanted: false,
      displayOrder: 1,
    });

    mockFetch.mockImplementation((url: string) => {
      if (url === '/api/registry/items?limit=500') {
        return Promise.resolve({ ok: true, json: async () => [priorityItem, standardItem] });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const { container } = renderWithProviders(
      <main>
        <AdminRegistryPage />
      </main>
    );

    await screen.findAllByText('Priority Dutch Oven');
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('supports priority toggling and arrow reordering from mobile card controls', async () => {
    const std1 = createMockRegistryItem({
      id: 'mob-1',
      name: 'Mobile Gift One',
      isMostWanted: false,
      displayOrder: 0,
    });
    const std2 = createMockRegistryItem({
      id: 'mob-2',
      name: 'Mobile Gift Two',
      isMostWanted: false,
      displayOrder: 1,
    });

    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/registry/items?limit=500') {
        return Promise.resolve({ ok: true, json: async () => [std1, std2] });
      }
      if (url === '/api/admin/registry-items' && options?.method === 'PUT') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
      }
      if (url === '/api/admin/registry-items/mob-2' && options?.method === 'PUT') {
        return Promise.resolve({ ok: true, json: async () => ({ id: 'mob-2', isMostWanted: true }) });
      }
      return Promise.reject(new Error(`Unhandled request: ${url}`));
    });

    renderWithProviders(<AdminRegistryPage />);

    const moveDownButtons = await screen.findAllByRole('button', {
      name: 'Move Mobile Gift One down',
    });
    fireEvent.click(moveDownButtons[1]);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/admin/registry-items',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ action: 'reorder', orderedIds: ['mob-2', 'mob-1'] }),
        })
      );
    });

    const moveUpButtons = screen.getAllByRole('button', { name: 'Move Mobile Gift One up' });
    fireEvent.click(moveUpButtons[1]);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/admin/registry-items',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ action: 'reorder', orderedIds: ['mob-1', 'mob-2'] }),
        })
      );
    });

    const mobilePriorityBtn = screen.getAllByRole('button', {
      name: 'Most Wanted: Mobile Gift Two',
    })[1];
    fireEvent.click(mobilePriorityBtn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/admin/registry-items/mob-2',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ isMostWanted: true }),
        })
      );
    });
  });

  it('displays contributor lifecycle badges and executes Confirm, Polite Reminder, and Void actions without deleting records', async () => {
    const itemWithContributors = createMockRegistryItem({
      id: 'item-lifecycle-1',
      name: 'Honeymoon Fund',
      isGroupGift: true,
      price: 500,
      amountContributed: 250,
      purchased: false,
      contributors: [
        createMockContributor({
          id: 'c-res-1',
          name: 'Alex Reserved',
          email: 'alex@example.com',
          amount: 100,
          refundedAmount: 0,
          status: 'RESERVED',
          date: '2026-06-01T12:00:00.000Z',
        }),
        createMockContributor({
          id: 'c-part-1',
          name: 'Casey Partial',
          email: 'casey@example.com',
          amount: 200,
          refundedAmount: 50,
          status: 'CONFIRMED',
          date: '2026-06-02T12:00:00.000Z',
          stripeChargeId: 'ch_partial_1',
        }),
        createMockContributor({
          id: 'c-ref-1',
          name: 'Riley Refunded',
          email: 'riley@example.com',
          amount: 75,
          refundedAmount: 75,
          status: 'REFUNDED',
          date: '2026-06-03T12:00:00.000Z',
        }),
      ],
    });

    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/registry/items?limit=500') {
        return Promise.resolve({ ok: true, json: async () => [itemWithContributors] });
      }
      if (url === '/api/registry/capabilities') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              cardCheckoutEnabled: true,
              stripePublishableKey: 'pk_test_123',
              defaultPaymentHandleType: 'Venmo',
              defaultPaymentHandle: '@couple',
            },
          }),
        });
      }
      if (url.startsWith('/api/admin/contributors/') && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: { action: JSON.parse(String(options.body)).action },
          }),
        });
      }
      return Promise.reject(new Error(`Unhandled request: ${url}`));
    });

    const { container } = renderWithProviders(
      <main>
        <AdminRegistryPage />
      </main>
    );

    expect((await screen.findAllByText('Reserved')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Confirmed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Partial Refund (-$50.00)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Refunded').length).toBeGreaterThan(0);

    // Refunded contributor has no destructive/active action buttons
    expect(
      screen.queryByRole('button', { name: 'Void contribution from Riley Refunded' })
    ).not.toBeInTheDocument();

    // Polite Reminder action
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Send polite reminder to Alex Reserved' })[0]
    );
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/admin/contributors/c-res-1/action',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ action: 'remind' }),
        })
      );
    });

    // Confirm action
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Confirm contribution from Alex Reserved' })[0]
    );
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/admin/contributors/c-res-1/action',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ action: 'confirm' }),
        })
      );
    });

    // Void action prompts confirmation dialog and preserves row history
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Void contribution from Casey Partial' })[0]
    );
    const dialogConfirmBtn = await screen.findByRole('button', { name: 'Confirm' });
    fireEvent.click(dialogConfirmBtn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/admin/contributors/c-part-1/action',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ action: 'void' }),
        })
      );
    });

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
