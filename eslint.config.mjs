import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import stylistic from '@stylistic/eslint-plugin';
import unusedImports from 'eslint-plugin-unused-imports';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import noDeprecatedImports from './eslint-rules/no-deprecated-imports.mjs';
import noRestrictedUtilityImports from './eslint-rules/no-restricted-utility-imports.mjs';
import { FlatCompat } from '@eslint/eslintrc';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const ensureFlatConfig = (config) => {
  if (Array.isArray(config)) {
    return config;
  }
  return compat.config(config);
};

const eslintConfig = [
  {
    ignores: [
      'docs-portal/**',
      'storybook-static/**',
      'public/mockServiceWorker.js',
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'dist/**',
      'test-results/**',
    ],
  },
  ...ensureFlatConfig(nextCoreWebVitals),
  ...ensureFlatConfig(nextTypescript),
  {
    plugins: {
      '@stylistic': stylistic,
      'unused-imports': unusedImports,
      react,
      'react-hooks': reactHooks,
      'local-rules': {
        rules: {
          'no-deprecated-imports': noDeprecatedImports,
          'no-restricted-utility-imports': noRestrictedUtilityImports,
        },
      },
    },
    rules: {
      'local-rules/no-restricted-utility-imports': 'error',
      'local-rules/no-deprecated-imports': 'warn',
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
      '@stylistic/indent': ['error', 2],
      '@stylistic/semi': ['error', 'always'],
      
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/features/*/*',
                '../features/*/*',
                '../../features/*/*',
                '../../../features/*/*',
                '../../../../features/*/*',
                '../../../../../features/*/*',
              ],
              message: 'Features should only be imported via their public index.ts exported interfaces to prevent cross-domain leakage.'
            }
          ]
        }
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-require-imports': 'error',
      'prefer-const': 'warn',
      'react/no-unescaped-entities': 'warn',

      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        { vars: 'all', varsIgnorePattern: '^_', args: 'after-used', argsIgnorePattern: '^_' }
      ]
    }
  },
  {
    files: ['**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  }
];

export default eslintConfig;
