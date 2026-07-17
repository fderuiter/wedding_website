'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

type ThemeContextType = {
  themePrimary: string;
  themeSecondary: string;
  themeAccent: string;
  themeOutline: string;
};

const ThemeContext = createContext<ThemeContextType>({
  themePrimary: '#B91C1C',
  themeSecondary: '#B45309',
  themeAccent: '#D4AF37',
  themeOutline: '#000000',
});

export const useTheme = () => useContext(ThemeContext);

export function ThemeProvider({ 
  children
}: { 
  children: React.ReactNode; 
}) {
  const [theme, setTheme] = useState({
    themePrimary: '#B91C1C',
    themeSecondary: '#B45309',
    themeAccent: '#D4AF37',
    themeOutline: '#000000',
  });

  useEffect(() => {
    // Extract color configurations directly from computed stylesheet styles
    // rather than hardcoded script variables.
    const styles = getComputedStyle(document.documentElement);
    const primary = styles.getPropertyValue('--color-primary').trim() || '#B91C1C';
    const secondary = styles.getPropertyValue('--color-secondary').trim() || '#B45309';
    const accent = styles.getPropertyValue('--color-accent').trim() || '#D4AF37';
    const outline = styles.getPropertyValue('--color-outline').trim() || '#000000';

    setTheme({
      themePrimary: primary,
      themeSecondary: secondary,
      themeAccent: accent,
      themeOutline: outline,
    });
  }, []);

  return (
    <ThemeContext.Provider value={theme}>
      {children}
    </ThemeContext.Provider>
  );
}
