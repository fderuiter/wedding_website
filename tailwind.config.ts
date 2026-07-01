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
        primary: 'var(--color-primary, ' + appTheme.colors.primary + ')',
        secondary: 'var(--color-secondary, ' + appTheme.colors.secondary + ')',
        'primary-light': appTheme.colors.primaryLight,
        'secondary-light': appTheme.colors.secondaryLight,
        background: appTheme.colors.backgroundDark,
        foreground: appTheme.colors.foregroundDark,
        text: appTheme.colors.text,
        'text-on-primary': appTheme.colors.textOnPrimary,
        'text-on-secondary': appTheme.colors.textOnSecondary,
        accent: 'var(--color-accent, ' + appTheme.colors.accent + ')',
        'accent-from': 'var(--color-primary, ' + appTheme.colors.primary + ')',
        'accent-to': 'var(--color-secondary, ' + appTheme.colors.secondary + ')',
        gold: appTheme.colors.gold,
        silver: appTheme.colors.silver,
        border: appTheme.colors.border,
      },
      textColor: {
        primary: 'var(--color-primary-text, var(--color-primary, ' + appTheme.colors.primary + '))',
        secondary: 'var(--color-secondary-text, var(--color-secondary, ' + appTheme.colors.secondary + '))',
        accent: 'var(--color-accent-text, var(--color-accent, ' + appTheme.colors.accent + '))',
      },
      fontFamily: {
        sans: appTheme.typography.fontFamily.sans.split(', '),
        mono: appTheme.typography.fontFamily.mono.split(', '),
      },
      spacing: {
        header: appTheme.spacing.headerHeight,
      },
    },
  },
  plugins: [],
}
export default config
