interface ThemeConfig {
  colors: {
    primary: string; // Used for accents, buttons, links
    secondary: string; // Used for highlights, secondary accents
    primaryLight: string;
    secondaryLight: string;
    background: string;
    text: string; // Main text color
    textOnPrimary: string; // Text on primary backgrounds
    textOnSecondary: string; // Text on secondary backgrounds
    accent: string;
  };
  gradients: {
    primary: string;
    secondary: string;
    background: string;
  };
}

export const theme: ThemeConfig = {
  colors: {
    primary: '#B91C1C', // Darker red for better contrast
    secondary: '#B8860B', // Darker gold for better contrast
    primaryLight: '#FCA5A5', // Light red for backgrounds
    secondaryLight: '#FFE066', // Light gold for backgrounds
    background: '#FFFFFF',
    text: '#171717', // Very dark gray for main text
    textOnPrimary: '#FFFFFF', // White text on primary backgrounds
    textOnSecondary: '#171717', // Dark text on secondary backgrounds
    accent: '#FFD700'
  },
  gradients: {
    primary: 'from-red-700 to-yellow-600',
    secondary: 'from-yellow-600 to-red-700',
    background: 'from-red-50 to-yellow-50'
  }
};

export type Theme = typeof theme;
export default theme;
