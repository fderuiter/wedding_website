import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import RegistryPage from '../index';

jest.mock('@/features/registry/hooks/useRegistry', () => ({
  useRegistry: () => ({
    items: [],
    isLoading: false,
    error: null,
    filters: {
      category: 'all',
      priceRange: { min: 0, max: 1000 },
      showPurchased: false,
      sortOrder: 'price-asc',
    },
    setFilters: jest.fn(),
    filteredItems: [],
    visibleItems: [],
    categories: [],
    minPrice: 0,
    maxPrice: 1000,
    categoryFilter: 'all',
    setCategoryFilter: jest.fn(),
    priceRange: [0, 1000],
    setPriceRange: jest.fn(),
    showGroupGiftsOnly: false,
    setShowGroupGiftsOnly: jest.fn(),
    showAvailableOnly: false,
    setShowAvailableOnly: jest.fn(),
    selectedItem: null,
    isModalOpen: false,
    setVisibleItemsCount: jest.fn(),
    isAdmin: false,
    handleCardClick: jest.fn(),
    handleCloseModal: jest.fn(),
    handleEdit: jest.fn(),
    handleDelete: jest.fn(),
    handleContribute: jest.fn(),
  }),
}));

describe('RegistryPage', () => {
  it('renders the main heading', () => {
    render(<RegistryPage />);
    expect(
      screen.getByRole('heading', { level: 1, name: /wedding registry/i })
    ).toBeInTheDocument();
  });
});
