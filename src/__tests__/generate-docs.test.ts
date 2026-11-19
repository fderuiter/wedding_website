import { z } from 'zod';
import {
  getZodType,
  getZodDescription,
  generateConfigTable,
  generateApiRoutesSection,
  generateEnvSpecs,
} from '../../scripts/generate-docs';
import { AppConfigSchema } from '../features/content/schemas';
import { DEFAULT_MODULE_CONFIG } from '../lib/modules';

describe('Documentation Generator - getZodType & Spec Tables', () => {
  describe('Primitive and structural types', () => {
    it('resolves string, number, boolean, date, object, and any', () => {
      expect(getZodType(z.string())).toBe('string');
      expect(getZodType(z.number())).toBe('number');
      expect(getZodType(z.boolean())).toBe('boolean');
      expect(getZodType(z.date())).toBe('date');
      expect(getZodType(z.object({ a: z.string() }))).toBe('object');
      expect(getZodType(z.any())).toBe('any');
    });

    it('resolves literal schemas', () => {
      expect(getZodType(z.literal('test'))).toBe("'test'");
      expect(getZodType(z.literal(123))).toBe('123');
      expect(getZodType(z.literal(true))).toBe('true');
    });

    it('resolves arrays', () => {
      expect(getZodType(z.array(z.string()))).toBe('string[]');
      expect(getZodType(z.array(z.object({ id: z.string() })))).toBe('object[]');
    });

    it('resolves unions', () => {
      expect(getZodType(z.union([z.string(), z.number()]))).toBe('string | number');
    });
  });

  describe('Modifier unwrapping', () => {
    it('unwraps single modifiers (optional, default, nullable)', () => {
      expect(getZodType(z.string().optional())).toBe('string');
      expect(getZodType(z.number().default(42))).toBe('number');
      expect(getZodType(z.boolean().nullable())).toBe('boolean');
    });

    it('recursively unwraps deeply nested wrappers', () => {
      expect(getZodType(z.string().nullable().optional().default(''))).toBe('string');
      expect(getZodType(z.boolean().optional().nullable().default(false))).toBe('boolean');
      expect(getZodType(z.number().default(0).optional())).toBe('number');
    });

    it('unwraps other modifiers such as brand, catch, readonly', () => {
      expect(getZodType(z.string().readonly())).toBe('string');
      expect(getZodType(z.string().catch('fallback'))).toBe('string');
      expect(getZodType(z.string().brand('MyBrand'))).toBe('string');
    });
  });

  describe('Enum and record schemas', () => {
    it('formats enum values into clean union representations', () => {
      const enumSchema = z.enum(['classic', 'modern', 'romantic']);
      expect(getZodType(enumSchema)).toBe("'classic' | 'modern' | 'romantic'");
    });

    it('unwraps modifiers around enum schemas', () => {
      const wrappedEnum = z.enum(['classic', 'modern', 'romantic']).default('classic');
      expect(getZodType(wrappedEnum)).toBe("'classic' | 'modern' | 'romantic'");
    });

    it('resolves record schemas to record', () => {
      expect(getZodType(z.record(z.string(), z.string()))).toBe('record');
      expect(getZodType(z.record(z.string(), z.number()).default({}))).toBe('record');
    });
  });

  describe('Pipelines and transformations', () => {
    it('resolves pipeline transformations to their output schema', () => {
      const pipeSchema = z.string().transform(Number).pipe(z.number());
      expect(getZodType(pipeSchema)).toBe('number');
    });

    it('resolves pipeline to output array schema', () => {
      const targetObj = z.object({ id: z.string() });
      const pipeSchema = z.union([z.string(), z.any()]).pipe(z.array(targetObj));
      expect(getZodType(pipeSchema)).toBe('object[]');
    });

    it('resolves raw transform without target schema back to transformed input', () => {
      const transformSchema = z.string().transform((v) => Number(v));
      expect(getZodType(transformSchema)).toBe('string');
    });
  });

  describe('Description metadata unwrapping (getZodDescription)', () => {
    it('reads .describe() placed before or after wrapped Zod modifiers and pipes', () => {
      expect(getZodDescription(z.string().describe('Outer description'))).toBe('Outer description');
      expect(getZodDescription(z.string().describe('Inner description').nullable().optional().default(''))).toBe('Inner description');
      expect(getZodDescription(z.string().transform((s) => s.trim()).pipe(z.string().describe('Piped description')).default(''))).toBe('Piped description');
      expect(getZodDescription(z.string().optional())).toBeUndefined();
    });
  });

  describe('AppConfigSchema fields', () => {
    it('unwraps all modified fields in AppConfigSchema without modifier labels and resolves modules to object', () => {
      const shape = AppConfigSchema.shape;

      expect(getZodType(shape.subdomain)).toBe('string');
      expect(getZodType(shape.multisiteEnabled)).toBe('boolean');
      expect(getZodType(shape.partner1Name)).toBe('string');
      expect(getZodType(shape.contactEmail)).toBe('string');
      expect(getZodType(shape.themePreset)).toBe("'classic' | 'modern' | 'romantic' | 'minimal' | 'editorial'");
      expect(getZodType(shape.themeTokens)).toBe('record');
      expect(getZodType(shape.typographyScale)).toBe('object');
      expect(getZodType(shape.brandLogoWidth)).toBe('string');
      expect(getZodType(shape.showCountdown)).toBe('boolean');
      expect(getZodType(shape.modules)).toBe('object');
      expect(getZodType(shape.features)).toBe('object[]');

      const entries = Object.entries(shape);
      expect(entries).toHaveLength(81);

      for (const [key, value] of entries) {
        const type = getZodType(value);
        expect(type).not.toBe('default');
        expect(type).not.toBe('optional');
        expect(type).not.toBe('nullable');
        expect(type).not.toBe('pipe');
        expect(type).not.toBe('pipeline');
        expect(type).not.toBe('unknown');

        const description = getZodDescription(value);
        expect(description).toBeDefined();
        expect(description!.length).toBeGreaterThan(0);
        expect(description).not.toContain(`Configuration field for ${key}`);
      }
    });

    it('preserves AppConfigSchema.shape.modules defaults and dependency rules', () => {
      const modulesSchema = AppConfigSchema.shape.modules;
      expect(modulesSchema.parse(undefined)).toEqual(DEFAULT_MODULE_CONFIG);
      expect(modulesSchema.parse({ registry: false, groupGifting: true })).toEqual({
        ...DEFAULT_MODULE_CONFIG,
        registry: false,
        groupGifting: false,
      });
      expect(modulesSchema.parse(JSON.stringify({ registry: false, groupGifting: true }))).toEqual({
        ...DEFAULT_MODULE_CONFIG,
        registry: false,
        groupGifting: false,
      });
    });
  });

  describe('Generated AppConfig and API Route Specifications', () => {
    it('distinguishes 66 Prisma columns, 15 virtual DTO fields, 64 public fields, 13 admin-only fields, and 4 masked secrets', () => {
      const table = generateConfigTable();
      expect(table).not.toContain('Configuration field for');

      const rows = table
        .trim()
        .split('\n')
        .slice(2);
      expect(rows).toHaveLength(81);

      const prismaRows = rows.filter((r) => r.includes('| `Prisma` |'));
      const virtualRows = rows.filter((r) => r.includes('| `Virtual DTO` |'));
      const publicRows = rows.filter((r) => r.includes('| `Public` |'));
      const adminOnlyRows = rows.filter((r) => r.includes('| `Admin-only` |'));
      const maskedSecretRows = rows.filter((r) => r.includes('| `Masked secret ('));

      expect(prismaRows).toHaveLength(66);
      expect(virtualRows).toHaveLength(15);
      expect(publicRows).toHaveLength(64);
      expect(adminOnlyRows).toHaveLength(13);
      expect(maskedSecretRows).toHaveLength(4);

      expect(table).toContain('`Masked secret (hasSmtpPass)`');
      expect(table).toContain('`Masked secret (hasResendApiKey)`');
      expect(table).toContain('`Masked secret (hasSendgridApiKey)`');
      expect(table).toContain('`Masked secret (hasTwilioAuthToken)`');
    });

    it('lists all 69 API route handlers and marks /api/media and /api/media/[id] as Admin-only', () => {
      const apiSection = generateApiRoutesSection();
      expect(apiSection).toContain('Total API route handlers: **69**');

      const handlerRows = apiSection
        .split('\n')
        .filter((line) => line.startsWith('| `/api/'));
      expect(handlerRows).toHaveLength(69);

      expect(apiSection).toContain('| `/api/media` | `src/app/api/media/route.ts` | `GET`, `POST` | `Admin-only` |');
      expect(apiSection).toContain('| `/api/media/[id]` | `src/app/api/media/[id]/route.ts` | `PUT`, `DELETE` | `Admin-only` |');
      expect(apiSection).toContain('| `/api/media/export` | `src/app/api/media/export/route.ts` | `GET`, `POST` | `Admin-only` |');
      expect(apiSection).toContain('| `/api/cron/broadcasts` | `src/app/api/cron/broadcasts/route.ts` | `GET`, `POST` | `Bearer (CRON_SECRET)` |');
    });

    it('generates non-empty environment specifications', () => {
      expect(generateEnvSpecs()).toContain('**Node.js**: v22.x');
    });
  });
});
