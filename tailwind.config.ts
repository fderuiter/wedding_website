import type { Config } from 'tailwindcss'
import { theme as appTheme } from './src/styles/theme'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: appTheme.colors.primary,
        secondary: appTheme.colors.secondary,
        'primary-light': appTheme.colors.primaryLight,
        'secondary-light': appTheme.colors.secondaryLight,
        background: appTheme.colors.backgroundDark,
        foreground: appTheme.colors.foregroundDark,
        text: appTheme.colors.text,
        'text-on-primary': appTheme.colors.textOnPrimary,
        'text-on-secondary': appTheme.colors.textOnSecondary,
        accent: appTheme.colors.accent,
        'accent-from': appTheme.colors.primary,
        'accent-to': appTheme.colors.secondary,
        gold: appTheme.colors.gold,
        silver: appTheme.colors.silver,
        border: appTheme.colors.border,
      },
    },
  },
  plugins: [],
}
export default config
