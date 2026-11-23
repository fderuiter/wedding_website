import fs from 'fs';
import os from 'os';
import path from 'path';
import type { FeatureMetadata } from '../src/lib/modules';
import {
  collectApiRouteEntries,
  extractFeatureRuntimeEnforcement,
  generateApiRoutesSection,
} from './generate-docs';

function writeFile(rootDir: string, relPath: string, content: string): void {
  const fullPath = path.join(rootDir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
}

describe('scripts/generate-docs AST analysis', () => {
  const repoRoot = process.cwd();
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'generate-docs-ast-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('classifies live Invite-only handlers, unwrapped routes, POST-only Edge bypass on Stripe webhook, and dedicated /admin/dashboard/registry route for registry', () => {
    const entries = collectApiRouteEntries(repoRoot);
    const byPath = new Map(entries.map((entry) => [entry.routePath, entry]));

    const guestAddress = byPath.get('/api/guest/address');
    expect(guestAddress).toBeDefined();
    expect(guestAddress?.accessTier).toBe('`Invite-only`');
    expect(guestAddress?.checksInviteSession).toBe(true);
    expect(guestAddress?.usesApiMiddleware).toBe(true);

    const rsvp = byPath.get('/api/rsvp');
    expect(rsvp).toBeDefined();
    expect(rsvp?.methods).toEqual(['POST']);
    expect(rsvp?.accessTier).toBe('`Invite-only`');
    expect(rsvp?.checksInviteSession).toBe(true);
    expect(rsvp?.usesApiMiddleware).toBe(true);

    const guestLookup = byPath.get('/api/guest/lookup');
    expect(guestLookup?.accessTier).toBe('`Guest / Admin`');
    expect(guestLookup?.checksInviteSession).toBe(false);

    const stripeWebhook = byPath.get('/api/registry/webhook/stripe');
    expect(stripeWebhook).toBeDefined();
    expect(stripeWebhook?.accessTier).toBe('`stripeSignature (STRIPE_WEBHOOK_SECRET)`');
    expect(stripeWebhook?.checksStripeSignature).toBe(true);
    expect(stripeWebhook?.edgeCookieBypassMethods).toEqual(['POST']);
    expect(stripeWebhook?.usesApiMiddleware).toBe(false);

    const unwrappedPaths = entries
      .filter((entry) => !entry.usesApiMiddleware)
      .map((entry) => entry.routePath)
      .sort();
    expect(unwrappedPaths).toEqual(
      expect.arrayContaining([
        '/api/live',
        '/api/og',
        '/api/ready',
        '/api/registry/webhook/stripe',
        '/api/uploads/[...path]',
      ]),
    );
    expect(unwrappedPaths).not.toContain('/api/guest/address');
    expect(unwrappedPaths).not.toContain('/api/rsvp');
    expect(unwrappedPaths).not.toContain('/api/media/export');

    const mediaExport = byPath.get('/api/media/export');
    expect(mediaExport?.usesApiMiddleware).toBe(true);

    const liveEnforcement = extractFeatureRuntimeEnforcement(repoRoot);
    expect(liveEnforcement.registry.uiCoverage).toContain('(`/admin/dashboard/registry` skips `isFeatureEnabled`)');
    expect(liveEnforcement.registry.uiCoverage).not.toContain('(`/admin/dashboard` skips `isFeatureEnabled`)');
    expect(liveEnforcement.attractions.uiCoverage).toContain('Nav + `/` link hidden');
  });

  it('distinguishes Edge cookie-gated vs POST-excluded stripe-signature routes and Invite-only vs optional session handlers in isolated AST fixtures', () => {
    writeFile(
      tempDir,
      'src/utils/withApiMiddleware.ts',
      'export function withApiMiddleware<T>(fn: T): T { return fn; }\n',
    );
    writeFile(
      tempDir,
      'src/utils/createValidatedRoute.ts',
      `import { withApiMiddleware } from './withApiMiddleware';
export function createValidatedRoute(opts: { handler: unknown }) {
  return withApiMiddleware(opts.handler);
}
`,
    );
    writeFile(
      tempDir,
      'src/features/billing/webhook.ts',
      `export async function POST(req: Request) {
  const sig = req.headers.get('stripe-signature');
  if (!sig) return new Response('missing sig', { status: 400 });
  return new Response('ok');
}
`,
    );
    writeFile(
      tempDir,
      'src/features/billing/index.ts',
      'export { POST } from \'./webhook\';\n',
    );
    writeFile(
      tempDir,
      'src/app/api/registry/webhook/stripe/route.ts',
      'export { POST } from \'@/features/billing\';\n',
    );
    writeFile(
      tempDir,
      'src/app/api/guest/address/route.ts',
      `import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';
import { ApiError } from '@/utils/ApiError';

export const POST = withApiMiddleware(async (req: Request) => {
  const invite = await getGuestInviteSession(req);
  if (!invite) {
    throw new ApiError(401, 'Invitation code required');
  }
  return Response.json({ ok: true });
});
`,
    );
    writeFile(
      tempDir,
      'src/app/api/guest/optional/route.ts',
      `import { createValidatedRoute } from '@/utils/createValidatedRoute';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';

export const GET = createValidatedRoute({
  handler: async (req: Request) => {
    const invite = await getGuestInviteSession(req);
    return Response.json({ guest: invite?.guestName ?? null });
  },
});
`,
    );
    writeFile(
      tempDir,
      'src/app/api/ready/route.ts',
      'export async function GET() { return Response.json({ ready: true }); }\n',
    );

    // 1. Without POST exclusion in src/middleware.ts: Edge cookie gate applies to all methods
    writeFile(
      tempDir,
      'src/middleware.ts',
      `export function middleware(req: { method: string; nextUrl: { pathname: string } }) {
  const normalizedPath = req.nextUrl.pathname;
  const isExcluded = normalizedPath === '/api/ready';
  if (isExcluded) {
    return;
  }
}
`,
    );

    const gatedEntries = collectApiRouteEntries(tempDir);
    const gatedByPath = new Map(gatedEntries.map((entry) => [entry.routePath, entry]));

    expect(gatedByPath.get('/api/registry/webhook/stripe')?.checksStripeSignature).toBe(true);
    expect(gatedByPath.get('/api/registry/webhook/stripe')?.edgeCookieBypassMethods).toEqual([]);
    expect(gatedByPath.get('/api/registry/webhook/stripe')?.usesApiMiddleware).toBe(false);
    expect(gatedByPath.get('/api/guest/address')?.accessTier).toBe('`Invite-only`');
    expect(gatedByPath.get('/api/guest/address')?.usesApiMiddleware).toBe(true);
    expect(gatedByPath.get('/api/guest/optional')?.accessTier).toBe('`Guest / Admin`');
    expect(gatedByPath.get('/api/guest/optional')?.usesApiMiddleware).toBe(true);
    expect(gatedByPath.get('/api/ready')?.accessTier).toBe('`Public`');
    expect(gatedByPath.get('/api/ready')?.usesApiMiddleware).toBe(false);

    const gatedSummary = generateApiRoutesSection(tempDir);
    expect(gatedSummary).toContain(
      'remains behind the Edge cookie gate in `src/middleware.ts` and enforces `stripe-signature` (`STRIPE_WEBHOOK_SECRET`) in the handler',
    );

    // 2. With method === 'POST' exclusion in src/middleware.ts: only POST bypasses Edge cookie gate
    writeFile(
      tempDir,
      'src/middleware.ts',
      `export function middleware(req: { method: string; nextUrl: { pathname: string } }) {
  const normalizedPath = req.nextUrl.pathname;
  const method = req.method;
  const isExcluded =
    normalizedPath === '/api/ready' ||
    (method === 'POST' && normalizedPath === '/api/registry/webhook/stripe');
  if (isExcluded) {
    return;
  }
}
`,
    );

    const excludedEntries = collectApiRouteEntries(tempDir);
    const excludedWebhook = excludedEntries.find(
      (entry) => entry.routePath === '/api/registry/webhook/stripe',
    );
    expect(excludedWebhook?.edgeCookieBypassMethods).toEqual(['POST']);

    const excludedSummary = generateApiRoutesSection(tempDir);
    expect(excludedSummary).toContain(
      'bypasses the Edge cookie gate on `POST` in `src/middleware.ts`',
    );
  });

  it('extracts UI, API, and Prisma persistence enforcement via AST without hardcoded lookup tables', () => {
    writeFile(
      tempDir,
      'prisma/schema.prisma',
      `model AppConfig {
  id String @id @default("global")
  showCountdown Boolean @default(true)
}
`,
    );
    writeFile(
      tempDir,
      'src/features/content/schemas.ts',
      'export const AppConfigSchema = { modules: true };\n',
    );
    writeFile(
      tempDir,
      'src/lib/routes.ts',
      `import { isFeatureEnabled } from './modules';
export const APP_ROUTES = [
  { path: '/weather', requiredModule: 'weather', showInNav: true },
  { path: '/registry', requiredModule: 'registry', showInNav: true },
];
export function getVisibleNavRoutes(modules: Record<string, boolean>) {
  return APP_ROUTES.filter((r) => isFeatureEnabled(r.requiredModule, modules));
}
`,
    );
    writeFile(
      tempDir,
      'src/app/admin/dashboard/layout.tsx',
      `import { isFeatureEnabled } from '@/lib/modules';
const navItems = [
  { href: '/admin/dashboard', featureId: 'registry' },
  { href: '/admin/dashboard/invitation-codes', featureId: 'registry' },
  { href: '/admin/dashboard/weather', featureId: 'weather' },
];
export default function AdminLayout({ modules }: { modules: Record<string, boolean> }) {
  return navItems.filter((item) => isFeatureEnabled(item.featureId, modules));
}
`,
    );
    writeFile(
      tempDir,
      'src/app/admin/dashboard/page.tsx',
      'export default function AdminDashboardRegistryPage() { return null; }\n',
    );
    writeFile(
      tempDir,
      'src/app/admin/dashboard/invitation-codes/page.tsx',
      'export default function AdminInvitesPage() { return null; }\n',
    );
    writeFile(
      tempDir,
      'src/app/weather/page.tsx',
      `import { notFound } from 'next/navigation';
import { isFeatureEnabled } from '@/lib/modules';

export default async function WeatherPage({ modules }: { modules: Record<string, boolean> }) {
  if (!isFeatureEnabled('weather', modules)) {
    notFound();
  }
  return null;
}
`,
    );
    writeFile(
      tempDir,
      'src/app/admin/dashboard/weather/page.tsx',
      'export default function AdminWeatherPage() { return null; }\n',
    );
    writeFile(
      tempDir,
      'src/app/registry/page.tsx',
      `import { notFound } from 'next/navigation';
import { isFeatureEnabled } from '@/lib/modules';

export default async function RegistryPage({ modules }: { modules: Record<string, boolean> }) {
  if (!isFeatureEnabled('registry', modules)) {
    notFound();
  }
  return null;
}
`,
    );
    writeFile(
      tempDir,
      'src/components/home/HomePageClient.tsx',
      `import { isFeatureEnabled } from '@/lib/modules';
export function HomePageClient({ config }: { config: { showCountdown: boolean; modules: Record<string, boolean> } }) {
  return config.showCountdown && isFeatureEnabled('countdown', config.modules) ? 'countdown' : null;
}
`,
    );
    writeFile(
      tempDir,
      'src/app/api/weather/route.ts',
      `import { isFeatureEnabled } from '@/lib/modules';
import { ApiError } from '@/utils/ApiError';

export async function GET() {
  if (!isFeatureEnabled('weather', {})) {
    throw new ApiError(404, 'Weather feature is disabled');
  }
  return Response.json({ ok: true });
}
`,
    );
    writeFile(
      tempDir,
      'src/features/registry/api/contribute.ts',
      `import { isFeatureEnabled } from '@/lib/modules';
import { ApiError } from '@/utils/ApiError';

export async function POST() {
  if (!isFeatureEnabled('registry', {})) {
    throw new ApiError(404, 'Registry disabled');
  }
  if (!isFeatureEnabled('groupGifting', {})) {
    throw new ApiError(400, 'Group gifting is currently disabled.');
  }
  return Response.json({ ok: true });
}
`,
    );
    writeFile(
      tempDir,
      'src/features/registry/index.ts',
      'export { POST as contributePOST } from \'./api/contribute\';\n',
    );
    writeFile(
      tempDir,
      'src/app/api/registry/contribute/route.ts',
      'export { contributePOST as POST } from \'@/features/registry\';\n',
    );

    const fixtureMetadata: Record<string, FeatureMetadata> = {
      weather: {
        id: 'weather',
        title: 'Weather Forecast',
        description: 'Weather forecast display',
        category: 'information',
      },
      registry: {
        id: 'registry',
        title: 'Gift Registry',
        description: 'Gift registry catalog',
        category: 'core',
      },
      groupGifting: {
        id: 'groupGifting',
        title: 'Group Gifting',
        description: 'Partial contributions',
        category: 'core',
        dependencies: ['registry'],
      },
      countdown: {
        id: 'countdown',
        title: 'Countdown',
        description: 'Wedding countdown timer',
        category: 'engagement',
      },
    };

    const extracted = extractFeatureRuntimeEnforcement(tempDir, fixtureMetadata);

    expect(extracted.weather).toEqual({
      persistence: '`Virtual DTO`',
      uiCoverage:
        'Nav hidden; `/weather` returns HTTP 404 (`/admin/dashboard/weather` skips `isFeatureEnabled`)',
      apiCoverage: 'HTTP 404 on `GET /api/weather`',
    });

    expect(extracted.registry).toEqual({
      persistence: '`Virtual DTO`',
      uiCoverage:
        'Nav hidden; `/registry` returns HTTP 404 (`/admin/dashboard` skips `isFeatureEnabled`)',
      apiCoverage: 'HTTP 404 on `POST /api/registry/contribute`',
    });

    expect(extracted.countdown).toEqual({
      persistence: '`Virtual DTO` + `Prisma` (`showCountdown`)',
      uiCoverage:
        'Homepage (`/`) widget (`config.showCountdown && isFeatureEnabled`)',
      apiCoverage: 'N/A',
    });

    expect(extracted.groupGifting).toEqual({
      persistence: '`Virtual DTO`',
      uiCoverage:
        'Unchecked in UI (`/registry` delegates enforcement to contribution APIs)',
      apiCoverage: 'HTTP 400 on `POST /api/registry/contribute`',
    });

    // When AppConfig defines `modules Json @default("{}")` in prisma/schema.prisma, persistence reflects Prisma (`modules`)
    writeFile(
      tempDir,
      'prisma/schema.prisma',
      `model AppConfig {
  id String @id @default("global")
  modules Json @default("{}")
  showCountdown Boolean @default(true)
}
`,
    );

    const persistedExtracted = extractFeatureRuntimeEnforcement(tempDir, fixtureMetadata);
    expect(persistedExtracted.weather.persistence).toBe('`Prisma` (`modules`)');
    expect(persistedExtracted.countdown.persistence).toBe('`Prisma` (`modules` + `showCountdown`)');
    expect(persistedExtracted.groupGifting.persistence).toBe('`Prisma` (`modules`)');
  });
});
