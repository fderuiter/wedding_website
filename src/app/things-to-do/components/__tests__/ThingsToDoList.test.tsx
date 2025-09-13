import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ThingsToDoList from '../ThingsToDoList';
import { attractions } from '@/data/things-to-do';

jest.mock('../ThingsToDoMap', () => {
    const MockThingsToDoMap = () => <div data-testid="things-to-do-map" />;
    MockThingsToDoMap.displayName = 'MockThingsToDoMap';
    return MockThingsToDoMap;
});

describe('ThingsToDoList', () => {
  it('renders all attractions by default', () => {
    render(<ThingsToDoList />);
    const attractionCards = screen.getAllByText(/Directions/);
    expect(attractionCards.length).toBe(attractions.length);
  });

  it('filters attractions when a category is clicked', () => {
    render(<ThingsToDoList />);

    const foodButton = screen.getByText('Food');
    fireEvent.click(foodButton);

    const foodAttractions = attractions.filter(a => a.category === 'food');
    const attractionCards = screen.getAllByText(/Directions/);
    expect(attractionCards.length).toBe(foodAttractions.length);
  });

  it('shows all attractions when "all" category is clicked', () => {
    render(<ThingsToDoList />);

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
