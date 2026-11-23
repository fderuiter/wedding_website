'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { SetStateAction } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import { useToast } from '@/components/ui/ToastProvider';
import {
  RegistryItem,
  PaginatedRegistryItems,
  OrderTrackingDetails,
  GuestClaimActions,
  RedirectReconciliationState,
} from '../types';
import { checkAdminClient } from '@/core/auth/auth.client';

import { apiClient } from '@/lib/apiClient';
import { useEntityOrchestration } from '@/hooks/useEntityOrchestration';

import { useFilter } from '@/hooks/useFilter';
import { CARD_PROCESSING_FEE_RATE } from '@/lib/stripe.client';
import {
  REGISTRY_INITIAL_VISIBLE_ITEMS,
  REGISTRY_MAX_CATALOG_LIMIT,
} from '@/utils/registryPagination';
import { useRegistryCapabilities } from './useRegistryCapabilities';
import { getItemTotalTargetAmount } from '../lib/registryStatusUtils';

export type SortOption = 'default' | 'price-asc' | 'price-desc' | 'most-wanted';

const EMPTY_ITEMS: RegistryItem[] = [];
const REGISTRY_QUERY_KEY = ['registry-items', 1, REGISTRY_MAX_CATALOG_LIMIT] as const;
const REGISTRY_ITEMS_ENDPOINT = `/api/registry/items?page=1&limit=${REGISTRY_MAX_CATALOG_LIMIT}`;

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
  retailerOrderNumber?: string;
  carrier?: string;
  trackingNumber?: string;
}

