import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CategoryFilter } from '../CategoryFilter';

describe('CategoryFilter', () => {
  it('renders a checkbox for each category', () => {
    const categories = ['Kitchen', 'Bedroom', 'Outdoor'];
    render(
      <CategoryFilter categories={categories} selected={[]} onChange={() => {}} />
    );

    categories.forEach(category => {
      expect(screen.getByLabelText(category)).toBeInTheDocument();
    });
  });

  it('calls onChange with updated selection when checkboxes are clicked', () => {
    const categories = ['Kitchen', 'Bedroom'];
    let selected: string[] = [];
    const handleChange = jest.fn((newSelected: string[]) => {
      selected = newSelected;
    });

    const { rerender } = render(
      <CategoryFilter
        categories={categories}
        selected={selected}
        onChange={handleChange}
      />
    );

    // Select Kitchen
    fireEvent.click(screen.getByLabelText('Kitchen'));
    expect(handleChange).toHaveBeenLastCalledWith(['Kitchen']);
    rerender(
      <CategoryFilter
        categories={categories}
        selected={selected}
        onChange={handleChange}
      />
    );

    // Select Bedroom
    fireEvent.click(screen.getByLabelText('Bedroom'));
    expect(handleChange).toHaveBeenLastCalledWith(['Kitchen', 'Bedroom']);
    rerender(
      <CategoryFilter
        categories={categories}
        selected={selected}
        onChange={handleChange}
      />
    );

    // Deselect Kitchen
    fireEvent.click(screen.getByLabelText('Kitchen'));
    expect(handleChange).toHaveBeenLastCalledWith(['Bedroom']);
  });
});
