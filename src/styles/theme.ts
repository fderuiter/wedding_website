/**
 * @interface ThemeConfig
 * @description Defines the structure of the application's theme configuration.
 * @property {object} colors - Color palette definitions.
 * @property {object} gradients - Gradient definitions.
 */
interface ThemeConfig {
  /**
   * Color palette for the application.
   */
  colors: {
    /** Primary accent color (e.g., buttons, links). */
    primary: string;
    /** Secondary accent color (e.g., highlights). */
    secondary: string;
    /** Lighter shade of the primary color for backgrounds. */
    primaryLight: string;
    /** Lighter shade of the secondary color for backgrounds. */
    secondaryLight: string;
    /** Main background color. */
    background: string;
    /** Main text color. */
    text: string;
    /** Text color to be used on primary backgrounds. */
    textOnPrimary: string;
    /** Text color to be used on secondary backgrounds. */
    textOnSecondary: string;
    /** Additional accent color. */
    accent: string;
    /** Gold color for 3D materials and UI. */
    gold: string;
    /** Silver color for 3D materials and UI. */
    silver: string;
    /** Sparkle color for point materials. */
    sparkle: string;
    /** Easter egg hotpink color. */
    easterEgg: string;
    /** Outline color. */
    outline: string;
    /** Border color. */
    border: string;
    /** Background color for dark mode (or main background) */
    backgroundDark: string;
    /** Foreground color for dark mode (or main text) */
    foregroundDark: string;
  };
  /**
   * Gradient definitions for the application.
   */
  gradients: {
    /** Primary gradient. */
    primary: string;
    /** Secondary gradient. */
    secondary: string;
    /** Background gradient. */
    background: string;
  };
}

/**
 * @const {ThemeConfig} theme
 * @description The main theme configuration object containing color and gradient definitions.
 * This is used to maintain design consistency across the application.
 */
export const theme: ThemeConfig = {
  colors: {
    primary: '#FF0000', // Red
    secondary: '#FFD700', // Yellow
    primaryLight: '#FCA5A5', // Light red for backgrounds
    secondaryLight: '#FFE066', // Light gold for backgrounds
    background: '#FFFFFF',
    text: '#171717', // Very dark gray for main text
    textOnPrimary: '#FFFFFF', // White text on primary backgrounds
    textOnSecondary: '#171717', // Dark text on secondary backgrounds
    accent: '#FFD700',
    gold: '#FFD700',
    silver: '#C0C0C0',
    sparkle: '#ffa0e0',
    easterEgg: '#ff69b4',
    outline: '#000000',
    border: '#4b5563',
    backgroundDark: '#111827',
    foregroundDark: '#f9fafb'
  },
  gradients: {
    primary: 'from-red-700 to-yellow-600',
    secondary: 'from-yellow-600 to-red-700',
    background: 'from-red-50 to-yellow-50'
  }
};

/**
 * Type definition for the Theme object, derived from the theme constant.
 */
export type Theme = typeof theme;
export default theme;
