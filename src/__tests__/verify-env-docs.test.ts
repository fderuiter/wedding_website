import { getKeysFromSource } from '../../scripts/verify-env-docs';

describe('AST-Based Environment Documentation Validation Parser', () => {
  it('correctly parses standard z.object properties', () => {
    const code = `
      import { z } from 'zod';
      const envSchema = z.object({
        NODE_ENV: z.enum(['development', 'test', 'production']),
        DATABASE_URL: z.string(),
      });
    `;
    const keys = getKeysFromSource(code);
    expect(keys).toEqual(['NODE_ENV', 'DATABASE_URL']);
  });

  it('handles multi-line formatting, trailing commas, and single/double quotes', () => {
    const code = `
      import { z } from 'zod';
      const envSchema = z.object({
        'NODE_ENV': z
          .enum(['development', 'test', 'production'])
          .default('development'),
        "DATABASE_URL": z.string()
          .url()
          .min(1),
        'POSTGRES_URL_NON_POOLING': z.string().optional(),
      });
    `;
    const keys = getKeysFromSource(code);
    expect(keys).toEqual(['NODE_ENV', 'DATABASE_URL', 'POSTGRES_URL_NON_POOLING']);
  });

  it('handles computed property names and single/double/template quotes inside them', () => {
    const code = `
      import { z } from 'zod';
      const envSchema = z.object({
        ['NODE_ENV']: z.string(),
        ["DATABASE_URL"]: z.string(),
        [\`POSTGRES_URL_NON_POOLING\`]: z.string(),
      });
    `;
    const keys = getKeysFromSource(code);
    expect(keys).toEqual(['NODE_ENV', 'DATABASE_URL', 'POSTGRES_URL_NON_POOLING']);
  });

  it('handles shorthand property assignments', () => {
    const code = `
      import { z } from 'zod';
      const NODE_ENV = z.string();
      const envSchema = z.object({
        NODE_ENV,
        DATABASE_URL: z.string(),
      });
    `;
    const keys = getKeysFromSource(code);
    expect(keys).toEqual(['NODE_ENV', 'DATABASE_URL']);
  });

  it('falls back to any z.object schema if envSchema variable declaration is missing or renamed', () => {
    const code = `
      import { z } from 'zod';
      const myCustomSchema = z.object({
        CUSTOM_VAR: z.string(),
      });
    `;
    const keys = getKeysFromSource(code);
    expect(keys).toEqual(['CUSTOM_VAR']);
  });

  it('correctly extracts the five default environment variables from the real src/env.ts structure', () => {
    const code = `
      import { z } from 'zod';

      const envSchema = z.object({
        NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
        DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL').min(1, 'DATABASE_URL is required'),
        POSTGRES_URL_NON_POOLING: z.string().url('POSTGRES_URL_NON_POOLING must be a valid URL').optional(),
        ADMIN_PASSWORD: z.string().min(1, 'ADMIN_PASSWORD is required').regex(/^scrypt:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/, 'ADMIN_PASSWORD must be in the format scrypt:[saltBase64]:[keyBase64]'),
        HISTORY_VERSION_LIMIT: z.coerce.number().min(1).default(50),
      });
    `;
    const keys = getKeysFromSource(code);
    expect(keys).toEqual([
      'NODE_ENV',
      'DATABASE_URL',
      'POSTGRES_URL_NON_POOLING',
      'ADMIN_PASSWORD',
      'HISTORY_VERSION_LIMIT',
    ]);
  });
});
