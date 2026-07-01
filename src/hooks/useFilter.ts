import { useState, useMemo } from 'react';

/**
 * A generic hook for extracting categories and filtering items based on multiple selected categories.
 * 
 * @param items The array of items to filter.
 * @param categoryExtractor A function to extract the category from an item.
 * @returns An object containing the available categories, selected categories state, and the filtered items.
 */
export function useFilter<T>(items: T[], categoryExtractor: (item: T) => string) {
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    items.forEach(item => {
      const category = categoryExtractor(item);
      if (category) {
        set.add(category);
      }
    });
    return Array.from(set).sort();
  }, [items, categoryExtractor]);

  const filteredItems = useMemo(() => {
    if (selectedCategories.length === 0) {
      return items;
    }
    return items.filter(item => {
      const category = categoryExtractor(item);
      return selectedCategories.includes(category);
    });
  }, [items, selectedCategories, categoryExtractor]);

  return {
    categories,
    selectedCategories,
    setSelectedCategories,
    filteredItems,
  };
}
