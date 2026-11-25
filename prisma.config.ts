import { defineConfig } from '@prisma/config';
import {
  isPooledPostgresUrl,
  isValidPostgresUrl,
  normalizePostgresUrl,
  parsePostgresUrl,
  redactPostgresUrl,
  resolveDirectMigrationPostgresUrl,
} from './src/lib/postgres-url.js';

export { isPooledPostgresUrl };

const DUMMY_DATABASE_URL = 'postgresql://dummy:dummy@localhost:5432/dummy';
const VALUE_TAKING_PRISMA_FLAGS = new Set([
  '--schema',
  '--config',
  '--name',
  '-n',
  '--applied',
  '--rolled-back',
  '--telemetry-information',
  '--url',
  '--from-schema',
  '--to-schema',
  '--from-migrations',
  '--to-migrations',
]);

function safeNormalizePostgresUrl(rawUrl?: string): string | undefined {
  const trimmed = rawUrl?.trim();
  if (!trimmed) {
    return undefined;
  }
  return isValidPostgresUrl(trimmed) ? normalizePostgresUrl(trimmed) : trimmed;
}

/**
 * Rewrites `ssl=` boolean/no-verify flags and endpoint-aware `tlsMode` values that Prisma CLI's
 * `quaint` engine would otherwise discard or downgrade to `sslmode=prefer`:
 * - Omitted `sslmode`/`ssl` on non-loopback TCP hosts (`tlsMode: 'verify-full'`) -> `sslmode=require&sslaccept=strict`
 * - `ssl=true` / `ssl=1` -> `sslmode=require` (strips `ssl`; maps custom `sslrootcert` to `sslcert` with `sslaccept=strict`)
 * - `ssl=false` / `ssl=0` -> `sslmode=disable` (strips `ssl`)
 * - `ssl=no-verify` / `sslmode=no-verify` -> `sslmode=require&sslaccept=accept_invalid_certs`
 * - `sslmode=allow` -> `sslmode=prefer`
 * - `sslmode=verify-ca` / `sslmode=verify-full` / `sslrootcert=system` -> `sslmode=require&sslaccept=strict`
 *   (maps explicit custom `sslrootcert` path to `sslcert`, failing closed if `sslrootcert` and `sslcert` collide)
 */
export function rewritePostgresUrlForPrismaCli(rawUrl: string): string {
  if (!isValidPostgresUrl(rawUrl)) {
    return rawUrl;
  }
  const parsed = parsePostgresUrl(rawUrl);

  if (parsed.sslrootcert && parsed.sslcert) {
    throw new Error(
      `PostgreSQL URL (${redactPostgresUrl(rawUrl)}) cannot specify both "sslrootcert" and "sslcert" for Prisma CLI.`
    );
  }

  const needsTlsRewrite =
    parsed.sslFlag !== undefined ||
    parsed.sslrootcert !== undefined ||
    parsed.tlsMode === 'allow' ||
    parsed.tlsMode === 'no-verify' ||
    parsed.tlsMode === 'verify-ca' ||
    parsed.tlsMode === 'verify-full';

  if (!needsTlsRewrite) {
    return parsed.normalizedUrl;
  }

  const qIdx = parsed.normalizedUrl.indexOf('?');
  const baseUrl = qIdx === -1 ? parsed.normalizedUrl : parsed.normalizedUrl.slice(0, qIdx);
  const params = new URLSearchParams(
    qIdx === -1 ? '' : parsed.normalizedUrl.slice(qIdx + 1)
  );

  params.delete('ssl');

  switch (parsed.tlsMode) {
    case 'disable':
      params.set('sslmode', 'disable');
      params.delete('sslaccept');
      break;
    case 'allow':
    case 'prefer':
      params.set('sslmode', 'prefer');
      params.delete('sslaccept');
      break;
    case 'no-verify':
      params.set('sslmode', 'require');
      params.set('sslaccept', 'accept_invalid_certs');
      break;
    case 'require':
      params.set('sslmode', 'require');
      if (parsed.sslrootcert && parsed.sslrootcert !== 'system') {
        params.set('sslaccept', 'strict');
        params.set('sslcert', parsed.sslrootcert);
      }
      params.delete('sslrootcert');
      break;
    case 'verify-ca':
    case 'verify-full':
      params.set('sslmode', 'require');
      params.set('sslaccept', 'strict');
      if (parsed.sslrootcert && parsed.sslrootcert !== 'system') {
        params.set('sslcert', parsed.sslrootcert);
      }
      params.delete('sslrootcert');
      break;
  }

  const queryStr = params.toString();
  return queryStr ? `${baseUrl}?${queryStr}` : baseUrl;
}

export function extractPrismaCliCommand(argv: readonly string[] = process.argv): string[] {
  const args = argv.slice(2);
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (!token) {
      continue;
    }
    if (token === '--') {
      break;
    }
    if (token.startsWith('-')) {
      if (!token.includes('=') && VALUE_TAKING_PRISMA_FLAGS.has(token)) {
        i += 1;
      }
      continue;
    }
    positional.push(token);
  }
  return positional;
}

