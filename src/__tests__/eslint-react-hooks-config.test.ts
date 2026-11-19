if (typeof globalThis.structuredClone === 'undefined') {
  globalThis.structuredClone = (val) => JSON.parse(JSON.stringify(val));
}
if (typeof global.structuredClone === 'undefined') {
  global.structuredClone = globalThis.structuredClone;
}

import fs from 'fs';
import path from 'path';
import { Linter, type Rule } from 'eslint';
import reactHooks from 'eslint-plugin-react-hooks';

const REACT_19_HOOK_RULES = [
  'set-state-in-effect',
  'immutability',
  'static-components',
  'purity',
  'refs',
] as const;

describe('eslint-plugin-react-hooks configuration and rule enforcement', () => {
  const configPath = path.resolve(process.cwd(), 'eslint.config.mjs');
  const configSource = fs.readFileSync(configPath, 'utf8');

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
