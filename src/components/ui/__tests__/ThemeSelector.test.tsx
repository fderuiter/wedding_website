import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { ThemeSelector } from '../ThemeSelector';
import { ThemeProvider } from '@/components/ThemeProvider';

describe('ThemeSelector', () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = 'theme_mode=; path=/; max-age=0';
  });

  it('renders theme options (Light, Dark, System)', () => {
    const { getByRole, getByText } = render(
      <ThemeProvider>
        <ThemeSelector />
      </ThemeProvider>
    );

    expect(getByRole('radiogroup', { name: 'Theme mode selector' })).toBeInTheDocument();
    expect(getByText('Light')).toBeInTheDocument();
    expect(getByText('Dark')).toBeInTheDocument();
    expect(getByText('System')).toBeInTheDocument();
  });

  it('switches theme when buttons are clicked', () => {
    const { getByRole } = render(
      <ThemeProvider>
        <ThemeSelector />
      </ThemeProvider>
    );

    const lightRadio = getByRole('radio', { name: /light/i });
    fireEvent.click(lightRadio);

    expect(lightRadio).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem('theme_mode')).toBe('light');
    expect(document.cookie).toContain('theme_mode=light');

    const darkRadio = getByRole('radio', { name: /dark/i });
    fireEvent.click(darkRadio);

    expect(darkRadio).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem('theme_mode')).toBe('dark');
    expect(document.cookie).toContain('theme_mode=dark');
  });
});
