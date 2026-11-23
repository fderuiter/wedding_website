import fs from 'fs';
import path from 'path';
import child_process from 'child_process';
import { fileURLToPath } from 'url';

export interface ParsedMigrateStatus {
  isUpToDate: boolean;
  pendingMigrations: string[];
  failedMigrations: string[];
  rawOutput: string;
  hasDrift?: boolean;
  hasError?: boolean;
  errorMessage?: string;
}

export interface MigrationDdlSummary {
  migrationName: string;
  sqlFilePath: string;
  ddlStatements: string[];
  fullSql: string;
}

export interface OfflineDiffMetadata {
  baseRef: string;
  baseRefMissing: boolean;
}

export interface PreflightCliArgs {
  requireDb: boolean;
  offline: boolean;
  baseRef: string;
  cliError?: string;
}

export interface PreflightCheckOptions {
  environment?: string;
  mockOutput?: string;
  mockExitCode?: number | null;
  mockSpawnError?: Error;
  migrationsDir?: string;
  stepSummaryFile?: string;
  requireDb?: boolean;
  offline?: boolean;
  baseRef?: string;
  cwd?: string;
  databaseUrl?: string;
}

const DEFAULT_BASE_REF = 'HEAD^1';
const MIGRATION_NAME_REGEX = /^\d{14}_[a-zA-Z0-9_-]+$/;

function stripAnsi(input: string): string {
  return input.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

/**
 * Redacts `postgres://` and `postgresql://` connection strings from diagnostic output.
 */
export function redactDatabaseUrls(input: string): string {
  return stripAnsi(input).replace(/postgres(?:ql)?:\/\/[^\s"'`<>)\]]*/gi, '[REDACTED_DATABASE_URL]');
}

/**
 * Parses CLI flags (`--require-db`, `--offline`, `--base-ref <ref>` / `--base-ref=<ref>`).
 */
export function parsePreflightCliArgs(argv: string[]): PreflightCliArgs {
  let requireDb = false;
  let offline = false;
  let baseRef = DEFAULT_BASE_REF;
  let cliError: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--require-db') {
      requireDb = true;
    } else if (arg === '--offline') {
      offline = true;
    } else if (arg === '--base-ref') {
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) {
        cliError = 'Invalid or missing value for --base-ref.';
        break;
      }
      baseRef = next;
      i++;
    } else if (arg.startsWith('--base-ref=')) {
      const val = arg.slice('--base-ref='.length).trim();
      if (!val || val.startsWith('-')) {
        cliError = 'Invalid or missing value for --base-ref.';
        break;
      }
      baseRef = val;
    } else if (arg.startsWith('-')) {
      cliError = `Unknown CLI option: ${arg}`;
      break;
    }
  }

  if (!cliError && requireDb && offline) {
    cliError = 'Cannot specify both --require-db and --offline.';
  }

  return {
    requireDb,
    offline,
    baseRef,
    cliError,
  };
}

function extractMigrationNamesFromBlock(block: string): string[] {
  const names: string[] = [];
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^[-*•]\s*/, '');
    if (line && MIGRATION_NAME_REGEX.test(line) && !names.includes(line)) {
      names.push(line);
    }
  }
  return names;
}

/**
 * Parses the raw output and optional exit code / spawn error of `prisma migrate status`
 * to determine pending, failed, diverged, or errored migration states.
 */
