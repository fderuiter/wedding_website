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

  it('forwards DOM ref and merges custom className via cn()', () => {
    const ref = React.createRef<HTMLDivElement>();
    const { container } = render(
      <CategoryFilter
        ref={ref}
        categories={['Kitchen']}
        selected={[]}
        onChange={() => {}}
        className="custom-category-filter-class"
      />
    );

    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect(container.firstChild).toHaveClass('custom-category-filter-class');
    expect(container.firstChild).toHaveClass('flex');
  });
});

