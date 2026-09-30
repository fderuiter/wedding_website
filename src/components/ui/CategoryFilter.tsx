import React from 'react';
import { FormGroup, Checkbox, Label } from './forms';
import { cn } from '@/utils/cn';

/**
 * Props for the CategoryFilter component.
 */
export interface CategoryFilterProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
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
 */
export const CategoryFilter = React.forwardRef<HTMLDivElement, CategoryFilterProps>(
  ({ categories, selected, onChange, className, ...props }, ref) => {
    const handleToggle = (category: string) => {
      if (selected.includes(category)) {
        onChange(selected.filter(c => c !== category));
      } else {
        onChange([...selected, category]);
      }
    };

    return (
      <div ref={ref} className={cn('flex flex-wrap gap-2 mb-4', className)} {...props}>
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
  }
);

CategoryFilter.displayName = 'CategoryFilter';

