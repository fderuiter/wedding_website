"use client";

import React, { createContext, useContext, useEffect } from 'react';

type ThemeContextType = {
  themePrimary: string;
  themeSecondary: string;
  themeAccent: string;
};

const ThemeContext = createContext<ThemeContextType>({
  themePrimary: '#f43f5e',
  themeSecondary: '#fbbf24',
  themeAccent: '#e11d48',
});

export const useTheme = () => useContext(ThemeContext);

export function ThemeProvider({ 
  children, 
  themePrimary, 
  themeSecondary, 
  themeAccent 
}: { 
  children: React.ReactNode; 
  themePrimary?: string; 
  themeSecondary?: string; 
  themeAccent?: string; 
}) {
  const primary = themePrimary || '#f43f5e';
  const secondary = themeSecondary || '#fbbf24';
  const accent = themeAccent || '#e11d48';

  useEffect(() => {
    document.documentElement.style.setProperty('--color-primary', primary);
    document.documentElement.style.setProperty('--color-secondary', secondary);
    document.documentElement.style.setProperty('--color-primary', primary);
    document.documentElement.style.setProperty('--color-secondary', secondary);
    
    // Convert accent color to tailwind's primary/primary equivalent if possible,
    // or just apply it to elements that used primary.
    // Let's create an --color-accent variable for things like hover states or focus rings.
    document.documentElement.style.setProperty('--color-accent', accent);
  }, [primary, secondary, accent]);

  return (
    <ThemeContext.Provider value={{ themePrimary: primary, themeSecondary: secondary, themeAccent: accent }}>
      {children}
    </ThemeContext.Provider>
  );
}
