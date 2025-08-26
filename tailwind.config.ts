import type { Config } from 'tailwindcss'

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
