import fs from 'fs';
import path from 'path';
import child_process from 'child_process';

export interface ParsedMigrateStatus {
  isUpToDate: boolean;
  pendingMigrations: string[];
  failedMigrations: string[];
  rawOutput: string;
}

export interface MigrationDdlSummary {
  migrationName: string;
  sqlFilePath: string;
  ddlStatements: string[];
  fullSql: string;
}

/**
 * Parses the raw output of `prisma migrate status` to determine pending/failed migrations.
 */
export function parsePrismaMigrateStatus(output: string): ParsedMigrateStatus {
  const isUpToDate = /Database schema is up to date/i.test(output) || /No pending migrations/i.test(output);
  const pendingMigrations: string[] = [];
  const failedMigrations: string[] = [];

  // Match pending migrations block:
  // "Following migrations have not yet been applied:"
  // followed by migration directory names (e.g. 20261027000000_add_fee_coverage)
  const pendingSectionRegex = /Following migrations have not yet been applied:\s*([\s\S]*?)(?:\n\s*\n|To apply migrations|Database schema is up to date|$)/i;
  const pendingMatch = output.match(pendingSectionRegex);
  if (pendingMatch && pendingMatch[1]) {
    const lines = pendingMatch[1].split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim().replace(/^[-*•]\s*/, '');
      // Prisma migration names typically start with digits (timestamp) followed by underscore
      if (line && /^\d{14}_[a-zA-Z0-9_-]+$/.test(line)) {
        if (!pendingMigrations.includes(line)) {
          pendingMigrations.push(line);
        }
      }
    }
  }

  // Match failed migrations if any:
  // "The `2026xxxxxx_...` migration started at ... failed"
  const failedRegex = /The\s+[`"']?([a-zA-Z0-9_-]+)[`"']?\s+migration.*failed/gi;
  let match: RegExpExecArray | null;
  while ((match = failedRegex.exec(output)) !== null) {
    if (match[1] && !failedMigrations.includes(match[1])) {
      failedMigrations.push(match[1]);
    }
  }

  return {
    isUpToDate: isUpToDate && pendingMigrations.length === 0,
    pendingMigrations,
    failedMigrations,
    rawOutput: output,
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

/**
 * Formats a rich Markdown summary for $GITHUB_STEP_SUMMARY.
 */
export function formatPreflightSummary(params: {
  environment: string;
  status: ParsedMigrateStatus;
  ddlSummaries: MigrationDdlSummary[];
  isOfflineInventory?: boolean;
  totalMigrationsCount?: number;
}): string {
  const { environment, status, ddlSummaries, isOfflineInventory = false, totalMigrationsCount } = params;

  let md = '### 📋 Pre-Flight Schema Migration Status & SQL DDL Summary\n\n';
  md += `- **Target Environment:** \`${environment}\`\n`;

  if (isOfflineInventory) {
    const totalCount = totalMigrationsCount ?? ddlSummaries.length;
    md += '- **Pre-Flight Gate:** `STATIC INVENTORY` ℹ️\n';
    md += '- **Database Status:** `STATIC MIGRATION INVENTORY (NO DATABASE_URL)`\n';
    md += `- **Recorded Migrations:** \`${totalCount} total in prisma/migrations (live pending count requires DATABASE_URL)\`\n\n`;

    if (ddlSummaries.length > 0) {
      md += `#### 📦 Recent Migration SQL DDL Inventory (latest ${ddlSummaries.length} of ${totalCount} file(s))\n\n`;
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
    } else {
      md += '_No migration directories found in `prisma/migrations`._\n';
    }

    return md;
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

  if (status.isUpToDate || status.pendingMigrations.length === 0) {
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

  for (let idx = 0; idx < ddlSummaries.length; idx++) {
    const summary = ddlSummaries[idx];
    md += `##### ${idx + 1}. \`${summary.migrationName}\`\n`;
    md += `- **Migration File:** \`${summary.sqlFilePath}\`\n`;

    if (summary.ddlStatements.length > 0) {
      md += '- **Key DDL Operations:**\n';
      for (const stmt of summary.ddlStatements) {
        // Truncate very long statements if necessary
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
  migrationsDir?: string;
  stepSummaryFile?: string;
}): { success: boolean; summary: string } {
  const migrationsDir = options?.migrationsDir || path.join(process.cwd(), 'prisma', 'migrations');
  const summaryFile = options?.stepSummaryFile || process.env.GITHUB_STEP_SUMMARY;
  const databaseUrl = process.env.DATABASE_URL;
  const isOfflineInventory = options?.mockOutput === undefined && !databaseUrl;
  const environment =
    options?.environment ||
    process.env.TARGET_ENVIRONMENT ||
    process.env.NODE_ENV ||
    (isOfflineInventory ? 'offline (static inventory)' : 'development');

  let rawOutput = options?.mockOutput;
  let totalMigrationsCount: number | undefined;
  let recentInventoryNames: string[] = [];

  if (rawOutput === undefined) {
    if (databaseUrl) {
      console.log(`Running "npx prisma migrate status" for environment "${environment}"...`);
      const childEnv: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: databaseUrl };
      delete childEnv.POSTGRES_URL_NON_POOLING;
      const result = child_process.spawnSync('npx', ['prisma', 'migrate', 'status'], {
        encoding: 'utf8',
        shell: process.platform === 'win32',
        env: childEnv,
      });
      rawOutput = (result.stdout || '') + '\n' + (result.stderr || '');
    } else {
      console.log('No DATABASE_URL set; generating static migration inventory from migrations directory...');
      let migrationNames: string[] = [];
      if (fs.existsSync(migrationsDir)) {
        migrationNames = fs
          .readdirSync(migrationsDir, { withFileTypes: true })
          .filter((d) => d.isDirectory() && /^\d{14}_/.test(d.name))
          .map((d) => d.name)
          .sort();
      }
      totalMigrationsCount = migrationNames.length;
      recentInventoryNames = migrationNames.slice(-3);
      rawOutput = '';
    }
  }

  const parsedStatus = parsePrismaMigrateStatus(rawOutput);
  const ddlSummaries = getMigrationDdlSummaries(
    migrationsDir,
    isOfflineInventory ? recentInventoryNames : parsedStatus.pendingMigrations
  );
  const markdownSummary = formatPreflightSummary({
    environment,
    status: parsedStatus,
    ddlSummaries,
    isOfflineInventory,
    totalMigrationsCount,
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

  if (parsedStatus.failedMigrations.length > 0) {
    return { success: false, summary: markdownSummary };
  }

  return { success: true, summary: markdownSummary };
}

// Auto-run if executed as main CLI
const isMain =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename || '');

if (isMain) {
  const result = runPreflightCheck();
  if (!result.success) {
    process.exit(1);
  }
}
