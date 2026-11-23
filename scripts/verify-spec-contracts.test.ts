import fs from 'fs';
import os from 'os';
import path from 'path';
import { verifySpecContracts } from './verify-spec-contracts';

function writeFixture(rootDir: string, relPath: string, content: string): void {
  const fullPath = path.join(rootDir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
}

describe('scripts/verify-spec-contracts', () => {
  const repoRoot = process.cwd();
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-spec-contracts-test-'));

    writeFixture(
      tempDir,
      'src/env.ts',
      `import { z } from 'zod';
const envSchema = z.object({
  TRUST_PROXY: z.boolean().default(false),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
});
export const env = envSchema.parse({});
`,
    );
    writeFixture(
      tempDir,
      'src/middleware.ts',
      'export function middleware() { return undefined; }\n',
    );
    writeFixture(
      tempDir,
      'src/app/api/weather/route.ts',
      'export async function GET() { return Response.json({ ok: true }); }\n',
    );
    writeFixture(
      tempDir,
      'src/app/api/admin/[entity]/route.ts',
      'export async function GET() { return Response.json([]); }\nexport async function POST() { return Response.json({}); }\n',
    );
    writeFixture(
      tempDir,
      'src/features/registry/admin.service.ts',
      `export class RegistryAdminService {
  static ENTITY_KEY = 'registry-items';
}
`,
    );
    writeFixture(
      tempDir,
      'src/features/registry/index.ts',
      'export { RegistryAdminService } from \'./admin.service\';\n',
    );
    writeFixture(
      tempDir,
      'src/features/admin/registry.ts',
      `import { RegistryAdminService } from '@/features/registry';
const serviceMap = {
  [RegistryAdminService.ENTITY_KEY]: new RegistryAdminService(),
};
export { serviceMap };
`,
    );
    writeFixture(
      tempDir,
      'src/lib/stripe.ts',
      `import { useMemo } from 'react';
export function getStripeCapability() {
  const performanceTier = useMemo(() => 'high', []);
  return { cardCheckoutEnabled: false, stripePublishableKey: null, performanceTier };
}
`,
    );
    writeFixture(
      tempDir,
      'src/utils/validation.ts',
      'export const ScrapeUrlSchema = {};\n',
    );
    writeFixture(
      tempDir,
      'src/features/registry/schemas.ts',
      'export const BatchScrapeUrlsSchema = {};\n',
    );
    writeFixture(
      tempDir,
      'src/features/registry/repository.ts',
      `export class RegistryRepository {
  async getAllItems() {
    return [];
  }
}
`,
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('passes cleanly with zero errors across all live repository Markdown specifications', () => {
    const result = verifySpecContracts(repoRoot);
    expect(result.errors).toEqual([]);
    expect(result.checkedRoutes).toBeGreaterThan(250);
    expect(result.checkedSymbols).toBeGreaterThan(300);
  });

  it('passes valid route citations, registered dynamic ENTITY_KEY slugs, and declared module symbols', () => {
    writeFixture(
      tempDir,
      'FEATURE_MODULES.md',
      [
        '# Valid Spec',
        '- Weather endpoint: `GET /api/weather` and wildcard `/api/*`.',
        '- Dynamic admin route: `GET /api/admin/registry-items` via `RegistryAdminService` in `src/features/registry/index.ts`.',
        '- Capability helper: `getStripeCapability` in [src/lib/stripe.ts](src/lib/stripe.ts#L1-L3) using `useMemo` hooks in [src/lib/stripe.ts](src/lib/stripe.ts#L1-L3).',
        '- Validation schemas: `ScrapeUrlSchema` ([src/utils/validation.ts](src/utils/validation.ts)) and `BatchScrapeUrlsSchema` ([src/features/registry/schemas.ts](src/features/registry/schemas.ts)).',
        '- Repository method: `RegistryRepository.getAllItems` ([src/features/registry/repository.ts](src/features/registry/repository.ts)).',
        '- Perimeter check: validates `X-Forwarded-Host` / `Host` in `src/middleware.ts` and `TRUST_PROXY` in `src/env.ts`.',
        '',
        '```md',
        'Fenced example with fake route `GET /api/does/not/exist` and `fakeFn` in `src/lib/stripe.ts` is ignored.',
        '```',
      ].join('\n'),
    );

    const result = verifySpecContracts(tempDir);
    expect(result.errors).toEqual([]);
    expect(result.checkedRoutes).toBe(3);
    expect(result.checkedSymbols).toBeGreaterThanOrEqual(6);
  });

  it('reports missing /api/... routes, unexported HTTP methods, and unregistered /api/admin/[entity] slugs', () => {
    writeFixture(
      tempDir,
      'FEATURE_MODULES.md',
      [
        '# Broken Routes Spec',
        '- Fabricated photo moderation routes: `GET /api/admin/photos/pending` and `POST /api/admin/photos/[id]/moderate`.',
        '- Wrong HTTP method: `DELETE /api/weather`.',
        '- Unregistered singular admin entity slug: `GET /api/admin/registry-item`.',
      ].join('\n'),
    );

    const result = verifySpecContracts(tempDir);
    expect(result.errors).toEqual([
      'FEATURE_MODULES.md:2: Route "/api/admin/photos/pending" does not match a static route under src/app/api/admin/ or any registered ENTITY_KEY in src/features/admin/registry.ts',
      'FEATURE_MODULES.md:2: Route "/api/admin/photos/[id]/moderate" does not match a static route under src/app/api/admin/ or any registered ENTITY_KEY in src/features/admin/registry.ts',
      'FEATURE_MODULES.md:3: Route "/api/weather" does not export HTTP method "DELETE" (exported: [GET] in src/app/api/weather/route.ts)',
      'FEATURE_MODULES.md:4: Route "/api/admin/registry-item" does not match a static route under src/app/api/admin/ or any registered ENTITY_KEY in src/features/admin/registry.ts',
    ]);
  });

  it('reports fabricated functions, swapped schema modules, missing class members, and missing source files', () => {
    writeFixture(
      tempDir,
      'SCRAPER.md',
      [
        '# Broken Symbols Spec',
        '- Fabricated Stripe helpers: `isStripeCardCheckoutConfigured()` and `getStripePublishableKey()` in [src/lib/stripe.ts](src/lib/stripe.ts).',
        '- Swapped schema path: `ScrapeUrlSchema` ([src/features/registry/schemas.ts](src/features/registry/schemas.ts)).',
        '- Fabricated method: `RegistryRepository.findPaginated` ([src/features/registry/repository.ts](src/features/registry/repository.ts)).',
        '- Non-existent file: `ghostSymbol` in `src/lib/nonExistentModule.ts`.',
      ].join('\n'),
    );

    const result = verifySpecContracts(tempDir);
    expect(result.errors).toEqual([
      'SCRAPER.md:2: Symbol "isStripeCardCheckoutConfigured" is not declared or exported in src/lib/stripe.ts',
      'SCRAPER.md:2: Symbol "getStripePublishableKey" is not declared or exported in src/lib/stripe.ts',
      'SCRAPER.md:3: Symbol "ScrapeUrlSchema" is not declared or exported in src/features/registry/schemas.ts',
      'SCRAPER.md:4: Member "findPaginated" on "RegistryRepository" ("RegistryRepository.findPaginated") does not exist in src/features/registry/repository.ts',
      'SCRAPER.md:5: Referenced source module "src/lib/nonExistentModule.ts" (for symbol "ghostSymbol") does not exist',
    ]);
  });

  it('resolves re-exported constant string literals and class members across module barrels', () => {
    const write = (relPath: string, content: string) => {
      const fullPath = path.join(tempDir, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, 'utf8');
    };

    write(
      'src/core/auth/guestInviteToken.ts',
      "export const GUEST_INVITE_COOKIE = 'guest_invite_session';\nexport class TokenHelper { verifyToken() { return true; } }\n",
    );
    write(
      'src/core/auth/guestInviteSession.ts',
      "import { GUEST_INVITE_COOKIE, TokenHelper } from './guestInviteToken';\nexport { GUEST_INVITE_COOKIE, TokenHelper };\n",
    );
    write(
      'docs/THREAT_MODEL.md',
      [
        '# Threat Model',
        '- `guest_invite_session` (`src/core/auth/guestInviteSession.ts`) and `TokenHelper.verifyToken` (`src/core/auth/guestInviteSession.ts`).',
        '- `unexported_cookie` (`src/core/auth/guestInviteSession.ts`).',
      ].join('\n'),
    );

    const result = verifySpecContracts(tempDir);
    expect(result.errors).toEqual([
      'docs/THREAT_MODEL.md:3: Symbol "unexported_cookie" is not declared or exported in src/core/auth/guestInviteSession.ts',
    ]);
  });

  it('resolves GitHub blob URLs (including percent-encoded dynamic route segments) and bolded symbol citations', () => {
    writeFixture(
      tempDir,
      'src/app/api/media/[id]/route.ts',
      'export async function DELETE() { return Response.json({ deleted: true }); }\n',
    );
    writeFixture(
      tempDir,
      'docs/ASSET_STORAGE.md',
      [
        '# Asset Storage',
        '- **`getStripeCapability`** ([src/lib/stripe.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/lib/stripe.ts)).',
        '- **`DELETE`** ([src/app/api/media/[id]/route.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/app/api/media/%5Bid%5D/route.ts)).',
        '- **`missingStorageHelper`** ([src/lib/stripe.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/lib/stripe.ts)).',
      ].join('\n'),
    );

    const result = verifySpecContracts(tempDir, { specFiles: ['docs/ASSET_STORAGE.md'] });
    expect(result.checkedSymbols).toBe(3);
    expect(result.errors).toEqual([
      'docs/ASSET_STORAGE.md:4: Symbol "missingStorageHelper" is not declared or exported in src/lib/stripe.ts',
    ]);
  });

  it('rejects missing HTTP 503 probe schemas or leaked stripped fields on GET /api/health in public/openapi.json', () => {
    writeFixture(
      tempDir,
      'public/openapi.json',
      JSON.stringify(
        {
          openapi: '3.0.3',
          paths: {
            '/api/live': {
              get: {
                responses: {
                  '200': {
                    content: {
                      'application/json': {
                        schema: {
                          type: 'object',
                          properties: {
                            status: { type: 'string', enum: ['alive'] },
                            timestamp: { type: 'string', format: 'date-time' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            '/api/health': {
              get: {
                responses: {
                  '200': {
                    content: {
                      'application/json': {
                        schema: {
                          type: 'object',
                          properties: {
                            success: { type: 'boolean', enum: [true] },
                            data: {
                              type: 'object',
                              properties: {
                                status: { type: 'string', enum: ['ok'] },
                                database: { type: 'string', enum: ['connected'] },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                  '503': {
                    content: {
                      'application/json': {
                        schema: {
                          type: 'object',
                          properties: {
                            success: { type: 'boolean', enum: [false] },
                            error: { type: 'string' },
                            referenceId: { type: 'string' },
                            status: { type: 'string', enum: ['unhealthy'] },
                            database: { type: 'string', enum: ['disconnected'] },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            '/api/ready': {
              get: {
                responses: {
                  '200': {
                    content: {
                      'application/json': {
                        schema: {
                          type: 'object',
                          properties: {
                            status: { type: 'string', enum: ['ready'] },
                            database: { type: 'string', enum: ['connected'] },
                            timestamp: { type: 'string', format: 'date-time' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        null,
        2,
      ),
    );

    const result = verifySpecContracts(tempDir);
    expect(result.errors).toEqual([
      'public/openapi.json: GET /api/health HTTP "503" schema must omit "status" (stripped by src/utils/withApiMiddleware.ts)',
      'public/openapi.json: GET /api/health HTTP "503" schema must omit "database" (stripped by src/utils/withApiMiddleware.ts)',
      'public/openapi.json: GET /api/ready must document HTTP "503" unwrapped schema with status="unhealthy", database="disconnected", error, and timestamp',
    ]);

    writeFixture(
      tempDir,
      'src/app/api/ready/route.ts',
      'function buildSchemaUnavailableResponse() { return {}; }\nexport async function GET() { return buildSchemaUnavailableResponse(); }\n',
    );
    writeFixture(
      tempDir,
      'src/app/api/health/route.ts',
      'export const GET = withApiMiddleware(async () => ({}), { isHealthProbe: true });\n',
    );
    const schemaAwareResult = verifySpecContracts(tempDir);
    expect(schemaAwareResult.errors).toContain(
      'public/openapi.json: GET /api/health must document HTTP "503" isHealthProbe schema with success=false, status="degraded", database="disconnected", timestamp, and error',
    );
    expect(schemaAwareResult.errors).toContain(
      'public/openapi.json: GET /api/ready must document HTTP "503" unwrapped schema with status="unhealthy", database enum ["connected", "disconnected"], error, and timestamp',
    );
  });

  it('rejects local/imported AST tokens on bare module citations while allowing scoped #L slice checks', () => {
    writeFixture(
      tempDir,
      'src/lib/localHookSample.ts',
      [
        "import { useMemo } from 'react';",
        'export function computeCapability() {',
        "  const localMemoValue = useMemo(() => 'high', []);",
        '  return Boolean(localMemoValue);',
        '}',
      ].join('\n'),
    );
    writeFixture(
      tempDir,
      'docs/SCOPED_SYMBOLS.md',
      [
        '# Scoped Symbols',
        '- Valid slice local hook: `useMemo` in [src/lib/localHookSample.ts](../src/lib/localHookSample.ts#L1-L4) and `localMemoValue` in [src/lib/localHookSample.ts](../src/lib/localHookSample.ts#L3-L4).',
        '- Valid paired slices: Reads `computeCapability()` synchronously via `useMemo` ([`src/lib/localHookSample.ts`](../src/lib/localHookSample.ts#L2-L2) (L2-L2) and [`src/lib/localHookSample.ts`](../src/lib/localHookSample.ts#L3-L4) (L3-L4)).',
        '- Bare module local hook rejected: `useMemo` in [src/lib/localHookSample.ts](../src/lib/localHookSample.ts).',
        '- Bare module local variable rejected: `localMemoValue` in [src/lib/localHookSample.ts](../src/lib/localHookSample.ts).',
        '- Out-of-slice token rejected: `useMemo` in [src/lib/localHookSample.ts](../src/lib/localHookSample.ts#L4-L5).',
      ].join('\n'),
    );

    const result = verifySpecContracts(tempDir, { specFiles: ['docs/SCOPED_SYMBOLS.md'] });
    expect(result.errors).toEqual([
      'docs/SCOPED_SYMBOLS.md:4: Symbol "useMemo" is not declared or exported in src/lib/localHookSample.ts',
      'docs/SCOPED_SYMBOLS.md:5: Symbol "localMemoValue" is not declared or exported in src/lib/localHookSample.ts',
      'docs/SCOPED_SYMBOLS.md:6: Symbol "useMemo" is not declared or referenced in src/lib/localHookSample.ts#L4-L5',
    ]);
  });

  it('extracts [Symbol](src/...) and [`Symbol`](src/...) link labels and rejects missing symbols', () => {
    writeFixture(
      tempDir,
      'src/components/SetupWizard.tsx',
      'export default function SetupWizard() { return null; }\n',
    );
    writeFixture(
      tempDir,
      'README.md',
      [
        '# Link Labels',
        '- Valid component link: [SetupWizard](src/components/SetupWizard.tsx).',
        '- Valid backticked member link: [`RegistryRepository.getAllItems`](src/features/registry/repository.ts#L1-L5).',
        '- Valid prose label ignored: [implementation](src/lib/stripe.ts) and [src/lib/stripe.ts](src/lib/stripe.ts).',
        '- Broken component link: [MissingWizard](src/components/SetupWizard.tsx).',
        '- Broken backticked link: [`missingHelper`](src/lib/stripe.ts).',
      ].join('\n'),
    );

    const result = verifySpecContracts(tempDir, { specFiles: ['README.md'] });
    expect(result.errors).toEqual([
      'README.md:5: Symbol "MissingWizard" is not declared or exported in src/components/SetupWizard.tsx',
      'README.md:6: Symbol "missingHelper" is not declared or exported in src/lib/stripe.ts',
    ]);
  });

  it('verifies assigned constant code spans (`CONST = value`) across direct, imported, and drifted module citations', () => {
    writeFixture(
      tempDir,
      'src/utils/registryPagination.ts',
      [
        'export const REGISTRY_DEFAULT_PAGE_LIMIT = 20;',
        'export const REGISTRY_MAX_CATALOG_LIMIT = 500;',
        'export const REGISTRY_INITIAL_VISIBLE_ITEMS = 12;',
        'export const REGISTRY_LOAD_MORE_INCREMENT = 8;',
      ].join('\n'),
    );
    writeFixture(
      tempDir,
      'src/features/registry/pages/index.tsx',
      [
        "import { REGISTRY_INITIAL_VISIBLE_ITEMS, REGISTRY_LOAD_MORE_INCREMENT } from '@/utils/registryPagination';",
        'export function RegistryPage() {',
        '  return REGISTRY_INITIAL_VISIBLE_ITEMS + REGISTRY_LOAD_MORE_INCREMENT;',
        '}',
      ].join('\n'),
    );
    writeFixture(
      tempDir,
      'src/features/registry/hooks/useRegistry.ts',
      [
        "import { REGISTRY_INITIAL_VISIBLE_ITEMS } from '@/utils/registryPagination';",
        'export function useRegistry() {',
        '  return REGISTRY_INITIAL_VISIBLE_ITEMS;',
        '}',
      ].join('\n'),
    );
    writeFixture(
      tempDir,
      'src/features/broadcast/service.ts',
      'const RECIPIENT_CHUNK_SIZE = 250;\nexport class BroadcastService { chunk = RECIPIENT_CHUNK_SIZE; }\n',
    );

    writeFixture(
      tempDir,
      'FEATURE_MODULES.md',
      [
        '# Constants Spec',
        'Registry pagination constants are centralized in [src/utils/registryPagination.ts](src/utils/registryPagination.ts#L1-L4):',
        '- **`REGISTRY_DEFAULT_PAGE_LIMIT = 20`**: Default page limit.',
        '- **Progressive Reveal**: Uses `REGISTRY_INITIAL_VISIBLE_ITEMS = 12` and `REGISTRY_LOAD_MORE_INCREMENT = 8` ([src/features/registry/pages/index.tsx](src/features/registry/pages/index.tsx#L1-L4)).',
        '- **Misattributed Increment**: Reveals `REGISTRY_LOAD_MORE_INCREMENT = 8` ([src/features/registry/hooks/useRegistry.ts](src/features/registry/hooks/useRegistry.ts)).',
        '- **Stale Broadcast Chunk**: Chunks of `RECIPIENT_CHUNK_SIZE = 500` ([src/features/broadcast/service.ts](src/features/broadcast/service.ts#L1)).',
      ].join('\n'),
    );

    const result = verifySpecContracts(tempDir, { specFiles: ['FEATURE_MODULES.md'] });
    expect(result.errors).toEqual([
      'FEATURE_MODULES.md:5: Symbol "REGISTRY_LOAD_MORE_INCREMENT" is not declared or exported in src/features/registry/hooks/useRegistry.ts',
      'FEATURE_MODULES.md:6: Constant "RECIPIENT_CHUNK_SIZE" in src/features/broadcast/service.ts has value 250, expected 500',
    ]);
  });
});
