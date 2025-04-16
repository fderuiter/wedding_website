import React from 'react';

export interface PriceRangeFilterProps {
  min: number;
  max: number;
  value: [number, number];
  onChange: (value: [number, number]) => void;
}

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
