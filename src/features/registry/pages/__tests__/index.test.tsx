import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import RegistryPage from '../index';
import { useRegistry } from '../../hooks/useRegistry';
import { RegistryItem } from '../../types';
import { createMockMedia } from '@/testing/factories/mediaFactory';
import { createMockRegistryItem } from '@/testing/factories/registryFactory';

// Mock useRegistry hook
jest.mock('../../hooks/useRegistry', () => ({
  useRegistry: jest.fn(),
}));

describe('RegistryPage Dialog integration', () => {
  const mockItem: RegistryItem = createMockRegistryItem({
    id: 'item-101',
    name: 'KitchenAid Stand Mixer',
    description: 'Professional 5-quart stand mixer in artisan red.',
    price: 350,
    category: 'Kitchen',
    isGroupGift: false,
    purchased: false,
    amountContributed: 0,
    contributors: [],
    image: createMockMedia({
      id: 'img-1',
      url: '/images/stand-mixer.jpg',
      altText: 'KitchenAid Stand Mixer',
      isDecorative: false,
    }),
  });

  const mockHandleCloseModal = jest.fn();
  const mockHandleContribute = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders registry contribution modal using Dialog with role="dialog", aria-modal="true", and matching accessible name', () => {
    (useRegistry as jest.Mock).mockReturnValue({
      items: [mockItem],
      isLoading: false,
      error: null,
      refetch: jest.fn(),
      selectedItem: mockItem,
      isModalOpen: true,
      setVisibleItemsCount: jest.fn(),
      isAdmin: false,
      filteredItems: [mockItem],
      visibleItems: [mockItem],
      categories: ['Kitchen'],
      minPrice: 0,
      maxPrice: 500,
      categoryFilter: 'All',
      setCategoryFilter: jest.fn(),
      priceRange: [0, 500],
      setPriceRange: jest.fn(),
      showGroupGiftsOnly: false,
      setShowGroupGiftsOnly: jest.fn(),
      showAvailableOnly: false,
      setShowAvailableOnly: jest.fn(),
      searchQuery: '',
      setSearchQuery: jest.fn(),
      sortOption: 'recommended',
      setSortOption: jest.fn(),
      handleClearFilters: jest.fn(),
      handleCardClick: jest.fn(),
      handleCloseModal: mockHandleCloseModal,
      handleEdit: jest.fn(),
      handleDelete: jest.fn(),
      handleContribute: mockHandleContribute,
    });

    render(<RegistryPage />);

    // Check that role="dialog" is exposed with aria-modal="true"
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    // Check that the accessible name matches the gift item title
    expect(screen.getByRole('dialog', { name: 'KitchenAid Stand Mixer' })).toBeInTheDocument();

    // Verify aria-labelledby points to the h2 heading inside RegistryItemCard
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBe('registry-item-title-item-101');

    const heading = within(dialog).getByRole('heading', { level: 2 });
    expect(heading).toHaveAttribute('id', 'registry-item-title-item-101');
    expect(heading).toHaveTextContent('KitchenAid Stand Mixer');
  });

  test('closes dialog on Escape key and triggers handleCloseModal', () => {
    (useRegistry as jest.Mock).mockReturnValue({
      items: [mockItem],
      isLoading: false,
      error: null,
      refetch: jest.fn(),
      selectedItem: mockItem,
      isModalOpen: true,
      setVisibleItemsCount: jest.fn(),
      isAdmin: false,
      filteredItems: [mockItem],
      visibleItems: [mockItem],
      categories: ['Kitchen'],
      minPrice: 0,
      maxPrice: 500,
      categoryFilter: 'All',
      setCategoryFilter: jest.fn(),
      priceRange: [0, 500],
      setPriceRange: jest.fn(),
      showGroupGiftsOnly: false,
      setShowGroupGiftsOnly: jest.fn(),
      showAvailableOnly: false,
      setShowAvailableOnly: jest.fn(),
      searchQuery: '',
      setSearchQuery: jest.fn(),
      sortOption: 'recommended',
      setSortOption: jest.fn(),
      handleClearFilters: jest.fn(),
      handleCardClick: jest.fn(),
      handleCloseModal: mockHandleCloseModal,
      handleEdit: jest.fn(),
      handleDelete: jest.fn(),
      handleContribute: mockHandleContribute,
    });

    render(<RegistryPage />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Press Escape
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    expect(mockHandleCloseModal).toHaveBeenCalledTimes(1);
  });

  test('traps keyboard Tab navigation inside the registry modal', () => {
    (useRegistry as jest.Mock).mockReturnValue({
      items: [mockItem],
      isLoading: false,
      error: null,
      refetch: jest.fn(),
      selectedItem: mockItem,
      isModalOpen: true,
      setVisibleItemsCount: jest.fn(),
      isAdmin: false,
      filteredItems: [mockItem],
      visibleItems: [mockItem],
      categories: ['Kitchen'],
      minPrice: 0,
      maxPrice: 500,
      categoryFilter: 'All',
      setCategoryFilter: jest.fn(),
      priceRange: [0, 500],
      setPriceRange: jest.fn(),
      showGroupGiftsOnly: false,
      setShowGroupGiftsOnly: jest.fn(),
      showAvailableOnly: false,
      setShowAvailableOnly: jest.fn(),
      searchQuery: '',
      setSearchQuery: jest.fn(),
      sortOption: 'recommended',
      setSortOption: jest.fn(),
      handleClearFilters: jest.fn(),
      handleCardClick: jest.fn(),
      handleCloseModal: mockHandleCloseModal,
      handleEdit: jest.fn(),
      handleDelete: jest.fn(),
      handleContribute: mockHandleContribute,
    });

    render(<RegistryPage />);

    const dialog = screen.getByRole('dialog');
    const closeBtn = within(dialog).getByRole('button', { name: /close modal/i });
    const nameInput = within(dialog).getByLabelText(/your name/i);
    const submitBtn = within(dialog).getByRole('button', { name: /claim gift/i });

    // Initial focus on first focusable element (close button)
    expect(closeBtn).toHaveFocus();

    // Tab through inputs
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    nameInput.focus();
    expect(nameInput).toHaveFocus();

    // Tab to last focusable element (submit button)
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    submitBtn.focus();
    expect(submitBtn).toHaveFocus();

    // Tab from last element wraps to first element (close button)
    fireEvent.keyDown(submitBtn, { key: 'Tab' });
    expect(closeBtn).toHaveFocus();

    // Shift+Tab from first element wraps to last element (submit button)
    fireEvent.keyDown(closeBtn, { key: 'Tab', shiftKey: true });
    expect(submitBtn).toHaveFocus();
  });

  test('progressively reveals gifts past 20 via scroll sentinel and Load More button and transfers focus to counter', () => {
    jest.useFakeTimers();

    let intersectionCallback: IntersectionObserverCallback | null = null;
    const originalIntersectionObserver = global.IntersectionObserver;
    global.IntersectionObserver = jest.fn((cb: IntersectionObserverCallback) => {
      intersectionCallback = cb;
      return {
        observe: jest.fn(),
        unobserve: jest.fn(),
        disconnect: jest.fn(),
        takeRecords: jest.fn(() => []),
        root: null,
        rootMargin: '0px',
        thresholds: [0],
      };
    }) as unknown as typeof IntersectionObserver;

    const thirtyItems: RegistryItem[] = Array.from({ length: 30 }, (_, idx) =>
      createMockRegistryItem({
        id: `item-${idx + 1}`,
        name: `Gift Item ${idx + 1}`,
        description: `Description ${idx + 1}`,
        price: (idx + 1) * 10,
        category: 'Home',
        isGroupGift: false,
        purchased: false,
        amountContributed: 0,
        contributors: [],
        image: createMockMedia({
          id: `img-${idx + 1}`,
          url: '/images/stand-mixer.jpg',
          altText: `Gift Item ${idx + 1}`,
          isDecorative: false,
        }),
      })
    );

    function StatefulRegistryHarness() {
      const [visibleCount, setVisibleCount] = React.useState(12);
      (useRegistry as jest.Mock).mockReturnValue({
        items: thirtyItems,
        isLoading: false,
        error: null,
        refetch: jest.fn(),
        selectedItem: null,
        isModalOpen: false,
        visibleItemsCount: visibleCount,
        setVisibleItemsCount: setVisibleCount,
        isAdmin: false,
        filteredItems: thirtyItems,
        visibleItems: thirtyItems.slice(0, visibleCount),
        categories: ['Home'],
        minPrice: 10,
        maxPrice: 300,
        categoryFilter: [],
        setCategoryFilter: jest.fn(),
        priceRange: [10, 300],
        setPriceRange: jest.fn(),
        showGroupGiftsOnly: false,
        setShowGroupGiftsOnly: jest.fn(),
        showAvailableOnly: false,
        setShowAvailableOnly: jest.fn(),
        searchQuery: '',
        setSearchQuery: jest.fn(),
        sortOption: 'default',
        setSortOption: jest.fn(),
        handleClearFilters: jest.fn(),
        handleCardClick: jest.fn(),
        handleCloseModal: mockHandleCloseModal,
        handleEdit: jest.fn(),
        handleDelete: jest.fn(),
        handleContribute: mockHandleContribute,
      });
      return <RegistryPage />;
    }

    try {
      render(<StatefulRegistryHarness />);

      expect(screen.getAllByText('Showing 12 of 30 gifts').length).toBeGreaterThan(0);

      // Load batch 1 via scroll sentinel: 12 -> 20
      React.act(() => {
        intersectionCallback?.(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver
        );
      });
      React.act(() => {
        jest.advanceTimersByTime(500);
      });
      expect(screen.getAllByText('Showing 20 of 30 gifts').length).toBeGreaterThan(0);

      // Load batch 2 via Load More button: 20 -> 28 (past 20!)
      const loadMoreBtn2 = screen.getByRole('button', { name: /load more/i });
      loadMoreBtn2.focus();
      fireEvent.click(loadMoreBtn2);
      React.act(() => {
        jest.advanceTimersByTime(500);
      });
      expect(screen.getAllByText('Showing 28 of 30 gifts').length).toBeGreaterThan(0);

      // Final batch: 28 -> 30; Load More unmounts and focus transfers to counter paragraph
      const loadMoreBtn3 = screen.getByRole('button', { name: /load more/i });
      loadMoreBtn3.focus();
      fireEvent.click(loadMoreBtn3);
      React.act(() => {
        jest.advanceTimersByTime(500);
      });

      expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
      const counters = screen.getAllByText('Showing 30 of 30 gifts');
      expect(counters.length).toBeGreaterThan(0);
      expect(screen.getByText('Gift Item 30')).toBeInTheDocument();
      const focusableCounter = counters.find(el => el.tagName === 'P');
      expect(focusableCounter).toHaveFocus();
    } finally {
      global.IntersectionObserver = originalIntersectionObserver;
      jest.useRealTimers();
    }
  });

  test('positions sticky filter bar below fixed Navbar (top-16) and exposes inline Clear Filters button when filters or sort are active', () => {
    const mockClearFilters = jest.fn();
    const baseState = {
      items: [mockItem],
      isLoading: false,
      error: null,
      refetch: jest.fn(),
      selectedItem: null,
      isModalOpen: false,
      visibleItemsCount: 12,
      setVisibleItemsCount: jest.fn(),
      isAdmin: false,
      filteredItems: [mockItem],
      visibleItems: [mockItem],
      categories: ['Kitchen'],
      minPrice: 0,
      maxPrice: 500,
      categoryFilter: [],
      setCategoryFilter: jest.fn(),
      priceRange: [0, 500] as [number, number],
      setPriceRange: jest.fn(),
      showGroupGiftsOnly: false,
      setShowGroupGiftsOnly: jest.fn(),
      showAvailableOnly: false,
      setShowAvailableOnly: jest.fn(),
      searchQuery: '',
      setSearchQuery: jest.fn(),
      sortOption: 'default' as const,
      setSortOption: jest.fn(),
      handleClearFilters: mockClearFilters,
      handleCardClick: jest.fn(),
      handleCloseModal: mockHandleCloseModal,
      handleEdit: jest.fn(),
      handleDelete: jest.fn(),
      handleContribute: mockHandleContribute,
    };

    (useRegistry as jest.Mock).mockReturnValue(baseState);
    const { rerender } = render(<RegistryPage />);

    const filterNav = screen.getByRole('navigation', { name: 'Registry Filters' });
    expect(filterNav).toHaveClass('sticky', 'top-16');
    expect(filterNav).not.toHaveClass('top-0');
    expect(screen.queryByTestId('inline-clear-filters-button')).not.toBeInTheDocument();

    (useRegistry as jest.Mock).mockReturnValue({
      ...baseState,
      showAvailableOnly: true,
    });
    rerender(<RegistryPage />);

    const inlineClearBtn = screen.getByTestId('inline-clear-filters-button');
    expect(inlineClearBtn).toHaveTextContent('Clear Filters');
    fireEvent.click(inlineClearBtn);
    expect(mockClearFilters).toHaveBeenCalledTimes(1);
  });

  test('omits tabindex on h1, removes aria-live from gift grid, keeps initial empty state silent, and announces filtered zero-result state politely', () => {
    const baseState = {
      items: [],
      isLoading: false,
      error: null,
      refetch: jest.fn(),
      selectedItem: null,
      isModalOpen: false,
      visibleItemsCount: 12,
      setVisibleItemsCount: jest.fn(),
      isAdmin: false,
      filteredItems: [],
      visibleItems: [],
      categories: ['Kitchen'],
      minPrice: 0,
      maxPrice: 500,
      categoryFilter: [],
      setCategoryFilter: jest.fn(),
      priceRange: [0, 500] as [number, number],
      setPriceRange: jest.fn(),
      showGroupGiftsOnly: false,
      setShowGroupGiftsOnly: jest.fn(),
      showAvailableOnly: false,
      setShowAvailableOnly: jest.fn(),
      searchQuery: '',
      setSearchQuery: jest.fn(),
      sortOption: 'default' as const,
      setSortOption: jest.fn(),
      handleClearFilters: jest.fn(),
      handleCardClick: jest.fn(),
      handleCloseModal: mockHandleCloseModal,
      handleEdit: jest.fn(),
      handleDelete: jest.fn(),
      handleContribute: mockHandleContribute,
    };

    // 1. Initial empty registry: no status announcement on mount
    (useRegistry as jest.Mock).mockReturnValue(baseState);
    const { container, rerender } = render(<RegistryPage />);

    const h1 = screen.getByRole('heading', { level: 1, name: 'Wedding Registry' });
    expect(h1).not.toHaveAttribute('tabindex');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    // 2. Populated grid: gift card grid itself must NOT be an aria-live region
    (useRegistry as jest.Mock).mockReturnValue({
      ...baseState,
      items: [mockItem],
      filteredItems: [mockItem],
      visibleItems: [mockItem],
    });
    rerender(<RegistryPage />);

    const card = screen.getByTestId('registry-card');
    expect(card.closest('[aria-live]')).toBeNull();
    expect(container.querySelector('.sr-only[aria-live="polite"]')).toHaveTextContent(
      'Showing 1 of 1 gifts'
    );

    // 3. Zero-result filter state: announces politely via EmptyState role="status" and live counter
    (useRegistry as jest.Mock).mockReturnValue({
      ...baseState,
      items: [mockItem],
      filteredItems: [],
      visibleItems: [],
      searchQuery: 'nonexistent',
    });
    rerender(<RegistryPage />);

    const emptyStatus = screen.getByRole('status');
    expect(emptyStatus).toHaveAttribute('aria-live', 'polite');
    expect(emptyStatus).toHaveTextContent('No gifts match the current filters.');
    expect(container.querySelector('.sr-only[aria-live="polite"]')).toHaveTextContent(
      'Showing 0 of 0 gifts'
    );
  });
});
