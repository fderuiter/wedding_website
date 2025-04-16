import React from 'react';

export interface CategoryFilterProps {
  categories: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

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
