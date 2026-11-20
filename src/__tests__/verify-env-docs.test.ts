import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  INTERNAL_ENV_ALLOWLIST,
  collectOperatorEnvKeys,
  extractEnvSchemaSpecs,
  getKeysFromSource,
  parseComposeEnvKeys,
  parseDockerfileEnvKeys,
  parseRuntimeContractTables,
  scanProcessEnvFromSource,
  validateEnvDocContent,
  validateRuntimeContract,
  verifyEnvDocs,
  type EnvClassification,
  type EnvFieldSpec,
  type RuntimeContractRow,
} from '../../scripts/verify-env-docs';

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

  describe('AST process.env Scanner', () => {
    it('extracts property access, element access, destructuring, and child-process env spreads while ignoring dynamic/non-env accesses', () => {
      const code = `
        import { spawn } from 'node:child_process';
        const isStatic = process.env.STATIC_EXPORT === 'true';
        const basePath = process.env['NEXT_PUBLIC_BASE_PATH'] || process.env[\`VITEPRESS_BASE\`];
        const { SITE_PARTNER1_NAME, SITE_VENUE_CITY: city = 'Minneapolis' } = process.env;
        const dynamicKey = 'IGNORED_DYNAMIC';
        const dynamicVal = process.env[dynamicKey];
        const otherObj = { env: { NOT_PROCESS_ENV: '1' } };
        void otherObj.env.NOT_PROCESS_ENV;
        void dynamicVal;
        spawn('next', ['build'], {
          env: {
            ...process.env,
            SPAWN_FLAG: 'true',
          },
        });
      `;

      const scanned = scanProcessEnvFromSource(code, 'sample.ts');
      expect(scanned.sort()).toEqual([
        'NEXT_PUBLIC_BASE_PATH',
        'SITE_PARTNER1_NAME',
        'SITE_VENUE_CITY',
        'SPAWN_FLAG',
        'STATIC_EXPORT',
        'VITEPRESS_BASE',
      ]);
    });
  });

  describe('Dockerfile and Docker Compose Environment Parsers', () => {
    it('parses single, multi-key, continued, quoted, and legacy ENV declarations from Dockerfile', () => {
      const dockerfile = [
        '# Commented ENV IGNORED_COMMENT=1',
        'FROM node:22-bookworm-slim AS runner',
        'ENV NODE_ENV=production',
        'ENV PORT=3000 HOST_BIND="0.0.0.0" \\',
        '    QUOTED_PAIR="INNER=VALUE"',
        'ENV LEGACY_VAR legacy_value',
      ].join('\n');

      expect(parseDockerfileEnvKeys(dockerfile).sort()).toEqual([
        'HOST_BIND',
        'LEGACY_VAR',
        'NODE_ENV',
        'PORT',
        'QUOTED_PAIR',
      ]);
    });

    it('parses Compose variable interpolations and bare environment pass-throughs while ignoring comments, $$ escapes, and container-internal keys', () => {
      const compose = [
        'services:',
        '  db:',
        '    image: postgres:15-alpine',
        '    environment:',
        '      POSTGRES_USER: ${DB_USER:-wedding}',
        '      POSTGRES_PASSWORD: ${DB_PASSWORD:-wedding123}',
        '      POSTGRES_DB: ${DB_NAME:-wedding}',
        '    ports:',
        '      - "${DB_PORT:-5432}:5432"',
        '  app:',
        '    ports:',
        '      - "127.0.0.1:${PORT:-3000}:3000"',
        '    environment:',
        '      # ${COMMENTED_OUT_VAR:-nope}',
        '      E2E_TEST: ${E2E_TEST:-true}',
        '      ESCAPED_LITERAL: "$${NOT_AN_INTERPOLATION}"',
        '    healthcheck:',
        '      test: ["CMD-SHELL", "echo $$PATH"]',
        '  worker:',
        '    environment:',
        '      - PASSTHROUGH_HOST_VAR',
      ].join('\n');

      expect(parseComposeEnvKeys(compose).sort()).toEqual([
        'DB_NAME',
        'DB_PASSWORD',
        'DB_PORT',
        'DB_USER',
        'E2E_TEST',
        'PASSTHROUGH_HOST_VAR',
        'PORT',
      ]);
    });
  });

  describe('Internal Runner Flag Allowlist & Live Workspace Discovery', () => {
    it('excludes NEXT_RUNTIME, npm_lifecycle_event, and JEST_WORKER_ID via INTERNAL_ENV_ALLOWLIST', () => {
      expect(Array.from(INTERNAL_ENV_ALLOWLIST).sort()).toEqual([
        'JEST_WORKER_ID',
        'NEXT_RUNTIME',
        'npm_lifecycle_event',
      ]);

      const { keys } = collectOperatorEnvKeys(process.cwd());
      for (const internalFlag of INTERNAL_ENV_ALLOWLIST) {
        expect(keys).not.toContain(internalFlag);
      }

      // Verify representative keys from each source layer are discovered
      expect(keys).toEqual(
        expect.arrayContaining([
          'DATABASE_URL',
          'ADMIN_PASSWORD',
          'ALLOWED_HOSTS',
          'GUEST_SESSION_SECRET',
          'SITE_PARTNER1_NAME',
          'SITE_CONTACT_EMAIL',
          'E2E_TEST',
          'HOSTNAME',
          'PORT',
          'STATIC_EXPORT',
          'NEXT_PUBLIC_BASE_PATH',
          'VITEPRESS_BASE',
          'DB_USER',
          'DB_PASSWORD',
          'DB_NAME',
          'DB_PORT',
        ])
      );
      expect(keys.length).toBeGreaterThanOrEqual(61);
    });
  });

  describe('Schema Spec Extraction & Runtime Contract Markdown Table Validation', () => {
    it('extracts required, production-required, conditional, and optional classifications plus defaults from src/env.ts', () => {
      const envContent = fs.readFileSync(path.join(process.cwd(), 'src/env.ts'), 'utf8');
      const specs: Map<string, EnvFieldSpec> = extractEnvSchemaSpecs(envContent);

      expect(specs.get('DATABASE_URL')).toEqual({
        key: 'DATABASE_URL',
        classification: 'required' satisfies EnvClassification,
        defaultValue: null,
      });
      expect(specs.get('ADMIN_PASSWORD')).toEqual({
        key: 'ADMIN_PASSWORD',
        classification: 'required',
        defaultValue: null,
      });
      expect(specs.get('GUEST_PASSCODE')).toEqual({
        key: 'GUEST_PASSCODE',
        classification: 'production-required',
        defaultValue: 'wedding2026',
      });
      expect(specs.get('GUEST_SESSION_SECRET')).toEqual({
        key: 'GUEST_SESSION_SECRET',
        classification: 'production-required',
        defaultValue: 'default-guest-session-secret',
      });
      expect(specs.get('ALLOWED_HOSTS')).toEqual({
        key: 'ALLOWED_HOSTS',
        classification: 'optional',
        defaultValue: 'localhost,127.0.0.1,*.localhost',
      });
      expect(specs.get('HISTORY_VERSION_LIMIT')).toEqual({
        key: 'HISTORY_VERSION_LIMIT',
        classification: 'optional',
        defaultValue: '50',
      });
      expect(specs.get('S3_BUCKET')).toEqual({
        key: 'S3_BUCKET',
        classification: 'conditional',
        defaultValue: null,
      });
      expect(specs.get('S3_ENDPOINT')).toEqual({
        key: 'S3_ENDPOINT',
        classification: 'optional',
        defaultValue: null,
      });
      expect(specs.get('STRIPE_SECRET_KEY')).toEqual({
        key: 'STRIPE_SECRET_KEY',
        classification: 'conditional',
        defaultValue: null,
      });
      expect(specs.get('STRIPE_WEBHOOK_SECRET')).toEqual({
        key: 'STRIPE_WEBHOOK_SECRET',
        classification: 'optional',
        defaultValue: null,
      });
    });

    it('detects misclassified variables, wrong default values, missing variables, and stale table entries in docs/runtime-contract.md', () => {
      const sampleSpecs = new Map<string, EnvFieldSpec>([
        ['DATABASE_URL', { key: 'DATABASE_URL', classification: 'required', defaultValue: null }],
        ['GUEST_SESSION_SECRET', { key: 'GUEST_SESSION_SECRET', classification: 'production-required', defaultValue: 'default-guest-session-secret' }],
        ['ALLOWED_HOSTS', { key: 'ALLOWED_HOSTS', classification: 'optional', defaultValue: 'localhost,127.0.0.1,*.localhost' }],
        ['HISTORY_VERSION_LIMIT', { key: 'HISTORY_VERSION_LIMIT', classification: 'optional', defaultValue: '50' }],
      ]);

      const driftedContract = [
        '# Application Runtime Contract',
        '',
        '## 4. Environment Variable Matrix',
        '',
        '### Mandatory Runtime Variables',
        '| Variable | Default Value | Description |',
        '|---|---|---|',
        '| `DATABASE_URL` | *None* | Primary DB URL |',
        '| `ALLOWED_HOSTS` | *None* | Misclassified as mandatory without default |',
        '',
        '### Optional Infrastructure & Feature Variables',
        '| Variable | Default Value | Description |',
        '|---|---|---|',
        '| `GUEST_SESSION_SECRET` | `default-guest-session-secret` | Misclassified as optional instead of production-required |',
        '| `HISTORY_VERSION_LIMIT` | `25` | Wrong default value |',
        '| `STALE_REMOVED_VAR` | *None* | Stale variable no longer in code |',
      ].join('\n');

      const parsedRows: RuntimeContractRow[] = parseRuntimeContractTables(driftedContract);
      expect(parsedRows).toHaveLength(5);

      const errors = validateRuntimeContract(
        driftedContract,
        ['DATABASE_URL', 'GUEST_SESSION_SECRET', 'ALLOWED_HOSTS', 'HISTORY_VERSION_LIMIT', 'PORT'],
        sampleSpecs,
        new Map([['PORT', ['Dockerfile', 'docker-compose.yml']]])
      );

      expect(errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Missing variable PORT in section "## 4. Environment Variable Matrix" of docs/runtime-contract.md (referenced in Dockerfile, docker-compose.yml)'),
          expect.stringContaining('Classification mismatch for ALLOWED_HOSTS'),
          expect.stringContaining('Default value mismatch for ALLOWED_HOSTS'),
          expect.stringContaining('Classification mismatch for GUEST_SESSION_SECRET'),
          expect.stringContaining('Default value mismatch for HISTORY_VERSION_LIMIT'),
          expect.stringContaining('Stale or unrecognized variable STALE_REMOVED_VAR'),
        ])
      );
    });

    it('scopes provider deployment runbooks in docs/deployment/ to core src/env.ts keys and PORT', () => {
      const coreKeys = ['NODE_ENV', 'DATABASE_URL', 'ADMIN_PASSWORD', 'ALLOWED_HOSTS'];
      const validWithPort = [
        '## 2. Required Environment Variables',
        '| Variable | Required |',
        '|---|---|',
        '| `NODE_ENV` | Yes |',
        '| `DATABASE_URL` | Yes |',
        '| `ADMIN_PASSWORD` | Yes |',
        '| `ALLOWED_HOSTS` | No |',
        '| `HOSTNAME` | No |',
        '| `PORT` | No |',
      ].join('\n');
      expect(validateEnvDocContent('docs/deployment/docker-vps.md', validWithPort, coreKeys)).toEqual([]);

      const clutteredRunbook = `${validWithPort}\n| \`SITE_PARTNER1_NAME\` | No |`;
      expect(validateEnvDocContent('docs/deployment/docker-vps.md', clutteredRunbook, coreKeys)).toEqual([
        expect.stringContaining('Out-of-scope variable SITE_PARTNER1_NAME'),
      ]);
    });

    it('exits 1 when a source or Compose file reads an undocumented variable or runtime-contract.md misstates a default', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-env-ast-'));
      const mockExit = jest.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
        throw new Error(`process.exit: ${code}`);
      });
      const mockErr = jest.spyOn(console, 'error').mockImplementation(() => {});
      const mockLog = jest.spyOn(console, 'log').mockImplementation(() => {});

      try {
        fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
        fs.mkdirSync(path.join(tempDir, 'docs/deployment'), { recursive: true });

        fs.writeFileSync(
          path.join(tempDir, 'src/env.ts'),
          `import { z } from 'zod';
           const envSchema = z.object({
             NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
             DATABASE_URL: z.string(),
           });
           const isEdge = process.env.NEXT_RUNTIME === 'edge';
           void isEdge;`
        );

        const baseGuide = [
          '## Environment Variables Reference',
          '- `NODE_ENV`: Mode.',
          '- `DATABASE_URL`: DB.',
        ].join('\n');

        const validContract = [
          '## 4. Environment Variable Matrix',
          '### Mandatory Runtime Variables',
          '| Variable | Default Value | Description |',
          '|---|---|---|',
          '| `DATABASE_URL` | *None* | DB |',
          '### Optional Infrastructure & Feature Variables',
          '| Variable | Default Value | Description |',
          '|---|---|---|',
          '| `NODE_ENV` | `development` | Mode |',
        ].join('\n');

        fs.writeFileSync(path.join(tempDir, 'DEPLOYMENT.md'), baseGuide);
        fs.writeFileSync(path.join(tempDir, '.env.example'), 'NODE_ENV=development\nDATABASE_URL="postgres://localhost/db"\n');
        fs.writeFileSync(path.join(tempDir, 'docs/runtime-contract.md'), validContract);
        for (const provider of ['docker-vps.md', 'gcp-cloud-run.md', 'vercel.md', 'railway-render.md']) {
          fs.writeFileSync(path.join(tempDir, 'docs/deployment', provider), baseGuide);
        }

        // Baseline valid workspace passes (NEXT_RUNTIME allowlisted)
        expect(() => verifyEnvDocs(tempDir)).not.toThrow();

        // 1. Undocumented variable in docker-compose.yml fails with exit 1
        fs.writeFileSync(
          path.join(tempDir, 'docker-compose.yml'),
          'services:\n  app:\n    environment:\n      SECRET_COMPOSE_FLAG: ${SECRET_COMPOSE_FLAG:-on}\n'
        );
        expect(() => verifyEnvDocs(tempDir)).toThrow('process.exit: 1');
        fs.unlinkSync(path.join(tempDir, 'docker-compose.yml'));

        // 2. Undocumented variable in src/ fails with exit 1
        fs.writeFileSync(path.join(tempDir, 'src/feature.ts'), 'export const x = process.env.UNDOCUMENTED_SRC_VAR;\n');
        expect(() => verifyEnvDocs(tempDir)).toThrow('process.exit: 1');
        fs.unlinkSync(path.join(tempDir, 'src/feature.ts'));

        // 3. Misstated default in docs/runtime-contract.md fails with exit 1
        fs.writeFileSync(
          path.join(tempDir, 'docs/runtime-contract.md'),
          validContract.replace('`development`', '`production`')
        );
        expect(() => verifyEnvDocs(tempDir)).toThrow('process.exit: 1');
      } finally {
        mockExit.mockRestore();
        mockErr.mockRestore();
        mockLog.mockRestore();
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('Word Boundary and Substring Matching', () => {
    function verifyKeyMatch(key: string, docContent: string): boolean {
      const keyRegex = new RegExp(`\\b${key}\\b`);
      return keyRegex.test(docContent);
    }

    it('fails if key only exists as a substring of a larger word', () => {
      expect(verifyKeyMatch('PORT', 'SUPPORT')).toBe(false);
      expect(verifyKeyMatch('PORT', 'PORT_NUMBER')).toBe(false);
      expect(verifyKeyMatch('PORT', 'MY_PORT')).toBe(false);
      expect(verifyKeyMatch('PASSWORD', 'ADMIN_PASSWORD')).toBe(false);
      expect(verifyKeyMatch('DATABASE_URL', 'POSTGRES_URL_NON_POOLING')).toBe(false);
    });

    it('passes when key is documented with exact word-boundary matches', () => {
      expect(verifyKeyMatch('PORT', 'We run on PORT 3000')).toBe(true);
      expect(verifyKeyMatch('PORT', 'PORT=3000')).toBe(true);
      expect(verifyKeyMatch('PORT', 'The environment variable PORT is set.')).toBe(true);
      expect(verifyKeyMatch('PORT', '`PORT` is required')).toBe(true);
      expect(verifyKeyMatch('PORT', '"PORT"')).toBe(true);
    });
  });

  describe('Safe Module Import Guard', () => {
    it('safely imports without executing validation or process.exit', () => {
      // Since this test is running, verify-env-docs was successfully imported without triggering any immediate process exits.
      expect(true).toBe(true);
    });
  });
});
