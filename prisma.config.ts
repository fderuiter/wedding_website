import { defineConfig } from '@prisma/config';
import {
  isValidPostgresUrl,
  normalizePostgresUrl,
  parsePostgresUrl,
} from './src/lib/postgres-url.js';

const DUMMY_DATABASE_URL = 'postgresql://dummy:dummy@localhost:5432/dummy';
const POOLER_HOST_REGEX =
  /(?:^|[.-])(?:pooler|pgbouncer)(?:[.-]|$)|\.proxy-[a-z0-9-]+\.[a-z0-9-]+\.rds\.amazonaws\.com$/i;
const POOLER_PORTS = new Set([6432, 6543]);
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

export function isPooledPostgresUrl(rawUrl?: string): boolean {
  if (!rawUrl || !isValidPostgresUrl(rawUrl)) {
    return false;
  }
  const parsed = parsePostgresUrl(rawUrl);
  const qIdx = parsed.normalizedUrl.indexOf('?');
  if (qIdx !== -1) {
    const params = new URLSearchParams(parsed.normalizedUrl.slice(qIdx + 1));
    const pgbouncer = (params.get('pgbouncer') ?? '').toLowerCase();
    if (pgbouncer === 'true' || pgbouncer === '1') {
      return true;
    }
  }
  if (!parsed.isUnixSocket) {
    if (POOLER_HOST_REGEX.test(parsed.host)) {
      return true;
    }
    if (parsed.port !== undefined && POOLER_PORTS.has(parsed.port)) {
      return true;
    }
  }
  return false;
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

export function resolvePrismaDatasourceUrl(
  databaseUrl: string | undefined,
  nonPoolingUrl: string | undefined,
  argv: readonly string[] = process.argv
): string {
  const normalizedDbUrl = safeNormalizePostgresUrl(databaseUrl);
  const normalizedNonPoolingUrl = safeNormalizePostgresUrl(nonPoolingUrl);
  const [command, subcommand] = extractPrismaCliCommand(argv);
  const isDirectMigrateCommand =
    command === 'migrate' &&
    (subcommand === 'deploy' || subcommand === 'status' || subcommand === 'resolve');

  if (
    isDirectMigrateCommand &&
    normalizedDbUrl &&
    isPooledPostgresUrl(normalizedDbUrl) &&
    normalizedNonPoolingUrl &&
    isValidPostgresUrl(normalizedNonPoolingUrl)
  ) {
    return normalizedNonPoolingUrl;
  }

  return normalizedDbUrl ?? DUMMY_DATABASE_URL;
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
    command === 'migrate' && (subcommand === 'dev' || subcommand === 'reset');
  if (!isShadowMigrateCommand) {
    return undefined;
  }

  if (isSamePostgresDatabase(normalizedShadowUrl, databaseUrl)) {
    return undefined;
  }

  return normalizedShadowUrl;
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
