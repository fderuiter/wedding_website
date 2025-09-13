import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ThingsToDoPage from '../page';
import { attractions } from '@/data/things-to-do';

// Mock the ThingsToDoMap component
jest.mock('../components/ThingsToDoMap', () => {
  return function DummyThingsToDoMap() {
    return <div data-testid="things-to-do-map" />;
  };
});

// Mock next/dynamic
jest.mock('next/dynamic', () => () => {
  const DummyThingsToDoMap = () => <div data-testid="things-to-do-map" />;
  return DummyThingsToDoMap;
});


describe('ThingsToDoPage', () => {
  it('renders the page title', () => {
    render(<ThingsToDoPage />);
    expect(screen.getByText('Things to Do in Rochester')).toBeInTheDocument();
  });

  it('renders the ThingsToDoList and filters attractions', () => {
    render(<ThingsToDoPage />);

    // Check that all attractions are rendered initially
    const allAttractions = screen.getAllByRole('heading', { level: 3 });
    expect(allAttractions).toHaveLength(attractions.length);

    // Check that the map is rendered
    expect(screen.getByTestId('things-to-do-map')).toBeInTheDocument();

    // Click the "Food" filter
    const foodButton = screen.getByText('Food');
    fireEvent.click(foodButton);

    // Check that only food attractions are rendered
    const foodAttractions = attractions.filter((a) => a.category === 'food');
    const filteredHeadings = screen.getAllByRole('heading', { level: 3 });
    expect(filteredHeadings).toHaveLength(foodAttractions.length);
    foodAttractions.forEach((attraction) => {
        expect(screen.getByText(attraction.name)).toBeInTheDocument();
    });

    // Click the "All" filter
    const allButton = screen.getByText('All');
    fireEvent.click(allButton);

    // Check that all attractions are rendered again
    const allAttractionsAgain = screen.getAllByRole('heading', { level: 3 });
    expect(allAttractionsAgain).toHaveLength(attractions.length);
  });
});
