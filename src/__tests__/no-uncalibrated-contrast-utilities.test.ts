if (typeof globalThis.structuredClone === 'undefined') {
  globalThis.structuredClone = (val) => JSON.parse(JSON.stringify(val));
}
if (typeof global.structuredClone === 'undefined') {
  global.structuredClone = globalThis.structuredClone;
}

import fs from 'fs';
import path from 'path';
import { Linter, type ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import noUncalibratedContrastUtilities from '../../eslint-rules/no-uncalibrated-contrast-utilities.mjs';

describe('local-rules/no-uncalibrated-contrast-utilities', () => {
  const configPath = path.resolve(process.cwd(), 'eslint.config.mjs');
  const configSource = fs.readFileSync(configPath, 'utf8');

  const linter = new Linter({ configType: 'flat' });
  const ruleConfig: Linter.Config[] = [
    {
      files: ['**/*.tsx', '**/*.ts'],
      languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        parser: tseslint.parser as Linter.Parser,
        parserOptions: {
          ecmaFeatures: { jsx: true },
        },
      },
      plugins: {
        'local-rules': {
          rules: {
            'no-uncalibrated-contrast-utilities': noUncalibratedContrastUtilities,
          },
        } as unknown as ESLint.Plugin,
      },
      rules: {
        'local-rules/no-uncalibrated-contrast-utilities': 'error',
      },
    },
  ];

  it('registers local-rules/no-uncalibrated-contrast-utilities at error severity in eslint.config.mjs', () => {
    expect(configSource).toContain(
      "import noUncalibratedContrastUtilities from './eslint-rules/no-uncalibrated-contrast-utilities.mjs';"
    );
    expect(configSource).toMatch(
      /['"]local-rules\/no-uncalibrated-contrast-utilities['"]\s*:\s*['"]error['"]/
    );
  });

  it('allows calibrated semantic tokens, dark-paired neutral utilities, and paired translucent surfaces', () => {
    const validCode = `
      import { cn } from '@/lib/utils';

      export function ValidSamples({ active }: { active: boolean }) {
        return (
          <div className="bg-white/80 dark:bg-gray-900/80 p-4">
            <p className="text-muted-text">Semantic muted text</p>
            <p className="text-gray-500 dark:text-gray-400">Explicitly paired text</p>
            <span className="bg-white/95 text-slate-900">Explicit light badge</span>
            <button className={cn('px-2 py-1', active ? 'text-primary' : 'text-muted-text')}>
              Toggle
            </button>
          </div>
        );
      }
    `;

    const messages = linter.verify(validCode, ruleConfig, { filename: 'src/components/Sample.tsx' });
    expect(messages).toEqual([]);
  });

  it('reports uncalibrated 400/500 neutral text utilities and unpaired bg-white/80 overlays', () => {
    const invalidCode = `
      import { cn } from '@/lib/utils';

      export function InvalidSamples({ muted }: { muted: boolean }) {
        return (
          <div>
            <span className="text-gray-400">Fails light contrast</span>
            <span className="text-stone-500">Fails dark contrast</span>
            <span className="text-gray-400 dark:text-zinc-500">Fails both modes</span>
            <button className={cn('rounded', muted && 'text-slate-400')}>Helper call</button>
            <div className="bg-white/80 px-3 py-1">Unpaired translucent pill</div>
          </div>
        );
      }
    `;

    const messages = linter.verify(invalidCode, ruleConfig, { filename: 'src/components/Invalid.tsx' });
    expect(messages.length).toBeGreaterThanOrEqual(6);
    for (const msg of messages) {
      expect(msg.ruleId).toBe('local-rules/no-uncalibrated-contrast-utilities');
      expect(msg.severity).toBe(2);
    }
  });
});
