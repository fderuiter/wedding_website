import { RegistryItem } from '@/types/registry';

/**
 * Filters a list of registry items based on selected categories and a price range.
 *
 * @param items - The array of registry items to filter.
 * @param categoryFilter - An array of selected category strings. If empty, all categories are included.
 * @param priceRange - A tuple representing the minimum and maximum price range.
 * @returns A new array of registry items that match the filter criteria.
 */
export function filterRegistryItems(
  items: RegistryItem[],
  categoryFilter: string[],
  priceRange: [number, number]
): RegistryItem[] {
  return items.filter(item => {
    const inCategory = categoryFilter.length === 0 || categoryFilter.includes(item.category);
    const inPrice = item.price >= priceRange[0] && item.price <= priceRange[1];
    return inCategory && inPrice;
  });
}
