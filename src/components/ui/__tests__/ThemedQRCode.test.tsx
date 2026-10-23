import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemedQRCode } from '../ThemedQRCode';
import { ThemeProvider } from '@/components/ThemeProvider';

describe('ThemedQRCode Component', () => {
  it('renders QR code canvas with accessibility attributes', () => {
    render(
      <ThemedQRCode
        value="https://venmo.com/u/testuser"
        aria-label="QR code to pay via Venmo"
        size={100}
      />
    );

    const canvas = screen.getByLabelText('QR code to pay via Venmo');
    expect(canvas).toBeInTheDocument();
  });

  it('renders with light mode theme colors', () => {
    render(
      <ThemeProvider
        config={{
          colorPrimary: '#B91C1C',
          themePreset: 'classic',
        }}
        initialThemeMode="light"
      >
        <ThemedQRCode
          value="https://venmo.com/u/testuser"
          aria-label="Payment QR code"
        />
      </ThemeProvider>
    );

    const canvas = screen.getByLabelText('Payment QR code');
    expect(canvas).toBeInTheDocument();
  });

  it('renders with dark mode theme colors', () => {
    render(
      <ThemeProvider
        config={{
          colorPrimary: '#B91C1C',
          themePreset: 'classic',
        }}
        initialThemeMode="dark"
      >
        <ThemedQRCode
          value="https://venmo.com/u/testuser"
          aria-label="Dark mode QR code"
        />
      </ThemeProvider>
    );

    const canvas = screen.getByLabelText('Dark mode QR code');
    expect(canvas).toBeInTheDocument();
  });

  it('falls back to default high contrast colors if explicitly provided colors have insufficient contrast', () => {
    render(
      <ThemedQRCode
        value="https://venmo.com/u/testuser"
        aria-label="Low contrast QR code"
        fgColor="#ffffff"
        bgColor="#ffffff"
      />
    );

    const canvas = screen.getByLabelText('Low contrast QR code');
    expect(canvas).toBeInTheDocument();
  });
});
