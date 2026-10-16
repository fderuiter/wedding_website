import React from 'react';
import { render, screen } from '@testing-library/react';
import ThingsToDoMap, { calculateBoundsAndCentroid } from '../ThingsToDoMap';

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
  TileLayer: () => <div data-testid="tile-layer" />,
  Marker: ({ children }: { children: React.ReactNode }) => <div data-testid="marker">{children}</div>,
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

describe('ThingsToDoMap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the map and markers', () => {
    render(<ThingsToDoMap attractions={attractions} />);

    expect(screen.getByTestId('map-container')).toBeInTheDocument();
    expect(screen.getByTestId('tile-layer')).toBeInTheDocument();

    const markers = screen.getAllByTestId('marker');
    expect(markers).toHaveLength(attractions.length);
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
});
