'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { useToast } from '@/components/ui/ToastProvider';
import { RegistryItem } from '@/features/registry/types';
import { checkAdminClient } from '@/features/admin/auth.client';

import { apiClient } from '@/lib/apiClient';
import { useEntityOrchestration } from '@/hooks/useEntityOrchestration';

import { useFilter } from '@/hooks/useFilter';

export function useRegistry() {
  const queryClient = useQueryClient();
  const { confirm } = useToast();
  const [selectedItem, setSelectedItem] = useState<RegistryItem | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [visibleItemsCount, setVisibleItemsCount] = useState(12);
  const [isAdmin, setIsAdmin] = useState(false);
  

  useEffect(() => {
    const checkAdminStatus = async () => {
      const admin = await checkAdminClient();
      setIsAdmin(admin);
    };
    checkAdminStatus();
  }, []);

  const {
    data: items = [],
    isLoading,
    error,
    remove: deleteItem,
  } = useEntityOrchestration<RegistryItem>({
    queryKey: ['registry-items'],
    endpoint: '/api/registry/items',
    entityName: 'registry item',
    apiClient,
  });

  const { mutate: contribute } = useMutation({
    mutationFn: async ({ itemId, purchaserName, amount }: { itemId: string; purchaserName: string; amount: number }) => {
      return apiClient.post('/api/registry/contribute', { itemId, purchaserName, amount });
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
              contributors: [...item.contributors, { name: variables.purchaserName, amount: variables.amount, date: new Date().toISOString() }],
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

  const [priceRange, setPriceRange] = useState<[number, number]>([0, 1000]);
  const [showGroupGiftsOnly, setShowGroupGiftsOnly] = useState(false);
  const [showAvailableOnly, setShowAvailableOnly] = useState(false);

  const {
    categories,
    selectedCategories: categoryFilter,
    setSelectedCategories: setCategoryFilter,
    filteredItems: categoryFilteredItems,
  } = useFilter(items, useCallback((item: RegistryItem) => item.category, []));

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
    setPriceRange([minPrice, maxPrice]);
  }, [minPrice, maxPrice]);

  const filteredItems = useMemo(() => {
    return categoryFilteredItems.filter(item => {
      const inPrice = item.price >= priceRange[0] && item.price <= priceRange[1];
      const isGroupGift = !showGroupGiftsOnly || item.isGroupGift;
      const isAvailable = !showAvailableOnly || !item.purchased;
      return inPrice && isGroupGift && isAvailable;
    });
  }, [categoryFilteredItems, priceRange, showGroupGiftsOnly, showAvailableOnly]);

  const visibleItems = useMemo(() => {
    return filteredItems.slice(0, visibleItemsCount);
  }, [filteredItems, visibleItemsCount]);

  const handleCardClick = useCallback((item: RegistryItem) => {
    if (item.purchased) return;
    setSelectedItem(item);
    setIsModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    setSelectedItem(null);
  }, []);

  const handleEdit = useCallback((id: string) => {
    router.push(`/registry/edit-item/${id}`);
  }, [router]);

  const handleDelete = useCallback(async (id: string) => {
    if (await confirm('Are you sure you want to delete this item?')) {
      deleteItem(id);
    }
  }, [deleteItem, confirm]);

  const handleContribute = useCallback(async (itemId: string, purchaserName: string, amount: number) => {
    return new Promise<void>((resolve, reject) => {
      contribute({ itemId, purchaserName, amount }, {
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

  return {
    items,
    isLoading,
    error,
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
    setCategoryFilter,
    priceRange,
    setPriceRange,
    showGroupGiftsOnly,
    setShowGroupGiftsOnly,
    showAvailableOnly,
    setShowAvailableOnly,
    handleCardClick,
    handleCloseModal,
    handleEdit,
    handleDelete,
    handleContribute,
  };
}
