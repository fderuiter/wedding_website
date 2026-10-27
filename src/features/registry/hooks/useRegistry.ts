'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import { useToast } from '@/components/ui/ToastProvider';
import { RegistryItem } from '../types';
import { checkAdminClient } from '@/core/auth/auth.client';

import { apiClient } from '@/lib/apiClient';
import { useEntityOrchestration } from '@/hooks/useEntityOrchestration';

import { useFilter } from '@/hooks/useFilter';

export type SortOption = 'default' | 'price-asc' | 'price-desc' | 'most-wanted';

export function useRegistry() {
  const queryClient = useQueryClient();
  const { confirm } = useToast();
  const [selectedItem, setSelectedItem] = useState<RegistryItem | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [visibleItemsCount, setVisibleItemsCount] = useState(12);
  const [isAdmin, setIsAdmin] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 1000]);
  const [showGroupGiftsOnly, setShowGroupGiftsOnly] = useState(false);
  const [showAvailableOnly, setShowAvailableOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOption, setSortOption] = useState<SortOption>('default');
  const router = useRouter();

  useEffect(() => {
    const checkAdminStatus = async () => {
      const admin = await checkAdminClient();
      setIsAdmin(admin);
    };
    checkAdminStatus();
  }, []);

  const [priceRangeUserSet, setPriceRangeUserSet] = useState(false);

  const [categoryFilterState, setCategoryFilterState] = useState<string[]>([]);

  const categoryParam = useMemo(() => {
    if (Array.isArray(categoryFilterState) && categoryFilterState.length > 0) {
      return categoryFilterState[0];
    }
    return '';
  }, [categoryFilterState]);

  const endpoint = useMemo(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', String(limit));
    if (categoryParam) {
      params.set('category', categoryParam);
    }
    if (priceRange[0] > 0) {
      params.set('minPrice', String(priceRange[0]));
    }
    if (priceRange[1] < 1000) {
      params.set('maxPrice', String(priceRange[1]));
    }
    return `/api/registry/items?${params.toString()}`;
  }, [page, limit, categoryParam, priceRange]);

  const {
    data: queryResult,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['registry-items', page, limit, categoryParam, priceRange[0], priceRange[1]],
    queryFn: async () => apiClient.get<any>(endpoint),
    placeholderData: (previousData) => previousData,
  });

  const { remove: deleteItem } = useEntityOrchestration<RegistryItem>({
    queryKey: ['registry-items', page, limit, categoryParam, priceRange[0], priceRange[1]],
    endpoint: '/api/registry/items',
    entityName: 'registry item',
    apiClient,
    enabled: false,
  });

  const items = useMemo(() => {
    if (!queryResult) return [];
    if (Array.isArray(queryResult)) return queryResult;
    if (typeof queryResult === 'object' && Array.isArray((queryResult as any).items)) {
      return (queryResult as any).items as RegistryItem[];
    }
    return [];
  }, [queryResult]);

  const total = useMemo(() => {
    if (queryResult && typeof queryResult === 'object' && 'total' in queryResult && typeof (queryResult as any).total === 'number') {
      return (queryResult as any).total;
    }
    return items.length;
  }, [queryResult, items.length]);

  const totalPages = useMemo(() => {
    if (queryResult && typeof queryResult === 'object' && 'totalPages' in queryResult && typeof (queryResult as any).totalPages === 'number') {
      return (queryResult as any).totalPages;
    }
    return Math.ceil(total / limit) || 1;
  }, [queryResult, total, limit]);

  const {
    categories,
    selectedCategories: categoryFilter,
    setSelectedCategories: setCategoryFilter,
    filteredItems: categoryFilteredItems,
  } = useFilter(items, useCallback((item: RegistryItem) => item.category, []));

  const handleSetCategoryFilter = useCallback((categories: string[]) => {
    setCategoryFilter(categories);
    setCategoryFilterState(categories);
    setPage(1);
  }, [setCategoryFilter]);

  const handleSetPriceRange = useCallback((range: [number, number]) => {
    setPriceRange(range);
    setPriceRangeUserSet(true);
    setPage(1);
  }, []);

  const { mutate: contribute } = useMutation({
    mutationFn: async ({ itemId, purchaserName, amount, code, message, coverFee }: { itemId: string; purchaserName: string; amount: number; code?: string; message?: string | null; coverFee?: boolean }) => {
      return apiClient.post('/api/registry/contribute', { itemId, purchaserName, amount, code, message, coverFee });
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: ['registry-items'] });
      const previousItems = queryClient.getQueryData<RegistryItem[]>(['registry-items']);
      if (previousItems) {
        queryClient.setQueryData<RegistryItem[]>(['registry-items'], prev => prev?.map(item => {
          if (item.id !== variables.itemId) return item;
          if (item.isGroupGift) {
            const newAmount = item.amountContributed + variables.amount;
            return {
              ...item,
              amountContributed: Math.min(item.price, newAmount),
              contributors: [
                ...item.contributors,
                {
                  name: variables.purchaserName,
                  amount: variables.amount,
                  coverFee: variables.coverFee ?? false,
                  feeAmount: variables.coverFee ? Math.round(variables.amount * 0.025 * 100) / 100 : 0,
                  date: new Date().toISOString(),
                  isPlusOne: false,
                  thankYouStatus: 'Unsent',
                  thankYouSentAt: null,
                },
              ],
              purchased: newAmount >= item.price,
            };
          } else {
            return {
              ...item,
              purchased: true,
              purchaserName: variables.purchaserName,
            };
          }
        }) || []);
      }
      return { previousItems };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousItems) {
        queryClient.setQueryData(['registry-items'], context.previousItems);
      }
    },
    // Keep onSettled here if it's not strictly part of "standard mutations" mentioned,
    // actually let's remove onSettled invalidation from contribute as well to follow "mutations perform manual cache snapshots and rollbacks without relying on settlement invalidation".
    onSuccess: (updatedItem) => {
      queryClient.setQueryData<RegistryItem[]>(['registry-items'], old =>
        old?.map(item => item.id === updatedItem.id ? updatedItem : item)
      );
    },
    meta: {
      successMessage: 'Thank you for your contribution!',
      errorMessage: 'Error: Could not process contribution.'
    }
  });

  const [minPrice, maxPrice] = useMemo(() => {
    if (items.length === 0) return [0, 1000];
    let min = items[0].price, max = items[0].price;
    for (const item of items) {
      if (item.price < min) min = item.price;
      if (item.price > max) max = item.price;
    }
    return [Math.floor(min), Math.ceil(max)];
  }, [items]);

  useEffect(() => {
    if (!priceRangeUserSet && items.length > 0) {
      setPriceRange([minPrice, maxPrice]);
    }
  }, [minPrice, maxPrice, priceRangeUserSet, items.length]);

  const filteredItems = useMemo(() => {
    const trimmedQuery = searchQuery.trim().toLowerCase();
    const result = categoryFilteredItems.filter(item => {
      const inPrice = item.price >= priceRange[0] && item.price <= priceRange[1];
      const isGroupGift = !showGroupGiftsOnly || item.isGroupGift;
      const isAvailable = !showAvailableOnly || !item.purchased;
      const matchesSearch = !trimmedQuery || (
        (item.name?.toLowerCase().includes(trimmedQuery) ?? false) ||
        (item.description?.toLowerCase().includes(trimmedQuery) ?? false)
      );
      return inPrice && isGroupGift && isAvailable && matchesSearch;
    });

    if (sortOption === 'price-asc') {
      return [...result].sort((a, b) => a.price - b.price);
    }
    if (sortOption === 'price-desc') {
      return [...result].sort((a, b) => b.price - a.price);
    }
    if (sortOption === 'most-wanted') {
      return [...result].sort((a, b) => {
        const mostWantedDiff = (b.isMostWanted ? 1 : 0) - (a.isMostWanted ? 1 : 0);
        if (mostWantedDiff !== 0) return mostWantedDiff;
        const orderDiff = (a.displayOrder ?? 0) - (b.displayOrder ?? 0);
        if (orderDiff !== 0) return orderDiff;
        const diff = (b.amountContributed || 0) - (a.amountContributed || 0);
        if (diff !== 0) return diff;
        return (b.contributors?.length || 0) - (a.contributors?.length || 0);
      });
    }
    return result;
  }, [categoryFilteredItems, priceRange, showGroupGiftsOnly, showAvailableOnly, searchQuery, sortOption]);

  const visibleItems = useMemo(() => {
    return filteredItems.slice(0, visibleItemsCount);
  }, [filteredItems, visibleItemsCount]);

  const handleCardClick = useCallback((item: RegistryItem) => {
    if (item.purchased) return;
    setSelectedItem(item);
    setIsModalOpen(true);
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      params.set('item', item.id);
      const newUrl = `${window.location.pathname}?${params.toString()}`;
      window.history.pushState({}, '', newUrl);
    }
  }, []);

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    setSelectedItem(null);
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.has('item')) {
        params.delete('item');
        const queryString = params.toString();
        const newUrl = queryString ? `${window.location.pathname}?${queryString}` : window.location.pathname;
        window.history.pushState({}, '', newUrl);
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || items.length === 0) return;

    const syncModalWithUrl = () => {
      const searchParams = new URLSearchParams(window.location.search);
      const targetId = searchParams.get('item');
      if (targetId) {
        const match = items.find(i => i.id === targetId);
        if (match) {
          setSelectedItem(match);
          setIsModalOpen(true);
        }
      }
    };

    syncModalWithUrl();

    window.addEventListener('popstate', syncModalWithUrl);
    return () => {
      window.removeEventListener('popstate', syncModalWithUrl);
    };
  }, [items]);

  const handleEdit = useCallback((id: string) => {
    router.push(`/registry/edit-item/${id}`);
  }, [router]);

  const handleDelete = useCallback(async (id: string) => {
    if (await confirm('Are you sure you want to delete this item?')) {
      deleteItem(id);
    }
  }, [deleteItem, confirm]);

  const handleContribute = useCallback(async (itemId: string, purchaserName: string, amount: number, code?: string, message?: string, coverFee?: boolean) => {
    return new Promise<void>((resolve, reject) => {
      contribute({ itemId, purchaserName, amount, code, message, coverFee }, {
        onSuccess: () => {
          handleCloseModal();
          resolve();
        },
        onError: (error) => {
          reject(error);
        }
      });
    });
  }, [contribute, handleCloseModal]);

  const handleClearFilters = useCallback(() => {
    setCategoryFilter([]);
    setCategoryFilterState([]);
    setPriceRange([minPrice, maxPrice]);
    setPriceRangeUserSet(false);
    setShowGroupGiftsOnly(false);
    setShowAvailableOnly(false);
    setSearchQuery('');
    setSortOption('default');
    setPage(1);
  }, [setCategoryFilter, minPrice, maxPrice]);

  return {
    items,
    total,
    page,
    setPage,
    limit,
    setLimit,
    totalPages,
    isLoading,
    error,
    refetch,
    selectedItem,
    isModalOpen,
    visibleItemsCount,
    setVisibleItemsCount,
    isAdmin,
    filteredItems,
    visibleItems,
    categories,
    minPrice,
    maxPrice,
    categoryFilter,
    setCategoryFilter: handleSetCategoryFilter,
    priceRange,
    setPriceRange: handleSetPriceRange,
    showGroupGiftsOnly,
    setShowGroupGiftsOnly,
    showAvailableOnly,
    setShowAvailableOnly,
    searchQuery,
    setSearchQuery,
    sortOption,
    setSortOption,
    handleClearFilters,
    handleCardClick,
    handleCloseModal,
    handleEdit,
    handleDelete,
    handleContribute,
  };
}
