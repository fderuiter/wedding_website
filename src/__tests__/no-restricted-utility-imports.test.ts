if (typeof globalThis.structuredClone === 'undefined') {
  globalThis.structuredClone = (val) => JSON.parse(JSON.stringify(val));
}
if (typeof global.structuredClone === 'undefined') {
  global.structuredClone = globalThis.structuredClone;
}

import noRestrictedUtilityImportsRule from '../../eslint-rules/no-restricted-utility-imports.mjs';
import { RuleTester } from 'eslint';

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

describe('no-restricted-utility-imports ESLint Rule AST verification', () => {
  ruleTester.run('no-restricted-utility-imports', noRestrictedUtilityImportsRule, {
    valid: [
      {
        code: "import React from 'react';",
      },
      {
        code: "import { uuidHelper } from '@/utils/uuid';",
      },
      {
        code: "import { hashPassword } from '@/utils/password';",
      },
      {
        code: "import { map } from '@/utils/array';",
      },
    ],
    invalid: [
      // lodash
      {
        code: "import lodash from 'lodash';",
        errors: [
          {
            message: 'Importing "lodash" is not allowed. Use modern native standard Array (e.g., Array.prototype.map, filter, reduce), Object (e.g., Object.keys, values, entries), and String methods instead.',
          },
        ],
      },
      {
        code: "import { get } from 'lodash/get';",
        errors: [
          {
            message: 'Importing "lodash/get" is not allowed. Use modern native standard Array (e.g., Array.prototype.map, filter, reduce), Object (e.g., Object.keys, values, entries), and String methods instead.',
          },
        ],
      },
      {
        code: "import _ from 'lodash-es';",
        errors: [
          {
            message: 'Importing "lodash-es" is not allowed. Use modern native standard Array (e.g., Array.prototype.map, filter, reduce), Object (e.g., Object.keys, values, entries), and String methods instead.',
          },
        ],
      },
      // bcrypt
      {
        code: "import bcrypt from 'bcrypt';",
        errors: [
          {
            message: 'Importing "bcrypt" is not allowed. Use native Node.js/Web Crypto APIs or custom scrypt-based password helpers (e.g., src/utils/password.ts) instead.',
          },
        ],
      },
      {
        code: "const bcrypt = require('bcrypt');",
        errors: [
          {
            message: 'Importing "bcrypt" is not allowed. Use native Node.js/Web Crypto APIs or custom scrypt-based password helpers (e.g., src/utils/password.ts) instead.',
          },
        ],
      },
      // uuid
      {
        code: "import { v4 as uuidv4 } from 'uuid';",
        errors: [
          {
            message: 'Importing "uuid" is not allowed. Use native standard crypto.randomUUID() instead.',
          },
        ],
      },
      {
        code: "export { v4 } from 'uuid';",
        errors: [
          {
            message: 'Importing "uuid" is not allowed. Use native standard crypto.randomUUID() instead.',
          },
        ],
      },
      {
        code: "export * from 'uuid';",
        errors: [
          {
            message: 'Importing "uuid" is not allowed. Use native standard crypto.randomUUID() instead.',
          },
        ],
      },
      {
        code: "const uuidPromise = import('uuid');",
        errors: [
          {
            message: 'Importing "uuid" is not allowed. Use native standard crypto.randomUUID() instead.',
          },
        ],
      },
    ],
  });
});

describe('no-restricted-utility-imports ESLint Rule metadata and coverage', () => {
  it('should expose the ESLint rule meta structure correctly', () => {
    expect(noRestrictedUtilityImportsRule.meta.type).toBe('problem');
    expect(noRestrictedUtilityImportsRule.meta.messages).toHaveProperty('restrictedImport');
  });

  it('should define a create function', () => {
    expect(typeof noRestrictedUtilityImportsRule.create).toBe('function');
  });
});
