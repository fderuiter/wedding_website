import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import RegistryPage from '../index';
import { useRegistry } from '@/features/registry/hooks/useRegistry';

jest.mock('@/features/registry/hooks/useRegistry');

const mockUseRegistry = useRegistry as jest.MockedFunction<typeof useRegistry>;

describe('RegistryPage', () => {
  const defaultMockState = {
    items: [],
    isLoading: false,
    error: null,
    refetch: jest.fn(),
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
    categoryFilter: [],
    setCategoryFilter: jest.fn(),
    priceRange: [0, 1000] as [number, number],
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
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseRegistry.mockReturnValue(defaultMockState as any);
  });

  it('renders the main heading', () => {
    render(<RegistryPage />);
    expect(
      screen.getByRole('heading', { level: 1, name: /wedding registry/i })
    ).toBeInTheDocument();
  });

  it('renders API error state with structured component and retry button', () => {
    const mockRefetch = jest.fn();
    mockUseRegistry.mockReturnValue({
      ...defaultMockState,
      error: new Error('Network Connection Error'),
      refetch: mockRefetch,
    } as any);

    render(<RegistryPage />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/unable to load registry/i)).toBeInTheDocument();
    expect(screen.getByText(/network connection error/i)).toBeInTheDocument();

    const retryButton = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retryButton);
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it('displays network fetch empty state when no items exist overall', () => {
    mockUseRegistry.mockReturnValue({
      ...defaultMockState,
      items: [],
      filteredItems: [],
      visibleItems: [],
    } as any);

    render(<RegistryPage />);

    expect(screen.getByText(/no gifts have been added to the registry yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refresh registry/i })).toBeInTheDocument();
  });

  it('displays active filter zero-results empty state when items exist but filter returns empty', () => {
    mockUseRegistry.mockReturnValue({
      ...defaultMockState,
      items: [
        {
          id: '1',
          name: 'Coffee Maker',
          category: 'Kitchen',
          price: 150,
          amountContributed: 0,
          purchased: false,
          isGroupGift: false,
          contributors: [],
        },
      ],
      filteredItems: [],
      visibleItems: [],
    } as any);

    render(<RegistryPage />);

    expect(screen.getByText(/no gifts match the current filters/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear filters/i })).toBeInTheDocument();
  });
});
