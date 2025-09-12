'use client';

import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RegistryItem } from '@/features/registry/types';
import { checkAdminClient } from '@/utils/adminAuth.client';
import { useRouter } from 'next/navigation';

export function useRegistry() {
  const queryClient = useQueryClient();
  const [selectedItem, setSelectedItem] = useState<RegistryItem | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [visibleItemsCount, setVisibleItemsCount] = useState(12);
  const [isAdmin, setIsAdmin] = useState(false);
  const router = useRouter();

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
  } = useQuery<RegistryItem[], Error>({
    queryKey: ['registry-items'],
    queryFn: async () => {
      const res = await fetch('/api/registry/items');
      if (!res.ok) throw new Error('Failed to fetch registry items');
      return res.json();
    },
  });

  const contributeMutation = useMutation({
    mutationFn: async ({ itemId, purchaserName, amount }: { itemId: string; purchaserName: string; amount: number }) => {
      const res = await fetch('/api/registry/contribute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, purchaserName, amount }),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Contribution failed');
      }
      return res.json();
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
      alert('Error: Could not process contribution.');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['registry-items'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const res = await fetch(`/api/registry/items/${itemId}`, { method: 'DELETE' });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to delete item');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['registry-items'] });
      alert('Item deleted successfully.');
    },
    onError: (error) => {
      alert(`Error deleting item: ${error.message}`);
    },
  });

  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 1000]);
  const [showGroupGiftsOnly, setShowGroupGiftsOnly] = useState(false);
  const [showAvailableOnly, setShowAvailableOnly] = useState(false);

  const categories = useMemo(() => {
    const set = new Set<string>();
    items.forEach(item => set.add(item.category));
    return Array.from(set).sort();
  }, [items]);

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
    return items.filter(item => {
      const inCategory = categoryFilter.length === 0 || categoryFilter.includes(item.category);
      const inPrice = item.price >= priceRange[0] && item.price <= priceRange[1];
      const isGroupGift = !showGroupGiftsOnly || item.isGroupGift;
      const isAvailable = !showAvailableOnly || !item.purchased;
      return inCategory && inPrice && isGroupGift && isAvailable;
    });
  }, [items, categoryFilter, priceRange, showGroupGiftsOnly, showAvailableOnly]);

  const visibleItems = useMemo(() => {
    return filteredItems.slice(0, visibleItemsCount);
  }, [filteredItems, visibleItemsCount]);

  const handleCardClick = (item: RegistryItem) => {
    if (item.purchased) return;
    setSelectedItem(item);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedItem(null);
  };

  const handleEdit = (id: string) => {
    router.push(`/registry/edit-item/${id}`);
  };

  const handleDelete = (id: string) => {
    if (window.confirm('Are you sure you want to delete this item?')) {
      deleteMutation.mutate(id);
    }
  };

  const handleContribute = async (itemId: string, purchaserName: string, amount: number) => {
    return new Promise<void>((resolve, reject) => {
      contributeMutation.mutate({ itemId, purchaserName, amount }, {
        onSuccess: () => {
          handleCloseModal();
          alert('Thank you for your contribution!');
          resolve();
        },
        onError: (error) => {
          reject(error);
        }
      });
    });
  };

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
