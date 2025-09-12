import React from 'react';

/**
 * @interface PriceRangeFilterProps
 * @description Defines the props for the PriceRangeFilter component.
 * @property {number} min - The minimum possible price value.
 * @property {number} max - The maximum possible price value.
 * @property {[number, number]} value - The current selected price range [min, max].
 * @property {(value: [number, number]) => void} onChange - Callback function invoked when the price range changes.
 */
export interface PriceRangeFilterProps {
  min: number;
  max: number;
  value: [number, number];
  onChange: (value: [number, number]) => void;
}

/**
 * @function PriceRangeFilter
 * @description A React component that provides a dual-slider for selecting a price range.
 * @param {PriceRangeFilterProps} props - The props for the component.
 * @returns {JSX.Element} The rendered PriceRangeFilter component.
 */
export const PriceRangeFilter: React.FC<PriceRangeFilterProps> = ({ min, max, value, onChange }) => {
  const [minValue, maxValue] = value;

  const handleMinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newMin = Math.min(Number(e.target.value), maxValue);
    onChange([newMin, maxValue]);
  };

  const handleMaxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newMax = Math.max(Number(e.target.value), minValue);
    onChange([minValue, newMax]);
  };

  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="text-sm">${min}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={minValue}
        onChange={handleMinChange}
        className="accent-yellow-600"
      />
      <span className="text-sm">${minValue}</span>
      <span className="mx-1">-</span>
      <input
        type="range"
        min={min}
        max={max}
        value={maxValue}
        onChange={handleMaxChange}
        className="accent-yellow-600"
      />
      <span className="text-sm">${maxValue}</span>
      <span className="text-sm">/ ${max}</span>
    </div>
  );
};
