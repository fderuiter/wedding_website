if (typeof globalThis.structuredClone === 'undefined') {
  globalThis.structuredClone = (val) => JSON.parse(JSON.stringify(val));
}
if (typeof global.structuredClone === 'undefined') {
  global.structuredClone = globalThis.structuredClone;
}

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import LegacyButton, { legacyHelper } from '../components/ui/LegacyButton';
import noDeprecatedImportsRule from '../../eslint-rules/no-deprecated-imports.mjs';
import { RuleTester } from 'eslint';
import path from 'path';
import fs from 'fs';

// ESLint RuleTester integration
const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

describe('no-deprecated-imports ESLint Rule AST verification', () => {
  const tempModuleFile = path.resolve(process.cwd(), 'src/components/ui/TempDeprecatedModule.tsx');
  const tempMixedFile = path.resolve(process.cwd(), 'src/components/ui/TempMixedModule.tsx');

  beforeAll(() => {
    // Create a temporary module-level deprecated file
    fs.writeFileSync(
      tempModuleFile,
      '/**\n * @deprecated This entire module is deprecated.\n */\nexport const someExport = 123;\n',
      'utf-8'
    );

    // Create a temporary mixed deprecated file (first statement is not deprecated, second is)
    fs.writeFileSync(
      tempMixedFile,
      'export const validMember = 1;\n\n/**\n * @deprecated Use modernMember instead.\n */\nexport const deprecatedMember = 2;\n',
      'utf-8'
    );
  });

  afterAll(() => {
    // Clean up temporary files
    if (fs.existsSync(tempModuleFile)) {
      fs.unlinkSync(tempModuleFile);
    }
    if (fs.existsSync(tempMixedFile)) {
      fs.unlinkSync(tempMixedFile);
    }
  });

  ruleTester.run('no-deprecated-imports', noDeprecatedImportsRule, {
    valid: [
      {
        code: "import Button from '@/components/ui/Button';",
        filename: path.resolve(process.cwd(), 'src/utils/dummy.ts'),
      },
      {
        code: "import Button from '../components/ui/Button';",
        filename: path.resolve(process.cwd(), 'src/utils/dummy.ts'),
      },
      {
        code: "import { cn } from '@/utils/cn';",
        filename: path.resolve(process.cwd(), 'src/components/ui/Button.tsx'),
      },
      {
        code: "import { validMember } from '@/components/ui/TempMixedModule';",
        filename: path.resolve(process.cwd(), 'src/utils/dummy.ts'),
      },
    ],
    invalid: [
      {
        code: "import LegacyButton from '@/components/ui/LegacyButton';",
        filename: path.resolve(process.cwd(), 'src/utils/dummy.ts'),
        errors: [
          {
            messageId: 'deprecatedModule',
            line: 1,
          },
        ],
      },
      {
        code: "import LegacyButton from '../components/ui/LegacyButton';",
        filename: path.resolve(process.cwd(), 'src/utils/dummy.ts'),
        errors: [
          {
            messageId: 'deprecatedModule',
            line: 1,
          },
        ],
      },
      {
        code: "import { legacyHelper } from '@/components/ui/LegacyButton';",
        filename: path.resolve(process.cwd(), 'src/utils/dummy.ts'),
        errors: [
          {
            messageId: 'deprecatedModule',
            line: 1,
          },
        ],
      },
      {
        code: "import { someExport } from '@/components/ui/TempDeprecatedModule';",
        filename: path.resolve(process.cwd(), 'src/utils/dummy.ts'),
        errors: [
          {
            messageId: 'deprecatedModule',
            line: 1,
          },
        ],
      },
      {
        code: "import { deprecatedMember } from '@/components/ui/TempMixedModule';",
        filename: path.resolve(process.cwd(), 'src/utils/dummy.ts'),
        errors: [
          {
            messageId: 'deprecatedSpecifier',
            line: 1,
          },
        ],
      },
    ],
  });
});

describe('no-deprecated-imports ESLint Rule metadata and UI Coverage', () => {
  it('should expose the ESLint rule meta structure correctly', () => {
    expect(noDeprecatedImportsRule.meta.type).toBe('suggestion');
    expect(noDeprecatedImportsRule.meta.messages).toHaveProperty('deprecatedModule');
    expect(noDeprecatedImportsRule.meta.messages).toHaveProperty('deprecatedSpecifier');
  });

  it('should define a create function', () => {
    expect(typeof noDeprecatedImportsRule.create).toBe('function');
  });

  it('renders LegacyButton and calls legacyHelper to secure 100% coverage', () => {
    render(<LegacyButton />);
    expect(screen.getByRole('button', { name: /legacy button/i })).toBeInTheDocument();
    expect(legacyHelper()).toBe('legacy');
  });
});
