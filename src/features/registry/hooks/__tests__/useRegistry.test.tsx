import { renderHook, act, waitFor, screen, fireEvent } from '@testing-library/react';
import { useRegistry } from '../useRegistry';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/ui/ToastProvider';
import React from 'react';
import { RegistryItem, PaginatedRegistryItems } from '../../types';
import { checkAdminClient } from '@/core/auth/auth.client';
import { server } from '@/mocks/server';
import { http, HttpResponse } from 'msw';
import { createMockRegistryItem } from '@/testing/factories/registryFactory';
import { setDemoRuntimeFlag } from '@/lib/demo/runtimeFlag';

// Mock next/navigation
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

// Mock admin check
jest.mock('@/core/auth/auth.client');
const mockedCheckAdminClient = checkAdminClient as jest.Mock;

// Mock window.confirm and window.alert
global.confirm = jest.fn(() => true);
global.alert = jest.fn();

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

const wrapper = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <ToastProvider>
        {children}
      </ToastProvider>
    </QueryClientProvider>
  );
  Wrapper.displayName = 'QueryClientWrapper';
  return Wrapper;
};

const mockItems: RegistryItem[] = [
  createMockRegistryItem({ id: '1', name: 'Coffee Maker', category: 'Category A', price: 100, purchased: false, isGroupGift: false, amountContributed: 0, contributors: [], description: 'Brews fresh espresso and filter coffee' }),
  createMockRegistryItem({ id: '2', name: 'Item 2', category: 'Category B', price: 200, purchased: true, isGroupGift: false, amountContributed: 0, contributors: [], purchaserName: 'John Doe', description: 'High-speed blender for smoothies' }),
  createMockRegistryItem({ id: '3', name: 'Item 3', category: 'Category A', price: 300, purchased: false, isGroupGift: true, amountContributed: 150, contributors: [], description: '' }),
];

