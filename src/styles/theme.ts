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
    /** Primary material color for the 3D heart. */
    heartMaterial1: string;
    /** Secondary material color for the 3D heart. */
    heartMaterial2: string;
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
export const theme = {
  colors: {
    primary: '#f43f5e',
    secondary: '#fbbf24',
    primaryLight: '#ffe4e6', // rose-100
    secondaryLight: '#fef3c7', // amber-100
    background: '#111827', // gray-900
    text: '#f9fafb', // gray-50
    textOnPrimary: '#ffffff',
    textOnSecondary: '#1f2937',
    accent: '#f43f5e',
    heartMaterial1: '#f43f5e',
    heartMaterial2: '#C0C0C0'
  },
  gradients: {
    primary: 'from-rose-500 to-amber-400',
    secondary: 'from-amber-400 to-rose-500',
    background: 'from-gray-900 to-gray-800'
  }
};

/**
 * Type definition for the Theme object, derived from the theme constant.
 */
export type Theme = typeof theme;
export default theme;
