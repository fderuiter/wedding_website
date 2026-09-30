import { renderHook, act } from '@testing-library/react';
import { useFilter } from '../useFilter';

interface TestItem {
  id: string;
  name: string;
  category?: string | null;
}

describe('useFilter', () => {
  const sampleItems: TestItem[] = [
    { id: '1', name: 'Item 1', category: 'Food' },
    { id: '2', name: 'Item 2', category: 'Activities' },
    { id: '3', name: 'Item 3', category: 'Food' },
    { id: '4', name: 'Item 4', category: 'Stay' },
    { id: '5', name: 'Item 5', category: null },
    { id: '6', name: 'Item 6', category: undefined },
  ];

  const categoryExtractor = (item: TestItem) => item.category ?? '';

  it('extracts unique, sorted categories from items', () => {
    const { result } = renderHook(() => useFilter(sampleItems, categoryExtractor));

    expect(result.current.categories).toEqual(['Activities', 'Food', 'Stay']);
  });

  it('returns exact original items reference when no categories are selected', () => {
    const { result } = renderHook(() => useFilter(sampleItems, categoryExtractor));

    expect(result.current.selectedCategories).toEqual([]);
    expect(result.current.filteredItems).toBe(sampleItems);
  });

  it('filters items correctly for a single selected category', () => {
    const { result } = renderHook(() => useFilter(sampleItems, categoryExtractor));

    act(() => {
      result.current.setSelectedCategories(['Food']);
    });

    expect(result.current.selectedCategories).toEqual(['Food']);
    expect(result.current.filteredItems).toEqual([
      { id: '1', name: 'Item 1', category: 'Food' },
      { id: '3', name: 'Item 3', category: 'Food' },
    ]);
  });

  it('filters items correctly for multiple selected categories in original sequence', () => {
    const { result } = renderHook(() => useFilter(sampleItems, categoryExtractor));

    act(() => {
      result.current.setSelectedCategories(['Stay', 'Activities']);
    });

    expect(result.current.filteredItems).toEqual([
      { id: '2', name: 'Item 2', category: 'Activities' },
      { id: '4', name: 'Item 4', category: 'Stay' },
    ]);
  });

  it('returns empty array when selected categories match no items', () => {
    const { result } = renderHook(() => useFilter(sampleItems, categoryExtractor));

    act(() => {
      result.current.setSelectedCategories(['NonExistentCategory']);
    });

    expect(result.current.filteredItems).toEqual([]);
  });

  it('ignores items with null or undefined categories when category filtering is active', () => {
    const itemsWithNulls: TestItem[] = [
      { id: '1', name: 'Valid Item', category: 'Food' },
      { id: '2', name: 'Null Category', category: null },
      { id: '3', name: 'Undefined Category', category: undefined },
    ];

    const { result } = renderHook(() =>
      useFilter(itemsWithNulls, (item) => (item.category as string))
    );

    act(() => {
      result.current.setSelectedCategories(['Food']);
    });

    expect(result.current.filteredItems).toEqual([
      { id: '1', name: 'Valid Item', category: 'Food' },
    ]);
  });

  it('updates filtered items when setSelectedCategories is called repeatedly', () => {
    const { result } = renderHook(() => useFilter(sampleItems, categoryExtractor));

    act(() => {
      result.current.setSelectedCategories(['Food']);
    });
    expect(result.current.filteredItems.length).toBe(2);

    act(() => {
      result.current.setSelectedCategories(['Food', 'Stay']);
    });
    expect(result.current.filteredItems.length).toBe(3);

    act(() => {
      result.current.setSelectedCategories([]);
    });
    expect(result.current.filteredItems).toBe(sampleItems);
  });
});
