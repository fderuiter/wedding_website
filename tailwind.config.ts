/**
 * @type {import('tailwindcss').Config}
 */
import type { Config } from 'tailwindcss'

/**
 * @description Tailwind CSS configuration object.
 *
 * This configuration specifies:
 * - `content`: The files that Tailwind should scan to find class names. This includes
 *   all JavaScript, TypeScript, and MDX files within the `src`, `pages`, `components`, and `app` directories.
 * - `theme.extend.colors`: Custom color definitions that extend Tailwind's default color palette.
 *   This is used to define brand-specific colors for gradients and text.
 * - `plugins`: Any additional Tailwind CSS plugins to be used. Currently, none are configured.
 */
const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'accent-from': '#f43f5e',
        'accent-to': '#fbbf24',
        'text-on-primary': '#ffffff',
      },
    },
  },
  plugins: [],
}
export default config
