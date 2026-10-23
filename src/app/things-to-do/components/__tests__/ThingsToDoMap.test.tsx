import React from 'react';
import { render, screen } from '@testing-library/react';
import ThingsToDoMap, { calculateBoundsAndCentroid, createMapMarkerIcon } from '../ThingsToDoMap';
import { useTheme } from '@/components/ThemeProvider';

jest.mock('@/components/ThemeProvider', () => ({
  useTheme: jest.fn(() => ({ resolvedTheme: 'dark' })),
}));

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
] as any;

const mockSetView = jest.fn();
const mockFitBounds = jest.fn();
const mockMap = {
  setView: mockSetView,
  fitBounds: mockFitBounds,
};

jest.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="map-container">{children}</div>,
  TileLayer: ({ url, attribution }: { url: string; attribution: string }) => (
    <div data-testid="tile-layer" data-url={url} data-attribution={attribution} />
  ),
  Marker: ({ children, icon }: { children: React.ReactNode; icon: any }) => (
    <div data-testid="marker" data-icon-class={icon?.options?.className}>{children}</div>
  ),
  Popup: ({ children }: { children: React.ReactNode }) => <div data-testid="popup">{children}</div>,
  useMap: () => mockMap,
}));

describe('calculateBoundsAndCentroid helper', () => {
  it('returns count 0 and fallback centroid for empty attractions', () => {
    const res = calculateBoundsAndCentroid([], [10.0, 20.0]);
    expect(res.count).toBe(0);
    expect(res.bounds).toBeNull();
    expect(res.centroid).toEqual([10.0, 20.0]);
  });

  it('filters out attractions with invalid coordinates', () => {
    const invalid = [
      { latitude: NaN, longitude: -90.0 },
      { latitude: 45.0, longitude: null },
      { latitude: '45.0', longitude: -90.0 },
    ] as any;
    const res = calculateBoundsAndCentroid(invalid, [0, 0]);
    expect(res.count).toBe(0);
  });

  it('calculates single attraction bounds and centroid', () => {
    const res = calculateBoundsAndCentroid([attractions[0]]);
    expect(res.count).toBe(1);
    expect(res.centroid).toEqual([45.0, -90.0]);
  });

  it('calculates min/max bounds and centroid for multiple attractions', () => {
    const res = calculateBoundsAndCentroid(attractions);
    expect(res.count).toBe(2);
    expect(res.bounds).toEqual([
      [45.0, -90.1],
      [45.1, -90.0],
    ]);
    expect(res.centroid).toEqual([45.05, -90.05]);
  });
});

describe('createMapMarkerIcon helper', () => {
  it('creates an L.divIcon with 44x44 dimensions, role="img", and aria-label', () => {
    const icon = createMapMarkerIcon('Test Landmark');
    expect(icon.options.className).toBe('custom-map-pin');
    expect(icon.options.iconSize).toEqual([44, 44]);
    expect(icon.options.html).toContain('role="img"');
    expect(icon.options.html).toContain('aria-label="Test Landmark"');
    expect(icon.options.html).toContain('var(--map-marker-pin-color');
    expect(icon.options.html).toContain('var(--map-marker-border-color');
    expect(icon.options.html).toContain('var(--map-marker-shadow-color');
  });
});

describe('ThingsToDoMap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useTheme as jest.Mock).mockReturnValue({ resolvedTheme: 'dark' });
  });

  it('renders the map with dark CartoDB tile URL when resolvedTheme is dark', () => {
    render(<ThingsToDoMap attractions={attractions} />);

    expect(screen.getByTestId('map-container')).toBeInTheDocument();
    const tileLayer = screen.getByTestId('tile-layer');
    expect(tileLayer).toHaveAttribute('data-url', 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png');

    const markers = screen.getAllByTestId('marker');
    expect(markers).toHaveLength(attractions.length);
  });

  it('renders light CartoDB tile URL when resolvedTheme is light', () => {
    (useTheme as jest.Mock).mockReturnValue({ resolvedTheme: 'light' });
    render(<ThingsToDoMap attractions={attractions} />);

    const tileLayer = screen.getByTestId('tile-layer');
    expect(tileLayer).toHaveAttribute('data-url', 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png');
  });

  it('falls back to defaultCenter setView when no attractions are provided', () => {
    render(<ThingsToDoMap attractions={[]} defaultCenter={[41.8781, -87.6298]} />);

    expect(mockSetView).toHaveBeenCalledWith([41.8781, -87.6298], 13);
  });

  it('uses setView with zoom level 14 for a single attraction', () => {
    render(<ThingsToDoMap attractions={[attractions[0]]} />);

    expect(mockSetView).toHaveBeenCalledWith([45.0, -90.0], 14);
  });

  it('uses fitBounds with computed bounds for multiple attractions', () => {
    render(<ThingsToDoMap attractions={attractions} />);

    expect(mockFitBounds).toHaveBeenCalledWith(
      [
        [45.0, -90.1],
        [45.1, -90.0],
      ],
      { padding: [50, 50] }
    );
  });

  it('renders Google Maps directions fallback in popup when custom directions is missing', () => {
    const attractionNoDirections = [
      {
        id: '3',
        name: 'Test Spot',
        description: 'A spot',
        category: 'activity',
        directions: '',
        latitude: 45.0,
        longitude: -90.0,
      },
    ] as any;

    render(<ThingsToDoMap attractions={attractionNoDirections} />);

    const directionsLink = screen.getByText('Directions').closest('a');
    expect(directionsLink).toHaveAttribute(
      'href',
      'https://www.google.com/maps/dir/?api=1&destination=45,-90'
    );
  });
});
