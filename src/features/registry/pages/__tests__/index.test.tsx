import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import RegistryPage from '../index';
import { useRegistry } from '@/features/registry/hooks/useRegistry';
import { RegistryItem } from '../../types';

// Mock the useRegistry hook
jest.mock('@/features/registry/hooks/useRegistry');

const mockUseRegistry = useRegistry as jest.Mock;

const mockItems: RegistryItem[] = [
  { id: '1', name: 'Blender', category: 'Kitchen', price: 50, purchased: false, isGroupGift: false, amountContributed: 0, contributors: [], description: '', image: '', quantity: 1, vendorUrl: '' },
  { id: '2', name: 'Toaster', category: 'Kitchen', price: 30, purchased: true, isGroupGift: false, amountContributed: 0, contributors: [], description: '', image: '', quantity: 1, vendorUrl: '' },
  { id: '3', name: 'Honeymoon Fund', category: 'Fund', price: 1000, purchased: false, isGroupGift: true, amountContributed: 250, contributors: [], description: '', image: '', quantity: 1, vendorUrl: '' },
];

const mockCategories = ['Kitchen', 'Fund'];

const baseMockReturnValue = {
  isLoading: false,
  error: null,
  selectedItem: null,
  isModalOpen: false,
  setVisibleItemsCount: jest.fn(),
  isAdmin: false,
  filteredItems: mockItems,
  visibleItems: mockItems,
  categories: mockCategories,
  minPrice: 30,
  maxPrice: 1000,
  categoryFilter: [],
  setCategoryFilter: jest.fn(),
  priceRange: [30, 1000],
  setPriceRange: jest.fn(),
  showGroupGiftsOnly: false,
  setShowGroupGiftsOnly: jest.fn(),
  showAvailableOnly: false,
  setShowAvailableOnly: jest.fn(),
  handleCardClick: jest.fn(),
  handleCloseModal: jest.fn(),
  handleEdit: jest.fn(),
  handleDelete: jest.fn(),
  handleContribute: jest.fn(),
};

describe('RegistryPage', () => {
  beforeEach(() => {
    // Reset mocks before each test
    mockUseRegistry.mockReturnValue(baseMockReturnValue);
  });

  it('should render the loading state', () => {
    mockUseRegistry.mockReturnValue({ ...baseMockReturnValue, isLoading: true });
    render(<RegistryPage />);
    // There are 12 skeleton cards rendered in the loading state
    expect(screen.getAllByTestId('registry-card-skeleton').length).toBeGreaterThan(0);
  });

  it('should render the registry items', () => {
    render(<RegistryPage />);
    expect(screen.getByText('Blender')).toBeInTheDocument();
    expect(screen.getByText('Toaster')).toBeInTheDocument();
    expect(screen.getByText('Honeymoon Fund')).toBeInTheDocument();
  });

  it('should filter items when a category is selected', () => {
    const setCategoryFilter = jest.fn();
    mockUseRegistry.mockReturnValue({ ...baseMockReturnValue, setCategoryFilter });
    render(<RegistryPage />);

    fireEvent.click(screen.getByLabelText('Kitchen'));

    expect(setCategoryFilter).toHaveBeenCalledWith(['Kitchen']);
  });

  it('should filter items when "Show only available gifts" is checked', () => {
    const setShowAvailableOnly = jest.fn();
    mockUseRegistry.mockReturnValue({ ...baseMockReturnValue, setShowAvailableOnly });
    render(<RegistryPage />);

    fireEvent.click(screen.getByLabelText('Show only available gifts'));

    expect(setShowAvailableOnly).toHaveBeenCalledWith(true);
  });

  it('should show empty state when no items match filters', () => {
    mockUseRegistry.mockReturnValue({ ...baseMockReturnValue, visibleItems: [], filteredItems: [] });
    render(<RegistryPage />);

    expect(screen.getByText('No gifts match the current filters. Try adjusting your search!')).toBeInTheDocument();
  });

  it('should call handleCardClick when an item is clicked', () => {
    const handleCardClick = jest.fn();
    mockUseRegistry.mockReturnValue({ ...baseMockReturnValue, handleCardClick });
    render(<RegistryPage />);

    fireEvent.click(screen.getByText('Blender'));
    expect(handleCardClick).toHaveBeenCalledWith(mockItems[0]);
  });
});
