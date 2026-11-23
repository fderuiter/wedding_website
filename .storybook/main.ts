import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import tailwindcssPostcss from '@tailwindcss/postcss';
import type { StorybookConfig } from '@storybook/react-webpack5';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: ['@storybook/addon-docs'],
  framework: {
    name: '@storybook/react-webpack5',
    options: {
      builder: {
        fsCache: true,
      },
    },
  },
  staticDirs: [
    { from: '../public/fonts', to: '/fonts' },
    { from: '../public/images', to: '/images' },
    { from: '../public/assets', to: '/assets' },
    { from: '../public/mockServiceWorker.js', to: '/mockServiceWorker.js' },
  ],
  webpackFinal: async (webpackConfig) => {
    webpackConfig.resolve = webpackConfig.resolve || {};
    webpackConfig.resolve.alias = {
      ...webpackConfig.resolve.alias,
      '@': path.resolve(currentDir, '../src'),
    };

    webpackConfig.experiments = {
      ...webpackConfig.experiments,
      typescript: false,
    };

    if (webpackConfig.module && webpackConfig.module.rules) {
      // Add babel-loader for TypeScript and React TSX
      webpackConfig.module.rules.push({
        test: /\.(ts|tsx)$/,
        exclude: /node_modules/,
        use: [
          {
            loader: require.resolve('babel-loader'),
            options: {
              presets: [
                [require.resolve('@babel/preset-env'), { targets: { browsers: 'defaults' } }],
                [require.resolve('@babel/preset-react'), { runtime: 'automatic' }],
                [require.resolve('@babel/preset-typescript'), { onlyRemoveTypeImports: false }],
              ],
            },
          },
        ],
      });

      // Update CSS rule to include postcss-loader for Tailwind CSS v4
      const cssRule = webpackConfig.module.rules.find(
        (rule): rule is Exclude<typeof rule, string | number | boolean | null | undefined> =>
          Boolean(
            rule &&
            typeof rule === 'object' &&
            'test' in rule &&
            rule.test &&
            rule.test.toString().includes('css')
          )
      );

      if (cssRule && Array.isArray(cssRule.use)) {
        cssRule.use.push({
          loader: require.resolve('postcss-loader'),
          options: {
            postcssOptions: {
              plugins: [
                tailwindcssPostcss,
              ],
            },
          },
        });
      }
    }

    return webpackConfig;
  },
};

export default config;
