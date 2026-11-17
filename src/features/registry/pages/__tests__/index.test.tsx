import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import RegistryPage from '../index';
import { useRegistry } from '../../hooks/useRegistry';
import { RegistryItem } from '../../types';

// Mock useRegistry hook
jest.mock('../../hooks/useRegistry', () => ({
  useRegistry: jest.fn(),
}));

describe('RegistryPage Dialog integration', () => {
  const mockItem: RegistryItem = {
    id: 'item-101',
    name: 'KitchenAid Stand Mixer',
    description: 'Professional 5-quart stand mixer in artisan red.',
    price: 350,
    category: 'Kitchen',
    isGroupGift: false,
    purchased: false,
    amountContributed: 0,
    contributors: [],
    image: {
      id: 'img-1',
      url: '/images/stand-mixer.jpg',
      altText: 'KitchenAid Stand Mixer',
      isDecorative: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };

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
});
