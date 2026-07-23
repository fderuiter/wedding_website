import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import stylistic from '@stylistic/eslint-plugin';
import unusedImports from 'eslint-plugin-unused-imports';

const isCI = process.env.CI === 'true' || process.env.CI === '1' || process.env.GITHUB_ACTIONS === 'true';
const severity = isCI ? 'error' : 'warn';

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    plugins: {
      '@stylistic': stylistic,
      'unused-imports': unusedImports,
    },
    rules: {
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
      '@stylistic/indent': ['error', 2],
      '@stylistic/semi': ['error', 'always'],
      
      // Downgrade previously failing rules to warn locally to avoid breaking local velocity,
      // but promote to block-level errors on CI to maintain code quality.
      'no-restricted-imports': [
        severity,
        {
          patterns: [
            {
              group: ['@/features/*/*'],
              message: 'Features should only be imported via their public index.ts exported interfaces to prevent cross-domain leakage.'
            }
          ]
        }
      ],
      '@typescript-eslint/no-explicit-any': severity,
      '@typescript-eslint/no-require-imports': severity,
      'prefer-const': severity,
      'react/no-unescaped-entities': severity,
      'react-hooks/set-state-in-effect': severity,
      'react-hooks/immutability': severity,
      'react-hooks/static-components': severity,
      'react-hooks/purity': severity,
      'react-hooks/refs': severity,

      '@typescript-eslint/no-unused-vars': isCI ? 'error' : 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        isCI ? 'error' : 'warn',
        { vars: 'all', varsIgnorePattern: '^_', args: 'after-used', argsIgnorePattern: '^_' }
      ]
    }
  }
];

export default eslintConfig;
