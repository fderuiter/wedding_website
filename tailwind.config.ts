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
 * - `plugins`: Any additional Tailwind CSS plugins to be used. Currently, none are configured.
 */
const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
export default config
