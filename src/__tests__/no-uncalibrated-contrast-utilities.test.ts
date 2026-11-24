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

  it('reports uncalibrated status text utilities and text-white status fills (WCAG 1.4.3 / F24)', () => {
    const invalidStatusCode = `
      import { cn } from '@/utils/cn';

      export function InvalidStatusSamples({ isPast }: { isPast: boolean }) {
        return (
          <div>
            <button className="bg-emerald-600 hover:bg-emerald-700 text-white">Approve</button>
            <button className="bg-amber-600 dark:hover:bg-amber-600 text-white">Import</button>
            <span className="text-emerald-600 dark:text-emerald-400 text-xs">Stripe Ref</span>
            <span className="text-amber-600 dark:text-amber-400 text-xs">Warning</span>
            <em className="text-amber-500">&lt;auto-generate&gt;</em>
            <span className={cn('w-5 h-5', isPast ? 'bg-emerald-600 text-white' : 'text-muted-text')}>
              ✓
            </span>
          </div>
        );
      }
    `;

    const messages = linter.verify(invalidStatusCode, ruleConfig, {
      filename: 'src/components/InvalidStatus.tsx',
    });
    const messageIds = messages.map((m) => m.messageId);

    expect(messageIds.filter((id) => id === 'uncalibratedStatusFill').length).toBeGreaterThanOrEqual(3);
    expect(messageIds.filter((id) => id === 'uncalibratedStatusText').length).toBeGreaterThanOrEqual(3);
  });

  it('exempts calibrated status tokens, dark-foreground pills, G145 large text, decorative icons, and checkboxes', () => {
    const validExemptionsCode = `
      import { Icon } from '@/components/ui/Icon';

      export function ValidStatusExemptions() {
        return (
          <div>
            <span className="text-status-success-text text-xs">All RSVPs up to date</span>
            <span className="text-status-warning-text text-xs">Guest Message:</span>
            <p className="text-warning-text text-xs">Capacity warning</p>
            <a href="https://example.com" className="text-secondary-text underline text-xs">Vendor</a>
            <span className="bg-amber-500 text-stone-900 text-[10px] font-bold">Pending</span>
            <div className="bg-emerald-100 text-emerald-600 text-3xl font-bold">✓</div>
            <div className="text-2xl font-black text-amber-600">4</div>
            <div className="text-xl font-bold text-emerald-600">12</div>
            <Icon name="Check" className="w-5 h-5 text-emerald-500" />
            <svg className="w-4 h-4 text-amber-600" viewBox="0 0 24 24" />
            <span aria-hidden="true" className="text-amber-500">★</span>
            <input type="checkbox" className="rounded text-amber-600 focus:ring-amber-500" />
            <div role="progressbar" className="h-full bg-emerald-600" />
          </div>
        );
      }
    `;

    const messages = linter.verify(validExemptionsCode, ruleConfig, {
      filename: 'src/components/ValidStatusExemptions.tsx',
    });
    expect(messages).toEqual([]);
  });
});
