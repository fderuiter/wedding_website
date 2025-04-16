import { RegistryItem } from '@/types/registry';

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