function applyOptimisticContribution(item: RegistryItem, variables: ContributeVariables): RegistryItem {
  if (item.id !== variables.itemId) return item;
  const totalTargetAmount = getItemTotalTargetAmount(item);
  const newAmount = (item.amountContributed || 0) + variables.amount;
  if (item.isGroupGift) {
    const isFund = item.itemType === 'CASH_FUND' || item.itemType === 'EXPERIENCE_FUND';
    const isPayableGroupGift = Boolean(isFund || item.isGroupGift);
    const effectiveCoverFee =
      isPayableGroupGift && !variables.paymentIntentId ? false : (variables.coverFee ?? false);
    return {
      ...item,
      amountContributed: Math.min(totalTargetAmount, newAmount),
      contributors: [
        ...item.contributors,
        {
          name: variables.purchaserName,
          amount: variables.amount,
          refundedAmount: 0,
          status: variables.paymentIntentId ? 'CONFIRMED' : 'RESERVED',
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
      purchased: newAmount >= totalTargetAmount,
    };
  }
  return {
    ...item,
    amountContributed: Math.min(totalTargetAmount, newAmount),
    purchased: newAmount >= totalTargetAmount,
    purchaserName: item.purchaserName
      ? `${item.purchaserName}, ${variables.purchaserName}`
      : variables.purchaserName,
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
    defaultPaymentHandleType: detectedDefaultPaymentHandleType,
    defaultPaymentHandle: detectedDefaultPaymentHandle,
    shippingAddress: detectedShippingAddress,
    isCapabilitiesLoading,
  } = useRegistryCapabilities();
  const cardCheckoutEnabled = isCapabilitiesLoading ? undefined : detectedCardCheckoutEnabled;
  const defaultPaymentHandleType = isCapabilitiesLoading ? null : detectedDefaultPaymentHandleType;
  const defaultPaymentHandle = isCapabilitiesLoading ? null : detectedDefaultPaymentHandle;
  const shippingAddress = isCapabilitiesLoading ? null : detectedShippingAddress;
  const [selectedItem, setSelectedItem] = useState<RegistryItem | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [redirectReconciliation, setRedirectReconciliation] =
    useState<RedirectReconciliationState | null>(null);
  const [visibleItemsCount, setVisibleItemsCount] = useState(REGISTRY_INITIAL_VISIBLE_ITEMS);
  const [isAdmin, setIsAdmin] = useState(false);
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 1000]);
  const [showGroupGiftsOnly, setShowGroupGiftsOnlyState] = useState(false);
  const [showAvailableOnly, setShowAvailableOnlyState] = useState(false);
  const [searchQuery, setSearchQueryState] = useState('');
  const [sortOption, setSortOptionState] = useState<SortOption>('default');
  const [priceRangeUserSet, setPriceRangeUserSet] = useState(false);
  const attemptedDeepLinkIds = useRef<Set<string>>(new Set());
  const reconciledPaymentIntentsRef = useRef<Set<string>>(new Set());
  const reconciledItemRef = useRef<RegistryItem | null>(null);
  const isMountedRef = useRef(true);
  const router = useRouter();

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

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

  const {
    data: queryResult,
    isLoading,
    error,
    refetch,
  } = useQuery<RegistryQueryData, Error>({
    queryKey: REGISTRY_QUERY_KEY,
    queryFn: async () => apiClient.get<RegistryQueryData>(REGISTRY_ITEMS_ENDPOINT),
    placeholderData: (previousData) => previousData,
  });

  const { remove: deleteItem } = useEntityOrchestration<RegistryItem>({
    queryKey: REGISTRY_QUERY_KEY,
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
    mutationFn: async ({
      itemId,
      purchaserName,
      amount,
      code,
      message,
      coverFee,
      email,
      paymentIntentId,
      retailerOrderNumber,
      carrier,
      trackingNumber,
    }: ContributeVariables) => {
      return apiClient.post('/api/registry/contribute', {
        itemId,
        purchaserName,
        amount,
        code,
        message,
        coverFee,
        email,
        paymentIntentId,
        ...(retailerOrderNumber ? { retailerOrderNumber } : {}),
        ...(carrier ? { carrier } : {}),
        ...(trackingNumber ? { trackingNumber } : {}),
      });
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
        const { claimActions: _claimActions, ...itemFields } = updatedItem as RegistryItem & {
          claimActions?: GuestClaimActions;
        };
        const nextItem = itemFields as RegistryItem;
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

  const syncItemInCache = useCallback((nextItem: RegistryItem) => {
    if (!nextItem || !nextItem.id) return;
    queryClient.setQueriesData<RegistryQueryData>(
      { queryKey: ['registry-items'] },
      (old) => mapRegistryQueryData(old, (item) => (item.id === nextItem.id ? nextItem : item))
    );
    setSelectedItem((prev) => (prev && prev.id === nextItem.id ? nextItem : prev));
    queryClient.invalidateQueries({ queryKey: ['admin-registry'] });
    queryClient.invalidateQueries({ queryKey: ['admin-registry-item', nextItem.id] });
  }, [queryClient]);

  const handleCardClick = useCallback((item: RegistryItem) => {
    reconciledItemRef.current = null;
    setRedirectReconciliation(null);
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
    reconciledItemRef.current = null;
    setRedirectReconciliation(null);
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
    if (typeof window === 'undefined') return;

    const searchParams = new URLSearchParams(window.location.search);
    const paymentIntentId = searchParams.get('payment_intent')?.trim() || '';
    const clientSecret = searchParams.get('payment_intent_client_secret')?.trim() || '';
    const redirectStatus = searchParams.get('redirect_status')?.trim() || '';
    const itemParam = searchParams.get('item')?.trim() || '';

    const hasStripeRedirectParams = Boolean(paymentIntentId || clientSecret || redirectStatus);
    if (!hasStripeRedirectParams) {
      return;
    }

    searchParams.delete('payment_intent');
    searchParams.delete('payment_intent_client_secret');
    searchParams.delete('redirect_status');
    const cleanQuery = searchParams.toString();
    const cleanUrl = cleanQuery
      ? `${window.location.pathname}?${cleanQuery}`
      : window.location.pathname;
    window.history.replaceState({}, '', cleanUrl);

    if (!paymentIntentId || !clientSecret) {
      if (redirectStatus === 'failed' || redirectStatus === 'processing') {
        queueMicrotask(() => {
          if (!isMountedRef.current) return;
          setRedirectReconciliation({
            status: redirectStatus,
            ...(paymentIntentId ? { paymentIntentId } : {}),
            ...(itemParam ? { itemId: itemParam } : {}),
            ...(redirectStatus === 'failed'
              ? {
                failureMessage:
                  'Your payment could not be completed. Please review your payment details and try again.',
              }
              : {}),
          });
        });
      }
      return;
    }

    const dedupeKey = `${paymentIntentId}:${clientSecret}`;
    if (reconciledPaymentIntentsRef.current.has(dedupeKey)) {
      return;
    }
    reconciledPaymentIntentsRef.current.add(dedupeKey);

    const reconcileRedirect = async () => {
      await Promise.resolve();
      if (!isMountedRef.current) return;

      setRedirectReconciliation({
        status: 'reconciling',
        paymentIntentId,
        ...(itemParam ? { itemId: itemParam } : {}),
      });

      try {
        const response = await apiClient.post<{
          status: 'succeeded' | 'processing' | 'failed';
          recorded: boolean;
          paymentIntentId: string;
          itemId: string;
          amount?: number;
          coverFee?: boolean;
          contributorName?: string;
          failureMessage?: string;
          item?: RegistryItem | null;
        }>('/api/registry/reconcile', {
          paymentIntentId,
          clientSecret,
          ...(itemParam ? { itemId: itemParam } : {}),
        });

        if (!isMountedRef.current || !response) return;

        if (response.item && response.item.id) {
          reconciledItemRef.current = response.item;
          syncItemInCache(response.item);
          setSelectedItem(response.item);
          setIsModalOpen(true);
          if (!itemParam && typeof window !== 'undefined') {
            const nextParams = new URLSearchParams(window.location.search);
            nextParams.set('item', response.item.id);
            window.history.replaceState({}, '', `${window.location.pathname}?${nextParams.toString()}`);
          }
          void queryClient.invalidateQueries({ queryKey: ['admin-registry'] });
          void queryClient.invalidateQueries({ queryKey: ['admin-registry-item', response.item.id] });
        }

        setRedirectReconciliation({
          status: response.status,
          paymentIntentId: response.paymentIntentId || paymentIntentId,
          itemId: response.itemId || response.item?.id || itemParam || undefined,
          ...(typeof response.amount === 'number' ? { amount: response.amount } : {}),
          ...(typeof response.coverFee === 'boolean' ? { coverFee: response.coverFee } : {}),
          ...(response.contributorName ? { contributorName: response.contributorName } : {}),
          ...(response.failureMessage ? { failureMessage: response.failureMessage } : {}),
        });
      } catch {
        if (!isMountedRef.current) return;
        setRedirectReconciliation({
          status: redirectStatus === 'processing' ? 'processing' : 'failed',
          paymentIntentId,
          ...(itemParam ? { itemId: itemParam } : {}),
          ...(redirectStatus !== 'processing'
            ? {
              failureMessage:
                'Your payment could not be verified automatically. Please check your card statement or try again below.',
            }
            : {}),
        });
      }
    };

    void reconcileRedirect();
  }, [queryClient, syncItemInCache]);

  useEffect(() => {
    if (typeof window === 'undefined' || isLoading) return;

    let cancelled = false;

    const resolveTargetItem = async (targetId: string) => {
      const reconciledItem =
        reconciledItemRef.current?.id === targetId ? reconciledItemRef.current : null;
      const match = items.find(i => i.id === targetId);
      if (match) {
        if (!cancelled) {
          const preferredItem =
            reconciledItem &&
            ((reconciledItem.purchased && !match.purchased) ||
              (reconciledItem.amountContributed ?? 0) > (match.amountContributed ?? 0))
              ? reconciledItem
              : match;
          setSelectedItem(preferredItem);
          setIsModalOpen(true);
        }
        return;
      }

      if (reconciledItem) {
        if (!cancelled) {
          setSelectedItem(reconciledItem);
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
    paymentIntentId?: string,
    orderDetails?: OrderTrackingDetails
  ) => {
    return new Promise<unknown>((resolve, reject) => {
      contribute(
        {
          itemId,
          purchaserName,
          amount,
          code,
          message,
          coverFee,
          email,
          paymentIntentId,
          retailerOrderNumber: orderDetails?.retailerOrderNumber || undefined,
          carrier: orderDetails?.carrier || undefined,
          trackingNumber: orderDetails?.trackingNumber || undefined,
        },
        {
          onSuccess: (data) => {
            resolve(data);
          },
          onError: (error) => {
            reject(error);
          },
        }
      );
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
  }, [setCategoryFilter, minPrice, maxPrice]);

  return {
    items,
    isLoading,
    error,
    refetch,
    selectedItem,
    isModalOpen,
    redirectReconciliation,
    setVisibleItemsCount,
    isAdmin,
    cardCheckoutEnabled,
    stripePublishableKey,
    defaultPaymentHandleType,
    defaultPaymentHandle,
    shippingAddress,
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
    syncItemInCache,
  };
}
