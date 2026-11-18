'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { SetStateAction } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import { useToast } from '@/components/ui/ToastProvider';
import { RegistryItem, PaginatedRegistryItems } from '../types';
import { checkAdminClient } from '@/core/auth/auth.client';

import { apiClient } from '@/lib/apiClient';
import { useEntityOrchestration } from '@/hooks/useEntityOrchestration';

import { useFilter } from '@/hooks/useFilter';

export type SortOption = 'default' | 'price-asc' | 'price-desc' | 'most-wanted';

const INITIAL_VISIBLE_ITEMS = 12;
const REGISTRY_CATALOG_LIMIT = 500;
const EMPTY_ITEMS: RegistryItem[] = [];

export function useRegistry() {
  const queryClient = useQueryClient();
  const { confirm } = useToast();
  const [selectedItem, setSelectedItem] = useState<RegistryItem | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [visibleItemsCount, setVisibleItemsCount] = useState(INITIAL_VISIBLE_ITEMS);
  const [isAdmin, setIsAdmin] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(REGISTRY_CATALOG_LIMIT);
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 1000]);
  const [showGroupGiftsOnly, setShowGroupGiftsOnlyState] = useState(false);
  const [showAvailableOnly, setShowAvailableOnlyState] = useState(false);
  const [searchQuery, setSearchQueryState] = useState('');
  const [sortOption, setSortOptionState] = useState<SortOption>('default');
  const [priceRangeUserSet, setPriceRangeUserSet] = useState(false);
  const attemptedDeepLinkIds = useRef<Set<string>>(new Set());
  const router = useRouter();

  useEffect(() => {
    const checkAdminStatus = async () => {
      const admin = await checkAdminClient();
      setIsAdmin(admin);
    };
    checkAdminStatus();
  }, []);

  const registryQueryKey = useMemo(() => ['registry-items', page, limit], [page, limit]);

  const endpoint = useMemo(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', String(limit));
    return `/api/registry/items?${params.toString()}`;
  }, [page, limit]);

  const {
    data: items = EMPTY_ITEMS,
    isLoading,
    error,
    refetch,
  } = useQuery<RegistryItem[], Error>({
    queryKey: registryQueryKey,
    queryFn: async () => {
      const res = await apiClient.get<PaginatedRegistryItems | RegistryItem[]>(endpoint);
      if (Array.isArray(res)) return res;
      if (res && typeof res === 'object' && Array.isArray(res.items)) {
        return res.items;
      }
      return [];
    },
    placeholderData: (previousData) => previousData,
  });

  const { remove: deleteItem } = useEntityOrchestration<RegistryItem>({
    queryKey: registryQueryKey,
    endpoint: '/api/registry/items',
    invalidateQueryKeys: [['admin-registry']],
    entityName: 'registry item',
    apiClient,
    enabled: false,
  });

  const total = items.length;
  const totalPages = Math.ceil(total / limit) || 1;

  const {
    categories,
    selectedCategories: categoryFilter,
    setSelectedCategories: setCategoryFilter,
    filteredItems: categoryFilteredItems,
  } = useFilter(items, useCallback((item: RegistryItem) => item.category, []));

  const handleSetCategoryFilter = useCallback((nextCategories: string[]) => {
    setCategoryFilter(nextCategories);
    setVisibleItemsCount(INITIAL_VISIBLE_ITEMS);
  }, [setCategoryFilter]);

  const handleSetPriceRange = useCallback((range: [number, number]) => {
    setPriceRange(range);
    setPriceRangeUserSet(true);
    setVisibleItemsCount(INITIAL_VISIBLE_ITEMS);
  }, []);

  const setShowGroupGiftsOnly = useCallback((value: SetStateAction<boolean>) => {
    setShowGroupGiftsOnlyState(value);
    setVisibleItemsCount(INITIAL_VISIBLE_ITEMS);
  }, []);

  const setShowAvailableOnly = useCallback((value: SetStateAction<boolean>) => {
    setShowAvailableOnlyState(value);
    setVisibleItemsCount(INITIAL_VISIBLE_ITEMS);
  }, []);

  const setSearchQuery = useCallback((value: SetStateAction<string>) => {
    setSearchQueryState(value);
    setVisibleItemsCount(INITIAL_VISIBLE_ITEMS);
  }, []);

  const setSortOption = useCallback((value: SetStateAction<SortOption>) => {
    setSortOptionState(value);
    setVisibleItemsCount(INITIAL_VISIBLE_ITEMS);
  }, []);

  const { mutate: contribute } = useMutation({
    mutationFn: async ({ itemId, purchaserName, amount, code, message, coverFee, email, paymentIntentId }: { itemId: string; purchaserName: string; amount: number; code?: string; message?: string | null; coverFee?: boolean; email?: string | null; paymentIntentId?: string }) => {
      return apiClient.post('/api/registry/contribute', { itemId, purchaserName, amount, code, message, coverFee, email, paymentIntentId });
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: registryQueryKey });
      const previousItems = queryClient.getQueryData<RegistryItem[]>(registryQueryKey);
      if (previousItems) {
        queryClient.setQueryData<RegistryItem[]>(registryQueryKey, prev => prev?.map(item => {
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
                  stripePaymentIntentId: variables.paymentIntentId ?? null,
                  stripeChargeId: null,
                  transactionTimestamp: new Date().toISOString(),
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
        queryClient.setQueryData(registryQueryKey, context.previousItems);
      }
    },
    onSuccess: (updatedItem: any) => {
      if (updatedItem && typeof updatedItem === 'object' && typeof updatedItem.id === 'string') {
        queryClient.setQueryData<RegistryItem[]>(registryQueryKey, old =>
          old?.map(item => item.id === updatedItem.id ? updatedItem : item)
        );
      }
      queryClient.invalidateQueries({ queryKey: ['admin-registry'] });
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

  const effectivePriceRange = useMemo<[number, number]>(
    () => (priceRangeUserSet ? priceRange : [minPrice, maxPrice]),
    [priceRangeUserSet, priceRange, minPrice, maxPrice]
  );

  const filteredItems = useMemo(() => {
    const trimmedQuery = searchQuery.trim().toLowerCase();
    const result = categoryFilteredItems.filter(item => {
      const inPrice = item.price >= effectivePriceRange[0] && item.price <= effectivePriceRange[1];
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
  }, [categoryFilteredItems, effectivePriceRange, showGroupGiftsOnly, showAvailableOnly, searchQuery, sortOption]);

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
    if (typeof window === 'undefined' || isLoading) return;

    let cancelled = false;

    const resolveTargetItem = async (targetId: string) => {
      const match = items.find(i => i.id === targetId);
      if (match) {
        if (!cancelled) {
          setSelectedItem(match);
          setIsModalOpen(true);
        }
        return;
      }

      if (attemptedDeepLinkIds.current.has(targetId)) {
        return;
      }
      attemptedDeepLinkIds.current.add(targetId);

      try {
        const fetchedItem = await apiClient.get<RegistryItem>(`/api/registry/items/${encodeURIComponent(targetId)}`);
        if (!cancelled && fetchedItem && typeof fetchedItem === 'object' && fetchedItem.id === targetId) {
          setSelectedItem(fetchedItem);
          setIsModalOpen(true);
        }
      } catch {
        // Ignore missing or unreachable deep-linked item IDs
      }
    };

    const syncModalWithUrl = (isPopState = false) => {
      const searchParams = new URLSearchParams(window.location.search);
      const targetId = searchParams.get('item');
      if (targetId) {
        void resolveTargetItem(targetId);
      } else if (isPopState) {
        setIsModalOpen(false);
        setSelectedItem(null);
      }
    };

    const handlePopState = () => syncModalWithUrl(true);

    syncModalWithUrl(false);

    window.addEventListener('popstate', handlePopState);
    return () => {
      cancelled = true;
      window.removeEventListener('popstate', handlePopState);
    };
  }, [items, isLoading]);

  const handleEdit = useCallback((id: string) => {
    router.push(`/registry/edit-item/${id}`);
  }, [router]);

  const handleDelete = useCallback(async (id: string) => {
    if (await confirm('Are you sure you want to delete this item?')) {
      deleteItem(id);
    }
  }, [deleteItem, confirm]);

  const handleContribute = useCallback(async (
    itemId: string,
    purchaserName: string,
    amount: number,
    code?: string,
    message?: string,
    coverFee?: boolean,
    email?: string,
    paymentIntentId?: string
  ) => {
    return new Promise<void>((resolve, reject) => {
      contribute({ itemId, purchaserName, amount, code, message, coverFee, email, paymentIntentId }, {
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
    setPriceRange([minPrice, maxPrice]);
    setPriceRangeUserSet(false);
    setShowGroupGiftsOnlyState(false);
    setShowAvailableOnlyState(false);
    setSearchQueryState('');
    setSortOptionState('default');
    setVisibleItemsCount(INITIAL_VISIBLE_ITEMS);
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
    priceRange: effectivePriceRange,
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
