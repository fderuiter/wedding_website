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

  it('assigns roving tabIndex to active theme option', () => {
    const { getByRole } = render(
      <ThemeProvider initialThemeMode="light">
        <ThemeSelector />
      </ThemeProvider>
    );

    const lightRadio = getByRole('radio', { name: /light/i });
    const darkRadio = getByRole('radio', { name: /dark/i });
    const systemRadio = getByRole('radio', { name: /system/i });

    expect(lightRadio).toHaveAttribute('tabIndex', '0');
    expect(darkRadio).toHaveAttribute('tabIndex', '-1');
    expect(systemRadio).toHaveAttribute('tabIndex', '-1');

    fireEvent.click(darkRadio);

    expect(lightRadio).toHaveAttribute('tabIndex', '-1');
    expect(darkRadio).toHaveAttribute('tabIndex', '0');
    expect(systemRadio).toHaveAttribute('tabIndex', '-1');
  });

  it('navigates options via keyboard arrow, Home, and End keys', () => {
    const { getByRole } = render(
      <ThemeProvider initialThemeMode="light">
        <ThemeSelector />
      </ThemeProvider>
    );

    const lightRadio = getByRole('radio', { name: /light/i });
    const darkRadio = getByRole('radio', { name: /dark/i });
    const systemRadio = getByRole('radio', { name: /system/i });

    lightRadio.focus();
    expect(document.activeElement).toBe(lightRadio);

    // ArrowRight moves focus to Dark
    fireEvent.keyDown(lightRadio, { key: 'ArrowRight' });
    expect(darkRadio).toHaveAttribute('aria-checked', 'true');
    expect(document.activeElement).toBe(darkRadio);

    // ArrowDown moves focus to System
    fireEvent.keyDown(darkRadio, { key: 'ArrowDown' });
    expect(systemRadio).toHaveAttribute('aria-checked', 'true');
    expect(document.activeElement).toBe(systemRadio);

    // ArrowRight wraps around to Light
    fireEvent.keyDown(systemRadio, { key: 'ArrowRight' });
    expect(lightRadio).toHaveAttribute('aria-checked', 'true');
    expect(document.activeElement).toBe(lightRadio);

    // ArrowLeft wraps around to System
    fireEvent.keyDown(lightRadio, { key: 'ArrowLeft' });
    expect(systemRadio).toHaveAttribute('aria-checked', 'true');
    expect(document.activeElement).toBe(systemRadio);

    // ArrowUp moves focus to Dark
    fireEvent.keyDown(systemRadio, { key: 'ArrowUp' });
    expect(darkRadio).toHaveAttribute('aria-checked', 'true');
    expect(document.activeElement).toBe(darkRadio);

    // Home moves focus to Light
    fireEvent.keyDown(darkRadio, { key: 'Home' });
    expect(lightRadio).toHaveAttribute('aria-checked', 'true');
    expect(document.activeElement).toBe(lightRadio);

    // End moves focus to System
    fireEvent.keyDown(lightRadio, { key: 'End' });
    expect(systemRadio).toHaveAttribute('aria-checked', 'true');
    expect(document.activeElement).toBe(systemRadio);
  });
});
