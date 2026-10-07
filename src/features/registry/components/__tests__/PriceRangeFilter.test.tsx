import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PriceRangeFilter } from '../PriceRangeFilter';

// Helper wrapper to manage state updates like in a real component
const Wrapper = ({ min, max, initial, onChange }: { min: number; max: number; initial: [number, number]; onChange: (val: [number, number]) => void }) => {
  const [value, setValue] = React.useState<[number, number]>(initial);
  const handleChange = (val: [number, number]) => {
    setValue(val);
    onChange(val);
  };
  return <PriceRangeFilter min={min} max={max} value={value} onChange={handleChange} />;
};

describe('PriceRangeFilter', () => {
  it('applies accent-primary styling to range inputs', () => {
    render(<PriceRangeFilter min={0} max={100} value={[10, 90]} onChange={jest.fn()} />);
    const minSlider = screen.getByLabelText('Minimum price');
    const maxSlider = screen.getByLabelText('Maximum price');
    expect(minSlider).toHaveClass('accent-primary');
    expect(maxSlider).toHaveClass('accent-primary');
  });

  it('updates consolidated price range display within bounds and calls onChange', () => {
    const handleChange = jest.fn();
    render(<Wrapper min={0} max={100} initial={[10, 90]} onChange={handleChange} />);

    const minSlider = screen.getByLabelText('Minimum price');
    const maxSlider = screen.getByLabelText('Maximum price');

    expect(screen.getByText('$10.00 – $90.00')).toBeInTheDocument();

    // Adjust min within bounds
    fireEvent.change(minSlider, { target: { value: '20' } });
    expect(screen.getByText('$20.00 – $90.00')).toBeInTheDocument();
    expect(handleChange).toHaveBeenNthCalledWith(1, [20, 90]);

    // Adjust max within bounds
    fireEvent.change(maxSlider, { target: { value: '80' } });
    expect(screen.getByText('$20.00 – $80.00')).toBeInTheDocument();
    expect(handleChange).toHaveBeenNthCalledWith(2, [20, 80]);

    // Attempt to set min above current max - should clamp and show single price
    fireEvent.change(minSlider, { target: { value: '95' } });
    expect(screen.getByText('$80.00')).toBeInTheDocument();
    expect(handleChange).toHaveBeenNthCalledWith(3, [80, 80]);

    // Attempt to set max below min - should clamp and show single price
    fireEvent.change(maxSlider, { target: { value: '60' } });
    expect(screen.getByText('$80.00')).toBeInTheDocument();
    expect(handleChange).toHaveBeenNthCalledWith(4, [80, 80]);
  });
});
