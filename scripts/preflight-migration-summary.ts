import fs from 'fs';
import path from 'path';
import child_process from 'child_process';
import { redactPostgresUrl } from '../src/lib/postgres-url.js';

export interface ParsedMigrateStatus {
  isUpToDate: boolean;
  pendingMigrations: string[];
  failedMigrations: string[];
  rawOutput: string;
  hasFatalError?: boolean;
  errorSummary?: string;
}

export interface MigrationDdlSummary {
  migrationName: string;
  sqlFilePath: string;
  ddlStatements: string[];
  fullSql: string;
}

function stripAnsiCodes(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

function sanitizeDiagnosticLine(line: string): string {
  return line.replace(/\bpostgres(?:ql)?:\/\/[^\s"'`<>)]+/gi, (match) => redactPostgresUrl(match));
}

function detectMigrateStatusError(cleanOutput: string): string | undefined {
  const prismaCodeMatch = cleanOutput.match(/\b(P[1-9]\d{3})\b/);
  if (prismaCodeMatch) {
    const code = prismaCodeMatch[1];
    const matchingLine = cleanOutput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.includes(code));
    return matchingLine
      ? sanitizeDiagnosticLine(matchingLine)
      : `Prisma error ${code} detected during migration status check`;
  }

  if (/The current database is not managed by Prisma Migrate/i.test(cleanOutput)) {
    return 'The current database is not managed by Prisma Migrate';
  }

  if (
    /Your local migration history and the migrations table from your database are different/i.test(
      cleanOutput
    ) ||
    /histories?\s+diverge/i.test(cleanOutput) ||
    /not found locally in prisma\/migrations/i.test(cleanOutput) ||
    /drift detected/i.test(cleanOutput)
  ) {
    return 'Database migration history has diverged from local prisma/migrations';
  }

  const genericErrorLine = cleanOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^(?:Error:|PrismaClient\w*Error\b|Schema engine error\b)/i.test(line));
  if (genericErrorLine) {
    return sanitizeDiagnosticLine(genericErrorLine);
  }

  return undefined;
}

/**
 * Parses the raw output of `prisma migrate status` to determine pending/failed migrations
 * and fatal schema/connectivity errors across Prisma 7.10.1 singular and plural headers.
 */
export function parsePrismaMigrateStatus(output: string): ParsedMigrateStatus {
  const cleanOutput = stripAnsiCodes(output);
  const pendingMigrations: string[] = [];
  const failedMigrations: string[] = [];

  // Match singular and plural Prisma 7.10.1 pending migration headers:
  // "Following migration have not yet been applied:" or "Following migrations have not yet been applied:"
  const pendingSectionRegex =
    /Following\s+migrations?\s+have\s+not\s+yet\s+been\s+applied:\s*([\s\S]*?)(?:\n\s*\n|To apply migrations|Following\s+migrations?\s+have\s+failed|Database schema is up to date|$)/gi;
  let pendingMatch: RegExpExecArray | null;
  while ((pendingMatch = pendingSectionRegex.exec(cleanOutput)) !== null) {
    if (!pendingMatch[1]) {
      continue;
    }
    const lines = pendingMatch[1].split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim().replace(/^[-*•]\s*/, '');
      if (line && /^\d{14}_[a-zA-Z0-9_-]+$/.test(line) && !pendingMigrations.includes(line)) {
        pendingMigrations.push(line);
      }
    }
  }

  // Match singular and plural Prisma 7.10.1 failed migration block headers:
  // "Following migration have failed:" or "Following migrations have failed:"
  const failedSectionRegex =
    /Following\s+migrations?\s+have\s+failed:\s*([\s\S]*?)(?:\n\s*\n|During development|The failed migration|Read more about|$)/gi;
  let failedSectionMatch: RegExpExecArray | null;
  while ((failedSectionMatch = failedSectionRegex.exec(cleanOutput)) !== null) {
    if (!failedSectionMatch[1]) {
      continue;
    }
    const lines = failedSectionMatch[1].split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim().replace(/^[-*•]\s*/, '');
      if (line && /^\d{14}_[a-zA-Z0-9_-]+$/.test(line) && !failedMigrations.includes(line)) {
        failedMigrations.push(line);
      }
    }
  }

  // Match inline failed migration messages:
  // "The `2026xxxxxx_...` migration started at ... failed"
  const failedRegex = /The\s+[`"']?([a-zA-Z0-9_-]+)[`"']?\s+migration.*failed/gi;
  let match: RegExpExecArray | null;
  while ((match = failedRegex.exec(cleanOutput)) !== null) {
    if (match[1] && !failedMigrations.includes(match[1])) {
      failedMigrations.push(match[1]);
    }
  }

  const errorSummary = detectMigrateStatusError(cleanOutput);
  const hasFatalError = Boolean(errorSummary);
  const rawUpToDate =
    /Database schema is up to date/i.test(cleanOutput) ||
    /No pending migrations/i.test(cleanOutput);

  return {
    isUpToDate:
      rawUpToDate &&
      pendingMigrations.length === 0 &&
      failedMigrations.length === 0 &&
      !hasFatalError,
    pendingMigrations,
    failedMigrations,
    rawOutput: output,
    hasFatalError,
    errorSummary,
  };
}

