import React from 'react';

/**
 * Props for the CategoryFilter component.
 */
export interface CategoryFilterProps {
  /** A list of all available category strings. */
  categories: string[];
  /** A list of the currently selected category strings. */
  selected: string[];
  /** Callback function that is invoked when the selection changes. */
  onChange: (selected: string[]) => void;
}

/**
 * A component that renders a list of checkboxes for filtering items by category.
 *
 * @param {CategoryFilterProps} props - The props for the component.
 * @returns {React.ReactElement} The rendered category filter component.
 */
export const CategoryFilter: React.FC<CategoryFilterProps> = ({ categories, selected, onChange }) => {
  const handleToggle = (category: string) => {
    if (selected.includes(category)) {
      onChange(selected.filter(c => c !== category));
    } else {
      onChange([...selected, category]);
    }
  };

  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {categories.map(category => (
        <label key={category} className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={selected.includes(category)}
            onChange={() => handleToggle(category)}
            className="form-checkbox accent-yellow-600 mr-2"
          />
          <span className="text-sm">{category}</span>
        </label>
      ))}
    </div>
  );
};
