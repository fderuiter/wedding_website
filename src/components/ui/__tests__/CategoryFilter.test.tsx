import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CategoryFilter } from '../CategoryFilter';

describe('CategoryFilter', () => {
  it('renders a checkbox for each category and includes group role with default label', () => {
    const categories = ['Kitchen', 'Bedroom', 'Outdoor'];
    render(
      <CategoryFilter categories={categories} selected={[]} onChange={() => {}} />
    );

    expect(screen.getByRole('group', { name: 'Filter by category' })).toBeInTheDocument();
    categories.forEach(category => {
      expect(screen.getByLabelText(category)).toBeInTheDocument();
    });
  });

  it('renders with a custom accessible label via label prop', () => {
    render(
      <CategoryFilter
        categories={['Kitchen']}
        selected={[]}
        onChange={() => {}}
        label="Filter gifts by category"
      />
    );

    expect(screen.getByRole('group', { name: 'Filter gifts by category' })).toBeInTheDocument();
  });

  it('prioritizes aria-label when provided alongside label prop', () => {
    render(
      <CategoryFilter
        categories={['Kitchen']}
        selected={[]}
        onChange={() => {}}
        label="Fallback label"
        aria-label="Direct aria label"
      />
    );

    expect(screen.getByRole('group', { name: 'Direct aria label' })).toBeInTheDocument();
  });

  it('omits aria-label when aria-labelledby is provided', () => {
    render(
      <div>
        <span id="custom-group-heading">Available Categories</span>
        <CategoryFilter
          categories={['Kitchen']}
          selected={[]}
          onChange={() => {}}
          aria-labelledby="custom-group-heading"
          label="Conflicting label"
        />
      </div>
    );

    const group = screen.getByRole('group', { name: 'Available Categories' });
    expect(group).toBeInTheDocument();
    expect(group).not.toHaveAttribute('aria-label');
    expect(group).toHaveAttribute('aria-labelledby', 'custom-group-heading');
  });

  it('renders accessible container safely when categories array is empty', () => {
    render(
      <CategoryFilter
        categories={[]}
        selected={[]}
        onChange={() => {}}
      />
    );

    const group = screen.getByRole('group', { name: 'Filter by category' });
    expect(group).toBeInTheDocument();
    expect(group.children).toHaveLength(0);
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

