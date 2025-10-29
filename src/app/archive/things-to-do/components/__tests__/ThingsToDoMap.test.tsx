import React from 'react';
import { render, screen } from '@testing-library/react';
import ThingsToDoMap from '../ThingsToDoMap';
import { attractions } from '@/data/things-to-do';

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