export function parsePrismaMigrateStatus(
  output: string,
  options?: { exitCode?: number | null; spawnError?: Error | null }
): ParsedMigrateStatus {
  const cleanOutput = stripAnsi(output);
  const matchesUpToDate =
    /Database schema is up to date/i.test(cleanOutput) || /No pending migrations/i.test(cleanOutput);
  const pendingMigrations: string[] = [];
  const failedMigrations: string[] = [];

  // Match singular or plural pending migrations block in Prisma 7 (`databaseIsBehind`):
  // "Following migration(s) have not yet been applied:"
  const pendingSectionRegex =
    /Following migrations? (?:have|has) not yet been applied:\s*([\s\S]*?)(?:\n\s*\n|To apply migrations|Database schema is up to date|$)/i;
  const pendingMatch = cleanOutput.match(pendingSectionRegex);
  if (pendingMatch && pendingMatch[1]) {
    for (const name of extractMigrationNamesFromBlock(pendingMatch[1])) {
      if (!pendingMigrations.includes(name)) {
        pendingMigrations.push(name);
      }
    }
  }

  // Match inline failed migrations:
  // "The `2026xxxxxx_...` migration started at ... failed"
  const failedInlineRegex = /The\s+[`"']?([a-zA-Z0-9_-]+)[`"']?\s+migration.*failed/gi;
  let match: RegExpExecArray | null;
  while ((match = failedInlineRegex.exec(cleanOutput)) !== null) {
    if (match[1] && !failedMigrations.includes(match[1])) {
      failedMigrations.push(match[1]);
    }
  }

  // Match Prisma 7 failed migrations block:
  // "Following migration(s) have failed:"
  const failedSectionRegex =
    /Following migrations? (?:have|has) failed:\s*([\s\S]*?)(?:\n\s*\n|During development|The failed migration|$)/i;
  const failedSectionMatch = cleanOutput.match(failedSectionRegex);
  if (failedSectionMatch && failedSectionMatch[1]) {
    for (const name of extractMigrationNamesFromBlock(failedSectionMatch[1])) {
      if (!failedMigrations.includes(name)) {
        failedMigrations.push(name);
      }
    }
  }

  // Detect diverged history (`historiesDiverge`), drift, or non-baselined databases
  const hasDrift =
    /Your local migration history and the migrations table from your database are different/i.test(cleanOutput) ||
    /from the database are not found locally in prisma\/migrations/i.test(cleanOutput) ||
    /\bdrift detected\b/i.test(cleanOutput) ||
    /\bhistoriesDiverge\b/i.test(cleanOutput) ||
    /The current database is not managed by Prisma Migrate/i.test(cleanOutput);

  const prismaErrorCodeMatch = cleanOutput.match(/\b(P[1-9]\d{3})\b/);
  const hasExplicitCliError =
    Boolean(prismaErrorCodeMatch) ||
    /\bCan't reach database server\b/i.test(cleanOutput) ||
    /\bConnection refused\b/i.test(cleanOutput) ||
    /\bAuthentication failed\b/i.test(cleanOutput) ||
    /\b(?:ECONNREFUSED|ENOTFOUND|ETIMEDOUT)\b/.test(cleanOutput);

  const exitCode = options?.exitCode;
  const spawnError = options?.spawnError ?? null;

  let hasError = false;
  let errorMessage: string | undefined;

  if (spawnError) {
    hasError = true;
    errorMessage = `Failed to execute prisma migrate status: ${redactDatabaseUrls(spawnError.message)}`;
  } else if (hasExplicitCliError && failedMigrations.length === 0 && !hasDrift) {
    hasError = true;
    errorMessage = prismaErrorCodeMatch
      ? `Prisma CLI reported error ${prismaErrorCodeMatch[1]} during migration status check`
      : 'Database connectivity or Prisma CLI error during migration status check';
  } else if (exitCode !== undefined && failedMigrations.length === 0 && !hasDrift) {
    // When exitCode is observed:
    // - exit 0 is valid only when schema is cleanly up to date with 0 pending migrations
    // - exit 1 is valid only when Prisma 7 reports clean pending migrations (`databaseIsBehind`)
    const isValidUpToDateExit = exitCode === 0 && matchesUpToDate && pendingMigrations.length === 0;
    const isValidPendingExit = exitCode === 1 && !matchesUpToDate && pendingMigrations.length > 0;

    if (!isValidUpToDateExit && !isValidPendingExit) {
      hasError = true;
      errorMessage = `Unexpected prisma migrate status exit code ${String(exitCode)} without clean migration status`;
    }
  } else if (
    exitCode === undefined &&
    !matchesUpToDate &&
    pendingMigrations.length === 0 &&
    failedMigrations.length === 0 &&
    !hasDrift
  ) {
    hasError = true;
    errorMessage = 'Unable to confirm database migration status from Prisma output';
  }

  // If history diverged or errored, do not treat partial unapplied lists as clean pending migrations
  const effectivePending = hasDrift || hasError || failedMigrations.length > 0 ? [] : pendingMigrations;
  const isUpToDate =
    matchesUpToDate &&
    effectivePending.length === 0 &&
    failedMigrations.length === 0 &&
    !hasDrift &&
    !hasError;

  return {
    isUpToDate,
    pendingMigrations: effectivePending,
    failedMigrations,
    rawOutput: output,
    hasDrift,
    hasError,
    errorMessage,
  };
}

/**
 * Extracts key DDL statements from migration SQL content.
 */
export function extractDdlStatements(sqlContent: string): string[] {
  // Strip block comments /* ... */
  const cleanSql = sqlContent.replace(/\/\*[\s\S]*?\*\//g, '');
  const lines = cleanSql.split(/\r?\n/);

  const statements: string[] = [];
  let currentStatement = '';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('--')) {
      continue;
    }

    currentStatement += (currentStatement ? ' ' : '') + line;

    if (line.endsWith(';')) {
      const trimmedStmt = currentStatement.replace(/;$/, '').trim();
      if (trimmedStmt) {
        statements.push(trimmedStmt);
      }
      currentStatement = '';
    }
  }

  if (currentStatement.trim()) {
    statements.push(currentStatement.trim());
  }

  return statements;
}

