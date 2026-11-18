import path from 'path';
import tailwindcssPostcss from '@tailwindcss/postcss';
import type { StorybookConfig } from '@storybook/react-webpack5';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: [
    '@storybook/addon-essentials',
  ],
  framework: {
    name: '@storybook/react-webpack5',
    options: {},
  },
  staticDirs: ['../public'],
  webpackFinal: async (webpackConfig) => {
    webpackConfig.resolve = webpackConfig.resolve || {};
    webpackConfig.resolve.alias = {
      ...webpackConfig.resolve.alias,
      '@': path.resolve(__dirname, '../src'),
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
                ['@babel/preset-env', { targets: { browsers: 'defaults' } }],
                ['@babel/preset-react', { runtime: 'automatic' }],
                '@babel/preset-typescript',
              ],
            },
          },
        ],
      });

      // Update CSS rule to include postcss-loader for Tailwind CSS v4
      const cssRule = webpackConfig.module.rules.find(
        (rule: any) => rule && rule.test && rule.test.toString().includes('css')
      ) as any;

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