/**
 * Extracts key DDL statements from migration SQL content.
 */
export function extractDdlStatements(sqlContent: string): string[] {
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
  migrationNames: string[]
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
      sqlFilePath: path.relative(process.cwd(), sqlPath).replace(/\\/g, '/'),
      ddlStatements,
      fullSql,
    });
  }

  return summaries;
}

function shortGitRef(ref: string): string {
  return /^[a-fA-F0-9]{40}$/.test(ref) ? ref.slice(0, 12) : ref;
}

function gitCommitExists(cwd: string, rev: string): boolean {
  if (!rev || /^0+$/.test(rev)) {
    return false;
  }
  const res = child_process.spawnSync('git', ['cat-file', '-e', `${rev}^{commit}`], {
    cwd,
    encoding: 'utf8',
  });
  return res.status === 0;
}

/**
 * Diffs `prisma/migrations/` across git commits when `DATABASE_URL` is unset.
 */
export function resolveGitChangedMigrations(params: {
  migrationsDir: string;
  cwd?: string;
  baseRef?: string;
  headRef?: string;
}): {
  changedMigrations: string[];
  diffRange: string;
} {
  const resolvedMigrationsDir = path.resolve(params.migrationsDir);
  const candidateCwd =
    params.cwd ??
    (fs.existsSync(resolvedMigrationsDir) ? resolvedMigrationsDir : process.cwd());

  const topLevelRes = child_process.spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: candidateCwd,
    encoding: 'utf8',
  });

  if (topLevelRes.status !== 0 || !topLevelRes.stdout?.trim()) {
    return { changedMigrations: [], diffRange: 'UNAVAILABLE' };
  }

  const gitRoot = topLevelRes.stdout.trim();
  const relMigrationsPath =
    path.relative(gitRoot, resolvedMigrationsDir).replace(/\\/g, '/') || 'prisma/migrations';
  const head = params.headRef?.trim() || 'HEAD';
  const explicitBase = params.baseRef?.trim() || '';

  let diffArgs: string[];
  let diffRange: string;

  if (explicitBase && gitCommitExists(gitRoot, explicitBase) && gitCommitExists(gitRoot, head)) {
    diffArgs = ['diff', '--name-only', explicitBase, head, '--', relMigrationsPath];
    diffRange = `${shortGitRef(explicitBase)}..${shortGitRef(head)}`;
  } else if (gitCommitExists(gitRoot, `${head}~1`)) {
    diffArgs = ['diff', '--name-only', `${head}~1`, head, '--', relMigrationsPath];
    diffRange = `${shortGitRef(head)}~1..${shortGitRef(head)}`;
  } else if (gitCommitExists(gitRoot, head)) {
    diffArgs = ['show', '--pretty=format:', '--name-only', head, '--', relMigrationsPath];
    diffRange = shortGitRef(head);
  } else {
    return { changedMigrations: [], diffRange: 'UNAVAILABLE' };
  }

  const diffRes = child_process.spawnSync('git', diffArgs, {
    cwd: gitRoot,
    encoding: 'utf8',
  });

  if (diffRes.status !== 0) {
    return { changedMigrations: [], diffRange };
  }

  const normalizedPrefix = relMigrationsPath.replace(/\/+$/, '') + '/';
  const changedSet = new Set<string>();
  for (const rawFile of (diffRes.stdout || '').split(/\r?\n/)) {
    const normalizedFile = rawFile.trim().replace(/\\/g, '/');
    if (!normalizedFile) {
      continue;
    }
    const relativeToMigrations = normalizedFile.startsWith(normalizedPrefix)
      ? normalizedFile.slice(normalizedPrefix.length)
      : normalizedFile;
    const candidateDir = relativeToMigrations.split('/')[0] ?? '';
    if (
      /^\d{14}_[a-zA-Z0-9_-]+$/.test(candidateDir) &&
      fs.existsSync(path.join(resolvedMigrationsDir, candidateDir))
    ) {
      changedSet.add(candidateDir);
    }
  }

  return {
    changedMigrations: Array.from(changedSet).sort(),
    diffRange,
  };
}