/**
 * Reads and summarizes SQL DDL for given migration directory names.
 */
export function getMigrationDdlSummaries(
  migrationsDir: string,
  migrationNames: string[],
  baseDir: string = process.cwd()
): MigrationDdlSummary[] {
  const summaries: MigrationDdlSummary[] = [];

  for (const name of migrationNames) {
    const sqlPath = path.join(migrationsDir, name, 'migration.sql');
    let fullSql = '';
    let ddlStatements: string[] = [];

    if (fs.existsSync(sqlPath)) {
      fullSql = fs.readFileSync(sqlPath, 'utf8');
      ddlStatements = extractDdlStatements(fullSql);
    }

    summaries.push({
      migrationName: name,
      sqlFilePath: path.relative(baseDir, sqlPath).replace(/\\/g, '/'),
      ddlStatements,
      fullSql,
    });
  }

  return summaries;
}

function findNearestExistingDir(targetPath: string): string {
  let current = path.resolve(targetPath);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      return process.cwd();
    }
    current = parent;
  }
  return fs.statSync(current).isDirectory() ? current : path.dirname(current);
}

/**
 * Discovers migration directories added or modified between `baseRef` and `HEAD` via `git diff`.
 * Falls back cleanly to zero diff items when `baseRef` (e.g. `HEAD^1`) or git metadata is missing.
 */
export function getChangedMigrationsFromGitDiff(params: {
  migrationsDir: string;
  baseRef?: string;
  cwd?: string;
}): { changedMigrations: string[]; baseRef: string; baseRefMissing: boolean } {
  const baseRef = params.baseRef || DEFAULT_BASE_REF;
  if (!baseRef || baseRef.startsWith('-')) {
    return { changedMigrations: [], baseRef, baseRefMissing: true };
  }

  const probeDir = params.cwd ? path.resolve(params.cwd) : findNearestExistingDir(params.migrationsDir);

  const topLevelRes = child_process.spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: probeDir,
    encoding: 'utf8',
  });
  if (topLevelRes.error || topLevelRes.status !== 0 || !topLevelRes.stdout.trim()) {
    return { changedMigrations: [], baseRef, baseRefMissing: true };
  }

  const gitRoot = topLevelRes.stdout.trim();

  const verifyBaseRes = child_process.spawnSync('git', ['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`], {
    cwd: gitRoot,
    encoding: 'utf8',
  });
  if (verifyBaseRes.error || verifyBaseRes.status !== 0) {
    return { changedMigrations: [], baseRef, baseRefMissing: true };
  }

  const resolvedMigrationsDir = path.resolve(params.migrationsDir);
  const relMigrationsDir = path.relative(gitRoot, resolvedMigrationsDir).replace(/\\/g, '/');
  if (!relMigrationsDir || relMigrationsDir.startsWith('..')) {
    return { changedMigrations: [], baseRef, baseRefMissing: false };
  }

  const diffRes = child_process.spawnSync(
    'git',
    ['diff', '--name-only', '--diff-filter=ACMR', baseRef, 'HEAD', '--', relMigrationsDir],
    {
      cwd: gitRoot,
      encoding: 'utf8',
    }
  );
  if (diffRes.error || diffRes.status !== 0) {
    return { changedMigrations: [], baseRef, baseRefMissing: true };
  }

  const prefix = relMigrationsDir.endsWith('/') ? relMigrationsDir : `${relMigrationsDir}/`;
  const found = new Set<string>();

  for (const rawLine of diffRes.stdout.split(/\r?\n/)) {
    const filePath = rawLine.trim().replace(/\\/g, '/');
    if (!filePath.startsWith(prefix)) {
      continue;
    }
    const remainder = filePath.slice(prefix.length);
    const segments = remainder.split('/');
    if (segments.length >= 2 && segments[1] === 'migration.sql' && MIGRATION_NAME_REGEX.test(segments[0])) {
      found.add(segments[0]);
    }
  }

  return {
    changedMigrations: Array.from(found).sort(),
    baseRef,
    baseRefMissing: false,
  };
}

