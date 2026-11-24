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
  ContributorAddressDetails,
  GuestClaimActions,
  ReconciledContributionReceipt,
  ReconcilePaymentIntentResponse,
} from '../types';
import { checkAdminClient } from '@/core/auth/auth.client';
import { useOptionalDemo } from '@/components/demo/DemoContext';

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
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
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
  const demo = useOptionalDemo();
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
  const [reconciledReceipt, setReconciledReceipt] = useState<ReconciledContributionReceipt | null>(
    null
  );
  const [reconciledItems, setReconciledItems] = useState<Record<string, RegistryItem>>({});
  const [redirectRecoveryState, setRedirectRecoveryState] = useState<{
    itemId: string | null;
    message: string;
  } | null>(null);
  const [visibleItemsCount, setVisibleItemsCount] = useState(REGISTRY_INITIAL_VISIBLE_ITEMS);
  const [isAdmin, setIsAdmin] = useState(false);
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 1000]);
  const [showGroupGiftsOnly, setShowGroupGiftsOnlyState] = useState(false);
  const [showAvailableOnly, setShowAvailableOnlyState] = useState(false);
  const [searchQuery, setSearchQueryState] = useState('');
  const [sortOption, setSortOptionState] = useState<SortOption>('default');
  const [priceRangeUserSet, setPriceRangeUserSet] = useState(false);
  const attemptedDeepLinkIds = useRef<Set<string>>(new Set());
  const reconciledIntentKeysRef = useRef<Set<string>>(new Set());
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
  }, [demo?.persona]);

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

  const isDemoMode = Boolean(demo?.isDemoMode);
  const demoRegistryItems = demo?.activeDataset.registryItems;

  const items = useMemo<RegistryItem[]>(() => {
    if (isDemoMode && demoRegistryItems) {
      return demoRegistryItems;
    }
    let baseItems: RegistryItem[] = EMPTY_ITEMS;
    if (Array.isArray(queryResult)) {
      baseItems = queryResult;
    } else if (queryResult && typeof queryResult === 'object' && Array.isArray(queryResult.items)) {
      baseItems = queryResult.items;
    }
    if (baseItems.length === 0 || Object.keys(reconciledItems).length === 0) {
      return baseItems;
    }
    return baseItems.map((item) => {
      const reconciled = reconciledItems[item.id];
      if (
        reconciled &&
        (reconciled.amountContributed ?? 0) >= (item.amountContributed ?? 0)
      ) {
        return reconciled;
      }
      return item;
    });
  }, [demoRegistryItems, isDemoMode, queryResult, reconciledItems]);

  const effectiveSelectedItem = useMemo<RegistryItem | null>(() => {
    if (!selectedItem) return null;
    if (isDemoMode && demoRegistryItems) {
      return demoRegistryItems.find((i) => i.id === selectedItem.id) ?? null;
    }
    const reconciled = reconciledItems[selectedItem.id];
    if (
      reconciled &&
      (reconciled.amountContributed ?? 0) >= (selectedItem.amountContributed ?? 0)
    ) {
      return reconciled;
    }
    return selectedItem;
  }, [demoRegistryItems, isDemoMode, reconciledItems, selectedItem]);

  const redirectRecoveryError = useMemo<string | null>(() => {
    if (!redirectRecoveryState) return null;
    if (
      redirectRecoveryState.itemId &&
      effectiveSelectedItem &&
      redirectRecoveryState.itemId !== effectiveSelectedItem.id
    ) {
      return null;
    }
    return redirectRecoveryState.message;
  }, [effectiveSelectedItem, redirectRecoveryState]);

  const effectiveIsModalOpen = isModalOpen && Boolean(effectiveSelectedItem);

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
      addressLine1,
      addressLine2,
      city,
      state,
      zipCode,
      country,
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
        ...(addressLine1 ? { addressLine1 } : {}),
        ...(addressLine2 ? { addressLine2 } : {}),
        ...(city ? { city } : {}),
        ...(state ? { state } : {}),
        ...(zipCode ? { zipCode } : {}),
        ...(country ? { country } : {}),
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

  const handleCardClick = useCallback((item: RegistryItem) => {
    setReconciledReceipt((prev) => (prev && prev.itemId === item.id ? prev : null));
    setRedirectRecoveryState(null);
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
    setReconciledReceipt(null);
    setRedirectRecoveryState(null);
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

  const syncItemInCache = useCallback((nextItem: RegistryItem) => {
    if (!nextItem || !nextItem.id) return;
    setReconciledItems((prev) => ({ ...prev, [nextItem.id]: nextItem }));
    queryClient.setQueriesData<RegistryQueryData>(
      { queryKey: ['registry-items'] },
      (old) => mapRegistryQueryData(old, (item) => (item.id === nextItem.id ? nextItem : item))
    );
    setSelectedItem((prev) => (prev && prev.id === nextItem.id ? nextItem : prev));
    queryClient.invalidateQueries({ queryKey: ['admin-registry'] });
    queryClient.invalidateQueries({ queryKey: ['admin-registry-item', nextItem.id] });
  }, [queryClient]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const searchParams = new URLSearchParams(window.location.search);
    const targetItemParam = searchParams.get('item');
    const paymentIntentId = searchParams.get('payment_intent');
    const clientSecret = searchParams.get('payment_intent_client_secret');
    const redirectStatus = searchParams.get('redirect_status');
    const hasStripeRedirectParams = Boolean(
      paymentIntentId ||
        clientSecret ||
        redirectStatus ||
        searchParams.has('source_redirect_slug')
    );

    if (!hasStripeRedirectParams) {
      return;
    }

    searchParams.delete('payment_intent');
    searchParams.delete('payment_intent_client_secret');
    searchParams.delete('redirect_status');
    searchParams.delete('source_redirect_slug');

    const cleanedQuery = searchParams.toString();
    const cleanedUrl = cleanedQuery
      ? `${window.location.pathname}?${cleanedQuery}`
      : window.location.pathname;
    window.history.replaceState(window.history.state ?? {}, '', cleanedUrl);

    const ensureItemQueryParam = (resolvedItemId: string) => {
      if (typeof window === 'undefined' || !resolvedItemId) return;
      const nextParams = new URLSearchParams(window.location.search);
      if (nextParams.get('item') !== resolvedItemId) {
        nextParams.set('item', resolvedItemId);
        window.history.replaceState(
          window.history.state ?? {},
          '',
          `${window.location.pathname}?${nextParams.toString()}`
        );
      }
    };

    const normalizedStatus = redirectStatus?.trim().toLowerCase() ?? '';
    const isExplicitNonSucceeded =
      normalizedStatus.length > 0 && normalizedStatus !== 'succeeded';

    if (isExplicitNonSucceeded) {
      const recoveryMessage =
        normalizedStatus === 'canceled' || normalizedStatus === 'cancelled'
          ? 'Your payment was canceled before completion. No contribution was recorded — you can try again below or choose another payment method.'
          : 'Your payment could not be completed. No contribution was recorded — please check your payment details and try again.';

      if (targetItemParam) {
        queueMicrotask(() => {
          setReconciledReceipt(null);
          setRedirectRecoveryState({
            itemId: targetItemParam,
            message: recoveryMessage,
          });
        });
        return;
      }

      if (paymentIntentId && clientSecret) {
        const dedupeKey = `${paymentIntentId}:${clientSecret}:failed`;
        if (reconciledIntentKeysRef.current.has(dedupeKey)) {
          return;
        }
        reconciledIntentKeysRef.current.add(dedupeKey);

        void (async () => {
          try {
            const res = await apiClient.post<ReconcilePaymentIntentResponse>(
              '/api/registry/payment-intent/reconcile',
              { paymentIntentId, clientSecret }
            );
            const fallbackItemId = res?.itemId ?? null;
            if (fallbackItemId) {
              ensureItemQueryParam(fallbackItemId);
              const fetchedItem = await apiClient
                .get<RegistryItem>(`/api/registry/items/${encodeURIComponent(fallbackItemId)}`)
                .catch(() => null);
              if (fetchedItem && fetchedItem.id === fallbackItemId) {
                setSelectedItem(fetchedItem);
                setIsModalOpen(true);
              }
            }
            setReconciledReceipt(null);
            setRedirectRecoveryState({
              itemId: fallbackItemId,
              message: res?.error || recoveryMessage,
            });
          } catch {
            setReconciledReceipt(null);
            setRedirectRecoveryState({
              itemId: null,
              message: recoveryMessage,
            });
          }
        })();
      }
      return;
    }

    if (!paymentIntentId || !clientSecret) {
      if (targetItemParam) {
        queueMicrotask(() => {
          setReconciledReceipt(null);
          setRedirectRecoveryState({
            itemId: targetItemParam,
            message:
              'We could not verify your payment redirect details. No contribution was recorded — please check your confirmation email or try again.',
          });
        });
      }
      return;
    }

    const dedupeKey = `${paymentIntentId}:${clientSecret}`;
    if (reconciledIntentKeysRef.current.has(dedupeKey)) {
      return;
    }
    reconciledIntentKeysRef.current.add(dedupeKey);

    void (async () => {
      try {
        const res = await apiClient.post<ReconcilePaymentIntentResponse>(
          '/api/registry/payment-intent/reconcile',
          {
            paymentIntentId,
            clientSecret,
            ...(targetItemParam ? { itemId: targetItemParam } : {}),
          }
        );

        if (res?.reconciled && res.item && res.receipt) {
          ensureItemQueryParam(res.item.id);
          syncItemInCache(res.item);
          setRedirectRecoveryState(null);
          setReconciledReceipt(res.receipt);
          setSelectedItem(res.item);
          setIsModalOpen(true);
          return;
        }

        const unresolvedItemId = res?.itemId ?? targetItemParam ?? null;
        if (unresolvedItemId) {
          ensureItemQueryParam(unresolvedItemId);
        }
        setReconciledReceipt(null);
        setRedirectRecoveryState({
          itemId: unresolvedItemId,
          message:
            res?.error ||
            'Your payment has not settled yet. No contribution was recorded — please try again or choose another payment method.',
        });
      } catch (err: unknown) {
        const errorMessage =
          err instanceof Error && err.message
            ? err.message
            : 'Unable to verify your payment right now. Please check your confirmation email or try again.';
        setReconciledReceipt(null);
        setRedirectRecoveryState({
          itemId: targetItemParam ?? null,
          message: errorMessage,
        });
      }
    })();
  }, [syncItemInCache]);

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
        setReconciledReceipt(null);
        setRedirectRecoveryState(null);
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
    orderDetails?: OrderTrackingDetails,
    addressDetails?: ContributorAddressDetails
  ) => {
    setReconciledItems((prev) => {
      if (!(itemId in prev)) return prev;
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
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
          addressLine1: addressDetails?.addressLine1 || undefined,
          addressLine2: addressDetails?.addressLine2 || undefined,
          city: addressDetails?.city || undefined,
          state: addressDetails?.state || undefined,
          zipCode: addressDetails?.zipCode || undefined,
          country: addressDetails?.country || undefined,
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
    selectedItem: effectiveSelectedItem,
    isModalOpen: effectiveIsModalOpen,
    reconciledReceipt,
    redirectRecoveryError,
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