/**
 * Formats a rich Markdown summary for $GITHUB_STEP_SUMMARY.
 */
export function formatPreflightSummary(params: {
  environment: string;
  status: ParsedMigrateStatus;
  ddlSummaries: MigrationDdlSummary[];
  mode?: 'live' | 'static-git-diff';
  diffRange?: string;
  failureReason?: string;
}): string {
  const { environment, status, ddlSummaries, mode = 'live', diffRange, failureReason } = params;

  let md = '### 📋 Pre-Flight Schema Migration Status & SQL DDL Summary\n\n';
  md += `- **Target Environment:** \`${environment}\`\n`;
  if (mode === 'static-git-diff') {
    md += '- **Verification Mode:** `STATIC GIT DIFF`\n';
    if (diffRange) {
      md += `- **Git Commit Range:** \`${diffRange}\`\n`;
    }
  }

  if (status.failedMigrations.length > 0) {
    md += '- **Pre-Flight Gate:** `FAILED` ❌\n';
    md += '- **Status:** `Failed previous migration(s) detected in database`\n';
    md += `- **Failed Migration Count:** \`${status.failedMigrations.length}\`\n\n`;
    md += '#### ⚠️ Failed Migrations Requiring Resolution:\n';
    for (const failed of status.failedMigrations) {
      md += `- \`${failed}\`\n`;
    }
    md += `\n> **Remediation**: Run \`npx prisma migrate resolve --rolled-back "${status.failedMigrations[0]}"\` or resolve schema state prior to deployment.\n`;
    return md;
  }

  const effectiveFailure = failureReason || (status.hasFatalError ? status.errorSummary : undefined);
  if (effectiveFailure) {
    const safeFailure = effectiveFailure.replace(/`/g, "'");
    md += '- **Pre-Flight Gate:** `FAILED` ❌\n';
    md += '- **Database Status:** `MIGRATION STATUS CHECK FAILED`\n';
    md += `- **Reason:** \`${safeFailure}\`\n\n`;
    md +=
      '> **Remediation**: Verify `DATABASE_URL` connectivity, ensure `POSTGRES_URL_NON_POOLING` does not collide with `DATABASE_URL` (`P3025`), and reconcile any schema drift or unmanaged database state before deploying.\n';
    return md;
  }

  if (mode === 'static-git-diff') {
    if (status.pendingMigrations.length === 0) {
      md += '- **Pre-Flight Gate:** `PASSED` 🟢\n';
      md += '- **Database Status:** `STATIC GIT DIFF (NO MIGRATION CHANGES)`\n';
      md += '- **Changed Migrations:** `0 (No schema alterations in commit range)`\n\n';
      md += '✅ Zero migration files changed in git commit range. Target release requires no DDL execution.\n';
      return md;
    }

    md += '- **Pre-Flight Gate:** `READY TO APPLY` 🟡\n';
    md += '- **Database Status:** `PENDING MIGRATIONS DETECTED (STATIC GIT DIFF)`\n';
    md += `- **Pending Migrations Count:** \`${status.pendingMigrations.length}\`\n\n`;
  } else if (status.isUpToDate || status.pendingMigrations.length === 0) {
    md += '- **Pre-Flight Gate:** `PASSED` 🟢\n';
    md += '- **Database Status:** `UP TO DATE`\n';
    md += '- **Pending Migrations:** `0 (No schema alterations required)`\n\n';
    md += '✅ Database schema matches all migration files. Target environment is ready for zero-downtime deployment.\n';
    return md;
  } else {
    md += '- **Pre-Flight Gate:** `READY TO APPLY` 🟡\n';
    md += '- **Database Status:** `PENDING MIGRATIONS DETECTED`\n';
    md += `- **Pending Migrations Count:** \`${status.pendingMigrations.length}\`\n\n`;
  }

  md += `#### 🔍 Pending Migration DDL Details (${status.pendingMigrations.length} file(s))\n\n`;

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

/**
 * Main execution function.
 */
export function runPreflightCheck(options?: {
  environment?: string;
  mockOutput?: string;
  mockExitCode?: number | null;
  migrationsDir?: string;
  stepSummaryFile?: string;
  cwd?: string;
  baseRef?: string;
  headRef?: string;
}): { success: boolean; summary: string } {
  const environment =
    options?.environment || process.env.TARGET_ENVIRONMENT || process.env.NODE_ENV || 'production';
  const migrationsDir = options?.migrationsDir || path.join(process.cwd(), 'prisma', 'migrations');
  const summaryFile = options?.stepSummaryFile || process.env.GITHUB_STEP_SUMMARY;

  let rawOutput = options?.mockOutput;
  let exitCode: number | null | undefined = options?.mockExitCode;
  let spawnError: Error | undefined;
  let mode: 'live' | 'static-git-diff' = 'live';
  let diffRange: string | undefined;

  if (rawOutput === undefined) {
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl) {
      console.log(`Running "prisma migrate status" for environment "${environment}"...`);
      const childEnv: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: databaseUrl };
      delete childEnv.POSTGRES_URL_NON_POOLING;

      const localPrismaBin = path.join(
        process.cwd(),
        'node_modules',
        '.bin',
        process.platform === 'win32' ? 'prisma.cmd' : 'prisma'
      );
      const useLocalBin = fs.existsSync(localPrismaBin);
      const result = child_process.spawnSync(
        useLocalBin ? localPrismaBin : 'npx',
        useLocalBin ? ['migrate', 'status'] : ['prisma', 'migrate', 'status'],
        {
          encoding: 'utf8',
          env: childEnv,
        }
      );
      exitCode = result.status;
      spawnError = result.error;
      rawOutput = `${result.stdout || ''}\n${result.stderr || ''}`;
    } else {
      mode = 'static-git-diff';
      console.log(
        'No DATABASE_URL set; diffing prisma/migrations/ across git commits (STATIC GIT DIFF)...'
      );
      const gitDiff = resolveGitChangedMigrations({
        migrationsDir,
        cwd: options?.cwd,
        baseRef: options?.baseRef,
        headRef: options?.headRef,
      });
      diffRange = gitDiff.diffRange;
      rawOutput =
        gitDiff.changedMigrations.length > 0
          ? `Following migrations have not yet been applied:\n${gitDiff.changedMigrations.join('\n')}\n`
          : 'Database schema is up to date!';
    }
  }

  const parsedStatus = parsePrismaMigrateStatus(rawOutput);
  let failureReason: string | undefined;

  if (spawnError) {
    failureReason = `Failed to execute prisma migrate status: ${spawnError.message}`;
  } else if (parsedStatus.hasFatalError) {
    failureReason = parsedStatus.errorSummary;
  } else if (exitCode !== undefined && exitCode !== 0) {
    const isCleanPendingExit =
      exitCode === 1 &&
      parsedStatus.pendingMigrations.length > 0 &&
      parsedStatus.failedMigrations.length === 0 &&
      !parsedStatus.hasFatalError;
    if (!isCleanPendingExit) {
      failureReason = `prisma migrate status exited with status ${String(exitCode)} without clean pending migrations`;
    }
  } else if (
    mode === 'live' &&
    options?.mockOutput === undefined &&
    exitCode === 0 &&
    !parsedStatus.isUpToDate &&
    parsedStatus.pendingMigrations.length === 0
  ) {
    failureReason = 'prisma migrate status produced unrecognized output';
  }

  const ddlSummaries = getMigrationDdlSummaries(migrationsDir, parsedStatus.pendingMigrations);
  const markdownSummary = formatPreflightSummary({
    environment,
    status: parsedStatus,
    ddlSummaries,
    mode,
    diffRange,
    failureReason,
  });

  console.log(markdownSummary);

  if (summaryFile) {
    try {
      fs.appendFileSync(summaryFile, markdownSummary + '\n', 'utf8');
      console.log(`Successfully appended preflight migration summary to ${summaryFile}`);
    } catch (err) {
      console.warn(`Failed to write to GITHUB_STEP_SUMMARY (${summaryFile}):`, err);
    }
  }

  if (parsedStatus.failedMigrations.length > 0 || parsedStatus.hasFatalError || Boolean(failureReason)) {
    return { success: false, summary: markdownSummary };
  }

  return { success: true, summary: markdownSummary };
}

function parseCliRefs(argv: readonly string[]): { baseRef?: string; headRef?: string } {
  let baseRef: string | undefined;
  let headRef: string | undefined;
  const args = argv.slice(2);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--base' && args[i + 1]) {
      baseRef = args[i + 1];
      i += 1;
    } else if (arg?.startsWith('--base=')) {
      baseRef = arg.slice('--base='.length);
    } else if (arg === '--head' && args[i + 1]) {
      headRef = args[i + 1];
      i += 1;
    } else if (arg?.startsWith('--head=')) {
      headRef = arg.slice('--head='.length);
    }
  }

  return { baseRef, headRef };
}

// Auto-run if executed as main CLI
const isMain =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename || '');

if (isMain) {
  const { baseRef, headRef } = parseCliRefs(process.argv);
  const result = runPreflightCheck({ baseRef, headRef });
  if (!result.success) {
    process.exit(1);
  }
}
