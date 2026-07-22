import React from 'react';
import { FormGroup, Checkbox, Label } from './forms';

/**
 * Props for the CategoryFilter component.
 */
interface CategoryFilterProps {
  /** A list of all available category strings. */
  categories: string[];
  /** A list of the currently selected category strings. */
  selected: string[];
  /** Callback function that is invoked when the selection changes. */
  onChange: (selected: string[]) => void;
}

/**
 * @function CategoryFilter
 * @description A component that renders a list of checkboxes for filtering items by category.
 * It allows users to select multiple categories to filter a list of items.
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
        <FormGroup key={category} className="inline-flex items-center space-y-0 mr-2">
          <div className="flex items-center space-x-2">
            <Checkbox
              checked={selected.includes(category)}
              onChange={() => handleToggle(category)}
            />
            <Label className="font-normal cursor-pointer">{category}</Label>
          </div>
        </FormGroup>
      ))}
    </div>
  );
};
