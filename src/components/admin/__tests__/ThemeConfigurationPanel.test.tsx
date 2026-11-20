import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import { ThemeConfigurationPanel } from '../ThemeConfigurationPanel';

expect.extend(toHaveNoViolations);

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

    // Invalid length measurement
    fireEvent.change(containerInput, { target: { value: 'invalid-unit' } });
    expect(containerInput).toHaveAttribute('aria-invalid', 'true');
    expect(
      screen.getByText(/Enter a valid size measurement using px, rem, em, %, or ch/i)
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

  test('links layout and border inputs to helper and error FormMessages via aria-describedby', () => {
    const handleChange = jest.fn();
    render(<ThemeConfigurationPanel values={defaultValues} onChange={handleChange} />);

    const containerInput = screen.getByLabelText(/Container Max Width/i);
    const gridGapInput = screen.getByLabelText(/Grid Gap/i);
    const cardPaddingInput = screen.getByLabelText(/Card Padding/i);
    const borderRadiusInput = screen.getByLabelText(/Border Radius/i);

    expect(containerInput).toHaveAttribute('aria-describedby', 'layoutContainerMaxWidth-help');
    expect(document.getElementById('layoutContainerMaxWidth-help')).toHaveTextContent(/64rem or 1200px/i);

    expect(gridGapInput).toHaveAttribute('aria-describedby', 'layoutGridGap-help');
    expect(document.getElementById('layoutGridGap-help')).toBeInTheDocument();

    expect(cardPaddingInput).toHaveAttribute('aria-describedby', 'layoutCardPadding-help');
    expect(document.getElementById('layoutCardPadding-help')).toBeInTheDocument();

    expect(borderRadiusInput).toHaveAttribute('aria-describedby', 'layoutBorderRadius-help');
    expect(document.getElementById('layoutBorderRadius-help')).toBeInTheDocument();

    fireEvent.change(borderRadiusInput, { target: { value: 'bad-radius' } });
    expect(borderRadiusInput).toHaveAttribute('aria-invalid', 'true');
    expect(borderRadiusInput).toHaveAttribute('aria-describedby', 'layoutBorderRadius-error');
    expect(document.getElementById('layoutBorderRadius-error')).toHaveTextContent(
      /Enter a valid size measurement/i
    );
  });

  test('does not render any unpersisted typography, spacing, border, or brand dimension inputs', () => {
    const handleChange = jest.fn();
    render(<ThemeConfigurationPanel values={defaultValues} onChange={handleChange} />);

    const unpersistedLabels = [
      /Base Font Size/i,
      /Large Font Size/i,
      /Normal Font Weight/i,
      /Medium Spacing/i,
      /Thin Border Width/i,
      /^Border Style$/i,
      /Logo Width/i,
      /Logo Height/i,
      /Hero Background Height/i,
      /Watermark Width/i,
      /Watermark Opacity/i,
      /Badge Size/i,
    ];

    for (const label of unpersistedLabels) {
      expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    }
  });

  test('renders only preset and color controls in essentials mode and passes jest-axe', async () => {
    const handleChange = jest.fn();
    const { container } = render(
      <ThemeConfigurationPanel mode="essentials" values={defaultValues} onChange={handleChange} />
    );

    expect(screen.getByLabelText(/Select Theme Preset/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Primary Color Code/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Secondary Color Code/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Container Max Width/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Grid Gap/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Card Padding/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Card Border Radius/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Print Background Color Code/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/Layout spacing, card rounding, and print styling colors can be customized anytime in Site Settings/i)
    ).toBeInTheDocument();

    const axeResults = await axe(container);
    expect(axeResults).toHaveNoViolations();
  });

  test('applies externalErrors across persisted Layout & Spacing controls and passes jest-axe', async () => {
    const handleChange = jest.fn();
    const { container } = render(
      <ThemeConfigurationPanel
        values={defaultValues}
        onChange={handleChange}
        errors={{
          layoutContainerMaxWidth: 'Server rejected max width.',
          layoutGridGap: 'Server rejected grid gap.',
          layoutCardPadding: 'Server rejected card padding.',
          layoutBorderRadius: 'Server rejected border radius.',
        }}
      />
    );

    const maxWidthInput = screen.getByLabelText(/Container Max Width/i);
    const gridGapInput = screen.getByLabelText(/Grid Gap/i);
    const cardPaddingInput = screen.getByLabelText(/Card Padding/i);
    const borderRadiusInput = screen.getByLabelText(/Card Border Radius/i);

    expect(maxWidthInput).toHaveAttribute('aria-invalid', 'true');
    expect(maxWidthInput).toHaveAttribute('aria-describedby', 'layoutContainerMaxWidth-error');
    expect(document.getElementById('layoutContainerMaxWidth-error')).toHaveTextContent(
      'Server rejected max width.'
    );

    expect(gridGapInput).toHaveAttribute('aria-invalid', 'true');
    expect(gridGapInput).toHaveAttribute('aria-describedby', 'layoutGridGap-error');
    expect(document.getElementById('layoutGridGap-error')).toHaveTextContent('Server rejected grid gap.');

    expect(cardPaddingInput).toHaveAttribute('aria-invalid', 'true');
    expect(cardPaddingInput).toHaveAttribute('aria-describedby', 'layoutCardPadding-error');
    expect(document.getElementById('layoutCardPadding-error')).toHaveTextContent('Server rejected card padding.');

    expect(borderRadiusInput).toHaveAttribute('aria-invalid', 'true');
    expect(borderRadiusInput).toHaveAttribute('aria-describedby', 'layoutBorderRadius-error');

    const axeResults = await axe(container);
    expect(axeResults).toHaveNoViolations();
  });

  test('strips previous preset defaults on preset switch and omits print tokens reset to preset default', () => {
    const handleChange = jest.fn();
    render(
      <ThemeConfigurationPanel
        values={{
          ...defaultValues,
          themePreset: 'classic',
          printBg: '#fef2f2',
          themeTokens: {
            '--card-bg': '#ffffff',
            '--print-bg': '#fef2f2',
            '--btn-radius': '0.625rem',
          },
        }}
        onChange={handleChange}
      />
    );

    fireEvent.change(screen.getByLabelText(/Select Theme Preset/i), {
      target: { value: 'romantic' },
    });

    expect(handleChange).toHaveBeenCalledWith({
      themePreset: 'romantic',
      themeTokens: {
        '--print-bg': '#fef2f2',
        '--btn-radius': '0.625rem',
      },
    });

    handleChange.mockClear();
    fireEvent.change(screen.getByLabelText(/Print Background Color Code/i), {
      target: { value: '#ffffff' },
    });

    expect(handleChange).toHaveBeenCalledWith({
      printBg: '#ffffff',
      themeTokens: {
        '--card-bg': '#ffffff',
        '--btn-radius': '0.625rem',
      },
    });
  });
});
