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
import { CARD_PROCESSING_FEE_RATE } from '@/lib/stripe';
import {
  REGISTRY_INITIAL_VISIBLE_ITEMS,
  REGISTRY_MAX_CATALOG_LIMIT,
} from '@/utils/registryPagination';
import { useRegistryCapabilities } from './useRegistryCapabilities';

export type SortOption = 'default' | 'price-asc' | 'price-desc' | 'most-wanted';

const EMPTY_ITEMS: RegistryItem[] = [];

type RegistryQueryData = PaginatedRegistryItems | RegistryItem[];

interface ContributeVariables {
  itemId: string;
  purchaserName: string;
  amount: number;
  code?: string;
  message?: string | null;
  coverFee?: boolean;
  email?: string | null;
  paymentIntentId?: string;
}

function applyOptimisticContribution(item: RegistryItem, variables: ContributeVariables): RegistryItem {
  if (item.id !== variables.itemId) return item;
  if (item.isGroupGift) {
    const newAmount = item.amountContributed + variables.amount;
    const isFund = item.itemType === 'CASH_FUND' || item.itemType === 'EXPERIENCE_FUND';
    const effectiveCoverFee =
      isFund && !variables.paymentIntentId ? false : (variables.coverFee ?? false);
    return {
      ...item,
      amountContributed: Math.min(item.price, newAmount),
      contributors: [
        ...item.contributors,
        {
          name: variables.purchaserName,
          amount: variables.amount,
          coverFee: effectiveCoverFee,
          feeAmount: effectiveCoverFee
            ? Math.round(variables.amount * CARD_PROCESSING_FEE_RATE * 100) / 100
            : 0,
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
  }
  return {
    ...item,
    purchased: true,
    purchaserName: variables.purchaserName,
  };
}

function mapRegistryQueryData(
  data: RegistryQueryData | undefined,
  updater: (_item: RegistryItem) => RegistryItem
): RegistryQueryData | undefined {
  if (!data) return data;
  if (Array.isArray(data)) {
    return data.map(updater);
  }
  if (typeof data === 'object' && Array.isArray(data.items)) {
    return {
      ...data,
      items: data.items.map(updater),
    };
  }
  return data;
}

export function useRegistry() {
  const queryClient = useQueryClient();
  const { confirm } = useToast();
  const {
    cardCheckoutEnabled: detectedCardCheckoutEnabled,
    stripePublishableKey,
    isCapabilitiesLoading,
  } = useRegistryCapabilities();
  const cardCheckoutEnabled = isCapabilitiesLoading ? undefined : detectedCardCheckoutEnabled;
  const [selectedItem, setSelectedItem] = useState<RegistryItem | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [visibleItemsCount, setVisibleItemsCount] = useState(REGISTRY_INITIAL_VISIBLE_ITEMS);
  const [isAdmin, setIsAdmin] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(REGISTRY_MAX_CATALOG_LIMIT);
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 1000]);
  const [showGroupGiftsOnly, setShowGroupGiftsOnlyState] = useState(false);
  const [showAvailableOnly, setShowAvailableOnlyState] = useState(false);
  const [searchQuery, setSearchQueryState] = useState('');
  const [sortOption, setSortOptionState] = useState<SortOption>('default');
  const [priceRangeUserSet, setPriceRangeUserSet] = useState(false);
  const attemptedDeepLinkIds = useRef<Set<string>>(new Set());
  const router = useRouter();

  useEffect(() => {
    let active = true;
    const checkAdminStatus = async () => {
      const admin = await checkAdminClient();
      if (active) {
        setIsAdmin(admin);
      }
    };
    void checkAdminStatus();
    return () => {
      active = false;
    };
  }, []);

  const registryQueryKey = useMemo(() => ['registry-items', page, limit], [page, limit]);

  const endpoint = useMemo(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', String(limit));
    return `/api/registry/items?${params.toString()}`;
  }, [page, limit]);

  const {
    data: queryResult,
    isLoading,
    error,
    refetch,
  } = useQuery<RegistryQueryData, Error>({
    queryKey: registryQueryKey,
    queryFn: async () => apiClient.get<RegistryQueryData>(endpoint),
    placeholderData: (previousData) => previousData,
  });

  const { remove: deleteItem } = useEntityOrchestration<RegistryItem>({
    queryKey: registryQueryKey,
    endpoint: '/api/registry/items',
    invalidateQueryKeys: [['admin-registry'], ['admin-registry-item']],
    entityName: 'registry item',
    apiClient,
    enabled: false,
  });

  const items = useMemo<RegistryItem[]>(() => {
    if (!queryResult) return EMPTY_ITEMS;
    if (Array.isArray(queryResult)) return queryResult;
    if (typeof queryResult === 'object' && Array.isArray(queryResult.items)) {
      return queryResult.items;
    }
    return EMPTY_ITEMS;
  }, [queryResult]);

  const total = useMemo(() => {
    if (queryResult && typeof queryResult === 'object' && 'total' in queryResult && typeof queryResult.total === 'number') {
      return queryResult.total;
    }
    return items.length;
  }, [queryResult, items.length]);

  const totalPages = useMemo(() => {
    if (queryResult && typeof queryResult === 'object' && 'totalPages' in queryResult && typeof queryResult.totalPages === 'number') {
      return queryResult.totalPages;
    }
    return Math.ceil(total / limit) || 1;
  }, [queryResult, total, limit]);

  const {
    categories,
    selectedCategories: categoryFilter,
    setSelectedCategories: setCategoryFilter,
    filteredItems: categoryFilteredItems,
  } = useFilter(items, useCallback((item: RegistryItem) => item.category, []));

  const handleSetCategoryFilter = useCallback((nextCategories: string[]) => {
    setCategoryFilter(nextCategories);
    setVisibleItemsCount(REGISTRY_INITIAL_VISIBLE_ITEMS);
  }, [setCategoryFilter]);

  const handleSetPriceRange = useCallback((range: [number, number]) => {
    setPriceRange(range);
    setPriceRangeUserSet(true);
    setVisibleItemsCount(REGISTRY_INITIAL_VISIBLE_ITEMS);
  }, []);

  const setShowGroupGiftsOnly = useCallback((value: SetStateAction<boolean>) => {
    setShowGroupGiftsOnlyState(value);
    setVisibleItemsCount(REGISTRY_INITIAL_VISIBLE_ITEMS);
  }, []);

  const setShowAvailableOnly = useCallback((value: SetStateAction<boolean>) => {
    setShowAvailableOnlyState(value);
    setVisibleItemsCount(REGISTRY_INITIAL_VISIBLE_ITEMS);
  }, []);

  const setSearchQuery = useCallback((value: SetStateAction<string>) => {
    setSearchQueryState(value);
    setVisibleItemsCount(REGISTRY_INITIAL_VISIBLE_ITEMS);
  }, []);

  const setSortOption = useCallback((value: SetStateAction<SortOption>) => {
    setSortOptionState(value);
    setVisibleItemsCount(REGISTRY_INITIAL_VISIBLE_ITEMS);
  }, []);

  const { mutate: contribute } = useMutation({
    mutationFn: async ({ itemId, purchaserName, amount, code, message, coverFee, email, paymentIntentId }: ContributeVariables) => {
      return apiClient.post('/api/registry/contribute', { itemId, purchaserName, amount, code, message, coverFee, email, paymentIntentId });
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: ['registry-items'] });
      const previousQueries = queryClient.getQueriesData<RegistryQueryData>({ queryKey: ['registry-items'] });
      const previousSelectedItem = selectedItem;

      queryClient.setQueriesData<RegistryQueryData>(
        { queryKey: ['registry-items'] },
        (old) => mapRegistryQueryData(old, (item) => applyOptimisticContribution(item, variables))
      );

      setSelectedItem((prev) =>
        prev && prev.id === variables.itemId ? applyOptimisticContribution(prev, variables) : prev
      );

      return { previousQueries, previousSelectedItem };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousQueries) {
        for (const [queryKey, previousData] of context.previousQueries) {
          queryClient.setQueryData(queryKey, previousData);
        }
      }
      if (context && 'previousSelectedItem' in context) {
        setSelectedItem(context.previousSelectedItem);
      }
    },
    onSuccess: (updatedItem, variables) => {
      if (updatedItem && typeof updatedItem === 'object' && 'id' in updatedItem && updatedItem.id) {
        const nextItem = updatedItem as RegistryItem;
        queryClient.setQueriesData<RegistryQueryData>(
          { queryKey: ['registry-items'] },
          (old) => mapRegistryQueryData(old, (item) => (item.id === nextItem.id ? nextItem : item))
        );
        setSelectedItem((prev) => (prev && prev.id === nextItem.id ? nextItem : prev));
      }
      queryClient.invalidateQueries({ queryKey: ['admin-registry'] });
      queryClient.invalidateQueries({ queryKey: ['admin-registry-item', variables.itemId] });
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
      if (selectedItem?.id === id) {
        handleCloseModal();
      }
      await deleteItem(id);
    }
  }, [deleteItem, confirm, selectedItem?.id, handleCloseModal]);

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
          resolve();
        },
        onError: (error) => {
          reject(error);
        }
      });
    });
  }, [contribute]);

  const handleClearFilters = useCallback(() => {
    setCategoryFilter([]);
    setPriceRange([minPrice, maxPrice]);
    setPriceRangeUserSet(false);
    setShowGroupGiftsOnlyState(false);
    setShowAvailableOnlyState(false);
    setSearchQueryState('');
    setSortOptionState('default');
    setVisibleItemsCount(REGISTRY_INITIAL_VISIBLE_ITEMS);
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
    cardCheckoutEnabled,
    stripePublishableKey,
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
