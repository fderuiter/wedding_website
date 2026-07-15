import { z } from 'zod';

const hexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/i, 'Invalid hex color');

export const themeSchema = z.object({
  colors: z.object({
    primary: hexColorSchema,
    secondary: hexColorSchema,
    primaryLight: hexColorSchema,
    secondaryLight: hexColorSchema,
    background: hexColorSchema,
    text: hexColorSchema,
    textOnPrimary: hexColorSchema,
    textOnSecondary: hexColorSchema,
    accent: hexColorSchema,
    gold: hexColorSchema,
    silver: hexColorSchema,
    sparkle: hexColorSchema,
    easterEgg: hexColorSchema,
    outline: hexColorSchema,
    border: hexColorSchema,
    backgroundDark: hexColorSchema,
    foregroundDark: hexColorSchema,
  }),
  gradients: z.object({
    primary: z.string(),
    secondary: z.string(),
    background: z.string(),
  }),
  typography: z.object({
    fontFamily: z.object({
      sans: z.string(),
      mono: z.string(),
    }),
  }),
  spacing: z.object({
    headerHeight: z.string(),
  }),
});

export type ThemeConfig = z.infer<typeof themeSchema>;

const rawTheme: ThemeConfig = {
  colors: {
    primary: '#B91C1C', // Aligning with rose-700
    secondary: '#B45309', // Aligning with amber-700 for better contrast
    primaryLight: '#FCA5A5',
    secondaryLight: '#FDE68A',
    background: '#FFFFFF',
    text: '#171717',
    textOnPrimary: '#FFFFFF',
    textOnSecondary: '#171717',
    accent: '#D4AF37',
    gold: '#FFD700',
    silver: '#C0C0C0',
    sparkle: '#FFA0E0',
    easterEgg: '#FF69B4',
    outline: '#000000',
    border: '#4B5563',
    backgroundDark: '#111827',
    foregroundDark: '#F9FAFB'
  },
  gradients: {
    primary: 'from-red-700 to-yellow-600',
    secondary: 'from-yellow-600 to-red-700',
    background: 'from-red-50 to-yellow-50'
  },
  typography: {
    fontFamily: {
      sans: 'var(--font-geist-sans), Arial, Helvetica, sans-serif',
      mono: 'var(--font-geist-mono), monospace',
    }
  },
  spacing: {
    headerHeight: '56px',
  }
};

export const theme = themeSchema.parse(rawTheme);
export type Theme = typeof theme;
export default theme;