export function isSamePostgresDatabase(urlA?: string, urlB?: string): boolean {
  const normA = safeNormalizePostgresUrl(urlA);
  const normB = safeNormalizePostgresUrl(urlB);
  if (!normA || !normB) {
    return false;
  }
  if (normA === normB) {
    return true;
  }
  if (!isValidPostgresUrl(normA) || !isValidPostgresUrl(normB)) {
    return false;
  }
  const parsedA = parsePostgresUrl(normA);
  const parsedB = parsePostgresUrl(normB);
  const endpointA = parsedA.isUnixSocket
    ? `socket:${parsedA.socketPath ?? ''}`
    : `tcp:${parsedA.host.toLowerCase().replace(/-pooler(?=\.)/i, '')}:${parsedA.port ?? 5432}`;
  const endpointB = parsedB.isUnixSocket
    ? `socket:${parsedB.socketPath ?? ''}`
    : `tcp:${parsedB.host.toLowerCase().replace(/-pooler(?=\.)/i, '')}:${parsedB.port ?? 5432}`;
  return (
    endpointA === endpointB &&
    parsedA.database === parsedB.database &&
    (parsedA.schema ?? 'public') === (parsedB.schema ?? 'public')
  );
}

function hasSameDatabaseAndSchema(urlA: string, urlB: string): boolean {
  if (!isValidPostgresUrl(urlA) || !isValidPostgresUrl(urlB)) {
    return false;
  }
  const parsedA = parsePostgresUrl(urlA);
  const parsedB = parsePostgresUrl(urlB);
  return (
    Boolean(parsedA.database) &&
    parsedA.database === parsedB.database &&
    (parsedA.schema ?? 'public') === (parsedB.schema ?? 'public')
  );
}

export function resolvePrismaDatasourceUrl(
  databaseUrl: string | undefined,
  nonPoolingUrl: string | undefined,
  argv: readonly string[] = process.argv
): string {
  const normalizedDbUrl = safeNormalizePostgresUrl(databaseUrl);
  if (!normalizedDbUrl) {
    return DUMMY_DATABASE_URL;
  }
  const normalizedNonPoolingUrl = safeNormalizePostgresUrl(nonPoolingUrl);
  const [command, subcommand] = extractPrismaCliCommand(argv);
  const isDirectMigrateCommand =
    command === 'migrate' &&
    (subcommand === 'deploy' || subcommand === 'status' || subcommand === 'resolve');

  const resolvedTargetUrl = isDirectMigrateCommand
    ? resolveDirectMigrationPostgresUrl(normalizedDbUrl, normalizedNonPoolingUrl)
    : normalizedDbUrl;

  return rewritePostgresUrlForPrismaCli(resolvedTargetUrl);
}

export function resolvePrismaShadowDatabaseUrl(
  nonPoolingUrl: string | undefined,
  databaseUrl: string | undefined,
  argv: readonly string[] = process.argv
): string | undefined {
  const normalizedShadowUrl = safeNormalizePostgresUrl(nonPoolingUrl);
  if (!normalizedShadowUrl) {
    return undefined;
  }

  const [command, subcommand] = extractPrismaCliCommand(argv);
  const isShadowMigrateCommand =
    command === 'migrate' &&
    (subcommand === 'dev' || subcommand === 'reset' || subcommand === 'diff');
  if (!isShadowMigrateCommand) {
    return undefined;
  }

  if (isSamePostgresDatabase(normalizedShadowUrl, databaseUrl)) {
    return undefined;
  }

  const normalizedDbUrl = safeNormalizePostgresUrl(databaseUrl);
  if (
    normalizedDbUrl &&
    isPooledPostgresUrl(normalizedDbUrl) &&
    !isPooledPostgresUrl(normalizedShadowUrl) &&
    hasSameDatabaseAndSchema(normalizedDbUrl, normalizedShadowUrl)
  ) {
    return undefined;
  }

  return rewritePostgresUrlForPrismaCli(normalizedShadowUrl);
}

if (process.env.DATABASE_URL && isValidPostgresUrl(process.env.DATABASE_URL)) {
  process.env.DATABASE_URL = normalizePostgresUrl(process.env.DATABASE_URL);
}
if (
  process.env.POSTGRES_URL_NON_POOLING &&
  isValidPostgresUrl(process.env.POSTGRES_URL_NON_POOLING)
) {
  process.env.POSTGRES_URL_NON_POOLING = normalizePostgresUrl(process.env.POSTGRES_URL_NON_POOLING);
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    // Provide a fallback dummy URL for build environments where the actual DB is not needed (e.g., CI)
    // Keep process.env.DATABASE_URL and process.env.POSTGRES_URL_NON_POOLING as first AST keys for static verifiers.
    url: resolvePrismaDatasourceUrl(process.env.DATABASE_URL, process.env.POSTGRES_URL_NON_POOLING),
    // Only bind shadowDatabaseUrl during `migrate dev`/`reset` when distinct from DATABASE_URL
    shadowDatabaseUrl: resolvePrismaShadowDatabaseUrl(process.env.POSTGRES_URL_NON_POOLING, process.env.DATABASE_URL),
  },
});
