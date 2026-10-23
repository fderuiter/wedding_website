import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ThemeConfigurationPanel } from '../ThemeConfigurationPanel';

describe('ThemeConfigurationPanel Component', () => {
  const defaultValues = {
    themePreset: 'classic',
    colorPrimary: '#B91C1C',
    colorSecondary: '#B45309',
    layoutContainerMaxWidth: '64rem',
    layoutGridGap: '1.5rem',
    layoutCardPadding: '2rem',
    layoutBorderRadius: '1rem',
  };

  test('renders preset dropdown, descriptions, color pickers, and layout inputs', () => {
    const handleChange = jest.fn();
    render(<ThemeConfigurationPanel values={defaultValues} onChange={handleChange} />);

    expect(screen.getByLabelText(/Select Theme Preset/i)).toBeInTheDocument();
    expect(screen.getByText(/Timeless elegance with traditional serif accents/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Primary Color Code/i)).toHaveValue('#B91C1C');
    expect(screen.getByLabelText(/Secondary Color Code/i)).toHaveValue('#B45309');
    expect(screen.getByLabelText(/Container Max Width/i)).toHaveValue('64rem');
    expect(screen.getByLabelText(/Grid Gap/i)).toHaveValue('1.5rem');
    expect(screen.getByLabelText(/Card Padding/i)).toHaveValue('2rem');
    expect(screen.getByLabelText(/Border Radius/i)).toHaveValue('1rem');
    expect(screen.getByLabelText(/Print Background Color Code/i)).toHaveValue('#ffffff');
    expect(screen.getByLabelText(/Print Text Color Code/i)).toHaveValue('#111827');
    expect(screen.getByLabelText(/Print Border Color Code/i)).toHaveValue('#e5e7eb');
    expect(screen.getByLabelText(/Print Header Border Color Code/i)).toHaveValue('#111827');
    expect(screen.getByLabelText(/Print Badge Accent Color Code/i)).toHaveValue('#f3f4f6');
  });

  test('calls onChange when theme preset changes', () => {
    const handleChange = jest.fn();
    render(<ThemeConfigurationPanel values={defaultValues} onChange={handleChange} />);

    const select = screen.getByLabelText(/Select Theme Preset/i);
    fireEvent.change(select, { target: { value: 'modern' } });

    expect(handleChange).toHaveBeenCalledWith({ themePreset: 'modern' });
  });

  test('calls onChange when color inputs change', () => {
    const handleChange = jest.fn();
    render(<ThemeConfigurationPanel values={defaultValues} onChange={handleChange} />);

    const primaryInput = screen.getByLabelText(/Primary Color Code/i);
    fireEvent.change(primaryInput, { target: { value: '#123456' } });

    expect(handleChange).toHaveBeenCalledWith({ colorPrimary: '#123456' });
  });

  test('validates CSS length units on layout token inputs and displays error for invalid inputs', () => {
    const handleChange = jest.fn();
    render(<ThemeConfigurationPanel values={defaultValues} onChange={handleChange} />);

    const containerInput = screen.getByLabelText(/Container Max Width/i);

    // Invalid CSS length unit
    fireEvent.change(containerInput, { target: { value: 'invalid-unit' } });
    expect(containerInput).toHaveAttribute('aria-invalid', 'true');
    expect(
      screen.getByText(/Invalid CSS length unit format. Use values like 64rem, 20px, 1.5rem, or 100%./i)
    ).toBeInTheDocument();

    // Valid CSS length unit
    fireEvent.change(containerInput, { target: { value: '1200px' } });
    expect(containerInput).toHaveAttribute('aria-invalid', 'false');
    expect(handleChange).toHaveBeenCalledWith({ layoutContainerMaxWidth: '1200px' });
  });

  test('allows blank/empty layout inputs without invalid error', () => {
    const handleChange = jest.fn();
    render(<ThemeConfigurationPanel values={defaultValues} onChange={handleChange} />);

    const gridGapInput = screen.getByLabelText(/Grid Gap/i);

    fireEvent.change(gridGapInput, { target: { value: '' } });
    expect(gridGapInput).toHaveAttribute('aria-invalid', 'false');
    expect(handleChange).toHaveBeenCalledWith({ layoutGridGap: '' });
  });

  test('calls onChange with updated print token when print background changes', () => {
    const handleChange = jest.fn();
    render(<ThemeConfigurationPanel values={defaultValues} onChange={handleChange} />);

    const printBgInput = screen.getByLabelText(/Print Background Color Code/i);
    fireEvent.change(printBgInput, { target: { value: '#fdf2f8' } });

    expect(handleChange).toHaveBeenCalledWith({
      printBg: '#fdf2f8',
      themeTokens: {
        '--print-bg': '#fdf2f8',
      },
    });
  });
});
