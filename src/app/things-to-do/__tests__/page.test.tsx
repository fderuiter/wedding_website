import React from 'react';
import { render, screen } from '@testing-library/react';
import ThingsToDoPage from '../page';

// Mock the ThingsToDoList component
jest.mock('../components/ThingsToDoList', () => {
  return function DummyThingsToDoList() {
    return <div data-testid="things-to-do-list" />;
  };
});

describe('ThingsToDoPage', () => {
  it('renders the main heading', () => {
    render(<ThingsToDoPage />);
    expect(screen.getByRole('heading', { name: /Things to Do in Rochester/i })).toBeInTheDocument();
  });

  it('renders the ThingsToDoList component', () => {
    render(<ThingsToDoPage />);
    expect(screen.getByTestId('things-to-do-list')).toBeInTheDocument();
  });
});
