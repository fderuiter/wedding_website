'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { CategoryFilter } from './CategoryFilter';
import { PriceRangeFilter } from './PriceRangeFilter';

interface RegistryFilterBarProps {
  categories: string[];
  categoryFilter: string[];
  setCategoryFilter: (categories: string[]) => void;
  minPrice: number;
  maxPrice: number;
  priceRange: [number, number];
  setPriceRange: (range: [number, number]) => void;
  showGroupGiftsOnly: boolean;
  setShowGroupGiftsOnly: (value: boolean) => void;
  showAvailableOnly: boolean;
  setShowAvailableOnly: (value: boolean) => void;
}

export function RegistryFilterBar({
  categories,
  categoryFilter,
  setCategoryFilter,
  minPrice,
  maxPrice,
  priceRange,
  setPriceRange,
  showGroupGiftsOnly,
  setShowGroupGiftsOnly,
  showAvailableOnly,
  setShowAvailableOnly,
}: RegistryFilterBarProps) {
  return (
    <motion.nav
      className="sticky top-0 z-30 bg-white/90 dark:bg-gray-800/90 backdrop-blur border-b border-rose-100 dark:border-gray-700 max-w-4xl mx-auto px-2 sm:px-6 mb-10 flex flex-col gap-4 py-4 rounded-xl shadow-md"
      aria-label="Registry Filters"
      role="navigation"
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="flex flex-col md:flex-row md:items-center gap-4">
        <CategoryFilter
          categories={categories}
          selected={categoryFilter}
          onChange={setCategoryFilter}
        />
        <PriceRangeFilter
          min={minPrice}
          max={maxPrice}
          value={priceRange}
          onChange={setPriceRange}
        />
      </div>
      <div className="flex flex-wrap justify-center items-center gap-4 mt-4">
        <div className="flex items-center">
          <input
            type="checkbox"
            id="group-gifts-only"
            checked={showGroupGiftsOnly}
            onChange={(e) => setShowGroupGiftsOnly(e.target.checked)}
            className="h-4 w-4 text-rose-600 border-gray-300 rounded focus:ring-rose-500"
          />
          <label htmlFor="group-gifts-only" className="ml-2 block text-sm text-gray-900 dark:text-gray-100">
            Show only group gifts
          </label>
        </div>
        <div className="flex items-center">
          <input
            type="checkbox"
            id="available-only"
            checked={showAvailableOnly}
            onChange={(e) => setShowAvailableOnly(e.target.checked)}
            className="h-4 w-4 text-rose-600 border-gray-300 rounded focus:ring-rose-500"
          />
          <label htmlFor="available-only" className="ml-2 block text-sm text-gray-900 dark:text-gray-100">
            Show only available gifts
          </label>
        </div>
      </div>
    </motion.nav>
  );
}