function renderDdlSummaryList(ddlSummaries: MigrationDdlSummary[]): string {
  let md = '';
  for (let idx = 0; idx < ddlSummaries.length; idx++) {
    const summary = ddlSummaries[idx];
    md += `##### ${idx + 1}. \`${summary.migrationName}\`\n`;
    md += `- **Migration File:** \`${summary.sqlFilePath}\`\n`;

    if (summary.ddlStatements.length > 0) {
      md += '- **Key DDL Operations:**\n';
      for (const stmt of summary.ddlStatements) {
        const displayStmt = stmt.length > 150 ? `${stmt.substring(0, 147)}...` : stmt;
        md += `  - \`${displayStmt}\`\n`;
      }
    } else {
      md += '- **Key DDL Operations:** _(No executable DDL statements extracted)_\n';
    }

    if (summary.fullSql.trim()) {
      md += `\n<details>\n<summary>Click to inspect full SQL statements (${summary.migrationName})</summary>\n\n`;
      md += `\`\`\`sql\n${summary.fullSql.trim()}\n\`\`\`\n`;
      md += '</details>\n\n';
    }
  }
  return md;
}

function renderRedactedDiagnostics(rawOutput: string): string {
  const sanitized = redactDatabaseUrls(rawOutput).trim();
  if (!sanitized) {
    return '';
  }
  const clipped = sanitized.length > 2000 ? `${sanitized.slice(0, 1997)}...` : sanitized;
  return `\n#### 🩺 Diagnostic Output (Redacted)\n\n\`\`\`text\n${clipped}\n\`\`\`\n`;
}

/**
 * Formats a rich Markdown summary for $GITHUB_STEP_SUMMARY.
 */
