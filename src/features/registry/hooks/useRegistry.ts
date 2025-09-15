'use client';

import { useState, useMemo } from 'react';
import toast from 'react-hot-toast';
import { RegistryItem } from '@/features/registry/types';
import { useAdminStatus } from '@/hooks/useAdminStatus';
import { useRegistryItems } from './useRegistryItems';
import { useRegistryFilters } from './useRegistryFilters';
import { useRouter } from 'next/navigation';

export function useRegistry() {
  const [selectedItem, setSelectedItem] = useState<RegistryItem | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [visibleItemsCount, setVisibleItemsCount] = useState(12);
  const isAdmin = useAdminStatus();
  const router = useRouter();

  const {
    items,
    isLoading,
    error,
    contribute,
    deleteItem,
  } = useRegistryItems();

  const {
    filteredItems,
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
  } = useRegistryFilters(items || []);

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
    toast.promise(
      deleteItem.mutateAsync(id),
      {
        loading: 'Deleting item...',
        success: 'Item deleted successfully!',
        error: (err) => `Error deleting item: ${err.message}`,
      }
    );
  };

  const handleContribute = async (itemId: string, purchaserName: string, amount: number) => {
    await toast.promise(
      contribute.mutateAsync({ itemId, purchaserName, amount }),
      {
        loading: 'Processing contribution...',
        success: () => {
          handleCloseModal();
          return 'Thank you for your contribution!';
        },
        error: (err) => `Error: ${err.message}`,
      }
    );
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
