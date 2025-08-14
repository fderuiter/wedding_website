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
  it('updates displayed values within bounds and calls onChange', () => {
    const handleChange = jest.fn();
    render(<Wrapper min={0} max={100} initial={[10, 90]} onChange={handleChange} />);

    const [minSlider, maxSlider] = screen.getAllByRole('slider');
    const getMinDisplay = () => screen.getAllByText(/\$\d+/)[1];
    const getMaxDisplay = () => screen.getAllByText(/\$\d+/)[2];

    // Adjust min within bounds
    fireEvent.change(minSlider, { target: { value: '20' } });
    expect(getMinDisplay()).toHaveTextContent('$20');
    expect(getMaxDisplay()).toHaveTextContent('$90');
    expect(handleChange).toHaveBeenNthCalledWith(1, [20, 90]);

    // Adjust max within bounds
    fireEvent.change(maxSlider, { target: { value: '80' } });
    expect(getMaxDisplay()).toHaveTextContent('$80');
    expect(handleChange).toHaveBeenNthCalledWith(2, [20, 80]);

    // Attempt to set min above current max - should clamp
    fireEvent.change(minSlider, { target: { value: '95' } });
    expect(getMinDisplay()).toHaveTextContent('$80');
    expect(getMaxDisplay()).toHaveTextContent('$80');
    expect(handleChange).toHaveBeenNthCalledWith(3, [80, 80]);

    // Attempt to set max below min - should clamp
    fireEvent.change(maxSlider, { target: { value: '60' } });
    expect(getMinDisplay()).toHaveTextContent('$80');
    expect(getMaxDisplay()).toHaveTextContent('$80');
    expect(handleChange).toHaveBeenNthCalledWith(4, [80, 80]);
  });
});

