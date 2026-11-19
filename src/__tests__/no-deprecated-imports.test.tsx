if (typeof globalThis.structuredClone === 'undefined') {
  globalThis.structuredClone = (val) => JSON.parse(JSON.stringify(val));
}
if (typeof global.structuredClone === 'undefined') {
  global.structuredClone = globalThis.structuredClone;
}

import noDeprecatedImportsRule from '../../eslint-rules/no-deprecated-imports.mjs';
import { RuleTester } from 'eslint';
import type { Rule } from 'eslint';
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
  const tempCleanDefaultFile = path.resolve(process.cwd(), 'src/components/ui/TempCleanDefaultModule.tsx');
  const tempDeprecatedDefaultFile = path.resolve(process.cwd(), 'src/components/ui/TempDeprecatedDefaultModule.tsx');
  const tempEmptyTagDefaultFile = path.resolve(process.cwd(), 'src/components/ui/TempEmptyTagDefaultModule.tsx');
  const tempNamedExportDeclFile = path.resolve(process.cwd(), 'src/components/ui/TempNamedExportDeclModule.tsx');
  const tempFiles = [
    tempModuleFile,
    tempMixedFile,
    tempCleanDefaultFile,
    tempDeprecatedDefaultFile,
    tempEmptyTagDefaultFile,
    tempNamedExportDeclFile,
  ];

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

    // Create a clean default export assignment file (no @deprecated tags)
    fs.writeFileSync(
      tempCleanDefaultFile,
      'const CleanComponent = () => null;\n\nexport default CleanComponent;\n',
      'utf-8'
    );

    // Create a deprecated default export assignment file
    fs.writeFileSync(
      tempDeprecatedDefaultFile,
      'const LegacyComponent = () => null;\n\n/**\n * @deprecated Use CleanComponent instead.\n */\nexport default LegacyComponent;\n',
      'utf-8'
    );

    // Create a default export with an empty @deprecated tag comment
    fs.writeFileSync(
      tempEmptyTagDefaultFile,
      'const EmptyTagComponent = () => null;\n\n/**\n * @deprecated\n */\nexport default EmptyTagComponent;\n',
      'utf-8'
    );

    // Create a file using named export declarations (export { ... }) with clean and deprecated members
    fs.writeFileSync(
      tempNamedExportDeclFile,
      [
        'const cleanNamed = 1;',
        'const cleanSource = 2;',
        '/** @deprecated Use cleanNamed instead. */',
        'const deprecatedNamed = 3;',
        '/** @deprecated */',
        'const emptyTagNamed = 4;',
        'export { cleanNamed, cleanSource as aliasedClean, deprecatedNamed, deprecatedNamed as aliasedDeprecated, emptyTagNamed };',
        '',
      ].join('\n'),
      'utf-8'
    );
  });

  afterAll(() => {
    // Clean up temporary files
    for (const file of tempFiles) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }
  });

  ruleTester.run('no-deprecated-imports', noDeprecatedImportsRule as unknown as Rule.RuleModule, {
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
      {
        code: "import EmptyState from '@/components/EmptyState';",
        filename: path.resolve(process.cwd(), 'src/utils/dummy.ts'),
      },
      {
        code: "import CleanComponent from '@/components/ui/TempCleanDefaultModule';",
        filename: path.resolve(process.cwd(), 'src/utils/dummy.ts'),
      },
      {
        code: "import { cleanNamed, aliasedClean } from '@/components/ui/TempNamedExportDeclModule';",
        filename: path.resolve(process.cwd(), 'src/utils/dummy.ts'),
      },
    ],
    invalid: [
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
        code: "import { someExport } from '../components/ui/TempDeprecatedModule';",
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
      {
        code: "import LegacyComponent from '@/components/ui/TempDeprecatedDefaultModule';",
        filename: path.resolve(process.cwd(), 'src/utils/dummy.ts'),
        errors: [
          {
            messageId: 'deprecatedSpecifier',
            line: 1,
          },
        ],
      },
      {
        code: "import EmptyTagComponent from '@/components/ui/TempEmptyTagDefaultModule';",
        filename: path.resolve(process.cwd(), 'src/utils/dummy.ts'),
        errors: [
          {
            messageId: 'deprecatedSpecifier',
            line: 1,
          },
        ],
      },
      {
        code: "import { deprecatedNamed, aliasedDeprecated, emptyTagNamed } from '@/components/ui/TempNamedExportDeclModule';",
        filename: path.resolve(process.cwd(), 'src/utils/dummy.ts'),
        errors: [
          {
            messageId: 'deprecatedSpecifier',
            line: 1,
          },
          {
            messageId: 'deprecatedSpecifier',
            line: 1,
          },
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
});
