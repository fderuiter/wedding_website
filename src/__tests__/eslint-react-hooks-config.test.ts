if (typeof globalThis.structuredClone === 'undefined') {
  globalThis.structuredClone = (val) => JSON.parse(JSON.stringify(val));
}
if (typeof global.structuredClone === 'undefined') {
  global.structuredClone = globalThis.structuredClone;
}

import fs from 'fs';
import path from 'path';
import { Linter, type ESLint, type Rule } from 'eslint';
import tsEslintPlugin from '@typescript-eslint/eslint-plugin';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import unusedImports from 'eslint-plugin-unused-imports';

const REACT_19_HOOK_RULES = [
  'set-state-in-effect',
  'immutability',
  'static-components',
  'purity',
  'refs',
] as const;

const PROMOTED_ERROR_RULES = [
  'local-rules/no-restricted-utility-imports',
  'local-rules/no-deprecated-imports',
  'prefer-const',
  'react/no-unescaped-entities',
  'react-hooks/exhaustive-deps',
  'jsx-a11y/role-supports-aria-props',
  '@next/next/no-location-assign-relative-destination',
  '@next/next/no-img-element',
  'unused-imports/no-unused-imports',
  'unused-imports/no-unused-vars',
] as const;

describe('eslint-plugin-react-hooks configuration and rule enforcement', () => {
  const configPath = path.resolve(process.cwd(), 'eslint.config.mjs');
  const configSource = fs.readFileSync(configPath, 'utf8');
  const packageJsonPath = path.resolve(process.cwd(), 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
    'lint-staged'?: Record<string, string>;
  };

  it('does not overwrite or silence react-hooks rules in eslint.config.mjs', () => {
    expect(configSource).not.toContain('noopRule');
    expect(configSource).not.toContain('nonStandardRules');
    expect(configSource).not.toMatch(/reactHooks\.rules\s*\[/);
    expect(configSource).toContain("import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'");
    expect(configSource).toContain("'react-hooks': reactHooks");

    for (const ruleName of REACT_19_HOOK_RULES) {
      const disableOrWarnPattern = new RegExp(
        `['"]react-hooks/${ruleName}['"]\\s*:\\s*(?:['"](?:off|warn)['"]|0|1|\\[\\s*(?:['"](?:off|warn)['"]|0|1))`
      );
      expect(configSource).not.toMatch(disableOrWarnPattern);
    }
  });

  it('promotes non-any rules to error and configures --max-warnings ratchets', () => {
    for (const ruleId of PROMOTED_ERROR_RULES) {
      const escapedRule = ruleId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const errorSeverityPattern = new RegExp(
        `['"]${escapedRule}['"]\\s*:\\s*(?:['"]error['"]|\\[\\s*['"]error['"])`
      );
      expect(configSource).toMatch(errorSeverityPattern);
    }

    expect(packageJson.devDependencies?.['typescript-eslint']).toBeDefined();
    expect(packageJson.devDependencies?.['@typescript-eslint/eslint-plugin']).toBeDefined();
    expect(packageJson.scripts?.lint).toMatch(/\beslint\s+\.\s+--max-warnings=\d+\b/);
    expect(packageJson['lint-staged']?.['*.{js,jsx,ts,tsx}']).toContain('--max-warnings=0');
  });

  it('preserves authentic implementations for all five React 19 react-hooks rules', () => {
    const rulesRecord = reactHooks.rules as Record<string, Rule.RuleModule>;

    for (const ruleName of REACT_19_HOOK_RULES) {
      const rule = rulesRecord[ruleName];
      expect(rule).toBeDefined();
      expect(typeof rule.create).toBe('function');
      expect(rule.meta).toBeDefined();

      // Ensure the rule is not replaced by an empty no-op visitor
      const source = Function.prototype.toString.call(rule.create);
      expect(source).not.toMatch(/create\s*\(\s*\)\s*\{\s*return\s*\{\s*\}\s*;?\s*\}/);
    }
  });

  describe('TypeScript unused-imports/no-unused-vars resolution', () => {
    const tsLinter = new Linter({ configType: 'flat' });
    const tsUnusedVarsConfig: Linter.Config[] = [
      {
        files: ['**/*.ts', '**/*.tsx'],
        languageOptions: {
          ecmaVersion: 2022,
          sourceType: 'module',
          parser: tseslint.parser as Linter.Parser,
          parserOptions: {
            ecmaFeatures: { jsx: true },
          },
        },
        plugins: {
          '@typescript-eslint': tsEslintPlugin as unknown as ESLint.Plugin,
          'unused-imports': unusedImports as unknown as ESLint.Plugin,
        },
        rules: {
          '@typescript-eslint/no-unused-vars': 'off',
          'unused-imports/no-unused-imports': 'error',
          'unused-imports/no-unused-vars': [
            'error',
            { vars: 'all', varsIgnorePattern: '^_', args: 'after-used', argsIgnorePattern: '^_' },
          ],
        },
      },
    ];

    it('produces zero unused-imports/no-unused-vars errors on TypeScript interfaces, overloads, constructor properties, and enums', () => {
      const code = `
        export interface SearchableTimezoneSelectProps {
          value: string;
          onChange: (val: string) => void;
        }

        export enum InvitationStatus {
          Pending = 'PENDING',
          Accepted = 'ACCEPTED',
          Declined = 'DECLINED',
        }

        export function formatGreeting(name: string): string;
        export function formatGreeting(first: string, last: string): string;
        export function formatGreeting(first: string, last?: string): string {
          return last ? \`\${first} \${last}\` : first;
        }

        export class SampleService {
          constructor(
            public readonly modelName: string,
            protected readonly maxRetries: number = 3,
            private readonly endpoint: string = '/api/sample'
          ) {}

          describeEndpoint(): string {
            return \`\${this.modelName}:\${this.endpoint}:\${this.maxRetries}\`;
          }
        }
      `;

      const messages = tsLinter.verify(code, tsUnusedVarsConfig, {
        filename: 'TypeSignatures.ts',
      });
      const unusedVarMessages = messages.filter(
        (m) => m.ruleId === 'unused-imports/no-unused-vars'
      );
      expect(unusedVarMessages).toEqual([]);
      expect(messages).toEqual([]);
    });

    it('emits zero unused-imports/no-unused-vars diagnostics on src/core/infrastructure/repository.ts', () => {
      const repoFilePath = path.resolve(
        process.cwd(),
        'src/core/infrastructure/repository.ts'
      );
      const repoSource = fs.readFileSync(repoFilePath, 'utf8');
      const messages = tsLinter.verify(repoSource, tsUnusedVarsConfig, {
        filename: 'src/core/infrastructure/repository.ts',
      });
      expect(messages).toEqual([]);
    });

    it('reports genuine unused variables as severity 2 errors while honoring underscore prefixes', () => {
      const code = `
        export function computeTotal(price: number, _unusedContext: string): number {
          const staleTotal = price * 2;
          const _ignoredLocal = price;
          return price;
        }
      `;

      const messages = tsLinter.verify(code, tsUnusedVarsConfig, {
        filename: 'UnusedVariableSample.ts',
      });
      expect(messages).toHaveLength(1);
      expect(messages[0]?.ruleId).toBe('unused-imports/no-unused-vars');
      expect(messages[0]?.severity).toBe(2);
      expect(messages[0]?.message).toContain('staleTotal');
    });
  });

  describe('AST enforcement via ESLint flat Linter', () => {
    const linter = new Linter({ configType: 'flat' });
    const baseConfig: Linter.Config[] = [
      {
        files: ['**/*.jsx', '**/*.js'],
        plugins: {
          'react-hooks': reactHooks as unknown as Record<string, unknown>,
        },
        languageOptions: {
          ecmaVersion: 2022,
          sourceType: 'module',
          parserOptions: {
            ecmaFeatures: { jsx: true },
          },
        },
        rules: {
          'react-hooks/set-state-in-effect': 'error',
          'react-hooks/immutability': 'error',
          'react-hooks/static-components': 'error',
          'react-hooks/purity': 'error',
          'react-hooks/refs': 'error',
        },
      },
    ];

    it('accepts compliant React Hooks components with zero errors', () => {
      const code = `
        import { useEffect, useRef, useState } from 'react';
        export function ValidComponent({ initialCount }) {
          const [count, setCount] = useState(initialCount);
          const latestCountRef = useRef(count);
          useEffect(() => {
            latestCountRef.current = count;
          }, [count]);
          return <button onClick={() => setCount((c) => c + 1)}>{count}</button>;
        }
      `;
      const messages = linter.verify(code, baseConfig, { filename: 'ValidComponent.jsx' });
      expect(messages).toEqual([]);
    });

    it('reports react-hooks/set-state-in-effect as an error', () => {
      const code = `
        import { useEffect, useState } from 'react';
        export function SyncEffectState({ value }) {
          const [local, setLocal] = useState('');
          useEffect(() => {
            setLocal(value);
          }, [value]);
          return <div>{local}</div>;
        }
      `;
      const messages = linter.verify(code, baseConfig, { filename: 'SyncEffectState.jsx' });
      expect(messages.some((m) => m.ruleId === 'react-hooks/set-state-in-effect' && m.severity === 2)).toBe(true);
    });

    it('reports react-hooks/immutability as an error', () => {
      const code = `
        export function MutatePropComponent(props) {
          props.user.name = 'mutated';
          return <div>{props.user.name}</div>;
        }
      `;
      const messages = linter.verify(code, baseConfig, { filename: 'MutatePropComponent.jsx' });
      expect(messages.some((m) => m.ruleId === 'react-hooks/immutability' && m.severity === 2)).toBe(true);
    });

    it('reports react-hooks/static-components as an error', () => {
      const code = `
        export function OuterComponent() {
          function NestedComponent() {
            return <span>nested</span>;
          }
          return <NestedComponent />;
        }
      `;
      const messages = linter.verify(code, baseConfig, { filename: 'OuterComponent.jsx' });
      expect(messages.some((m) => m.ruleId === 'react-hooks/static-components' && m.severity === 2)).toBe(true);
    });

    it('reports react-hooks/purity as an error', () => {
      const code = `
        export function ImpureComponent() {
          const now = Date.now();
          return <span>{now}</span>;
        }
      `;
      const messages = linter.verify(code, baseConfig, { filename: 'ImpureComponent.jsx' });
      expect(messages.some((m) => m.ruleId === 'react-hooks/purity' && m.severity === 2)).toBe(true);
    });

    it('reports react-hooks/refs as an error', () => {
      const code = `
        import { useRef } from 'react';
        export function RenderRefMutation() {
          const renderCountRef = useRef(0);
          renderCountRef.current += 1;
          return <span>{renderCountRef.current}</span>;
        }
      `;
      const messages = linter.verify(code, baseConfig, { filename: 'RenderRefMutation.jsx' });
      expect(messages.some((m) => m.ruleId === 'react-hooks/refs' && m.severity === 2)).toBe(true);
    });
  });
});
