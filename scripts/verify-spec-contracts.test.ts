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
});