export function formatPreflightSummary(params: {
  environment: string;
  status: ParsedMigrateStatus;
  ddlSummaries: MigrationDdlSummary[];
  offlineDiff?: OfflineDiffMetadata;
}): string {
  const { environment, status, ddlSummaries, offlineDiff } = params;

  let md = '### 📋 Pre-Flight Schema Migration Status & SQL DDL Summary\n\n';
  md += `- **Target Environment:** \`${environment}\`\n`;

  if (offlineDiff) {
    md += `- **Execution Mode:** \`OFFLINE (git diff ${offlineDiff.baseRef}..HEAD)\`\n`;
    md += '- **Pre-Flight Gate:** `PASSED (STATIC DIFF)` 🟢\n';
    md += '- **Database Status:** `NOT QUERIED`\n';
    md += `- **Changed Migration Files:** \`${ddlSummaries.length}\`\n\n`;

    if (offlineDiff.baseRefMissing) {
      md += `ℹ️ Base Git reference \`${offlineDiff.baseRef}\` is unavailable in this checkout; reporting 0 changed migration files without querying a live database.\n`;
      return md;
    }

    if (ddlSummaries.length === 0) {
      md += `ℹ️ Live database was not queried. No migration SQL files changed between \`${offlineDiff.baseRef}\` and \`HEAD\`.\n`;
      return md;
    }

    md += `#### 🔍 Changed Migration DDL Details (${ddlSummaries.length} file(s) in \`${offlineDiff.baseRef}..HEAD\`)\n\n`;
    md += renderDdlSummaryList(ddlSummaries);
    return md;
  }

  if (status.failedMigrations.length > 0) {
    md += '- **Pre-Flight Gate:** `FAILED` ❌\n';
    md += '- **Database Status:** `FAILED MIGRATIONS DETECTED`\n';
    md += '- **Status:** `Failed previous migration(s) detected in database`\n';
    md += `- **Failed Migration Count:** \`${status.failedMigrations.length}\`\n\n`;
    md += '#### ⚠️ Failed Migrations Requiring Resolution:\n';
    for (const failed of status.failedMigrations) {
      md += `- \`${failed}\`\n`;
    }
    md += `\n> **Remediation**: Run \`npx prisma migrate resolve --rolled-back "${status.failedMigrations[0]}"\` or resolve schema state prior to deployment.\n`;
    md += renderRedactedDiagnostics(status.rawOutput);
    return md;
  }

  if (status.hasDrift) {
    md += '- **Pre-Flight Gate:** `FAILED` ❌\n';
    md += '- **Database Status:** `SCHEMA DRIFT / DIVERGED HISTORY`\n';
    md += '- **Status:** `Database migration history has diverged from local prisma/migrations or database is unmanaged`\n';
    md += renderRedactedDiagnostics(status.rawOutput);
    md += '\n> **Remediation**: Reconcile `_prisma_migrations` against `prisma/migrations/` before running `npx prisma migrate deploy`.\n';
    return md;
  }

  if (status.hasError || (!status.isUpToDate && status.pendingMigrations.length === 0)) {
    const reason = redactDatabaseUrls(
      status.errorMessage || 'Prisma migrate status failed or returned an unrecognized state'
    );
    md += '- **Pre-Flight Gate:** `FAILED` ❌\n';
    md += '- **Database Status:** `ERROR`\n';
    md += `- **Status:** \`${reason}\`\n`;
    md += renderRedactedDiagnostics(status.rawOutput);
    return md;
  }

  if (status.isUpToDate && status.pendingMigrations.length === 0) {
    md += '- **Pre-Flight Gate:** `PASSED` 🟢\n';
    md += '- **Database Status:** `UP TO DATE`\n';
    md += '- **Pending Migrations:** `0 (No schema alterations required)`\n\n';
    md += '✅ Database schema matches all migration files. Target environment is ready for zero-downtime deployment.\n';
    return md;
  }

  md += '- **Pre-Flight Gate:** `READY TO APPLY` 🟡\n';
  md += '- **Database Status:** `PENDING MIGRATIONS DETECTED`\n';
  md += `- **Pending Migrations Count:** \`${status.pendingMigrations.length}\`\n\n`;

  md += `#### 🔍 Pending Migration DDL Details (${status.pendingMigrations.length} file(s))\n\n`;
  md += renderDdlSummaryList(ddlSummaries);

  return md;
}

function appendStepSummary(summaryFile: string | undefined, markdownSummary: string): void {
  if (!summaryFile) {
    return;
  }
  try {
    fs.appendFileSync(summaryFile, markdownSummary + '\n', 'utf8');
    console.log(`Successfully appended preflight migration summary to ${summaryFile}`);
  } catch (err) {
    console.warn(`Failed to write to GITHUB_STEP_SUMMARY (${summaryFile}):`, err);
  }
}

/**
 * Main execution function.
 */