describe('useRegistry', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', '/');
    }
    mockedCheckAdminClient.mockResolvedValue(false);
    queryClient = createTestQueryClient();
    
    // Default success handler for fetching items
    server.use(
      http.get('/api/registry/items', () => {
        return HttpResponse.json({ success: true, data: mockItems });
      })
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should fetch registry items and return initial state', async () => {
    const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(queryClient) });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.items).toEqual(mockItems);
    expect(result.current.isAdmin).toBe(false);
  });

  it('should handle card click and open modal', async () => {
    const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(queryClient) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const item = result.current.items[0];

    act(() => {
      result.current.handleCardClick(item);
    });

    expect(result.current.selectedItem).toEqual(item);
    expect(result.current.isModalOpen).toBe(true);
  });

  it('should open modal in read-only mode for purchased item', async () => {
    const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(queryClient) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const item = result.current.items[1];

    act(() => {
      result.current.handleCardClick(item);
    });

    expect(result.current.selectedItem).toEqual(item);
    expect(result.current.isModalOpen).toBe(true);
  });

  it('should handle modal close', async () => {
    const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(queryClient) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.handleCardClick(result.current.items[0]);
    });

    expect(result.current.isModalOpen).toBe(true);

    act(() => {
      result.current.handleCloseModal();
    });

    expect(result.current.isModalOpen).toBe(false);
    expect(result.current.selectedItem).toBeNull();
  });

  it('should handle edit', async () => {
    const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(queryClient) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.handleEdit('1');
    });

    expect(mockPush).toHaveBeenCalledWith('/registry/edit-item/1');

    setDemoRuntimeFlag(true);
    try {
      act(() => {
        result.current.handleEdit('demo-custom-item-7');
      });
      expect(mockPush).toHaveBeenCalledWith('/registry/edit-item/fallback?id=demo-custom-item-7');
    } finally {
      setDemoRuntimeFlag(false);
    }
  });

  it('should handle delete', async () => {
    let deleteCalled = false;
    server.use(
      http.delete('/api/registry/items/1', () => {
        deleteCalled = true;
        return HttpResponse.json({ success: true });
      })
    );

    const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(queryClient) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.handleDelete('1');
    });

    const confirmButton = await screen.findByRole('button', { name: 'Confirm' });
    
    await act(async () => {
      fireEvent.click(confirmButton);
    });

    await waitFor(() => {
      expect(deleteCalled).toBe(true);
    });
  });

  it('should handle contribution and keep optimistic update when response has no id', async () => {
    let contributeBody = null;
    server.use(
      http.post('/api/registry/contribute', async ({ request }) => {
        contributeBody = await request.json();
        return HttpResponse.json({ success: true });
      })
    );

    const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(queryClient) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.handleCardClick(result.current.items[0]);
    });
    expect(result.current.isModalOpen).toBe(true);

    await act(async () => {
      await result.current.handleContribute('1', 'Jane Doe', 100);
    });

    expect(contributeBody).toEqual({ itemId: '1', purchaserName: 'Jane Doe', amount: 100 });
    expect(result.current.isModalOpen).toBe(true);
    expect(result.current.selectedItem?.purchased).toBe(true);
    expect(result.current.items.find(i => i.id === '1')?.purchased).toBe(true);
  });

  it('should synchronize PaginatedRegistryItems cache entries and keep modal open after handleContribute', async () => {
    const paginatedPage1: PaginatedRegistryItems = {
      items: mockItems.map(item => ({ ...item })),
      total: 4,
      page: 1,
      limit: 20,
      totalPages: 2,
    };
    const secondaryCacheKey = ['registry-items', 1, 20, 'Category A', 0, 1000] as const;
    queryClient.setQueryData<PaginatedRegistryItems>(secondaryCacheKey, {
      items: [mockItems[0], mockItems[2]].map(item => ({ ...item })),
      total: 2,
      page: 1,
      limit: 20,
      totalPages: 1,
    });

    const serverUpdatedItem: RegistryItem = {
      ...mockItems[0],
      purchased: true,
      purchaserName: 'J*** D***',
    };

    server.use(
      http.get('/api/registry/items', () => {
        return HttpResponse.json(paginatedPage1);
      }),
      http.post('/api/registry/contribute', () => {
        return HttpResponse.json(serverUpdatedItem);
      })
    );

    const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(queryClient) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.setShowAvailableOnly(true);
      result.current.handleCardClick(result.current.items[0]);
    });

    expect(result.current.isModalOpen).toBe(true);
    expect(result.current.selectedItem?.id).toBe('1');

    await act(async () => {
      await result.current.handleContribute('1', 'Jane Doe', 100);
    });

    // Modal stays open with updated selectedItem even after showAvailableOnly removes item from filteredItems
    expect(result.current.isModalOpen).toBe(true);
    expect(result.current.selectedItem).toEqual(serverUpdatedItem);
    expect(result.current.filteredItems.find(i => i.id === '1')).toBeUndefined();

    // Active PaginatedRegistryItems query cache is updated while preserving pagination metadata
    const activeCached = queryClient.getQueryData<PaginatedRegistryItems>(['registry-items', 1, 500]);
    expect(activeCached?.total).toBe(4);
    expect(activeCached?.totalPages).toBe(2);
    expect(activeCached?.items.find(i => i.id === '1')).toEqual(serverUpdatedItem);

    // Other cached PaginatedRegistryItems pages/filters under ['registry-items'] are also synchronized
    const secondaryCached = queryClient.getQueryData<PaginatedRegistryItems>(secondaryCacheKey);
    expect(secondaryCached?.items.find(i => i.id === '1')).toEqual(serverUpdatedItem);
  });

  it('should roll back PaginatedRegistryItems caches and selectedItem on contribution error', async () => {
    const paginatedData: PaginatedRegistryItems = {
      items: mockItems.map(item => ({ ...item })),
      total: 3,
      page: 1,
      limit: 20,
      totalPages: 1,
    };
    const secondaryCacheKey = ['registry-items', 2, 20, '', 0, 1000] as const;
    queryClient.setQueryData<PaginatedRegistryItems>(secondaryCacheKey, {
      items: [{ ...mockItems[2] }],
      total: 3,
      page: 2,
      limit: 20,
      totalPages: 2,
    });

    server.use(
      http.get('/api/registry/items', () => {
        return HttpResponse.json(paginatedData);
      }),
      http.post('/api/registry/contribute', () => {
        return HttpResponse.json({ error: 'Payment record failed' }, { status: 500 });
      })
    );

    const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(queryClient) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const targetGroupItem = result.current.items[2];
    act(() => {
      result.current.handleCardClick(targetGroupItem);
    });

    await act(async () => {
      await expect(
        result.current.handleContribute('3', 'Jane Doe', 150)
      ).rejects.toThrow('Payment record failed');
    });

    expect(result.current.isModalOpen).toBe(true);
    expect(result.current.selectedItem?.purchased).toBe(false);
    expect(result.current.selectedItem?.amountContributed).toBe(150);

    const activeCached = queryClient.getQueryData<PaginatedRegistryItems>(['registry-items', 1, 500]);
    const revertedItem = activeCached?.items.find(i => i.id === '3') ?? result.current.items.find(i => i.id === '3');
    expect(revertedItem?.purchased).toBe(false);
    expect(revertedItem?.amountContributed).toBe(150);

    const secondaryCached = queryClient.getQueryData<PaginatedRegistryItems>(secondaryCacheKey);
    expect(secondaryCached?.items[0].purchased).toBe(false);
    expect(secondaryCached?.items[0].amountContributed).toBe(150);
  });

  it('should filter items by category', async () => {
    const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(queryClient) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.setCategoryFilter(['Category B']);
    });

    expect(result.current.filteredItems.length).toBe(1);
    expect(result.current.filteredItems[0].id).toBe('2');
  });

  it('should filter by price range', async () => {
    const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(queryClient) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.setPriceRange([150, 250]);
    });

    expect(result.current.filteredItems.length).toBe(1);
    expect(result.current.filteredItems[0].id).toBe('2');
  });

  it('should filter by group gifts only', async () => {
    const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(queryClient) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.setShowGroupGiftsOnly(true);
    });

    expect(result.current.filteredItems.length).toBe(1);
    expect(result.current.filteredItems[0].id).toBe('3');
  });

  it('should filter by available only', async () => {
    const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(queryClient) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.setShowAvailableOnly(true);
    });

    expect(result.current.filteredItems.length).toBe(2);
    expect(result.current.filteredItems.map(i => i.id)).toEqual(['1', '3']);
  });

  it('should filter items by search query matching item title / name', async () => {
    const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(queryClient) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.setSearchQuery('coffee');
    });

    expect(result.current.filteredItems.length).toBe(1);
    expect(result.current.filteredItems[0].id).toBe('1');
  });

  it('should filter items by search query matching item description', async () => {
    const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(queryClient) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.setSearchQuery('smoothies');
    });

    expect(result.current.filteredItems.length).toBe(1);
    expect(result.current.filteredItems[0].id).toBe('2');
  });

  it('should trim search whitespace and match case-insensitively', async () => {
    const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(queryClient) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.setSearchQuery('  ESPRESSO  ');
    });

    expect(result.current.filteredItems.length).toBe(1);
    expect(result.current.filteredItems[0].id).toBe('1');
  });

  it('should reset search query when handleClearFilters is called', async () => {
    const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(queryClient) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.setSearchQuery('smoothies');
      result.current.setShowGroupGiftsOnly(true);
    });

    expect(result.current.searchQuery).toBe('smoothies');
    expect(result.current.filteredItems.length).toBe(0);

    act(() => {
      result.current.handleClearFilters();
    });

    expect(result.current.searchQuery).toBe('');
    expect(result.current.showGroupGiftsOnly).toBe(false);
    expect(result.current.filteredItems.length).toBe(3);
  });

  describe('sorting options', () => {
    it('should default to original item order', async () => {
      const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(queryClient) });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.sortOption).toBe('default');
      expect(result.current.filteredItems.map(i => i.id)).toEqual(['1', '2', '3']);
    });

    it('should sort items by price low to high (price-asc)', async () => {
      const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(queryClient) });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      act(() => {
        result.current.setSortOption('price-asc');
      });

      expect(result.current.sortOption).toBe('price-asc');
      expect(result.current.filteredItems.map(i => i.id)).toEqual(['1', '2', '3']);
    });

    it('should sort items by price high to low (price-desc)', async () => {
      const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(queryClient) });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      act(() => {
        result.current.setSortOption('price-desc');
      });

      expect(result.current.sortOption).toBe('price-desc');
      expect(result.current.filteredItems.map(i => i.id)).toEqual(['3', '2', '1']);
    });

    it('should sort items by most wanted prioritizing isMostWanted flag and displayOrder', async () => {
      const customItems: RegistryItem[] = [
        createMockRegistryItem({ id: '1', name: 'Coffee Maker', category: 'Category A', price: 100, purchased: false, isGroupGift: false, isMostWanted: false, displayOrder: 1, amountContributed: 200, contributors: [], description: '' }),
        createMockRegistryItem({ id: '2', name: 'Item 2', category: 'Category B', price: 200, purchased: false, isGroupGift: false, isMostWanted: true, displayOrder: 2, amountContributed: 0, contributors: [], description: '' }),
        createMockRegistryItem({ id: '3', name: 'Item 3', category: 'Category A', price: 300, purchased: false, isGroupGift: false, isMostWanted: true, displayOrder: 1, amountContributed: 0, contributors: [], description: '' }),
      ];
      server.use(
        http.get('/api/registry/items', () => {
          return HttpResponse.json({ success: true, data: customItems });
        })
      );

      const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(queryClient) });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      act(() => {
        result.current.setSortOption('most-wanted');
      });

      expect(result.current.sortOption).toBe('most-wanted');
      expect(result.current.filteredItems.map(i => i.id)).toEqual(['3', '2', '1']);
    });
  });

  describe('URL query param synchronization', () => {
    it('should auto-open target item modal when ?item=<itemId> is present in URL', async () => {
      window.history.replaceState({}, '', '/?item=3');
      const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(queryClient) });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await waitFor(() => {
        expect(result.current.isModalOpen).toBe(true);
        expect(result.current.selectedItem?.id).toBe('3');
      });
    });

    it('should update URL when card is clicked and clear URL when modal is closed', async () => {
      const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(queryClient) });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      act(() => {
        result.current.handleCardClick(mockItems[0]);
      });

      expect(window.location.search).toContain('item=1');
      expect(result.current.isModalOpen).toBe(true);

      act(() => {
        result.current.handleCloseModal();
      });

      expect(window.location.search).not.toContain('item=1');
      expect(result.current.isModalOpen).toBe(false);
    });
  });

  describe('bounded full-catalog fetch and client faceted filtering', () => {
    const largeCatalog: RegistryItem[] = Array.from({ length: 35 }, (_, idx) => {
      const num = idx + 1;
      const categories = ['Kitchen', 'Bedroom', 'Outdoor', 'Cash Fund'];
      const category = categories[idx % categories.length];
      return {
        id: `gift-${num}`,
        itemType: category === 'Cash Fund' ? 'CASH_FUND' : 'PHYSICAL',
        name: num === 35 ? 'Artisan Pizza Oven' : `Registry Gift ${num}`,
        description: num === 28 ? 'Handcrafted cedar picnic blanket basket' : `Description for item ${num}`,
        category,
        price: num === 35 ? 1250 : num * 25,
        quantity: 1,
        purchased: num % 5 === 0,
        isGroupGift: category === 'Cash Fund' || num % 4 === 0,
        isMostWanted: num === 32 || num === 5,
        displayOrder: num === 32 ? 1 : num === 5 ? 2 : num,
        isSample: false,
        amountContributed: num === 35 ? 250 : 0,
        contributors: [],
        imageUrl: '',
      };
    });

    it('fetches up to 500 items once without server category or price params and unwraps paginated responses', async () => {
      const requestedUrls: string[] = [];
      server.use(
        http.get('/api/registry/items', ({ request }) => {
          requestedUrls.push(request.url);
          return HttpResponse.json({
            success: true,
            data: {
              items: largeCatalog,
              total: largeCatalog.length,
              page: 1,
              limit: 500,
              totalPages: 1,
            },
          });
        })
      );

      const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(queryClient) });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.items).toHaveLength(35);
      expect(result.current.filteredItems).toHaveLength(35);
      expect(result.current.visibleItems).toHaveLength(12);
      expect(requestedUrls).toHaveLength(1);
      const parsedUrl = new URL(requestedUrls[0]);
      expect(parsedUrl.searchParams.get('limit')).toBe('500');
      expect(parsedUrl.searchParams.get('page')).toBe('1');
      expect(parsedUrl.searchParams.has('category')).toBe(false);
      expect(parsedUrl.searchParams.has('minPrice')).toBe(false);
      expect(parsedUrl.searchParams.has('maxPrice')).toBe(false);

      // Selecting multiple categories keeps all catalog categories visible and does not trigger new fetches
      act(() => {
        result.current.setCategoryFilter(['Kitchen', 'Outdoor']);
      });

      expect(requestedUrls).toHaveLength(1);
      expect(result.current.categories).toEqual(['Bedroom', 'Cash Fund', 'Kitchen', 'Outdoor']);
      expect(result.current.categoryFilter).toEqual(['Kitchen', 'Outdoor']);
      expect(result.current.filteredItems.every(i => i.category === 'Kitchen' || i.category === 'Outdoor')).toBe(true);
      expect(result.current.filteredItems.some(i => i.category === 'Kitchen')).toBe(true);
      expect(result.current.filteredItems.some(i => i.category === 'Outdoor')).toBe(true);
      expect(result.current.filteredItems.some(i => i.id === 'gift-35')).toBe(true);
    });

    it('keeps minPrice and maxPrice anchored to full catalog bounds and restores items when widening price slider', async () => {
      server.use(
        http.get('/api/registry/items', () =>
          HttpResponse.json({
            success: true,
            data: { items: largeCatalog, total: 35, page: 1, limit: 500, totalPages: 1 },
          })
        )
      );

      const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(queryClient) });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // Includes $1,250 gift-35 on initial load without clipping at $1,000
      expect(result.current.minPrice).toBe(25);
      expect(result.current.maxPrice).toBe(1250);
      expect(result.current.priceRange).toEqual([25, 1250]);
      expect(result.current.filteredItems).toHaveLength(35);

      // Combine category + narrow price range
      act(() => {
        result.current.setCategoryFilter(['Outdoor']);
        result.current.setPriceRange([100, 300]);
      });

      expect(result.current.minPrice).toBe(25);
      expect(result.current.maxPrice).toBe(1250);
      expect(result.current.categories).toEqual(['Bedroom', 'Cash Fund', 'Kitchen', 'Outdoor']);
      const narrowedCount = result.current.filteredItems.length;
      expect(narrowedCount).toBeGreaterThan(0);
      expect(result.current.filteredItems.every(i => i.price >= 100 && i.price <= 300 && i.category === 'Outdoor')).toBe(true);

      // Widen price slider outward without clearing filters — excluded Outdoor gifts (including $1,250 gift-35) return immediately
      act(() => {
        result.current.setPriceRange([25, 1250]);
      });

      expect(result.current.categoryFilter).toEqual(['Outdoor']);
      expect(result.current.filteredItems.length).toBeGreaterThan(narrowedCount);
      expect(result.current.filteredItems.some(i => i.id === 'gift-35')).toBe(true);
    });

    it('searches and sorts across all 35 catalog items including items past position 20', async () => {
      server.use(
        http.get('/api/registry/items', () =>
          HttpResponse.json({
            success: true,
            data: { items: largeCatalog, total: 35, page: 1, limit: 500, totalPages: 1 },
          })
        )
      );

      const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(queryClient) });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // Search name past position 20
      act(() => {
        result.current.setSearchQuery('pizza oven');
      });
      expect(result.current.filteredItems.map(i => i.id)).toEqual(['gift-35']);

      // Search description past position 20
      act(() => {
        result.current.setSearchQuery('cedar picnic');
      });
      expect(result.current.filteredItems.map(i => i.id)).toEqual(['gift-28']);

      // Clear search and sort across entire 35-item catalog
      act(() => {
        result.current.setSearchQuery('');
        result.current.setSortOption('price-desc');
      });
      expect(result.current.filteredItems[0].id).toBe('gift-35');
      expect(result.current.filteredItems[34].id).toBe('gift-1');

      act(() => {
        result.current.setSortOption('most-wanted');
      });
      expect(result.current.filteredItems[0].id).toBe('gift-32');
      expect(result.current.filteredItems[1].id).toBe('gift-5');
    });

    it('opens contribution dialog for ?item= deep link past position 20 and updates availability immediately on contribution', async () => {
      window.history.replaceState({}, '', '/registry?item=gift-34');
      server.use(
        http.get('/api/registry/items', () =>
          HttpResponse.json({
            success: true,
            data: { items: largeCatalog, total: 35, page: 1, limit: 500, totalPages: 1 },
          })
        ),
        http.post('/api/registry/contribute', () =>
          HttpResponse.json({
            success: true,
            data: {
              ...largeCatalog[33],
              amountContributed: largeCatalog[33].price,
              purchased: true,
            },
          })
        )
      );

      const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(queryClient) });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await waitFor(() => {
        expect(result.current.isModalOpen).toBe(true);
        expect(result.current.selectedItem?.id).toBe('gift-34');
      });

      act(() => {
        result.current.setShowAvailableOnly(true);
      });
      expect(result.current.filteredItems.some(i => i.id === 'gift-34')).toBe(true);

      await act(async () => {
        await result.current.handleContribute('gift-34', 'Alex Rivera', largeCatalog[33].price);
      });

      expect(result.current.isModalOpen).toBe(true);
      expect(result.current.selectedItem?.purchased).toBe(true);
      expect(result.current.items.find(i => i.id === 'gift-34')?.purchased).toBe(true);
      expect(result.current.filteredItems.some(i => i.id === 'gift-34')).toBe(false);
    });
  });
});
