import { render, screen, fireEvent, act } from '@testing-library/react';
import ThingsToDoList from '../ThingsToDoList';

const attractions = [
  {
    id: '1',
    name: 'Test Food Place',
    description: 'A place to eat',
    category: 'food',
    website: 'https://test.com',
    directions: 'Go straight',
    latitude: 45.0,
    longitude: -90.0,
    isVisible: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    image: null
  },
  {
    id: '2',
    name: 'Test Park',
    description: 'A place to walk',
    category: 'activity',
    website: 'https://test.com',
    directions: 'Go left',
    latitude: 45.1,
    longitude: -90.1,
    isVisible: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    image: null
  }
];

jest.mock('../ThingsToDoMap', () => {
  const MockThingsToDoMap = () => <div data-testid="things-to-do-map" />;
  MockThingsToDoMap.displayName = 'MockThingsToDoMap';
  return MockThingsToDoMap;
});

describe('ThingsToDoList', () => {
  let originalParent: any;

  beforeAll(() => {
    originalParent = window.parent;
    Object.defineProperty(window, 'parent', {
      value: {},
      configurable: true,
      writable: true,
    });
  });

  afterAll(() => {
    Object.defineProperty(window, 'parent', {
      value: originalParent,
      configurable: true,
      writable: true,
    });
  });

  it('renders all attractions by default', async () => {
    render(<ThingsToDoList attractions={attractions as any} />);
    await screen.findByTestId('things-to-do-map');
    expect(screen.getByRole('group', { name: 'Filter attractions by category' })).toBeInTheDocument();
    const attractionCards = screen.getAllByText(/Directions/);
    expect(attractionCards.length).toBe(attractions.length);
  });

  it('filters attractions when a category is toggled', async () => {
    render(<ThingsToDoList attractions={attractions as any} />);
    await screen.findByTestId('things-to-do-map');

    const foodCheckbox = screen.getByLabelText('food');
    fireEvent.click(foodCheckbox);

    const foodAttractions = attractions.filter(a => a.category === 'food');
    const attractionCards = screen.getAllByText(/Directions/);
    expect(attractionCards.length).toBe(foodAttractions.length);
  });

  it('shows all attractions when no categories are selected', async () => {
    render(<ThingsToDoList attractions={attractions as any} />);
    await screen.findByTestId('things-to-do-map');

    // First filter to food
    const foodCheckbox = screen.getByLabelText('food');
    fireEvent.click(foodCheckbox);

    // Then uncheck food
    fireEvent.click(foodCheckbox);

    const attractionCards = screen.getAllByText(/Directions/);
    expect(attractionCards.length).toBe(attractions.length);
  });

  it('renders EmptyState with informative message and no action button when attractions list is empty', async () => {
    render(<ThingsToDoList attractions={[]} />);
    await screen.findByTestId('things-to-do-map');

    expect(screen.getByText('No items found')).toBeInTheDocument();
    expect(screen.getByText('No attractions have been added yet. Please check back later!')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('renders EmptyState with "Clear filters" action button when active category filters yield no results', async () => {
    render(<ThingsToDoList attractions={attractions as any} />);
    await screen.findByTestId('things-to-do-map');

    // Filter to food category
    const foodCheckbox = screen.getByLabelText('food');
    fireEvent.click(foodCheckbox);

    // Verify food attraction is displayed
    expect(screen.getByText('Test Food Place')).toBeInTheDocument();

    // Simulate draft update where attractions only contains 'activity' category
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'DRAFT_UPDATE',
            draftType: 'attractions',
            draftData: [
              {
                id: '3',
                name: 'Test Museum',
                description: 'A museum to visit',
                category: 'activity',
                website: 'https://test.com',
                directions: 'Go straight ahead',
                latitude: 45.2,
                longitude: -90.2,
                isVisible: true,
                createdAt: new Date(),
                updatedAt: new Date(),
                image: null,
              },
            ],
          },
        })
      );
    });

    // EmptyState should now be visible since selected category 'food' has no matches
    expect(screen.getByText('No items found')).toBeInTheDocument();
    expect(screen.getByText('No attractions match the selected categories.')).toBeInTheDocument();

    const clearButton = screen.getByRole('button', { name: 'Clear filters' });
    expect(clearButton).toBeInTheDocument();

    // Click "Clear filters" to reset category selection
    fireEvent.click(clearButton);

    // EmptyState should disappear and attractions should reappear
    expect(screen.queryByText('No items found')).not.toBeInTheDocument();
    expect(screen.getByText('Test Museum')).toBeInTheDocument();
  });
});
