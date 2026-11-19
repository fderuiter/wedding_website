import { z } from 'zod';
import { getZodType } from '../../scripts/generate-docs';
import { AppConfigSchema } from '../features/content/schemas';

describe('Documentation Generator - getZodType Helper', () => {
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

  describe('AppConfigSchema fields', () => {
    it('unwraps all modified fields in AppConfigSchema without modifier labels', () => {
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
      expect(getZodType(shape.modules)).toBe('any');
      expect(getZodType(shape.features)).toBe('object[]');

      // Verify none of the fields return modifier names
      for (const value of Object.values(shape)) {
        const type = getZodType(value);
        expect(type).not.toBe('default');
        expect(type).not.toBe('optional');
        expect(type).not.toBe('nullable');
        expect(type).not.toBe('pipe');
        expect(type).not.toBe('pipeline');
        expect(type).not.toBe('unknown');
      }
    });
  });
});