export function runPreflightCheck(options?: PreflightCheckOptions): { success: boolean; summary: string } {
  const workDir = options?.cwd ? path.resolve(options.cwd) : process.cwd();
  const migrationsDir = options?.migrationsDir || path.join(workDir, 'prisma', 'migrations');
  const summaryFile = options?.stepSummaryFile || process.env.GITHUB_STEP_SUMMARY;
  const requireDb = Boolean(options?.requireDb);
  const offline = Boolean(options?.offline);
  const baseRef = options?.baseRef || DEFAULT_BASE_REF;
  const databaseUrl =
    options?.databaseUrl !== undefined ? options.databaseUrl : process.env.DATABASE_URL;
  const isOfflineMode =
    options?.mockOutput === undefined && (offline || (!requireDb && !databaseUrl?.trim()));
  const environment =
    options?.environment ||
    process.env.TARGET_ENVIRONMENT ||
    process.env.NODE_ENV ||
    (isOfflineMode ? 'offline' : 'development');

  if (requireDb && offline) {
    const conflictSummary = formatPreflightSummary({
      environment,
      status: {
        isUpToDate: false,
        pendingMigrations: [],
        failedMigrations: [],
        rawOutput: '',
        hasError: true,
        errorMessage: 'Cannot specify both --require-db and --offline.',
      },
      ddlSummaries: [],
    });
    console.error(conflictSummary);
    appendStepSummary(summaryFile, conflictSummary);
    return { success: false, summary: conflictSummary };
  }

  if (baseRef.startsWith('-')) {
    const badRefSummary = formatPreflightSummary({
      environment,
      status: {
        isUpToDate: false,
        pendingMigrations: [],
        failedMigrations: [],
        rawOutput: '',
        hasError: true,
        errorMessage: 'Invalid --base-ref value.',
      },
      ddlSummaries: [],
    });
    console.error(badRefSummary);
    appendStepSummary(summaryFile, badRefSummary);
    return { success: false, summary: badRefSummary };
  }

  // Offline git-diff mode when `--offline` is passed or when `DATABASE_URL` is absent without `--require-db`
  if (isOfflineMode) {
    console.log(
      `Running offline preflight migration diff against "${baseRef}" (live database NOT QUERIED)...`
    );
    const diffResult = getChangedMigrationsFromGitDiff({
      migrationsDir,
      baseRef,
      cwd: options?.cwd,
    });
    const ddlSummaries = getMigrationDdlSummaries(
      migrationsDir,
      diffResult.changedMigrations,
      workDir
    );
    const markdownSummary = formatPreflightSummary({
      environment,
      status: {
        isUpToDate: false,
        pendingMigrations: [],
        failedMigrations: [],
        rawOutput: '',
      },
      ddlSummaries,
      offlineDiff: {
        baseRef: diffResult.baseRef,
        baseRefMissing: diffResult.baseRefMissing,
      },
    });

    console.log(markdownSummary);
    appendStepSummary(summaryFile, markdownSummary);
    return { success: true, summary: markdownSummary };
  }

  if (options?.mockOutput === undefined && requireDb && !databaseUrl?.trim()) {
    const missingDbSummary = formatPreflightSummary({
      environment,
      status: {
        isUpToDate: false,
        pendingMigrations: [],
        failedMigrations: [],
        rawOutput: '',
        hasError: true,
        errorMessage: 'Missing mandatory DATABASE_URL environment variable for --require-db mode.',
      },
      ddlSummaries: [],
    });
    console.error(missingDbSummary);
    appendStepSummary(summaryFile, missingDbSummary);
    return { success: false, summary: missingDbSummary };
  }

  let rawOutput = options?.mockOutput;
  let exitCode: number | null | undefined = options?.mockExitCode;
  let spawnError: Error | null = options?.mockSpawnError ?? null;

  if (rawOutput === undefined) {
    console.log(`Running "npx prisma migrate status" for environment "${environment}"...`);
    const childEnv: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: databaseUrl };
    delete childEnv.POSTGRES_URL_NON_POOLING;
    const result = child_process.spawnSync('npx', ['prisma', 'migrate', 'status'], {
      cwd: workDir,
      encoding: 'utf8',
      shell: process.platform === 'win32',
      env: childEnv,
    });
    rawOutput = `${result.stdout || ''}\n${result.stderr || ''}`;
    exitCode = result.status;
    spawnError = result.error ?? null;
  }

  const parsedStatus = parsePrismaMigrateStatus(rawOutput, { exitCode, spawnError });
  const ddlSummaries = getMigrationDdlSummaries(
    migrationsDir,
    parsedStatus.pendingMigrations,
    workDir
  );
  const markdownSummary = formatPreflightSummary({
    environment,
    status: parsedStatus,
    ddlSummaries,
  });

  console.log(markdownSummary);
  appendStepSummary(summaryFile, markdownSummary);

  const isHealthy =
    parsedStatus.failedMigrations.length === 0 &&
    !parsedStatus.hasDrift &&
    !parsedStatus.hasError &&
    (parsedStatus.isUpToDate || parsedStatus.pendingMigrations.length > 0);

  return { success: isHealthy, summary: markdownSummary };
}

// Auto-run if executed as main CLI
const currentFilePath =
  typeof import.meta.filename === 'string'
    ? import.meta.filename
    : fileURLToPath(import.meta.url);
const isMain =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === path.resolve(currentFilePath);

if (isMain) {
  const cliArgs = parsePreflightCliArgs(process.argv.slice(2));
  if (cliArgs.cliError) {
    console.error(`❌ ${cliArgs.cliError}`);
    process.exit(1);
  }
  const result = runPreflightCheck({
    requireDb: cliArgs.requireDb,
    offline: cliArgs.offline,
    baseRef: cliArgs.baseRef,
  });
  if (!result.success) {
    process.exit(1);
  }
}
