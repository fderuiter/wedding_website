'use client';

import { useState, useEffect, useMemo } from 'react';
import { RegistryItem } from '@/features/registry/types';

export function useRegistryFilters(items: RegistryItem[]) {
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

  return {
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
  };
}
