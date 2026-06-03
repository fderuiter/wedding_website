import React from 'react';
import { render, screen } from '@testing-library/react';
import ThingsToDoMap from '../ThingsToDoMap';

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

jest.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="map-container">{children}</div>,
  TileLayer: () => <div data-testid="tile-layer" />,
  Marker: ({ children }: { children: React.ReactNode }) => <div data-testid="marker">{children}</div>,
  Popup: ({ children }: { children: React.ReactNode }) => <div data-testid="popup">{children}</div>,
}));

describe('ThingsToDoMap', () => {
  it('renders the map and markers', () => {
    render(<ThingsToDoMap attractions={attractions} />);

    expect(screen.getByTestId('map-container')).toBeInTheDocument();
    expect(screen.getByTestId('tile-layer')).toBeInTheDocument();

    const markers = screen.getAllByTestId('marker');
    expect(markers).toHaveLength(attractions.length);
  });
});
