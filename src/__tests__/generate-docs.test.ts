import fs from 'fs';
import os from 'os';
import path from 'path';
import { z } from 'zod';
import {
  getZodType,
  getZodDescription,
  escapeMarkdownTableCell,
  encodeRouteMermaidNodeId,
  generateConfigTable,
  generateRoutesDiagram,
  generateApiRoutesSection,
  generateEnvSpecs,
  generateFeatureMetadataTable,
  generateAdminEntityTable,
  generateFeatureBarrelsTable,
  updateFeatureModulesMd,
} from '../../scripts/generate-docs';
import { AppConfigSchema } from '@/features/content';
import { DEFAULT_MODULE_CONFIG, FEATURE_METADATA } from '../lib/modules';

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

    it('returns unknown for null, undefined, and non-schema inputs', () => {
      expect(getZodType(null)).toBe('unknown');
      expect(getZodType(undefined)).toBe('unknown');
      expect(getZodType('string')).toBe('unknown');
      expect(getZodType(42)).toBe('unknown');
      expect(getZodType({})).toBe('unknown');
      expect(getZodType({ _zod: {} })).toBe('unknown');
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

    it('unwraps exactOptional and refine schemas to their underlying base types', () => {
      expect(getZodType(z.string().exactOptional())).toBe('string');
      expect(getZodType(z.string().refine((val) => val.length > 0))).toBe('string');
      expect(getZodType(z.string().refine((val) => val.length > 0).exactOptional())).toBe('string');
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

    it('reads descriptions through exactOptional and refine, and returns undefined for non-schema inputs', () => {
      expect(getZodDescription(z.string().describe('Exact optional field').exactOptional())).toBe('Exact optional field');
      expect(getZodDescription(z.string().describe('Refined field').refine((s) => s.length > 0))).toBe('Refined field');
      expect(getZodDescription(z.string().meta({ description: 'Registry metadata description' }).optional())).toBe('Registry metadata description');
      expect(getZodDescription(null)).toBeUndefined();
      expect(getZodDescription(undefined)).toBeUndefined();
      expect(getZodDescription('not-a-schema')).toBeUndefined();
      expect(getZodDescription({})).toBeUndefined();
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
      expect(getZodType(shape.rsvpOpen)).toBe('boolean');
      expect(getZodType(shape.isRsvpOpen)).toBe('boolean');
      expect(getZodType(shape.rsvpDeadlineDate)).toBe('string');
      expect(getZodType(shape.rsvpGracePeriodHours)).toBe('number');
      expect(getZodType(shape.rsvpClosedMessage)).toBe('string');
      expect(getZodType(shape.modules)).toBe('object');
      expect(getZodType(shape.features)).toBe('object[]');

      const entries = Object.entries(shape);
      expect(entries).toHaveLength(99);

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
    it('distinguishes 84 Prisma columns, 15 virtual DTO fields, 69 public fields, 26 admin-only fields, and 4 masked secrets', () => {
      const table = generateConfigTable();
      expect(table).not.toContain('Configuration field for');

      const rows = table
        .trim()
        .split('\n')
        .slice(2);
      expect(rows).toHaveLength(99);

      const prismaRows = rows.filter((r) => r.includes('| `Prisma` |'));
      const virtualRows = rows.filter((r) => r.includes('| `Virtual DTO` |'));
      const publicRows = rows.filter((r) => r.includes('| `Public` |'));
      const adminOnlyRows = rows.filter((r) => r.includes('| `Admin-only` |'));
      const maskedSecretRows = rows.filter((r) => r.includes('| `Masked secret ('));

      expect(prismaRows).toHaveLength(84);
      expect(virtualRows).toHaveLength(15);
      expect(publicRows).toHaveLength(69);
      expect(adminOnlyRows).toHaveLength(26);
      expect(maskedSecretRows).toHaveLength(4);

      expect(table).toContain('`Masked secret (hasSmtpPass)`');
      expect(table).toContain('`Masked secret (hasResendApiKey)`');
      expect(table).toContain('`Masked secret (hasSendgridApiKey)`');
      expect(table).toContain('`Masked secret (hasTwilioAuthToken)`');
    });

    it('lists all 83 API route handlers and marks /api/media, /api/admin/geocode, /api/admin/thank-you-notes/[id]/send-email, and /api/admin/invitation-codes/merge Admin-only, /api/registry/webhook/stripe stripeSignature, and /api/live, /api/guest/session, and /api/uploads/[...path] Public', () => {
      const apiSection = generateApiRoutesSection();
      expect(apiSection).toContain('Total API route handlers: **83**');

      const handlerRows = apiSection
        .split('\n')
        .filter((line) => line.startsWith('| `/api/'));
      expect(handlerRows).toHaveLength(83);

      expect(apiSection).toContain('| `/api/admin/geocode` | `src/app/api/admin/geocode/route.ts` | `GET` | `Admin-only` |');
      expect(apiSection).toContain('| `/api/live` | `src/app/api/live/route.ts` | `GET` | `Public` |');
      expect(apiSection).toContain('| `/api/guest/session` | `src/app/api/guest/session/route.ts` | `GET`, `DELETE` | `Public` |');
      expect(apiSection).toContain('| `/api/registry/claim` | `src/app/api/registry/claim/route.ts` | `GET`, `POST` | `Public` |');
      expect(apiSection).toContain('| `/api/admin/broadcast/[id]` | `src/app/api/admin/broadcast/[id]/route.ts` | `GET` | `Admin-only` |');
      expect(apiSection).toContain('| `/api/admin/contributors/[id]/action` | `src/app/api/admin/contributors/[id]/action/route.ts` | `POST` | `Admin-only` |');
      expect(apiSection).toContain('| `/api/admin/thank-you-notes/[id]/send-email` | `src/app/api/admin/thank-you-notes/[id]/send-email/route.ts` | `POST` | `Admin-only` |');

      expect(apiSection).toContain('| `/api/admin/invitation-codes/catalog` | `src/app/api/admin/invitation-codes/catalog/route.ts` | `GET` | `Admin-only` |');
      expect(apiSection).toContain('| `/api/admin/invitation-codes/rsvps` | `src/app/api/admin/invitation-codes/rsvps/route.ts` | `GET`, `PUT` | `Admin-only` |');
      expect(apiSection).toContain('| `/api/admin/sub-events/rsvp-summary` | `src/app/api/admin/sub-events/rsvp-summary/route.ts` | `GET` | `Admin-only` |');
      expect(apiSection).toContain('| `/api/admin/invitation-codes/merge` | `src/app/api/admin/invitation-codes/merge/route.ts` | `POST` | `Admin-only` |');
      expect(apiSection).toContain('| `/api/media` | `src/app/api/media/route.ts` | `GET`, `POST` | `Admin-only` |');
      expect(apiSection).toContain('| `/api/media/[id]` | `src/app/api/media/[id]/route.ts` | `PUT`, `DELETE` | `Admin-only` |');
      expect(apiSection).toContain('| `/api/media/export` | `src/app/api/media/export/route.ts` | `GET`, `POST` | `Admin-only` |');
      expect(apiSection).toContain('| `/api/cron/broadcasts` | `src/app/api/cron/broadcasts/route.ts` | `GET`, `POST` | `Bearer (CRON_SECRET)` |');
      expect(apiSection).toContain(
        '| `/api/registry/webhook/stripe` | `src/app/api/registry/webhook/stripe/route.ts` | `POST` | `stripeSignature (STRIPE_WEBHOOK_SECRET)` |'
      );
      expect(apiSection).toContain(
        '| `/api/uploads/[...path]` | `src/app/api/uploads/[...path]/route.ts` | `GET`, `HEAD` | `Public` |'
      );
    });

    it('generates non-empty environment specifications', () => {
      expect(generateEnvSpecs()).toContain('**Node.js**: v22.x');
    });

    it('encodes bracketed, hyphenated, and catch-all route segments into distinct collision-free Mermaid node IDs', () => {
      const candidates = [
        'id',
        '[id]',
        'export-labels',
        'exportlabels',
        'export_labels',
        'export/labels',
        'path',
        '[...path]',
        '...path',
        'api/admin/[entity]/[id]',
        'api/admin/entity/id',
      ];

      const encodedIds = candidates.map((rel) => encodeRouteMermaidNodeId(rel));
      expect(new Set(encodedIds).size).toBe(candidates.length);
      for (const id of encodedIds) {
        expect(id).toMatch(/^node_[A-Za-z0-9_]+$/);
      }

      const tmpAppDir = fs.mkdtempSync(path.join(os.tmpdir(), 'routes-diagram-'));
      try {
        const routeDirs = [
          'items/id',
          'items/[id]',
          'notes/export-labels',
          'notes/exportlabels',
          'uploads/[...path]',
          'uploads/path',
        ];
        for (const rel of routeDirs) {
          const full = path.join(tmpAppDir, rel);
          fs.mkdirSync(full, { recursive: true });
          fs.writeFileSync(path.join(full, 'route.ts'), 'export async function GET() {}\n', 'utf8');
        }

        const diagram = generateRoutesDiagram(tmpAppDir);
        const idNodeLines = diagram
          .split('\n')
          .filter((line) => line.includes('["id"]') || line.includes('["[id]"]'));
        expect(idNodeLines).toHaveLength(2);

        const exportLines = diagram
          .split('\n')
          .filter((line) => line.includes('["export-labels"]') || line.includes('["exportlabels"]'));
        expect(exportLines).toHaveLength(2);

        const uploadLines = diagram
          .split('\n')
          .filter((line) => line.includes('["[...path]"]') || line.includes('["path"]'));
        expect(uploadLines).toHaveLength(2);
      } finally {
        fs.rmSync(tmpAppDir, { recursive: true, force: true });
      }
    });

    it('escapes both backslashes and pipe characters in Markdown table cells', () => {
      expect(escapeMarkdownTableCell("'classic' | 'modern'")).toBe("'classic' \\| 'modern'");
      expect(escapeMarkdownTableCell('C:\\app\\config')).toBe('C:\\\\app\\\\config');
      expect(escapeMarkdownTableCell('foo \\| bar')).toBe('foo \\\\\\| bar');

      const customTable = generateConfigTable({
        customField: z
          .enum(['a\\b', 'c|d'])
          .describe('Supports C:\\path\\file | fallback \\| literal\nand multiline notes'),
      });
      expect(customTable).toContain(
        "| `customField` | `'a\\\\b' \\| 'c\\|d'` | `Virtual DTO` | `Server-only` | Supports C:\\\\path\\\\file \\| fallback \\\\\\| literal and multiline notes |"
      );
    });
  });

  describe('FEATURE_MODULES.md Automated Table Generation', () => {
    it('generates all 9 presentation feature toggles with dependencies, Prisma persistence, and HTTP 400 groupGifting coverage', () => {
      const table = generateFeatureMetadataTable();
      const rows = table.trim().split('\n').slice(2);
      expect(rows).toHaveLength(9);
      expect(table).not.toContain('`guestPasscode`');

      for (const key of Object.keys(FEATURE_METADATA)) {
        expect(table).toContain(`| \`${key}\` |`);
      }

      expect(table).toContain('Requires `registry`');
      expect(table).toContain('HTTP 400 on `POST /api/registry/contribute` & `POST /api/registry/payment-intent`');
      expect(table).toContain('`/registry/edit-item/[id]`');
      expect(table).toContain('`Prisma` (`modules` + `showCountdown`)');
      expect(table).toContain('`Prisma` (`modules` + `showAddToCalendar`)');
    });

    it('generates all 7 exact plural ENTITY_KEY slugs from src/features/admin/registry.ts', () => {
      const table = generateAdminEntityTable();
      const rows = table.trim().split('\n').slice(2);
      expect(rows).toHaveLength(7);

      const expectedSlugs = [
        'content-nodes',
        'wedding-party',
        'attractions',
        'registry-items',
        'invitation-codes',
        'seating-tables',
        'sub-events',
      ];
      for (const slug of expectedSlugs) {
        expect(table).toContain(`| \`${slug}\` |`);
        expect(table).toContain(`\`/api/admin/${slug}\``);
      }

      expect(table).not.toContain('| `registry-item` |');
      expect(table).not.toContain('| `seating-table` |');
      expect(table).not.toContain('| `sub-event` |');
      expect(table).not.toContain('| `invitation-code` |');
      expect(table).not.toContain('| `content` |');
    });

    it('generates all 11 feature module barrels from src/features/*/index.ts and excludes non-existent service symbols', () => {
      const table = generateFeatureBarrelsTable();
      expect(table).toContain('Total domain feature modules: **11** under `src/features/`.');

      const expectedDomains = [
        'admin',
        'attractions',
        'broadcast',
        'content',
        'logistics',
        'media',
        'registry',
        'seating',
        'sub-events',
        'weather',
        'wedding-party',
      ];
      for (const domain of expectedDomains) {
        expect(table).toContain(`| \`${domain}\` | \`src/features/${domain}/index.ts\` |`);
      }

      const staleRemovedSymbols = [
        'attractionsService',
        'mediaService',
        'seatingService',
        'SubEventRepository',
        'weatherProxy',
        'weddingPartyService',
        'sendBroadcast',
        'BroadcastModal',
        'LogisticsRepository',
      ];
      for (const removedSymbol of staleRemovedSymbols) {
        expect(table).not.toContain(`\`${removedSymbol}\``);
      }
    });

    it('synchronizes FEATURE_MODULES.md markers in an isolated workspace and detects barrel/entity changes or missing markers', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'generate-feature-modules-'));
      try {
        const adminDir = path.join(tmpDir, 'src/features/admin');
        const customDir = path.join(tmpDir, 'src/features/custom');
        fs.mkdirSync(adminDir, { recursive: true });
        fs.mkdirSync(customDir, { recursive: true });

        fs.writeFileSync(
          path.join(customDir, 'admin-service.ts'),
          [
            'export class CustomEntityAdminService {',
            "  static readonly ENTITY_KEY = 'custom-entities';",
            '  constructor() {',
            "    super(schema, 'CustomEntity');",
            '  }',
            '}',
          ].join('\n'),
        );
        fs.writeFileSync(
          path.join(customDir, 'index.ts'),
          [
            "export { CustomEntityAdminService } from './admin-service';",
            'export const customHelper = () => true;',
            'export type CustomItemDTO = { id: string };',
          ].join('\n'),
        );
        fs.writeFileSync(
          path.join(adminDir, 'registry.ts'),
          [
            'export async function getEntityService(entity: string) {',
            "  const [{ CustomEntityAdminService }] = await Promise.all([import('@/features/custom')]);",
            '  const serviceMap = {',
            '    [CustomEntityAdminService.ENTITY_KEY]: new CustomEntityAdminService(),',
            '  };',
            '  return serviceMap[entity] || null;',
            '}',
            'export { getEntityService as lookupEntity };',
          ].join('\n'),
        );
        fs.writeFileSync(path.join(adminDir, 'index.ts'), "export { getEntityService } from './registry';\n");

        const docPath = path.join(tmpDir, 'FEATURE_MODULES.md');
        fs.writeFileSync(
          docPath,
          [
            '# Feature Modules',
            '<!-- BEGIN AUTOGENERATED FEATURE_METADATA -->',
            'stale metadata',
            '<!-- END AUTOGENERATED FEATURE_METADATA -->',
            '<!-- BEGIN AUTOGENERATED ADMIN_ENTITIES -->',
            'stale entities',
            '<!-- END AUTOGENERATED ADMIN_ENTITIES -->',
            '<!-- BEGIN AUTOGENERATED FEATURE_BARRELS -->',
            'stale barrels',
            '<!-- END AUTOGENERATED FEATURE_BARRELS -->',
          ].join('\n'),
        );

        updateFeatureModulesMd(tmpDir);
        const updated = fs.readFileSync(docPath, 'utf8');
        expect(updated).not.toContain('stale metadata');
        expect(updated).not.toContain('stale entities');
        expect(updated).not.toContain('stale barrels');
        expect(updated).toContain('| `custom-entities` | `CustomEntityAdminService` | `src/features/custom/index.ts` | `CustomEntity` |');
        expect(updated).toContain('| `custom` | `src/features/custom/index.ts` | `CustomEntityAdminService`, `customHelper` | `CustomItemDTO` |');

        fs.writeFileSync(docPath, '# Missing markers\n');
        expect(() => updateFeatureModulesMd(tmpDir)).toThrow(
          'FEATURE_MODULES.md is missing one or more required AUTOGENERATED HTML marker blocks',
        );
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
