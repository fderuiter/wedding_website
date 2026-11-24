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
        '- Capability helper: `getStripeCapability` in [src/lib/stripe.ts](src/lib/stripe.ts) returning `performanceTier` in [src/lib/stripe.ts](src/lib/stripe.ts).',
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

  it('fails when unprotected routes in src/lib/routes.ts or src/app/metadata.ts drift from src/middleware.ts or ARCHITECTURE.md', () => {
    writeFixture(
      tempDir,
      'src/app/api/admin/me/route.ts',
      'export async function GET() { return Response.json({ isAdmin: false }); }\n',
    );
    writeFixture(
      tempDir,
      'src/app/api/admin/logout/route.ts',
      'export async function POST() { return Response.json({ success: true }); }\n',
    );
    writeFixture(
      tempDir,
      'src/app/api/og/route.tsx',
      'export async function GET() { return new Response("png"); }\n',
    );
    writeFixture(
      tempDir,
      'src/lib/routes.ts',
      `const APP_ROUTES = [
  { path: '/api/admin/me', roles: ['public', 'admin'], exact: true },
  { path: '/api/admin/logout', roles: ['public', 'admin'], exact: true },
];
export function isProtectedRoute() { return false; }
`,
    );
    writeFixture(
      tempDir,
      'src/app/metadata.ts',
      "export const ogUrl = '/api/og?p1=Alex';\n",
    );
    writeFixture(
      tempDir,
      'src/middleware.ts',
      `export function middleware(request: { nextUrl: { pathname: string }; method: string }) {
  const normalizedPath = request.nextUrl.pathname;
  const method = request.method;
  const isExcluded = (normalizedPath === '/api/admin/me' && method === 'GET');
  return isExcluded;
}
`,
    );
    writeFixture(
      tempDir,
      'ARCHITECTURE.md',
      [
        '# Architecture',
        '| Route | Handler | Methods | Access Tier |',
        '|---|---|---|---|',
        '| `/api/admin/me` | `src/app/api/admin/me/route.ts` | `GET` | `Guest / Admin` |',
        '| `/api/admin/logout` | `src/app/api/admin/logout/route.ts` | `POST` | `Public` |',
        '| `/api/og` | `src/app/api/og/route.tsx` | `GET` | `Public` |',
      ].join('\n'),
    );

    const driftResult = verifySpecContracts(tempDir);
    expect(driftResult.errors).toEqual([
      'ARCHITECTURE.md: Unprotected API route "/api/admin/me" from src/lib/routes.ts is not documented with Access Tier `Public`',
      'src/lib/routes.ts: Unprotected API route "/api/admin/logout" (POST) is not excluded from the cookie gate in src/middleware.ts',
      'src/app/metadata.ts: Unprotected API route "/api/og" (GET) is not excluded from the cookie gate in src/middleware.ts',
    ]);

    writeFixture(
      tempDir,
      'src/middleware.ts',
      `export function middleware(request: { nextUrl: { pathname: string }; method: string }) {
  const normalizedPath = request.nextUrl.pathname;
  const method = request.method;
  const isExcluded =
    (normalizedPath === '/api/admin/me' && method === 'GET') ||
    (normalizedPath === '/api/admin/logout' && method === 'POST') ||
    (normalizedPath === '/api/og' && method === 'GET');
  return isExcluded;
}
`,
    );
    writeFixture(
      tempDir,
      'ARCHITECTURE.md',
      [
        '# Architecture',
        '| Route | Handler | Methods | Access Tier |',
        '|---|---|---|---|',
        '| `/api/admin/me` | `src/app/api/admin/me/route.ts` | `GET` | `Public` |',
        '| `/api/admin/logout` | `src/app/api/admin/logout/route.ts` | `POST` | `Public` |',
        '| `/api/og` | `src/app/api/og/route.tsx` | `GET` | `Public` |',
      ].join('\n'),
    );

    const fixedResult = verifySpecContracts(tempDir);
    expect(fixedResult.errors).toEqual([]);
  });

  it('fails when a module in src/core/auth/ or a SITE_* override in src/lib/config.ts is missing from ARCHITECTURE.md', () => {
    writeFixture(
      tempDir,
      'src/core/auth/guestInviteToken.ts',
      'export function getSignedGuestInviteSession() { return null; }\n',
    );
    writeFixture(
      tempDir,
      'src/core/auth/guestInviteSession.ts',
      'export function getGuestInviteSession() { return null; }\n',
    );
    writeFixture(
      tempDir,
      'src/lib/config.ts',
      `export function getEnvConfigOverrides() {
  return {
    p1: process.env.SITE_PARTNER1_NAME,
    theme: process.env.SITE_THEME_TOKENS,
  };
}
`,
    );
    writeFixture(
      tempDir,
      'ARCHITECTURE.md',
      [
        '# Architecture',
        '- Documented auth module: `src/core/auth/guestInviteSession.ts`.',
        '- Documented env override: `SITE_PARTNER1_NAME`.',
      ].join('\n'),
    );

    const driftResult = verifySpecContracts(tempDir);
    expect(driftResult.errors).toEqual([
      'ARCHITECTURE.md: Authentication module "src/core/auth/guestInviteToken.ts" in src/core/auth/ is not documented in ARCHITECTURE.md',
      'ARCHITECTURE.md: Environment variable override "SITE_THEME_TOKENS" in src/lib/config.ts is not documented in ARCHITECTURE.md',
    ]);

    writeFixture(
      tempDir,
      'ARCHITECTURE.md',
      [
        '# Architecture',
        '- Documented auth modules: `src/core/auth/guestInviteSession.ts` and `src/core/auth/guestInviteToken.ts`.',
        '- Documented env overrides: `SITE_PARTNER1_NAME` and `SITE_THEME_TOKENS`.',
      ].join('\n'),
    );

    const fixedResult = verifySpecContracts(tempDir);
    expect(fixedResult.errors).toEqual([]);
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

  it('rejects local/imported AST tokens and #L source line anchors while staying resilient to source line shifts', () => {
    writeFixture(
      tempDir,
      'src/lib/localHookSample.ts',
      [
        "import { useMemo } from 'react';",
        'function internalHelper() { return true; }',
        'export function computeCapability() {',
        "  const localMemoValue = useMemo(() => 'high', []);",
        '  return Boolean(localMemoValue) && internalHelper();',
        '}',
      ].join('\n'),
    );
    writeFixture(
      tempDir,
      'docs/SCOPED_SYMBOLS.md',
      [
        '# Scoped Symbols',
        '- Valid AST declarations: `computeCapability()` and `internalHelper` in [src/lib/localHookSample.ts](../src/lib/localHookSample.ts).',
        '- Bare module local hook rejected: `useMemo` in [src/lib/localHookSample.ts](../src/lib/localHookSample.ts).',
        '- Bare module local variable rejected: `localMemoValue` in [src/lib/localHookSample.ts](../src/lib/localHookSample.ts).',
        '- Source line anchor rejected: `computeCapability` in [src/lib/localHookSample.ts](../src/lib/localHookSample.ts#L3-L6).',
      ].join('\n'),
    );

    const result = verifySpecContracts(tempDir, { specFiles: ['docs/SCOPED_SYMBOLS.md'] });
    expect(result.errors).toEqual([
      'docs/SCOPED_SYMBOLS.md:3: Symbol "useMemo" is not declared or exported in src/lib/localHookSample.ts',
      'docs/SCOPED_SYMBOLS.md:4: Symbol "localMemoValue" is not declared or exported in src/lib/localHookSample.ts',
      'docs/SCOPED_SYMBOLS.md:5: Source line-range anchor in "../src/lib/localHookSample.ts#L3-L6" is prohibited; cite "src/lib/localHookSample.ts" by symbol name instead',
    ]);

    // Prepending 40 blank/comment lines to the source file causes zero failures on valid AST symbol citations
    const shiftedSource = `${Array.from({ length: 40 }, (_, idx) => `// shift line ${idx + 1}`).join('\n')}\n${fs.readFileSync(path.join(tempDir, 'src/lib/localHookSample.ts'), 'utf8')}`;
    writeFixture(tempDir, 'src/lib/localHookSample.ts', shiftedSource);
    writeFixture(
      tempDir,
      'docs/SHIFTED_SYMBOLS.md',
      '# Shifted Symbols\n- `computeCapability()` and `internalHelper` in [src/lib/localHookSample.ts](../src/lib/localHookSample.ts).\n',
    );
    expect(verifySpecContracts(tempDir, { specFiles: ['docs/SHIFTED_SYMBOLS.md'] }).errors).toEqual(
      [],
    );
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
        '- Valid backticked member link: [`RegistryRepository.getAllItems`](src/features/registry/repository.ts).',
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

  it('indexes type-alias members across literal, parenthesized, and intersection types and rejects omitted setters on "exposes only" lines', () => {
    writeFixture(
      tempDir,
      'src/components/ThemeProvider.tsx',
      [
        "export type ThemeMode = 'light' | 'dark' | 'system';",
        'type BaseThemeContext = ({',
        '  themeMode: ThemeMode;',
        '  setThemeMode: (mode: ThemeMode) => void;',
        '});',
        'type ThemeContextType = BaseThemeContext & {',
        '  glowFilter: string;',
        '  setPreviewConfig?: (',
        '    _preview: Record<string, unknown> | null,',
        '  ) => void;',
        '};',
        'export function ThemeProvider() {',
        '  return null;',
        '}',
      ].join('\n'),
    );
    writeFixture(
      tempDir,
      'docs/THEME_CONTEXT_CONTRACT.md',
      [
        '# Theme Context Contract',
        '- Valid complete exposes-only claim: `ThemeContextType` in [src/components/ThemeProvider.tsx](../src/components/ThemeProvider.tsx) exposes only `ThemeContextType.setThemeMode` and `ThemeContextType.setPreviewConfig`, with zero physics setters.',
        '- Valid multiline member declaration: `ThemeContextType.setPreviewConfig` in [src/components/ThemeProvider.tsx](../src/components/ThemeProvider.tsx).',
        '- Incomplete bare setter claim: `ThemeContextType` in [src/components/ThemeProvider.tsx](../src/components/ThemeProvider.tsx) exposes only `setThemeMode` and zero physics setters.',
        '- Incomplete dotted setter claim: `ThemeContextType` in [src/components/ThemeProvider.tsx](../src/components/ThemeProvider.tsx) exposes only `ThemeContextType.setThemeMode`.',
        '- Missing type-alias member: `ThemeContextType.setPhysicsImpulse` in [src/components/ThemeProvider.tsx](../src/components/ThemeProvider.tsx).',
      ].join('\n'),
    );

    const result = verifySpecContracts(tempDir, {
      specFiles: ['docs/THEME_CONTEXT_CONTRACT.md'],
    });
    expect(result.errors).toEqual([
      'docs/THEME_CONTEXT_CONTRACT.md:4: Type "ThemeContextType" in src/components/ThemeProvider.tsx declares callable member(s) "setPreviewConfig" omitted from "exposes only" claim',
      'docs/THEME_CONTEXT_CONTRACT.md:5: Type "ThemeContextType" in src/components/ThemeProvider.tsx declares callable member(s) "setPreviewConfig" omitted from "exposes only" claim',
      'docs/THEME_CONTEXT_CONTRACT.md:6: Member "setPhysicsImpulse" on "ThemeContextType" ("ThemeContextType.setPhysicsImpulse") does not exist in src/components/ThemeProvider.tsx',
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
        'Registry pagination constants are centralized in [src/utils/registryPagination.ts](src/utils/registryPagination.ts):',
        '- **`REGISTRY_DEFAULT_PAGE_LIMIT = 20`**: Default page limit.',
        '- **Progressive Reveal**: Uses `REGISTRY_INITIAL_VISIBLE_ITEMS = 12` and `REGISTRY_LOAD_MORE_INCREMENT = 8` ([src/features/registry/pages/index.tsx](src/features/registry/pages/index.tsx)).',
        '- **Misattributed Increment**: Reveals `REGISTRY_LOAD_MORE_INCREMENT = 8` ([src/features/registry/hooks/useRegistry.ts](src/features/registry/hooks/useRegistry.ts)).',
        '- **Stale Broadcast Chunk**: Chunks of `RECIPIENT_CHUNK_SIZE = 500` ([src/features/broadcast/service.ts](src/features/broadcast/service.ts)).',
      ].join('\n'),
    );

    const result = verifySpecContracts(tempDir, { specFiles: ['FEATURE_MODULES.md'] });
    expect(result.errors).toEqual([
      'FEATURE_MODULES.md:5: Symbol "REGISTRY_LOAD_MORE_INCREMENT" is not declared or exported in src/features/registry/hooks/useRegistry.ts',
      'FEATURE_MODULES.md:6: Constant "RECIPIENT_CHUNK_SIZE" in src/features/broadcast/service.ts has value 250, expected 500',
    ]);
  });

  it('enforces interactive demo runtime module, DEMO_STORAGE_KEY, and build:export coverage across ARCHITECTURE.md, docs/runtime-contract.md, and DEPLOYMENT.md', () => {
    expect(verifySpecContracts(process.cwd()).errors).toEqual([]);

    writeFixture(
      tempDir,
      'package.json',
      JSON.stringify({ name: 'demo-spec-fixture', scripts: { 'build:export': 'node scripts/build-export.mjs' } }),
    );
    writeFixture(
      tempDir,
      'src/components/layout/RootLayoutClient.tsx',
      'export default function RootLayoutClient() { return null; }\n',
    );
    writeFixture(
      tempDir,
      'src/components/demo/DemoContext.tsx',
      'export function DemoProvider() { return null; }\n',
    );
    writeFixture(
      tempDir,
      'src/components/demo/DemoToolbar.tsx',
      'export function DemoToolbar() { return null; }\n',
    );
    writeFixture(
      tempDir,
      'src/lib/demo/demoStore.ts',
      "const DEMO_STORAGE_KEY = 'wedding_showcase_demo_v1';\nexport function hydrateDemoStateFromStorage() { return DEMO_STORAGE_KEY; }\n",
    );
    writeFixture(
      tempDir,
      'src/lib/demo/demoApiHandler.ts',
      'export function installDemoFetchInterceptor() { return () => {}; }\n',
    );
    writeFixture(
      tempDir,
      'src/lib/sampleData/builder.ts',
      'export function buildArchetypeSeedData() { return {}; }\n',
    );
    writeFixture(
      tempDir,
      'src/features/registry/components/SimulatedCardCheckout.tsx',
      'export const SIMULATED_TEST_CARDS = [];\nexport function SimulatedCardCheckout() { return null; }\n',
    );
    writeFixture(
      tempDir,
      'src/app/admin/setup/page.tsx',
      'export default function AdminSetupPage() { return null; }\n',
    );

    const completeSpecLines = [
      '# Demo Runtime Spec',
      '- Build with `npm run build:export`.',
      '- Layout: `RootLayoutClient` in [src/components/layout/RootLayoutClient.tsx](src/components/layout/RootLayoutClient.tsx), `DemoProvider` in [src/components/demo/DemoContext.tsx](src/components/demo/DemoContext.tsx), and `DemoToolbar` in [src/components/demo/DemoToolbar.tsx](src/components/demo/DemoToolbar.tsx).',
      '- Store: `wedding_showcase_demo_v1` via `hydrateDemoStateFromStorage` in [src/lib/demo/demoStore.ts](src/lib/demo/demoStore.ts) and `buildArchetypeSeedData` in [src/lib/sampleData/builder.ts](src/lib/sampleData/builder.ts).',
      '- Interceptor & Checkout: `installDemoFetchInterceptor` in [src/lib/demo/demoApiHandler.ts](src/lib/demo/demoApiHandler.ts), `SimulatedCardCheckout` in [src/features/registry/components/SimulatedCardCheckout.tsx](src/features/registry/components/SimulatedCardCheckout.tsx), and `AdminSetupPage` in [src/app/admin/setup/page.tsx](src/app/admin/setup/page.tsx).',
    ].join('\n');

    writeFixture(tempDir, 'ARCHITECTURE.md', completeSpecLines);
    writeFixture(
      tempDir,
      'docs/runtime-contract.md',
      completeSpecLines.replace(/\]\(src\//g, '](../src/'),
    );
    writeFixture(
      tempDir,
      'DEPLOYMENT.md',
      '# Incomplete Deployment Spec\nOmits demo runtime modules and storage key.\n',
    );

    const result = verifySpecContracts(tempDir, {
      specFiles: ['ARCHITECTURE.md', 'docs/runtime-contract.md', 'DEPLOYMENT.md'],
    });
    expect(result.errors).toEqual([
      'DEPLOYMENT.md: Interactive demo runtime module "src/components/layout/RootLayoutClient.tsx" is not documented in DEPLOYMENT.md',
      'DEPLOYMENT.md: Interactive demo runtime module "src/components/demo/DemoContext.tsx" is not documented in DEPLOYMENT.md',
      'DEPLOYMENT.md: Interactive demo runtime module "src/components/demo/DemoToolbar.tsx" is not documented in DEPLOYMENT.md',
      'DEPLOYMENT.md: Interactive demo runtime module "src/lib/demo/demoStore.ts" is not documented in DEPLOYMENT.md',
      'DEPLOYMENT.md: Interactive demo runtime module "src/lib/demo/demoApiHandler.ts" is not documented in DEPLOYMENT.md',
      'DEPLOYMENT.md: Interactive demo runtime module "src/lib/sampleData/builder.ts" is not documented in DEPLOYMENT.md',
      'DEPLOYMENT.md: Interactive demo runtime module "src/features/registry/components/SimulatedCardCheckout.tsx" is not documented in DEPLOYMENT.md',
      'DEPLOYMENT.md: Interactive demo runtime module "src/app/admin/setup/page.tsx" is not documented in DEPLOYMENT.md',
      'DEPLOYMENT.md: Demo storage key "wedding_showcase_demo_v1" from src/lib/demo/demoStore.ts is not documented in DEPLOYMENT.md',
      'DEPLOYMENT.md: Static showcase export script "build:export" from package.json is not documented in DEPLOYMENT.md',
    ]);
  });

  it('reports broadcast schema, placeholder, status literal, escaping, subject stripping, and baseUrl drift with exact line numbers', () => {
    writeFixture(
      tempDir,
      'src/features/broadcast/schemas.ts',
      [
        "import { z } from 'zod';",
        'const BroadcastTargetFiltersSchema = z.object({',
        '  partyTags: z.array(z.string()).optional(),',
        '  selectedIds: z.array(z.string()).optional(),',
        '});',
        'export const SendBroadcastSchema = z.object({',
        "  channel: z.enum(['EMAIL', 'SMS']),",
        '  body: z.string(),',
        '  scheduledFor: z.string().optional(),',
        '});',
        'export const SendTestBroadcastSchema = z.object({',
        "  channel: z.enum(['EMAIL', 'SMS']),",
        '  body: z.string(),',
        '  destination: z.string().optional(),',
        '});',
      ].join('\n'),
    );
    writeFixture(
      tempDir,
      'src/features/broadcast/template.ts',
      [
        "export function sanitizeEmailSubject(subject: string) { return subject.replace(/[\\r\\n<>]/g, ''); }",
        'export function renderBroadcastTemplate(tpl: string, _ctx: unknown, options?: { escapeHtml?: boolean }) {',
        '  const shouldEscape = Boolean(options?.escapeHtml);',
        '  return shouldEscape ? tpl : tpl;',
        '}',
        'export const AVAILABLE_TEMPLATE_PLACEHOLDERS = [',
        "  '{{guestName}}',",
        "  '{{invitationCode}}',",
        '] as const;',
      ].join('\n'),
    );
    writeFixture(
      tempDir,
      'src/features/broadcast/service.ts',
      [
        'function resolveBroadcastBaseUrl(configBaseUrl?: string, requestOrigin?: string) {',
        "  return { baseUrl: configBaseUrl || requestOrigin || 'http://localhost:3000' };",
        '}',
        "type FinalBroadcastStatus = 'SENT' | 'PARTIALLY_SENT' | 'FAILED';",
        'export class BroadcastService { status: FinalBroadcastStatus = "SENT"; url = resolveBroadcastBaseUrl; }',
      ].join('\n'),
    );
    writeFixture(
      tempDir,
      'src/app/api/admin/broadcast/send/route.ts',
      'export async function POST() { return Response.json({}); }\n',
    );
    writeFixture(
      tempDir,
      'src/app/api/admin/broadcast/test-send/route.ts',
      'export async function POST() { return Response.json({}); }\n',
    );

    writeFixture(
      tempDir,
      'docs/BROADCASTS.md',
      [
        '# Guest Broadcasts',
        '- `/api/admin/broadcast/test-send` sends to `testEmail` or `testPhone`.',
        '- `/api/admin/broadcast/send` schedules via `scheduledAt`.',
        '- `BroadcastTargetFiltersSchema` supports `partyTags` and `includeAddressCollection`.',
        '- `executeDispatch` marks messages `PARTIAL` and writes `errorMessage`.',
        '- `AVAILABLE_TEMPLATE_PLACEHOLDERS`: `{{guestName}}` and `{{partner1Name}}` via `resolveBroadcastBaseUrl` (`NEXT_PUBLIC_SITE_URL`).',
        '- `renderBroadcastTemplate` (`escapeHtml: true`, default).',
        '- `sanitizeEmailSubject` replaces newlines with spaces and trims whitespace.',
      ].join('\n'),
    );

    const result = verifySpecContracts(tempDir, { specFiles: ['docs/BROADCASTS.md'] });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('src/features/broadcast/schemas.ts:6: SendBroadcastSchema must enforce .strict()'),
        expect.stringContaining('docs/BROADCASTS.md:2: SendTestBroadcastSchema uses `destination`'),
        expect.stringContaining('docs/BROADCASTS.md:3: Deprecated `scheduledAt` key'),
        expect.stringContaining('docs/BROADCASTS.md:4: Missing BroadcastTargetFiltersSchema key `selectedIds`'),
        expect.stringContaining('docs/BROADCASTS.md:4: Stale broadcast filter key "includeAddressCollection"'),
        expect.stringContaining('docs/BROADCASTS.md:5: Invalid broadcast status `PARTIAL`'),
        expect.stringContaining('docs/BROADCASTS.md:5: BroadcastRecipient records failures in `error`'),
        expect.stringContaining('docs/BROADCASTS.md:6: Missing template placeholder `{{invitationCode}}`'),
        expect.stringContaining('docs/BROADCASTS.md:6: Documented placeholder `{{partner1Name}}`'),
        expect.stringContaining('docs/BROADCASTS.md:6: resolveBroadcastBaseUrl does not read NEXT_PUBLIC_SITE_URL'),
        expect.stringContaining('docs/BROADCASTS.md:7: renderBroadcastTemplate defaults `escapeHtml` to `false`'),
        expect.stringContaining('docs/BROADCASTS.md:8: sanitizeEmailSubject documentation must cite `[\\r\\n<>]`'),
      ]),
    );
  });

  it('reports Prisma model, AppConfig/backupPersistence count, schemaVersion, registry guard, scraper domain, and security control drift', () => {
    writeFixture(
      tempDir,
      'prisma/schema.prisma',
      [
        'model AppConfig {',
        '  id String @id',
        '  smtpPass String @default("")',
        '  modules Json @default("{}")',
        '}',
        'model AuthLockout {',
        '  keyHash String @id',
        '}',
      ].join('\n'),
    );
    writeFixture(
      tempDir,
      'src/lib/backupPersistence.ts',
      [
        "export const APP_CONFIG_SECRET_KEYS = ['smtpPass'] as const;",
        "export const APP_CONFIG_BACKUP_KEYS = ['id', 'modules'] as const;",
        'export function sanitizeAppConfigForBackup() { return {}; }',
      ].join('\n'),
    );
    writeFixture(
      tempDir,
      'src/app/api/admin/maintenance/export/route.ts',
      "const BACKUP_SCHEMA_VERSION = '2.0';\nexport async function GET() { return Response.json({ version: BACKUP_SCHEMA_VERSION }); }\n",
    );
    writeFixture(
      tempDir,
      'ARCHITECTURE.md',
      [
        '# Architecture',
        '- **Data Models:**',
        '  - **`AppConfig`:** Settings.',
        'Covering 2 persisted PostgreSQL columns in prisma/schema.prisma.',
        '- **Backup Export Sanitizer (`sanitizeAppConfigForBackup`):** Retains 1 `APP_CONFIG_BACKUP_KEYS` while stripping the 1 raw provider secrets.',
        'Import and export formats include (`schemaVersion: "1.0"`).',
      ].join('\n'),
    );

    writeFixture(
      tempDir,
      'src/app/api/registry/claim/route.ts',
      "import { isFeatureEnabled } from '@/lib/modules';\nexport async function POST() { return isFeatureEnabled('registry'); }\n",
    );
    writeFixture(
      tempDir,
      'src/app/api/registry/scrape/route.ts',
      'export async function POST() { return Response.json({}); }\n',
    );
    writeFixture(
      tempDir,
      'FEATURE_MODULES.md',
      [
        '# Feature Modules',
        "- **Registry APIs Enforcing `isFeatureEnabled('registry')` (HTTP 404 — 0 of 2 handlers)**:",
        "- **Shared Routes Skipping `isFeatureEnabled('registry')` (2 of 2 handlers)**:",
        '  - `POST /api/registry/scrape`',
      ].join('\n'),
    );

    writeFixture(
      tempDir,
      'src/features/registry/api/scrape.ts',
      "const isAmazonDomain = hostname === 'amazon.com' || hostname.endsWith('.amazon.com');\nexport { isAmazonDomain };\n",
    );
    writeFixture(
      tempDir,
      'SCRAPER.md',
      ['# Scraper', '- Selector `#productTitle` on `amazon.*`.'].join('\n'),
    );

    writeFixture(
      tempDir,
      'src/features/broadcast/providers/index.ts',
      'async function sendSmtpEmail() { return { success: true }; }\nexport { sendSmtpEmail };\n',
    );
    writeFixture(
      tempDir,
      'src/app/api/guest/address/public/route.ts',
      [
        'export async function POST(req: Request, body: Record<string, string>) {',
        "  await rateLimit(req, 10, 15 * 60 * 1000, 'public_address_collect');",
        '  const honeypotVal = body.website || body.honeypot;',
        '  return Response.json({ honeypotVal });',
        '}',
      ].join('\n'),
    );
    writeFixture(
      tempDir,
      'src/utils/pathContainment.ts',
      'export class PathContainmentError extends Error {}\n',
    );
    writeFixture(
      tempDir,
      'SECURITY.md',
      [
        '# Security',
        '- Default `smtp` / `none` providers operate as safe no-op stubs.',
        '- Public form `/api/guest/address/public` allows 50 requests per 15 minutes.',
      ].join('\n'),
    );

    const result = verifySpecContracts(tempDir, {
      specFiles: ['ARCHITECTURE.md', 'FEATURE_MODULES.md', 'SCRAPER.md', 'SECURITY.md'],
    });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('ARCHITECTURE.md:2: Prisma model "AuthLockout"'),
        expect.stringContaining('ARCHITECTURE.md:5: Must cite src/lib/backupPersistence.ts'),
        expect.stringContaining('ARCHITECTURE.md:6: Expected `schemaVersion: "2.0"`'),
        expect.stringContaining('FEATURE_MODULES.md:2: Guarded registry route "/api/registry/claim" is missing'),
        expect.stringContaining('SCRAPER.md:2: Scraper host check in src/features/registry/api/scrape.ts matches `amazon.com` and `*.amazon.com` only, not `amazon.*`'),
        expect.stringContaining('SECURITY.md:2: Must not describe `smtp` as an inert or no-op stub'),
        expect.stringContaining('SECURITY.md:3: Must document `/api/guest/address/public` rate limit of 10 requests per 15 minutes'),
        expect.stringContaining('SECURITY.md:3: Must document honeypot validation on `/api/guest/address/public`'),
        expect.stringContaining('SECURITY.md:1: Must reference `src/utils/pathContainment.ts`'),
      ]),
    );
  });

  it('verifies all seven repository Markdown specifications contain zero #Lstart-Lend source anchors', () => {
    const sevenSpecs = [
      'ARCHITECTURE.md',
      'FEATURE_MODULES.md',
      'SCRAPER.md',
      'SECURITY.md',
      'docs/BROADCASTS.md',
      'docs/runtime-contract.md',
      'docs/THREAT_MODEL.md',
    ];
    for (const rel of sevenSpecs) {
      const raw = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
      expect(raw).not.toMatch(/#L\d+/);
    }
  });

  it('handles CommonMark backtick info strings, multi-line HTML comments, backticked comment literals, angle-bracket links, and interface members', () => {
    writeFixture(
      tempDir,
      'src/features/rsvp/contract.ts',
      [
        'export interface RsvpContract {',
        '  readonly guestId: string;',
        '  confirmRsvp(code: string): Promise<boolean>;',
        '}',
        'export function submitRsvp(): boolean {',
        '  return true;',
        '}',
      ].join('\n'),
    );
    writeFixture(
      tempDir,
      'docs/CONTRACT_SPEC.md',
      [
        '# Contract Spec',
        'Inline triple-backtick code ```not a fence` keeps scanner outside fences.',
        '<!--',
        '- `GET /api/nonexistent/commented`',
        '- [missingInComment](<../src/features/rsvp/contract.ts>)',
        '-->',
        '- Preserves `<!-- literal marker -->` while checking [submitRsvp](<../src/features/rsvp/contract.ts>), [`RsvpContract.confirmRsvp`](<../src/features/rsvp/contract.ts>), and [missingHelper](<../src/features/rsvp/contract.ts>).',
      ].join('\n'),
    );

    const res = verifySpecContracts(tempDir, { specFiles: ['docs/CONTRACT_SPEC.md'] });
    expect(res.errors).toEqual([
      'docs/CONTRACT_SPEC.md:7: Symbol "missingHelper" is not declared or exported in src/features/rsvp/contract.ts',
    ]);
  });
});
