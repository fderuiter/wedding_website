interface ThemeConfig {
  colors: {
    primary: string;
    secondary: string;
    primaryLight: string;
    secondaryLight: string;
    background: string;
    text: string;
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
    primary: '#FF0000', // Red
    secondary: '#FFD700', // Yellow
    primaryLight: '#FF3333',
    secondaryLight: '#FFE44D',
    background: '#FFFFFF',
    text: '#1F2937',
    accent: '#FFE44D'
  },
  gradients: {
    primary: 'from-red-600 to-yellow-400',
    secondary: 'from-yellow-400 to-red-500',
    background: 'from-red-50 to-yellow-50'
  }
};

export type Theme = typeof theme;
export default theme;
