import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
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
  it('renders all attractions by default', async () => {
    render(<ThingsToDoList attractions={attractions as any} />);
    await screen.findByTestId('things-to-do-map');
    const attractionCards = screen.getAllByText(/Directions/);
    expect(attractionCards.length).toBe(attractions.length);
  });

  it('filters attractions when a category is clicked', async () => {
    render(<ThingsToDoList attractions={attractions as any} />);
    await screen.findByTestId('things-to-do-map');

    const foodButton = screen.getByText('Food');
    fireEvent.click(foodButton);

    const foodAttractions = attractions.filter(a => a.category === 'food');
    const attractionCards = screen.getAllByText(/Directions/);
    expect(attractionCards.length).toBe(foodAttractions.length);
  });

  it('shows all attractions when "all" category is clicked', async () => {
    render(<ThingsToDoList attractions={attractions as any} />);
    await screen.findByTestId('things-to-do-map');

    // First filter to something else
    const foodButton = screen.getByText('Food');
    fireEvent.click(foodButton);

    // Then click "all"
    const allButton = screen.getByText('All');
    fireEvent.click(allButton);

    const attractionCards = screen.getAllByText(/Directions/);
    expect(attractionCards.length).toBe(attractions.length);
  });
});
