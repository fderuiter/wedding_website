if (typeof globalThis.structuredClone === 'undefined') {
  globalThis.structuredClone = (val) => JSON.parse(JSON.stringify(val));
}
if (typeof global.structuredClone === 'undefined') {
  global.structuredClone = globalThis.structuredClone;
}

import { execFileSync } from 'child_process';
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

  describe('repository ESLint flat config scoping, TypeScript signatures, and baseline ratchet', () => {
    interface ProbeMessage {
      ruleId: string | null;
      severity: number;
      message: string;
    }

    interface ProbeResults {
      configs: Record<
        string,
        {
          react19HookSeverities: Record<string, number>;
          reactOrHookRuleKeys: string[];
        }
      >;
      signatureProbe: {
        errorCount: number;
        warningCount: number;
        messages: ProbeMessage[];
      };
      anyProbes: Record<string, ProbeMessage[]>;
    }

    let probeResults: ProbeResults;

    beforeAll(() => {
      const probeScript = `
        import { ESLint } from 'eslint';

        const react19Rules = ${JSON.stringify(REACT_19_HOOK_RULES)};
        const eslint = new ESLint({ cwd: process.cwd() });

        const normalizeSeverity = (entry) => {
          const raw = Array.isArray(entry) ? entry[0] : entry;
          if (raw === 'error' || raw === 2) return 2;
          if (raw === 'warn' || raw === 1) return 1;
          return 0;
        };

        const configTargets = [
          'src/components/MediaImage.tsx',
          'src/hooks/useUnified3DInput.ts',
          'scripts/check-quality.ts',
          'e2e/verification.spec.ts',
          'src/utils/cn.ts',
        ];

        const configs = {};
        for (const target of configTargets) {
          const cfg = await eslint.calculateConfigForFile(target);
          const rules = cfg?.rules ?? {};
          const react19HookSeverities = {};
          for (const ruleName of react19Rules) {
            react19HookSeverities[ruleName] = normalizeSeverity(rules[\`react-hooks/\${ruleName}\`]);
          }
          const reactOrHookRuleKeys = Object.keys(rules).filter(
            (key) => key.startsWith('react/') || key.startsWith('react-hooks/') || key.startsWith('jsx-a11y/')
          );
          configs[target] = { react19HookSeverities, reactOrHookRuleKeys };
        }

        const sampleCode = [
          'export interface ServiceContract {',
          '  execute(command: string, cwd: string): Promise<void>;',
          '}',
          'export type EventHandler = (event: string, payload: number) => void;',
          'export function overloaded(id: string): string;',
          'export function overloaded(id: number): string;',
          'export function overloaded(this: unknown, id: string | number): string {',
          "  const _ignored = id;",
          "  const { secret, ...publicFields } = { secret: 'x', label: 'ok' };",
          '  try {',
          '    return String(publicFields.label);',
          '  } catch (err) {',
          "    return '';",
          '  }',
          '}',
          'export class ParameterPropertyHolder {',
          '  constructor(public readonly name: string) {}',
          '}',
          '',
        ].join('\\n');

        const [sigRes] = await eslint.lintText(sampleCode, { filePath: 'src/utils/cleanSignatureProbe.ts' });

        const anySnippet = 'export const untypedValue: any = 42;\\n';
        const anyTargets = [
          'src/utils/cleanAnyProbe.ts',
          'src/utils/__tests__/exemptAnyProbe.test.ts',
          'e2e/exemptAnyProbe.spec.ts',
          'scripts/exemptAnyProbe.ts',
          '.storybook/main.ts',
        ];
        const anyProbes = {};
        for (const target of anyTargets) {
          const [res] = await eslint.lintText(anySnippet, { filePath: target });
          anyProbes[target] = res.messages.map((m) => ({
            ruleId: m.ruleId,
            severity: m.severity,
            message: m.message,
          }));
        }

        process.stdout.write(JSON.stringify({
          configs,
          signatureProbe: {
            errorCount: sigRes.errorCount,
            warningCount: sigRes.warningCount,
            messages: sigRes.messages.map((m) => ({
              ruleId: m.ruleId,
              severity: m.severity,
              message: m.message,
            })),
          },
          anyProbes,
        }));
      `;

      const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', probeScript], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });
      probeResults = JSON.parse(stdout) as ProbeResults;
    });

    it('reports active React 19 react-hooks/* rules for .tsx and hook files and 0 react/* or react-hooks/* rules for non-React files', () => {
      for (const reactTarget of ['src/components/MediaImage.tsx', 'src/hooks/useUnified3DInput.ts']) {
        const targetCfg = probeResults.configs[reactTarget];
        expect(targetCfg).toBeDefined();
        for (const ruleName of REACT_19_HOOK_RULES) {
          expect(targetCfg.react19HookSeverities[ruleName]).toBe(2);
        }
      }

      for (const nonReactTarget of ['scripts/check-quality.ts', 'e2e/verification.spec.ts', 'src/utils/cn.ts']) {
        const targetCfg = probeResults.configs[nonReactTarget];
        expect(targetCfg).toBeDefined();
        expect(targetCfg.reactOrHookRuleKeys).toEqual([]);
      }
    });

    it('caps shrink-only legacy baseline overrides at <= 119 existing files without wildcards', () => {
      const arrayRegex = /const\s+(LEGACY_[A-Z0-9_]+_BASELINE_FILES)\s*=\s*\[([\s\S]*?)\];/g;
      const baselineGroups = new Map<string, string[]>();
      let match: RegExpExecArray | null;

      while ((match = arrayRegex.exec(configSource)) !== null) {
        const groupName = match[1];
        const entries = Array.from(match[2].matchAll(/'([^']+)'/g), (m) => m[1]);
        baselineGroups.set(groupName, entries);
      }

      expect(baselineGroups.size).toBeGreaterThan(0);
      const anyBaseline = baselineGroups.get('LEGACY_EXPLICIT_ANY_BASELINE_FILES') ?? [];
      expect(anyBaseline.length).toBeLessThanOrEqual(111);

      const allBaselineFiles = new Set<string>();
      for (const files of baselineGroups.values()) {
        for (const relFile of files) {
          expect(relFile).not.toContain('*');
          expect(fs.existsSync(path.resolve(process.cwd(), relFile))).toBe(true);
          allBaselineFiles.add(relFile);
        }
      }

      expect(allBaselineFiles.has('src/components/ui/__tests__/Overlay.test.tsx')).toBe(true);
      expect(allBaselineFiles.size).toBeLessThanOrEqual(119);
    });

    it('emits 0 unused-imports/no-unused-vars warnings on TypeScript signatures, catch bindings, and rest siblings', () => {
      const unusedVarMessages = probeResults.signatureProbe.messages.filter(
        (m) => m.ruleId === 'unused-imports/no-unused-vars'
      );
      expect(unusedVarMessages).toEqual([]);
      expect(probeResults.signatureProbe.errorCount).toBe(0);
      expect(probeResults.signatureProbe.warningCount).toBe(0);
    });

    it('enforces @typescript-eslint/no-explicit-any as an error in clean src/ files and exempts tests, e2e/, scripts/, and .storybook/main.ts', () => {
      expect(
        probeResults.anyProbes['src/utils/cleanAnyProbe.ts'].some(
          (m) => m.ruleId === '@typescript-eslint/no-explicit-any' && m.severity === 2
        )
      ).toBe(true);

      for (const exemptPath of [
        'src/utils/__tests__/exemptAnyProbe.test.ts',
        'e2e/exemptAnyProbe.spec.ts',
        'scripts/exemptAnyProbe.ts',
        '.storybook/main.ts',
      ]) {
        expect(
          probeResults.anyProbes[exemptPath].filter(
            (m) => m.ruleId === '@typescript-eslint/no-explicit-any'
          )
        ).toEqual([]);
      }
    });
  });
});
