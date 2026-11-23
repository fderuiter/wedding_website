import fs from 'fs';
import path from 'path';
import { ts } from 'ts-morph';
import { fileURLToPath } from 'url';
import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
import { parsePostgresUrl, redactPostgresUrl } from '../src/lib/postgres-url.js';
import { getKeysFromSource } from './verify-env-docs';

interface ExtractedMigrateCommand {
  file: string;
  subcommand: string;
  rawCommand: string;
  flags: string[];
  isFencedBlock: boolean;
}

const VALID_MIGRATE_SUBCOMMANDS = new Set(['deploy', 'dev', 'status', 'resolve', 'diff', 'reset']);

const REMOVED_PRISMA_7_FLAGS = new Set([
  '--from-schema-datamodel',
  '--to-schema-datamodel',
  '--from-schema-datasource',
  '--to-schema-datasource',
  '--from-url',
  '--to-url',
  '--schema',
  '--preview-feature',
]);

const VALID_PRISMA_7_SUBCOMMAND_FLAGS: Record<string, Set<string>> = {
  diff: new Set([
    '--from-empty',
    '--to-empty',
    '--from-schema',
    '--to-schema',
    '--from-migrations',
    '--to-migrations',
    '--from-config-datasource',
    '--to-config-datasource',
    '--script',
    '--exit-code',
    '--config',
    '--output',
    '--help',
  ]),
  deploy: new Set(['--config', '--help']),
  status: new Set(['--config', '--help']),
  resolve: new Set(['--applied', '--rolled-back', '--config', '--help']),
  dev: new Set(['--name', '--create-only', '--skip-seed', '--skip-generate', '--config', '--help']),
  reset: new Set(['--force', '--skip-seed', '--skip-generate', '--config', '--help']),
};

function normalizeLogicalFencedLines(blockLines: string[]): string[] {
  const logicalLines: string[] = [];
  let buffer = '';

  for (const rawLine of blockLines) {
    const trimmed = rawLine.trim();
    if (!buffer && trimmed.startsWith('#')) {
      continue;
    }
    if (trimmed.endsWith('\\')) {
      buffer += `${trimmed.slice(0, -1).trimEnd()} `;
    } else {
      buffer += trimmed;
      if (buffer.length > 0) {
        logicalLines.push(buffer);
      }
      buffer = '';
    }
  }

  if (buffer.trim().length > 0) {
    logicalLines.push(buffer.trim());
  }

  return logicalLines;
}

function extractOrderedSnippets(markdown: string): Array<{ text: string; isFencedBlock: boolean }> {
  const lines = markdown.split(/\r?\n/);
  const ordered: Array<{ text: string; isFencedBlock: boolean }> = [];

  let inFence = false;
  let fenceChar = '';
  let currentBlock: string[] = [];

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!inFence) {
        inFence = true;
        fenceChar = marker;
        currentBlock = [];
      } else if (marker === fenceChar) {
        for (const logicalLine of normalizeLogicalFencedLines(currentBlock)) {
          ordered.push({ text: logicalLine, isFencedBlock: true });
        }
        inFence = false;
        fenceChar = '';
        currentBlock = [];
      }
      continue;
    }

    if (inFence) {
      currentBlock.push(line);
      continue;
    }

    const spanRegex = /`([^`]+)`/g;
    let match: RegExpExecArray | null;
    while ((match = spanRegex.exec(line)) !== null) {
      ordered.push({ text: match[1].trim(), isFencedBlock: false });
    }
  }

  return ordered;
}

function extractFencedLogicalLines(markdown: string): string[] {
  return extractOrderedSnippets(markdown)
    .filter((item) => item.isFencedBlock)
    .map((item) => item.text);
}

const BRACKETED_POSTGRES_TEMPLATE_REGEX =
  /^postgres(?:ql)?:\/\/\[user\]:\[password\]@\[host\](?::\[port\])?\/\[(?:database|db)\](?:\?.*)?$/i;

function materializeShellVarsForUrlValidation(input: string): string {
  let current = input;
  const innermostVarRegex = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-?+])([^{}]*))?\}/g;
  for (let round = 0; round < 5; round++) {
    let changed = false;
    current = current.replace(
      innermostVarRegex,
      (fullMatch, varName: string, operator?: string, operand?: string) => {
        if ((operator === ':-' || operator === '-') && operand && !operand.startsWith('$')) {
          changed = true;
          return operand;
        }
        if (operator === ':-' && operand && operand.startsWith('$')) {
          return fullMatch;
        }
        changed = true;
        if (/PORT/i.test(varName)) {
          return '5432';
        }
        return 'placeholder';
      }
    );
    if (!changed) {
      break;
    }
  }
  return current;
}

function isPureVariableReference(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (/^\$[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    return true;
  }
  if (/^\$\{\{[^}]+\}\}$/.test(trimmed)) {
    return true;
  }
  if (/^\$\{[A-Za-z_][A-Za-z0-9_]*(?::?[-?+](\$[A-Za-z_][A-Za-z0-9_]*|\$\{[A-Za-z_][A-Za-z0-9_]*\}))?\}$/.test(trimmed)) {
    return true;
  }
  return false;
}

function validateDocumentedPostgresUrlsInRunbook(
  relPath: string,
  markdown: string,
  envKeysToCheck: string[],
  errors: string[]
): void {
  const snippets = extractOrderedSnippets(markdown);
  const envKeyPattern = envKeysToCheck
    .filter(Boolean)
    .map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const assignmentRegex = envKeyPattern
    ? new RegExp(
      `(?:^|[\\s"'(])(${envKeyPattern})=("([^"]*)"|'([^']*)'|([^\\s"',;)]*))`,
      'g'
    )
    : null;

  for (const { text: rawSnippet, isFencedBlock } of snippets) {
    const snippet = rawSnippet.trim();
    if (!snippet) {
      continue;
    }

    const validatedNormalizedUrls = new Set<string>();

    if (assignmentRegex) {
      assignmentRegex.lastIndex = 0;
      let assignMatch: RegExpExecArray | null;
      while ((assignMatch = assignmentRegex.exec(snippet)) !== null) {
        const envKey = assignMatch[1];
        const fullRhs = assignMatch[2] ?? '';
        const unquotedValue =
          assignMatch[3] !== undefined
            ? assignMatch[3]
            : assignMatch[4] !== undefined
              ? assignMatch[4]
              : (assignMatch[5] ?? '');

        // Prose reference to `DATABASE_URL=` prefix without a value (as opposed to `DATABASE_URL=""`)
        if (fullRhs === '' && (snippet === `${envKey}=` || !isFencedBlock)) {
          continue;
        }

        const prefixBeforeMatch = snippet.slice(0, assignMatch.index + assignMatch[0].indexOf(envKey));
        if (
          /--(?:set|update)-secrets\b/.test(prefixBeforeMatch) ||
          (/--(?:set|update)-secrets\b/.test(snippet) &&
            /^[A-Za-z_][A-Za-z0-9_]*:(?:latest|\d+)$/.test(unquotedValue))
        ) {
          continue;
        }

        if (isPureVariableReference(unquotedValue)) {
          continue;
        }

        const materializedValue = materializeShellVarsForUrlValidation(unquotedValue);
        if (BRACKETED_POSTGRES_TEMPLATE_REGEX.test(materializedValue)) {
          validatedNormalizedUrls.add(materializedValue);
          continue;
        }

        try {
          parsePostgresUrl(materializedValue, {
            allowEmptyHostSocket: false,
            requireDatabaseName: true,
          });
          validatedNormalizedUrls.add(materializedValue);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          errors.push(
            `${relPath}: Invalid documented ${envKey} connection string (${redactPostgresUrl(unquotedValue)}): ${reason}`
          );
          validatedNormalizedUrls.add(materializedValue);
        }
      }
    }

    // Prose scheme-only mentions such as `postgres://`, `postgresql://`, or `postgres(ql)://`
    if (
      !isFencedBlock &&
      (snippet === 'postgres://' || snippet === 'postgresql://' || snippet === 'postgres(ql)://')
    ) {
      continue;
    }

    const materializedSnippet = materializeShellVarsForUrlValidation(snippet);
    const uriRegex = /\bpostgres(?:ql)?:\/\/[^\s"'`<>)]+/g;
    let uriMatch: RegExpExecArray | null;
    while ((uriMatch = uriRegex.exec(materializedSnippet)) !== null) {
      const candidateUri = uriMatch[0].replace(/[.,;]+$/, '');
      if (validatedNormalizedUrls.has(candidateUri)) {
        continue;
      }
      // Bare scheme mention inside a multi-token inline span is still invalid if intended as a URI,
      // except if someone wrote e.g. `postgres://` alone (already handled above).
      if (BRACKETED_POSTGRES_TEMPLATE_REGEX.test(candidateUri)) {
        continue;
      }

      try {
        parsePostgresUrl(candidateUri, {
          allowEmptyHostSocket: false,
          requireDatabaseName: true,
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        errors.push(
          `${relPath}: Invalid documented PostgreSQL URI (${redactPostgresUrl(candidateUri)}): ${reason}`
        );
      }
    }
  }
}

function parseMigrateSegmentsFromSnippet(
  file: string,
  snippet: string,
  isFencedBlock: boolean
): ExtractedMigrateCommand[] {
  const results: ExtractedMigrateCommand[] = [];
  const segments = snippet.split(/\s*(?:&&|\|\||;|\|)\s*/);

  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!/\bprisma\s+migrate\b/.test(trimmed)) {
      continue;
    }

    // Ignore pure namespace mentions like `prisma migrate` or `npx prisma migrate` without a subcommand
    if (/^(?:npx\s+)?prisma\s+migrate$/.test(trimmed)) {
      continue;
    }

    const migrateMatch = trimmed.match(/\bprisma\s+migrate\s+([a-zA-Z0-9_-]+)(.*)$/);
    if (!migrateMatch) {
      continue;
    }

    const subcommand = migrateMatch[1];
    const rest = migrateMatch[2] || '';
    const flags: string[] = [];
    const flagRegex = /(?:^|\s)(--[a-zA-Z0-9-]+)(?==|\s|$)/g;
    let flagMatch: RegExpExecArray | null;
    while ((flagMatch = flagRegex.exec(rest)) !== null) {
      flags.push(flagMatch[1]);
    }

    results.push({
      file,
      subcommand,
      rawCommand: trimmed,
      flags,
      isFencedBlock,
    });
  }

  return results;
}

export function extractPrismaMigrateCommands(file: string, markdown: string): ExtractedMigrateCommand[] {
  const snippets = extractOrderedSnippets(markdown);
  const commands: ExtractedMigrateCommand[] = [];

  for (const snippet of snippets) {
    commands.push(...parseMigrateSegmentsFromSnippet(file, snippet.text, snippet.isFencedBlock));
  }

  return commands;
}

function parsePrismaConfigEnvVars(prismaConfigContent: string): {
  urlEnvKey: string | null;
  shadowUrlEnvKey: string | null;
} {
  const sourceFile = ts.createSourceFile('prisma.config.ts', prismaConfigContent, ts.ScriptTarget.Latest, true);
  let urlEnvKey: string | null = null;
  let shadowUrlEnvKey: string | null = null;

  function extractEnvKey(node: ts.Node): string | null {
    // Matches process.env.KEY
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(sourceFile) === 'process' &&
      node.expression.name.text === 'env'
    ) {
      return node.name.text;
    }
    // Matches env('KEY')
    if (
      ts.isCallExpression(node) &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      return node.arguments[0].text;
    }
    let found: string | null = null;
    ts.forEachChild(node, (child) => {
      if (!found) {
        found = extractEnvKey(child);
      }
    });
    return found;
  }

  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(sourceFile) === 'datasource') {
      if (ts.isObjectLiteralExpression(node.initializer)) {
        for (const prop of node.initializer.properties) {
          if (ts.isPropertyAssignment(prop)) {
            const propName = prop.name.getText(sourceFile);
            if (propName === 'url') {
              urlEnvKey = extractEnvKey(prop.initializer);
            } else if (propName === 'shadowDatabaseUrl') {
              shadowUrlEnvKey = extractEnvKey(prop.initializer);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { urlEnvKey, shadowUrlEnvKey };
}

function getPrismaMajorVersion(packageJsonContent: string): number {
  const pkg = JSON.parse(packageJsonContent) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const rawVersion =
    pkg.devDependencies?.prisma ??
    pkg.dependencies?.['@prisma/client'] ??
    '7.0.0';
  const majorMatch = rawVersion.match(/(\d+)/);
  return majorMatch ? Number(majorMatch[1]) : 7;
}

function parseDeployProviderContract(workflowContent: string): {
  cloudRunService: string | null;
  allowedCloudRunServices: Set<string>;
  usesParameterizedCloudRunTarget: boolean;
  gcpAuthSecret: string | null;
  usesWorkloadIdentity: boolean;
} {
  const serviceMatch = workflowContent.match(/^\s*service:\s*([a-zA-Z0-9_-]+)\s*$/m);
  const usesParameterizedCloudRunTarget =
    /\bvars\.CLOUD_RUN_SERVICE\b/.test(workflowContent) &&
    /\bvars\.CLOUD_RUN_REGION\b/.test(workflowContent);
  const allowedCloudRunServices = new Set<string>();
  if (serviceMatch) {
    allowedCloudRunServices.add(serviceMatch[1]);
  }
  if (usesParameterizedCloudRunTarget || allowedCloudRunServices.size === 0) {
    allowedCloudRunServices.add('wedding-website');
    allowedCloudRunServices.add('wedding-website-staging');
  }

  const authSecretMatch = workflowContent.match(/credentials_json:\s*\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}/);
  const usesWorkloadIdentity = /workload_identity_provider\s*:/.test(workflowContent);

  return {
    cloudRunService: serviceMatch ? serviceMatch[1] : 'wedding-website',
    allowedCloudRunServices,
    usesParameterizedCloudRunTarget,
    gcpAuthSecret: authSecretMatch ? authSecretMatch[1] : null,
    usesWorkloadIdentity,
  };
}

function parsePublishArtifactRegistry(workflowContent: string): string {
  const registryMatch = workflowContent.match(/^\s*REGISTRY:\s*([^\s#]+)\s*$/m);
  return registryMatch ? registryMatch[1] : 'ghcr.io';
}

function isValidScryptHashLiteral(value: string): boolean {
  if (!value.startsWith('scrypt:')) {
    return false;
  }
  const parts = value.split(':');
  if (parts.length !== 3) {
    return false;
  }
  const [, saltB64, keyB64] = parts;
  if (!saltB64 || !keyB64) {
    return false;
  }
  const b64Re = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  if (!b64Re.test(saltB64) || !b64Re.test(keyB64)) {
    return false;
  }
  return Buffer.from(saltB64, 'base64').length === 16 && Buffer.from(keyB64, 'base64').length === 64;
}

function parseDockerComposeContract(composeContent: string): {
  services: string[];
  interpolatedVars: string[];
  requiredVars: string[];
  dbPorts: string[];
  migrationCommand: string | null;
  migrationDatabaseUrl: string | null;
  migrationReadOnly: boolean;
  migrationCapDropAll: boolean;
  migrationNoNewPrivileges: boolean;
  migrationTmpfs: string[];
  appEnvMap: Map<string, string>;
  appHasHealthcheck: boolean;
  appHealthcheckTargetsLive: boolean;
  appHasEnvFile: boolean;
  appHostname: string | null;
  appReadOnly: boolean;
  appCapDropAll: boolean;
  appNoNewPrivileges: boolean;
  appTmpfs: string[];
  appUploadsVolumeMounted: boolean;
  topLevelUploadsVolumeDeclared: boolean;
} {
  const lines = composeContent.split(/\r?\n/);
  const services: string[] = [];
  const dbPorts: string[] = [];
  const appEnvMap = new Map<string, string>();
  const migrationTmpfs: string[] = [];
  const appTmpfs: string[] = [];
  let migrationCommand: string | null = null;
  let migrationDatabaseUrl: string | null = null;
  let migrationReadOnly = false;
  let migrationCapDropAll = false;
  let migrationNoNewPrivileges = false;
  let inServices = false;
  let inTopLevelVolumes = false;
  let currentService: string | null = null;
  let inDbPorts = false;
  let inMigrationEnv = false;
  let inMigrationCapDrop = false;
  let inMigrationSecurityOpt = false;
  let inMigrationTmpfs = false;
  let inAppEnv = false;
  let inAppVolumes = false;
  let inAppCapDrop = false;
  let inAppSecurityOpt = false;
  let inAppTmpfs = false;
  let inAppHealthcheck = false;
  let appHasHealthcheck = false;
  let appHealthcheckTargetsLive = false;
  let appHasEnvFile = false;
  let appHostname: string | null = null;
  let appReadOnly = false;
  let appCapDropAll = false;
  let appNoNewPrivileges = false;
  let appUploadsVolumeMounted = false;
  let topLevelUploadsVolumeDeclared = false;

  for (const line of lines) {
    if (/^services:\s*$/.test(line)) {
      inServices = true;
      inTopLevelVolumes = false;
      continue;
    }
    if (/^volumes:\s*$/.test(line)) {
      inServices = false;
      inTopLevelVolumes = true;
      currentService = null;
      continue;
    }
    if (/^\S/.test(line) && !line.trim().startsWith('#')) {
      inServices = false;
      inTopLevelVolumes = false;
      currentService = null;
    }
    if (inTopLevelVolumes) {
      if (/^  uploads_data:\s*(?:#.*)?$/.test(line)) {
        topLevelUploadsVolumeDeclared = true;
      }
      continue;
    }
    if (!inServices) {
      continue;
    }

    const serviceMatch = line.match(/^  ([a-zA-Z0-9_-]+):\s*$/);
    if (serviceMatch) {
      currentService = serviceMatch[1];
      services.push(currentService);
      inDbPorts = false;
      inMigrationEnv = false;
      inMigrationCapDrop = false;
      inMigrationSecurityOpt = false;
      inMigrationTmpfs = false;
      inAppEnv = false;
      inAppVolumes = false;
      inAppCapDrop = false;
      inAppSecurityOpt = false;
      inAppTmpfs = false;
      inAppHealthcheck = false;
      continue;
    }

    if (currentService === 'db') {
      if (/^    [a-zA-Z0-9_-]+:/.test(line)) {
        inDbPorts = /^    ports:\s*$/.test(line);
      } else if (inDbPorts) {
        const portMatch = line.match(/^\s*-\s*(?:["']([^"']*)["']|(\S+))\s*(?:#.*)?$/);
        if (portMatch) {
          dbPorts.push(portMatch[1] ?? portMatch[2] ?? '');
        }
      }
    }

    if (currentService === 'migration') {
      if (/^    [a-zA-Z0-9_-]+:/.test(line)) {
        inMigrationEnv = /^    environment:\s*$/.test(line);
        inMigrationCapDrop = /^    cap_drop:\s*$/.test(line);
        inMigrationSecurityOpt = /^    security_opt:\s*$/.test(line);
        inMigrationTmpfs = /^    tmpfs:\s*$/.test(line);
        const cmdMatch = line.match(/^    command:\s*(.+?)\s*(?:#.*)?$/);
        if (cmdMatch) {
          migrationCommand = cmdMatch[1].replace(/^["']|["']$/g, '').trim();
        }
        if (/^    read_only:\s*true\s*(?:#.*)?$/.test(line)) {
          migrationReadOnly = true;
        }
      } else if (inMigrationEnv) {
        const dbUrlMatch = line.match(
          /^\s*(?:-\s*)?DATABASE_URL\s*(?::|=)\s*(?:["']([^"']*)["']|(.+?))\s*(?:#.*)?$/
        );
        if (dbUrlMatch) {
          migrationDatabaseUrl = (dbUrlMatch[1] ?? dbUrlMatch[2] ?? '').trim();
        }
      } else if (inMigrationCapDrop) {
        if (/^\s*-\s*["']?ALL["']?\s*(?:#.*)?$/.test(line)) {
          migrationCapDropAll = true;
        }
      } else if (inMigrationSecurityOpt) {
        if (/^\s*-\s*["']?no-new-privileges:true["']?\s*(?:#.*)?$/.test(line)) {
          migrationNoNewPrivileges = true;
        }
      } else if (inMigrationTmpfs) {
        const tmpfsMatch = line.match(/^\s*-\s*(?:["']([^"']*)["']|(\S+))\s*(?:#.*)?$/);
        if (tmpfsMatch) {
          migrationTmpfs.push(tmpfsMatch[1] ?? tmpfsMatch[2] ?? '');
        }
      }
    }

    if (currentService === 'app') {
      if (/^    [a-zA-Z0-9_-]+:/.test(line)) {
        inAppEnv = /^    environment:\s*$/.test(line);
        inAppVolumes = /^    volumes:\s*$/.test(line);
        inAppCapDrop = /^    cap_drop:\s*$/.test(line);
        inAppSecurityOpt = /^    security_opt:\s*$/.test(line);
        inAppTmpfs = /^    tmpfs:\s*$/.test(line);
        inAppHealthcheck = /^    healthcheck:\s*$/.test(line);
        if (/^    read_only:\s*true\s*(?:#.*)?$/.test(line)) {
          appReadOnly = true;
        }
      }
      if (/^    healthcheck:\s*$/.test(line)) {
        appHasHealthcheck = true;
      }
      if (inAppHealthcheck && line.includes('/api/live')) {
        appHealthcheckTargetsLive = true;
      }
      if (/^    env_file:\s*/.test(line)) {
        appHasEnvFile = true;
      }
      if (inAppCapDrop && /^\s*-\s*["']?ALL["']?\s*(?:#.*)?$/.test(line)) {
        appCapDropAll = true;
      }
      if (inAppSecurityOpt && /^\s*-\s*["']?no-new-privileges:true["']?\s*(?:#.*)?$/.test(line)) {
        appNoNewPrivileges = true;
      }
      if (inAppTmpfs && !/^    tmpfs:\s*$/.test(line)) {
        const tmpfsMatch = line.match(/^\s*-\s*(?:["']([^"']*)["']|(\S+))\s*(?:#.*)?$/);
        if (tmpfsMatch) {
          appTmpfs.push(tmpfsMatch[1] ?? tmpfsMatch[2] ?? '');
        }
      }
      if (inAppEnv && !line.trim().startsWith('#')) {
        const kvMatch = line.match(
          /^\s*(?:-\s*)?([A-Z0-9_]+)\s*(?::|=)\s*(?:["']([^"']*)["']|(.+?))\s*(?:#.*)?$/
        );
        if (kvMatch) {
          const envKey = kvMatch[1];
          const envVal = (kvMatch[2] ?? kvMatch[3] ?? '').trim();
          appEnvMap.set(envKey, envVal);
          if (envKey === 'HOSTNAME') {
            appHostname = envVal;
          }
        }
      }
      if (inAppVolumes) {
        if (/^\s*-\s*uploads_data:\/app\/public\/uploads(?::rw)?\s*(?:#.*)?$/.test(line)) {
          appUploadsVolumeMounted = true;
        }
      }
    }
  }

  const sanitized = composeContent.replace(/\$\$/g, '');
  const interpolatedSet = new Set<string>();
  const interpolationRegex = /\$\{([A-Z0-9_]+)(?::?[-?+][^}]*)?\}/g;
  let match: RegExpExecArray | null;
  while ((match = interpolationRegex.exec(sanitized)) !== null) {
    interpolatedSet.add(match[1]);
  }

  const requiredSet = new Set<string>();
  const requiredRegex = /\$\{([A-Z0-9_]+):\?[^}]*\}/g;
  while ((match = requiredRegex.exec(sanitized)) !== null) {
    requiredSet.add(match[1]);
  }

  return {
    services,
    interpolatedVars: Array.from(interpolatedSet),
    requiredVars: Array.from(requiredSet),
    dbPorts,
    migrationCommand,
    migrationDatabaseUrl,
    migrationReadOnly,
    migrationCapDropAll,
    migrationNoNewPrivileges,
    migrationTmpfs,
    appEnvMap,
    appHasHealthcheck,
    appHealthcheckTargetsLive,
    appHasEnvFile,
    appHostname,
    appReadOnly,
    appCapDropAll,
    appNoNewPrivileges,
    appTmpfs,
    appUploadsVolumeMounted,
    topLevelUploadsVolumeDeclared,
  };
}

function parseCiWorkflowJobIds(ciWorkflowContent: string): string[] {
  const lines = ciWorkflowContent.split(/\r?\n/);
  const jobIds: string[] = [];
  let inJobs = false;

  for (const line of lines) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (inJobs && /^\S/.test(line) && !line.trim().startsWith('#')) {
      inJobs = false;
    }
    if (inJobs) {
      const jobMatch = line.match(/^  ([a-zA-Z0-9_-]+):\s*$/);
      if (jobMatch) {
        jobIds.push(jobMatch[1]);
      }
    }
  }

  return jobIds;
}

function parseWorkflowFilesAndSecrets(workflowsDir: string): {
  workflowFiles: string[];
  workflowSecrets: Set<string>;
  workflowVars: Set<string>;
  workflowYamlErrors: string[];
} {
  const entries = fs
    .readdirSync(workflowsDir)
    .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
    .sort();

  const workflowSecrets = new Set<string>();
  const workflowVars = new Set<string>();
  const workflowYamlErrors: string[] = [];
  const secretRegex = /\bsecrets\.([A-Z0-9_]+)\b/g;
  const varRegex = /\bvars\.([A-Z0-9_]+)\b/g;

  for (const file of entries) {
    const content = fs.readFileSync(path.join(workflowsDir, file), 'utf8');
    const doc = parseDocument(content, { version: '1.2', strict: true });

    for (const err of doc.errors) {
      const line = err.linePos?.[0]?.line ?? 1;
      const summary = err.message.split(/\r?\n/)[0].trim();
      workflowYamlErrors.push(
        `.github/workflows/${file}:${line}: Invalid YAML 1.2 syntax (${err.code}): ${summary}`
      );
    }

    for (const warn of doc.warnings) {
      const line = warn.linePos?.[0]?.line ?? 1;
      const summary = warn.message.split(/\r?\n/)[0].trim();
      workflowYamlErrors.push(
        `.github/workflows/${file}:${line}: Invalid YAML 1.2 tag/warning (${warn.code}): ${summary}`
      );
    }

    let match: RegExpExecArray | null;
    while ((match = secretRegex.exec(content)) !== null) {
      const secretName = match[1];
      if (secretName !== 'GITHUB_TOKEN') {
        workflowSecrets.add(secretName);
      }
    }
    while ((match = varRegex.exec(content)) !== null) {
      workflowVars.add(match[1]);
    }
  }

  return { workflowFiles: entries, workflowSecrets, workflowVars, workflowYamlErrors };
}

function extractSectionSlice(markdown: string, headingPattern: RegExp, stopHeadingPrefix: string): string {
  const lines = markdown.split(/\r?\n/);
  const collected: string[] = [];
  let inSection = false;
  let inFence = false;

  for (const line of lines) {
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      inFence = !inFence;
    }
    if (!inFence && !inSection && headingPattern.test(line)) {
      inSection = true;
      continue;
    }
    if (!inFence && inSection && line.startsWith(stopHeadingPrefix)) {
      break;
    }
    if (inSection) {
      collected.push(line);
    }
  }

  return collected.join('\n');
}

export function verifyDeploymentRunbooks(repoRoot: string = process.cwd()): string[] {
  const errors: string[] = [];

  const requiredFiles = [
    '.nvmrc',
    'package.json',
    'prisma.config.ts',
    'prisma/schema.prisma',
    'Dockerfile',
    'docker-compose.yml',
    'docker-compose.ci.yml',
    'next.config.ts',
    'vercel.json',
    'src/env.ts',
    'src/lib/config.ts',
    'src/middleware.ts',
    'src/app/api/uploads/[...path]/route.ts',
    'DEPLOYMENT.md',
    'docs/runtime-contract.md',
    'docs/deployment/README.md',
    'docs/deployment/vercel.md',
    'docs/deployment/gcp-cloud-run.md',
    'docs/deployment/docker-vps.md',
    'docs/deployment/railway-render.md',
    '.github/dependabot.yml',
    '.github/workflows/ci.yml',
    '.github/workflows/storybook.yml',
    '.github/workflows/deploy.yml',
    '.github/workflows/deploy-provider.yml',
    '.github/workflows/publish-artifact.yml',
    '.github/workflows/db-migrate.yml',
    '.github/workflows/rollback.yml',
  ];

  for (const relPath of requiredFiles) {
    if (!fs.existsSync(path.join(repoRoot, relPath))) {
      errors.push(`Required repository file not found: ${relPath}`);
    }
  }
  if (errors.length > 0) {
    return errors;
  }

  const packageJsonRaw = fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8');
  const prismaMajor = getPrismaMajorVersion(packageJsonRaw);
  const packageJson = JSON.parse(packageJsonRaw) as {
    scripts?: Record<string, string>;
    engines?: Record<string, string>;
    devEngines?: {
      runtime?: { name?: string; version?: string; onFail?: string };
      packageManager?: { name?: string; version?: string; onFail?: string };
    };
    devDependencies?: Record<string, string>;
  };

  const prismaConfigRaw = fs.readFileSync(path.join(repoRoot, 'prisma.config.ts'), 'utf8');
  const { urlEnvKey, shadowUrlEnvKey } = parsePrismaConfigEnvVars(prismaConfigRaw);

  const runbookRelPaths = [
    'DEPLOYMENT.md',
    'docs/runtime-contract.md',
    'docs/deployment/README.md',
    'docs/deployment/vercel.md',
    'docs/deployment/gcp-cloud-run.md',
    'docs/deployment/docker-vps.md',
    'docs/deployment/railway-render.md',
  ];

  const runbookContents = new Map<string, string>();
  for (const relPath of runbookRelPaths) {
    runbookContents.set(relPath, fs.readFileSync(path.join(repoRoot, relPath), 'utf8'));
  }

  // 1. Prisma 7 CLI & prisma.config.ts verification across all runbooks
  for (const [relPath, content] of runbookContents.entries()) {
    const commands = extractPrismaMigrateCommands(relPath, content);
    for (const cmd of commands) {
      if (!VALID_MIGRATE_SUBCOMMANDS.has(cmd.subcommand)) {
        errors.push(`${relPath}: Invalid prisma migrate subcommand "${cmd.subcommand}" in \`${cmd.rawCommand}\``);
        continue;
      }

      if (prismaMajor >= 7) {
        for (const flag of cmd.flags) {
          if (REMOVED_PRISMA_7_FLAGS.has(flag)) {
            errors.push(
              `${relPath}: Removed Prisma <7 flag "${flag}" used under Prisma ${prismaMajor}.x in \`${cmd.rawCommand}\``
            );
          } else {
            const allowedFlags = VALID_PRISMA_7_SUBCOMMAND_FLAGS[cmd.subcommand];
            if (allowedFlags && !allowedFlags.has(flag)) {
              errors.push(
                `${relPath}: Unsupported flag "${flag}" for "prisma migrate ${cmd.subcommand}" in \`${cmd.rawCommand}\``
              );
            }
          }
        }

        if (cmd.subcommand === 'diff' && cmd.isFencedBlock) {
          const hasFrom = cmd.flags.some((flag) => flag.startsWith('--from-'));
          const hasTo = cmd.flags.some((flag) => flag.startsWith('--to-'));
          if (!hasFrom || !hasTo) {
            errors.push(
              `${relPath}: Incomplete "prisma migrate diff" command missing --from-* or --to-* flag in \`${cmd.rawCommand}\``
            );
          }
        }

        if (
          urlEnvKey &&
          shadowUrlEnvKey &&
          cmd.rawCommand.includes(`${urlEnvKey}=`) &&
          cmd.rawCommand.includes(shadowUrlEnvKey) &&
          !new RegExp(`(?:env\\s+-u\\s+${shadowUrlEnvKey}|unset\\s+${shadowUrlEnvKey})`).test(cmd.rawCommand)
        ) {
          errors.push(
            `${relPath}: \`${cmd.rawCommand}\` overrides ${urlEnvKey} from ${shadowUrlEnvKey} without \`env -u ${shadowUrlEnvKey}\` (triggers Prisma 7 P3025 shadow database collision)`
          );
        }
      }
    }

    if (shadowUrlEnvKey && content.includes(shadowUrlEnvKey)) {
      if (!content.includes('prisma.config.ts')) {
        errors.push(
          `${relPath}: Documents ${shadowUrlEnvKey} without referencing prisma.config.ts datasource binding`
        );
      }
      if (/automatically\s+used\s+by\s+Prisma\s+CLI/i.test(content)) {
        errors.push(
          `${relPath}: Stale claim that ${shadowUrlEnvKey} is automatically used by Prisma CLI`
        );
      }
    }

    validateDocumentedPostgresUrlsInRunbook(
      relPath,
      content,
      [urlEnvKey ?? 'DATABASE_URL', shadowUrlEnvKey ?? 'POSTGRES_URL_NON_POOLING'],
      errors
    );
  }

  // Verify Vercel prisma migrate deploy explicitly overrides DATABASE_URL when non-pooling URL is documented
  const vercelMd = runbookContents.get('docs/deployment/vercel.md') ?? '';
  if (urlEnvKey && shadowUrlEnvKey && vercelMd.includes(shadowUrlEnvKey)) {
    const vercelMigrateDeploys = extractPrismaMigrateCommands('docs/deployment/vercel.md', vercelMd).filter(
      (cmd) => cmd.isFencedBlock && cmd.subcommand === 'deploy'
    );
    if (vercelMigrateDeploys.length === 0) {
      errors.push('docs/deployment/vercel.md: Missing fenced `prisma migrate deploy` build command');
    }
    for (const cmd of vercelMigrateDeploys) {
      if (!new RegExp(`\\b${urlEnvKey}=`).test(cmd.rawCommand)) {
        errors.push(
          `docs/deployment/vercel.md: \`${cmd.rawCommand}\` must explicitly override ${urlEnvKey}= to bypass PgBouncer under prisma.config.ts`
        );
      }
    }
  }

  // 2. Cloud Run, GHCR digest, Workload Identity Federation / GCP_SA_KEY, and GUEST_SESSION_SECRET contract
  const deployProviderRaw = fs.readFileSync(path.join(repoRoot, '.github/workflows/deploy-provider.yml'), 'utf8');
  const publishArtifactRaw = fs.readFileSync(path.join(repoRoot, '.github/workflows/publish-artifact.yml'), 'utf8');
  const {
    cloudRunService,
    allowedCloudRunServices,
    usesParameterizedCloudRunTarget,
    gcpAuthSecret,
    usesWorkloadIdentity,
  } = parseDeployProviderContract(deployProviderRaw);
  const canonicalRegistry = parsePublishArtifactRegistry(publishArtifactRaw);
  const gcpMd = runbookContents.get('docs/deployment/gcp-cloud-run.md') ?? '';
  const deploymentMdForCloudRun = runbookContents.get('DEPLOYMENT.md') ?? '';
  const gcpFencedLines = extractFencedLogicalLines(gcpMd);

  if (cloudRunService) {
    if (gcpMd.includes('wedding-service') && !allowedCloudRunServices.has('wedding-service')) {
      errors.push(
        `docs/deployment/gcp-cloud-run.md: References stale service name "wedding-service" instead of "${cloudRunService}"`
      );
    }

    const allowedServicesLabel = Array.from(allowedCloudRunServices).join(', ');
    for (const line of gcpFencedLines) {
      const positionalMatch = line.match(
        /\bgcloud\s+run\s+(?:deploy|services\s+update|services\s+update-traffic)\s+([a-zA-Z0-9_-]+)/
      );
      if (positionalMatch && !allowedCloudRunServices.has(positionalMatch[1])) {
        errors.push(
          `docs/deployment/gcp-cloud-run.md: gcloud command targets service "${positionalMatch[1]}" instead of allowed services (${allowedServicesLabel})`
        );
      }
      const serviceFlagMatch = line.match(/--service(?:=|\s+)([a-zA-Z0-9_-]+)/);
      if (serviceFlagMatch && !allowedCloudRunServices.has(serviceFlagMatch[1])) {
        errors.push(
          `docs/deployment/gcp-cloud-run.md: --service flag targets "${serviceFlagMatch[1]}" instead of allowed services (${allowedServicesLabel})`
        );
      }
    }
  }

  if (usesParameterizedCloudRunTarget) {
    for (const [docLabel, docText] of [
      ['DEPLOYMENT.md', deploymentMdForCloudRun],
      ['docs/deployment/gcp-cloud-run.md', gcpMd],
    ] as const) {
      if (!docText.includes('CLOUD_RUN_SERVICE') || !docText.includes('CLOUD_RUN_REGION')) {
        errors.push(
          `${docLabel}: Must document parameterized Cloud Run target variables CLOUD_RUN_SERVICE and CLOUD_RUN_REGION`
        );
      }
      if (!docText.includes('wedding-website-staging')) {
        errors.push(
          `${docLabel}: Must document isolated default staging Cloud Run service "wedding-website-staging"`
        );
      }
    }
  }

  if (gcpAuthSecret && !gcpMd.includes(gcpAuthSecret)) {
    errors.push(
      `docs/deployment/gcp-cloud-run.md: Missing workflow authentication secret "${gcpAuthSecret}" from deploy-provider.yml`
    );
  }

  if (!usesWorkloadIdentity && /Workload Identity Federation/i.test(gcpMd)) {
    errors.push(
      'docs/deployment/gcp-cloud-run.md: Claims Workload Identity Federation while deploy-provider.yml authenticates via credentials_json'
    );
  }

  if (usesWorkloadIdentity) {
    for (const [docLabel, docText] of [
      ['DEPLOYMENT.md', deploymentMdForCloudRun],
      ['docs/deployment/gcp-cloud-run.md', gcpMd],
    ] as const) {
      if (
        !/Workload Identity Federation/i.test(docText) ||
        !docText.includes('GCP_WORKLOAD_IDENTITY_PROVIDER') ||
        !docText.includes('GCP_SERVICE_ACCOUNT')
      ) {
        errors.push(
          `${docLabel}: Must document Workload Identity Federation with GCP_WORKLOAD_IDENTITY_PROVIDER and GCP_SERVICE_ACCOUNT`
        );
      }
    }
  }

  for (const line of gcpFencedLines) {
    const imageMatch = line.match(/--image(?:=|\s+)([^\s"']+)/);
    if (imageMatch) {
      const imageRef = imageMatch[1];
      if (!imageRef.startsWith(`${canonicalRegistry}/`)) {
        errors.push(
          `docs/deployment/gcp-cloud-run.md: Container image "${imageRef}" must pull from primary registry "${canonicalRegistry}/"`
        );
      }
      if (imageRef.endsWith(':latest')) {
        errors.push(
          `docs/deployment/gcp-cloud-run.md: Mutable ":latest" image tag prohibited in "${imageRef}"`
        );
      }
      if (!imageRef.includes('@sha256:')) {
        errors.push(
          `docs/deployment/gcp-cloud-run.md: Container image "${imageRef}" must pin an immutable @sha256: digest`
        );
      }
    }

    if (/\bgcloud\s+run\s+deploy\b/.test(line) && !line.includes('GUEST_SESSION_SECRET')) {
      errors.push(
        'docs/deployment/gcp-cloud-run.md: Manual `gcloud run deploy` command omits mandatory GUEST_SESSION_SECRET'
      );
    }
  }

  if (
    !gcpMd.includes('--startup-probe-request-path=/api/health') ||
    !gcpMd.includes('--liveness-probe-request-path=/api/live')
  ) {
    errors.push(
      'docs/deployment/gcp-cloud-run.md: Must configure `--startup-probe-request-path=/api/health` and `--liveness-probe-request-path=/api/live`'
    );
  }

  // Verify inline mandatory Vercel env var lists in DEPLOYMENT.md and docs/deployment/README.md include GUEST_SESSION_SECRET
  for (const relPath of ['DEPLOYMENT.md', 'docs/deployment/README.md']) {
    const content = runbookContents.get(relPath) ?? '';
    for (const line of content.split(/\r?\n/)) {
      if (
        line.includes('DATABASE_URL') &&
        line.includes('ADMIN_PASSWORD') &&
        line.includes('ALLOWED_HOSTS') &&
        !line.includes('GUEST_SESSION_SECRET')
      ) {
        errors.push(
          `${relPath}: Mandatory production variable list mentioning DATABASE_URL, ADMIN_PASSWORD, and ALLOWED_HOSTS omits GUEST_SESSION_SECRET`
        );
      }
    }
  }

  // 3. Docker Compose / VPS runbook & isolated docker-compose.ci.yml contract
  const composeRaw = fs.readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf8');
  const ciComposeRaw = fs.readFileSync(path.join(repoRoot, 'docker-compose.ci.yml'), 'utf8');
  const envTsRaw = fs.readFileSync(path.join(repoRoot, 'src/env.ts'), 'utf8');
  const configTsRaw = fs.readFileSync(path.join(repoRoot, 'src/lib/config.ts'), 'utf8');
  const ciWorkflowRaw = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
  const composeContract = parseDockerComposeContract(composeRaw);
  const ciComposeContract = parseDockerComposeContract(ciComposeRaw);
  const envSchemaKeys = getKeysFromSource(envTsRaw);
  const dockerMd = runbookContents.get('docs/deployment/docker-vps.md') ?? '';
  const deploymentMd = runbookContents.get('DEPLOYMENT.md') ?? '';

  for (const [relPath, content] of runbookContents.entries()) {
    if (content.includes('scrypt:c2FsdA==:aGFzaA==')) {
      errors.push(
        `${relPath}: Must not document invalid 4-byte placeholder hash "scrypt:c2FsdA==:aGFzaA=="`
      );
    }
  }
  if (composeRaw.includes('scrypt:c2FsdA==:aGFzaA==')) {
    errors.push(
      'docker-compose.yml: Must not contain invalid 4-byte placeholder hash "scrypt:c2FsdA==:aGFzaA=="'
    );
  }
  if (ciComposeRaw.includes('scrypt:c2FsdA==:aGFzaA==')) {
    errors.push(
      'docker-compose.ci.yml: Must not contain invalid 4-byte placeholder hash "scrypt:c2FsdA==:aGFzaA=="'
    );
  }

  for (const requiredSecret of ['DB_PASSWORD', 'ADMIN_PASSWORD', 'GUEST_PASSCODE', 'GUEST_SESSION_SECRET']) {
    if (!composeContract.requiredVars.includes(requiredSecret)) {
      errors.push(
        `docker-compose.yml: Must require explicit operator value via \${${requiredSecret}:?...} without fallback defaults`
      );
    }
    if (new RegExp(`\\$\\{${requiredSecret}:-`).test(composeRaw)) {
      errors.push(
        `docker-compose.yml: Must not define a default fallback (\${${requiredSecret}:-...}) for secret "${requiredSecret}"`
      );
    }
  }

  if (
    composeContract.dbPorts.length === 0 ||
    !composeContract.dbPorts.every((portSpec) => portSpec.startsWith('127.0.0.1:'))
  ) {
    errors.push(
      'docker-compose.yml: `db` service must bind PostgreSQL strictly to loopback (`127.0.0.1:${DB_PORT:-5432}:5432`)'
    );
  }

  if (!composeContract.migrationDatabaseUrl?.startsWith('${DATABASE_URL:-')) {
    errors.push(
      'docker-compose.yml: `migration` service must honor explicit `DATABASE_URL` overrides (`${DATABASE_URL:-...}`)'
    );
  }
  if (composeContract.migrationCommand !== './node_modules/.bin/prisma migrate deploy') {
    errors.push(
      'docker-compose.yml: `migration` service must execute `./node_modules/.bin/prisma migrate deploy` offline without `npx`'
    );
  }
  if (
    !composeContract.migrationReadOnly ||
    !composeContract.migrationCapDropAll ||
    !composeContract.migrationNoNewPrivileges ||
    !composeContract.migrationTmpfs.some((entry) => entry === '/tmp' || entry.startsWith('/tmp:'))
  ) {
    errors.push(
      'docker-compose.yml: `migration` service must enforce `read_only: true`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, and `tmpfs: [/tmp]`'
    );
  }
  if (
    !composeContract.appReadOnly ||
    !composeContract.appCapDropAll ||
    !composeContract.appNoNewPrivileges ||
    !composeContract.appTmpfs.some((entry) => entry === '/tmp' || entry.startsWith('/tmp:')) ||
    !composeContract.appTmpfs.some(
      (entry) => entry === '/app/.next/cache' || entry.startsWith('/app/.next/cache:')
    )
  ) {
    errors.push(
      'docker-compose.yml: `app` service must enforce `read_only: true`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, and `tmpfs` mounts for `/tmp` and `/app/.next/cache`'
    );
  }
  if (!composeContract.appHasHealthcheck || !composeContract.appHealthcheckTargetsLive) {
    errors.push('docker-compose.yml: `app` service healthcheck must probe `/api/live`');
  }
  if (!composeContract.appEnvMap.get('DATABASE_URL')?.startsWith('${DATABASE_URL:-')) {
    errors.push(
      'docker-compose.yml: `app` service must honor explicit `DATABASE_URL` overrides (`${DATABASE_URL:-...}`)'
    );
  }
  if (composeContract.appEnvMap.get('E2E_TEST') !== '${E2E_TEST:-false}') {
    errors.push('docker-compose.yml: `app` service must set `E2E_TEST: ${E2E_TEST:-false}` by default');
  }
  if (composeContract.appEnvMap.get('ALLOWED_HOSTS') !== '${ALLOWED_HOSTS:-localhost,127.0.0.1,*.localhost}') {
    errors.push(
      'docker-compose.yml: `app` service must restrict default `ALLOWED_HOSTS` to `localhost,127.0.0.1,*.localhost`'
    );
  }
  for (const schemaKey of envSchemaKeys) {
    if (!composeContract.appEnvMap.has(schemaKey)) {
      errors.push(
        `docker-compose.yml: \`app\` service environment must forward runtime variable "${schemaKey}" from src/env.ts`
      );
    }
  }

  // Validate isolated docker-compose.ci.yml override contract
  if (!/POSTGRES_PASSWORD:\s*\$\{DB_PASSWORD:-wedding123\}/.test(ciComposeRaw)) {
    errors.push(
      'docker-compose.ci.yml: Must isolate disposable CI database password default `POSTGRES_PASSWORD: ${DB_PASSWORD:-wedding123}`'
    );
  }
  if (ciComposeContract.appEnvMap.get('E2E_TEST') !== '${E2E_TEST:-true}') {
    errors.push('docker-compose.ci.yml: `app` service must isolate `E2E_TEST: ${E2E_TEST:-true}`');
  }
  const ciAdminEnv = ciComposeContract.appEnvMap.get('ADMIN_PASSWORD') ?? '';
  const ciAdminDefaultMatch = ciAdminEnv.match(/^\$\{ADMIN_PASSWORD:-([^}]+)\}$/);
  if (!ciAdminDefaultMatch || !isValidScryptHashLiteral(ciAdminDefaultMatch[1])) {
    errors.push(
      'docker-compose.ci.yml: `app` service must provide a valid 16-byte-salt / 64-byte-key scrypt fallback in `ADMIN_PASSWORD`'
    );
  }
  if (!ciWorkflowRaw.includes('-f docker-compose.yml -f docker-compose.ci.yml')) {
    errors.push(
      '.github/workflows/ci.yml: Container jobs must explicitly pass `-f docker-compose.yml -f docker-compose.ci.yml`'
    );
  }

  for (const svc of composeContract.services) {
    if (!new RegExp(`\\b${svc}\\b`).test(dockerMd)) {
      errors.push(`docs/deployment/docker-vps.md: Missing docker-compose.yml service "${svc}"`);
    }
  }
  if (composeContract.services.includes('migration') && !/\bmigration\b/.test(deploymentMd)) {
    errors.push('DEPLOYMENT.md: Missing docker-compose.yml `migration` service reference');
  }

  if (configTsRaw.includes('E2E_TEST')) {
    if (!dockerMd.includes('E2E_TEST=false')) {
      errors.push('docs/deployment/docker-vps.md: Must document E2E_TEST=false for production onboarding');
    }
  }

  if (!composeContract.appHasEnvFile) {
    for (const envVar of ['DB_USER', 'DB_PASSWORD', 'DB_NAME', 'DB_PORT']) {
      if (composeContract.interpolatedVars.includes(envVar) && !dockerMd.includes(envVar)) {
        errors.push(
          `docs/deployment/docker-vps.md: Missing Compose-interpolated variable "${envVar}" from docker-compose.yml`
        );
      }
    }
  }

  if (composeContract.appHasHealthcheck) {
    if (/Add the health check probe to docker-compose\.yml/i.test(dockerMd)) {
      errors.push(
        'docs/deployment/docker-vps.md: Stale instruction to add healthcheck to docker-compose.yml when healthcheck is already built-in'
      );
    }
    if (!/\bhealthcheck\b/i.test(dockerMd)) {
      errors.push('docs/deployment/docker-vps.md: Must document built-in healthcheck in docker-compose.yml');
    }
  }

  const dockerRollbackSection = extractSectionSlice(dockerMd, /^##\s+8\.\s+Rollback\b/, '## ');
  const rollbackLines = extractFencedLogicalLines(dockerRollbackSection);
  for (const line of rollbackLines) {
    if (/\bdocker\s+run\b/.test(line)) {
      if (!/(?:^|\s)(?:-p\s|--publish(?:=|\s))/.test(line)) {
        errors.push(
          `docs/deployment/docker-vps.md: Rollback \`docker run\` command lacks host port mapping (-p / --publish): \`${line}\``
        );
      }
      if (!/(?:^|\s)--network(?:=|\s)/.test(line)) {
        errors.push(
          `docs/deployment/docker-vps.md: Rollback \`docker run\` command lacks Compose network attachment (--network): \`${line}\``
        );
      }
      if (/:latest(?:\s|$)/.test(line)) {
        errors.push(
          `docs/deployment/docker-vps.md: Rollback \`docker run\` command must not deploy mutable :latest tag: \`${line}\``
        );
      }
    }
  }

  // Verify HOSTNAME=0.0.0.0 and uploads_data:/app/public/uploads across Dockerfile, docker-compose.yml, and docs
  const dockerfileRaw = fs.readFileSync(path.join(repoRoot, 'Dockerfile'), 'utf8');
  const runtimeContractMd = runbookContents.get('docs/runtime-contract.md') ?? '';
  if (!/^ENV\s+HOSTNAME=(?:"0\.0\.0\.0"|'0\.0\.0\.0'|0\.0\.0\.0)\s*$/m.test(dockerfileRaw)) {
    errors.push('Dockerfile: Missing `ENV HOSTNAME="0.0.0.0"` in runner image');
  }
  if (composeContract.appHostname !== '0.0.0.0') {
    errors.push('docker-compose.yml: `app` service must set `HOSTNAME: "0.0.0.0"`');
  }
  if (!composeContract.appUploadsVolumeMounted || !composeContract.topLevelUploadsVolumeDeclared) {
    errors.push(
      'docker-compose.yml: `app` service must mount `uploads_data:/app/public/uploads` with `uploads_data:` declared under top-level `volumes:`'
    );
  }
  if (!/\|\s*`HOSTNAME`\s*\|\s*`0\.0\.0\.0`/.test(runtimeContractMd)) {
    errors.push('docs/runtime-contract.md: Missing `HOSTNAME` (`0.0.0.0`) entry in Environment Variable Matrix');
  }
  if (!dockerMd.includes('uploads_data') || !dockerMd.includes('/app/public/uploads')) {
    errors.push('docs/deployment/docker-vps.md: Must document `uploads_data` volume mounted at `/app/public/uploads`');
  }

  // Verify Node.js 22 LTS toolchain parity across .nvmrc, Dockerfile, package.json, runtime/deployment docs, workflows, and Dependabot
  const nvmrcRaw = fs.readFileSync(path.join(repoRoot, '.nvmrc'), 'utf8').trim();
  const nvmrcMajorMatch = nvmrcRaw.match(/^v?(\d+)(?:\.\d+\.\d+)?$/);
  const expectedNodeMajor = nvmrcMajorMatch ? nvmrcMajorMatch[1] : '22';
  if (!nvmrcMajorMatch || expectedNodeMajor !== '22') {
    errors.push(`.nvmrc: Must pin Node.js 22 LTS major ("22"), found "${nvmrcRaw}"`);
  }

  const expectedDockerBaseRegex = new RegExp(
    `^FROM\\s+node:${expectedNodeMajor}-bookworm-slim@sha256:[a-fA-F0-9]{64}\\b`,
    'm'
  );
  const mismatchedDockerNodeRegex = new RegExp(
    `^FROM\\s+node:(?!${expectedNodeMajor}-bookworm-slim(?:@|\\s|$))[^\\s]+`,
    'm'
  );
  if (!expectedDockerBaseRegex.test(dockerfileRaw) || mismatchedDockerNodeRegex.test(dockerfileRaw)) {
    errors.push(
      `Dockerfile: Must pin \`node:${expectedNodeMajor}-bookworm-slim@sha256:<64-hex>\` matching .nvmrc (Node.js ${expectedNodeMajor} LTS)`
    );
  }

  const extractSemverMajor = (range?: string): string | null => {
    if (!range) return null;
    const match = range.trim().match(/^(?:[\^~>=<v\s]*)(\d+)(?:\.\d+|\.x|\b|$)/i);
    return match ? match[1] : null;
  };
  if (
    extractSemverMajor(packageJson.engines?.node) !== expectedNodeMajor ||
    !packageJson.engines?.node?.includes('>=22.22.1') ||
    !packageJson.engines?.node?.includes('<23.0.0')
  ) {
    errors.push(
      `package.json: \`engines.node\` ("${packageJson.engines?.node ?? ''}") must target Node.js ${expectedNodeMajor} with range ">=22.22.1 <23.0.0" matching .nvmrc and lockfile floor`
    );
  }
  if (
    packageJson.devEngines?.runtime?.name !== 'node' ||
    extractSemverMajor(packageJson.devEngines?.runtime?.version) !== expectedNodeMajor ||
    packageJson.devEngines?.runtime?.onFail !== 'error'
  ) {
    errors.push(
      `package.json: \`devEngines.runtime\` must enforce Node.js ${expectedNodeMajor} with \`onFail: "error"\` matching .nvmrc`
    );
  }
  if (extractSemverMajor(packageJson.devDependencies?.['@types/node']) !== expectedNodeMajor) {
    errors.push(
      `package.json: \`devDependencies["@types/node"]\` ("${packageJson.devDependencies?.['@types/node'] ?? ''}") must target Node.js ${expectedNodeMajor} matching .nvmrc`
    );
  }

  const staleDocNodeLtsRegex = new RegExp(
    `\\bNode\\.js\\s+v?(?!${expectedNodeMajor}\\b)\\d+(?:\\.x)?\\s+LTS\\b`
  );
  const staleDocNodeImageRegex = new RegExp(
    `\\bnode:(?!${expectedNodeMajor}-bookworm-slim\\b)\\d+-(?:bookworm-slim|alpine)\\b`
  );
  if (
    !runtimeContractMd.includes(`v${expectedNodeMajor}.x LTS`) ||
    !runtimeContractMd.includes(`node:${expectedNodeMajor}-bookworm-slim`) ||
    staleDocNodeLtsRegex.test(runtimeContractMd) ||
    staleDocNodeImageRegex.test(runtimeContractMd)
  ) {
    errors.push(
      `docs/runtime-contract.md: Must specify Node.js v${expectedNodeMajor}.x LTS and \`node:${expectedNodeMajor}-bookworm-slim\` matching .nvmrc`
    );
  }

  const deploymentOverviewMd = runbookContents.get('docs/deployment/README.md') ?? '';
  for (const [docLabel, docContent] of [
    ['DEPLOYMENT.md', deploymentMd],
    ['docs/deployment/README.md', deploymentOverviewMd],
  ] as const) {
    if (
      !docContent.includes(`Node.js v${expectedNodeMajor}.x LTS`) ||
      staleDocNodeLtsRegex.test(docContent)
    ) {
      errors.push(
        `${docLabel}: Must specify \`Node.js v${expectedNodeMajor}.x LTS\` matching .nvmrc`
      );
    }
  }

  const workflowsCheckDir = path.join(repoRoot, '.github/workflows');
  const workflowYamlEntries = fs
    .readdirSync(workflowsCheckDir)
    .filter((entry) => entry.endsWith('.yml') || entry.endsWith('.yaml'))
    .sort();
  let setupNodeStepCount = 0;
  for (const wfEntry of workflowYamlEntries) {
    const wfRelPath = `.github/workflows/${wfEntry}`;
    const wfDoc = parseDocument(fs.readFileSync(path.join(workflowsCheckDir, wfEntry), 'utf8'), {
      version: '1.2',
    });
    const jobsNode: unknown = isMap(wfDoc.contents) ? wfDoc.contents.get('jobs', true) : null;
    if (!isMap(jobsNode)) {
      continue;
    }
    for (const jobPair of jobsNode.items) {
      const jobKey = isScalar(jobPair.key) ? String(jobPair.key.value) : 'unknown';
      const jobNode: unknown = jobPair.value;
      if (!isMap(jobNode)) {
        continue;
      }
      const stepsNode: unknown = jobNode.get('steps', true);
      if (!isSeq(stepsNode)) {
        continue;
      }
      for (const stepItem of stepsNode.items) {
        if (!isMap(stepItem)) {
          continue;
        }
        const usesNode: unknown = stepItem.get('uses', true);
        if (
          !isScalar(usesNode) ||
          typeof usesNode.value !== 'string' ||
          !usesNode.value.trim().startsWith('actions/setup-node@')
        ) {
          continue;
        }
        setupNodeStepCount += 1;
        const withNode: unknown = stepItem.get('with', true);
        const versionFileNode: unknown = isMap(withNode)
          ? withNode.get('node-version-file', true)
          : undefined;
        const hardcodedVersionNode: unknown = isMap(withNode)
          ? withNode.get('node-version', true)
          : undefined;
        const versionFileVal =
          isScalar(versionFileNode) && typeof versionFileNode.value === 'string'
            ? versionFileNode.value.trim()
            : '';
        if (versionFileVal !== '.nvmrc' || hardcodedVersionNode !== undefined) {
          errors.push(
            `${wfRelPath} (job "${jobKey}"): \`actions/setup-node\` must set \`node-version-file: '.nvmrc'\` without hardcoded \`node-version\``
          );
        }
      }
    }
  }
  if (setupNodeStepCount === 0) {
    errors.push('.github/workflows: Expected at least one `actions/setup-node` step referencing `.nvmrc`');
  }

  const dependabotDoc = parseDocument(
    fs.readFileSync(path.join(repoRoot, '.github/dependabot.yml'), 'utf8'),
    { version: '1.2' }
  );
  const hasDependabotMajorIgnore = (ecosystem: string, dependencyName: string): boolean => {
    const updatesNode: unknown = isMap(dependabotDoc.contents)
      ? dependabotDoc.contents.get('updates', true)
      : null;
    if (!isSeq(updatesNode)) {
      return false;
    }
    for (const updateEntry of updatesNode.items) {
      if (!isMap(updateEntry)) {
        continue;
      }
      const ecoNode: unknown = updateEntry.get('package-ecosystem', true);
      if (!isScalar(ecoNode) || String(ecoNode.value).trim() !== ecosystem) {
        continue;
      }
      const ignoreNode: unknown = updateEntry.get('ignore', true);
      if (!isSeq(ignoreNode)) {
        continue;
      }
      for (const ignoreRule of ignoreNode.items) {
        if (!isMap(ignoreRule)) {
          continue;
        }
        const depNode: unknown = ignoreRule.get('dependency-name', true);
        const typesNode: unknown = ignoreRule.get('update-types', true);
        if (!isScalar(depNode) || String(depNode.value).trim() !== dependencyName || !isSeq(typesNode)) {
          continue;
        }
        const hasMajorType = typesNode.items.some(
          (item) => isScalar(item) && String(item.value).trim() === 'version-update:semver-major'
        );
        if (hasMajorType) {
          return true;
        }
      }
    }
    return false;
  };
  if (!hasDependabotMajorIgnore('docker', 'node')) {
    errors.push(
      '.github/dependabot.yml: Missing `version-update:semver-major` ignore rule for `node` under `docker` ecosystem'
    );
  }
  if (!hasDependabotMajorIgnore('npm', '@types/node')) {
    errors.push(
      '.github/dependabot.yml: Missing `version-update:semver-major` ignore rule for `@types/node` under `npm` ecosystem'
    );
  }

  const hasDependabotVersionIgnore = (
    ecosystem: string,
    dependencyName: string,
    expectedVersionRange: string
  ): boolean => {
    const updatesNode: unknown = isMap(dependabotDoc.contents)
      ? dependabotDoc.contents.get('updates', true)
      : null;
    if (!isSeq(updatesNode)) {
      return false;
    }
    for (const updateEntry of updatesNode.items) {
      if (!isMap(updateEntry)) {
        continue;
      }
      const ecoNode: unknown = updateEntry.get('package-ecosystem', true);
      if (!isScalar(ecoNode) || String(ecoNode.value).trim() !== ecosystem) {
        continue;
      }
      const ignoreNode: unknown = updateEntry.get('ignore', true);
      if (!isSeq(ignoreNode)) {
        continue;
      }
      for (const ignoreRule of ignoreNode.items) {
        if (!isMap(ignoreRule)) {
          continue;
        }
        const depNode: unknown = ignoreRule.get('dependency-name', true);
        const versionsNode: unknown = ignoreRule.get('versions', true);
        if (!isScalar(depNode) || String(depNode.value).trim() !== dependencyName || !isSeq(versionsNode)) {
          continue;
        }
        const hasExpectedRange = versionsNode.items.some(
          (item) => isScalar(item) && String(item.value).trim() === expectedVersionRange
        );
        if (hasExpectedRange) {
          return true;
        }
      }
    }
    return false;
  };
  if (!hasDependabotVersionIgnore('docker', 'node', '>= 23.0.0')) {
    errors.push(
      '.github/dependabot.yml: Missing `versions: [">= 23.0.0"]` ignore rule for `node` under `docker` ecosystem'
    );
  }
  if (!hasDependabotVersionIgnore('npm', '@types/node', '>= 23.0.0')) {
    errors.push(
      '.github/dependabot.yml: Missing `versions: [">= 23.0.0"]` ignore rule for `@types/node` under `npm` ecosystem'
    );
  }

  // Verify PostgreSQL 15+ floor, Docker Compose ./node_modules/.bin/prisma migrate deploy prose, and /api/live container liveness claims
  for (const [relPath, content] of runbookContents.entries()) {
    if (/\bPostgreSQL\s+1[0-4]\b/i.test(content)) {
      errors.push(
        `${relPath}: References unsupported PostgreSQL < 15 floor (minimum supported version is PostgreSQL 15+)`
      );
    }
    if (
      /Docker Compose[^.\n]*`migration`[^.\n]*`npx prisma migrate deploy`/i.test(content) ||
      /managed via `npx prisma migrate deploy`\.\s*Migrations run prior to application startup via the Docker Compose `migration` service/i.test(
        content
      )
    ) {
      errors.push(
        `${relPath}: Must document offline \`./node_modules/.bin/prisma migrate deploy\` (not \`npx prisma migrate deploy\`) for the Docker Compose \`migration\` service`
      );
    }
    if (
      content.includes('--liveness-probe-request-path=/api/health') ||
      /query\s+`?\/api\/health`?[^.\n]*\bfor\s+liveness\b/i.test(content) ||
      /\bliveness\s+(?:probes?|healthchecks?|checks?)\s+(?:query|hit|target|use)\s+`?\/api\/health`?/i.test(
        content
      )
    ) {
      errors.push(
        `${relPath}: Must direct container and orchestrator liveness probes to \`/api/live\` instead of \`/api/health\``
      );
    }
  }
  if (!/PostgreSQL\s+15\b/i.test(deploymentMd)) {
    errors.push('DEPLOYMENT.md: Must specify PostgreSQL 15+ as minimum supported database version');
  }
  if (!deploymentMd.includes('./node_modules/.bin/prisma migrate deploy')) {
    errors.push(
      'DEPLOYMENT.md: Must document `./node_modules/.bin/prisma migrate deploy` for Docker Compose / offline container migrations'
    );
  }
  if (!deploymentOverviewMd.includes('./node_modules/.bin/prisma migrate deploy')) {
    errors.push(
      'docs/deployment/README.md: Must document `./node_modules/.bin/prisma migrate deploy` for Docker Compose / offline container migrations'
    );
  }
  const healthProbeSection = extractSectionSlice(
    deploymentMd,
    /^##\s+Health Checks & Liveness Probes\b/,
    '## '
  );
  if (!healthProbeSection.includes('/api/live')) {
    errors.push(
      'DEPLOYMENT.md: `## Health Checks & Liveness Probes` section must direct container liveness probes to `/api/live`'
    );
  }

  // Verify standalone /uploads/* rewrite and nosniff upload route contract
  const nextConfigRaw = fs.readFileSync(path.join(repoRoot, 'next.config.ts'), 'utf8');
  const uploadRouteRaw = fs.readFileSync(path.join(repoRoot, 'src/app/api/uploads/[...path]/route.ts'), 'utf8');
  if (!nextConfigRaw.includes("source: '/uploads/:path*'") || !nextConfigRaw.includes("destination: '/api/uploads/:path*'")) {
    errors.push('next.config.ts: Missing server rewrite from `/uploads/:path*` to `/api/uploads/:path*`');
  }
  if (!uploadRouteRaw.includes('X-Content-Type-Options') || !uploadRouteRaw.includes('nosniff')) {
    errors.push('src/app/api/uploads/[...path]/route.ts: Must set `X-Content-Type-Options: nosniff` on responses');
  }

  // Verify middleware webhook & uploads exclusions preserve ALLOWED_HOSTS check
  const middlewareRaw = fs.readFileSync(path.join(repoRoot, 'src/middleware.ts'), 'utf8');
  const hostCheckIdx = middlewareRaw.indexOf('!isHostAllowed(');
  const excludedGuardIdx = middlewareRaw.indexOf('const isExcluded');
  if (hostCheckIdx === -1 || excludedGuardIdx === -1 || hostCheckIdx > excludedGuardIdx) {
    errors.push('src/middleware.ts: `isHostAllowed` perimeter check must execute before `isExcluded` evaluation');
  }
  if (!middlewareRaw.includes("normalizedPath === '/api/registry/webhook/stripe'")) {
    errors.push('src/middleware.ts: Must exclude `/api/registry/webhook/stripe` from session cookie checks');
  }
  if (!middlewareRaw.includes("normalizedPath === '/api/live'")) {
    errors.push('src/middleware.ts: Must exclude `/api/live` from session cookie checks');
  }
  if (!middlewareRaw.includes("'/uploads/:path*'")) {
    errors.push("src/middleware.ts: `config.matcher` must include `'/uploads/:path*'` so `ALLOWED_HOSTS` runs on `/uploads/*`");
  }

  // 4. GitHub Workflows, Secrets, Approval Gate, CI Jobs, & Static Export Contract
  const workflowsDir = path.join(repoRoot, '.github/workflows');
  const { workflowFiles, workflowSecrets, workflowVars, workflowYamlErrors } =
    parseWorkflowFilesAndSecrets(workflowsDir);
  errors.push(...workflowYamlErrors);
  const deployWorkflowRaw = fs.readFileSync(path.join(workflowsDir, 'deploy.yml'), 'utf8');
  const ciJobIds = parseCiWorkflowJobIds(ciWorkflowRaw);

  for (const wfFile of workflowFiles) {
    if (!deploymentMd.includes(wfFile)) {
      errors.push(`DEPLOYMENT.md: Missing GitHub Actions workflow reference "${wfFile}"`);
    }
  }

  for (const requiredCiJob of ['storybook-build', 'deploy-docs']) {
    if (ciJobIds.includes(requiredCiJob) && !deploymentMd.includes(requiredCiJob)) {
      errors.push(`DEPLOYMENT.md: Missing ci.yml job reference "${requiredCiJob}"`);
    }
  }

  if (packageJson.scripts?.['build:export'] && !deploymentMd.includes('build:export')) {
    errors.push('DEPLOYMENT.md: Missing static HTML showcase script reference "build:export"');
  }

  if (deployWorkflowRaw.includes('schema-compatibility') && !deploymentMd.includes('schema-compatibility')) {
    errors.push('DEPLOYMENT.md: Missing deploy.yml pre-approval job reference "schema-compatibility"');
  }
  if (
    deployWorkflowRaw.includes('preflight-migration-summary.ts') &&
    !deploymentMd.includes('preflight-migration-summary.ts')
  ) {
    errors.push('DEPLOYMENT.md: Missing preflight script reference "preflight-migration-summary.ts"');
  }
  if (/pre-flight SQL migration previews against production/i.test(deploymentMd)) {
    errors.push(
      'DEPLOYMENT.md: Stale claim that deploy.yml runs pre-flight SQL migration previews against live production before approval'
    );
  }

  // Validate DEPLOYMENT.md "## 🔑 Setup and Secrets" tables match exact workflow-used secrets and variables
  const setupSecretsSection = extractSectionSlice(deploymentMd, /^##\s+.*Setup and Secrets\b/, '## ');
  if (!setupSecretsSection) {
    errors.push('DEPLOYMENT.md: Missing "Setup and Secrets" section');
  } else {
    const documentedTableSecrets = new Set<string>();
    const documentedTableVars = new Set<string>();
    let currentTableKind: 'secrets' | 'vars' | null = null;

    for (const line of setupSecretsSection.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('|')) {
        currentTableKind = null;
        continue;
      }
      if (/^\|\s*Secret\s*\|/i.test(trimmed)) {
        currentTableKind = 'secrets';
        continue;
      }
      if (/^\|\s*Variable\s*\|/i.test(trimmed)) {
        currentTableKind = 'vars';
        continue;
      }
      if (/^[\s|:-]+$/.test(trimmed)) {
        continue;
      }
      const rowMatch = line.match(/^\s*\|\s*`([A-Z0-9_]+)`\s*\|/);
      if (rowMatch) {
        if (currentTableKind === 'vars') {
          documentedTableVars.add(rowMatch[1]);
        } else {
          documentedTableSecrets.add(rowMatch[1]);
        }
      }
    }

    for (const docSecret of documentedTableSecrets) {
      if (!workflowSecrets.has(docSecret)) {
        errors.push(
          `DEPLOYMENT.md: Secret "${docSecret}" in Setup and Secrets table is not referenced via secrets.* in any .github/workflows/*.yml file`
        );
      }
      if (workflowVars.has(docSecret)) {
        errors.push(
          `DEPLOYMENT.md: "${docSecret}" must be documented as a primary GitHub Actions Variable (vars.${docSecret}) rather than a primary Secret in Setup and Secrets table`
        );
      }
    }
    for (const wfSecret of workflowSecrets) {
      const migratedToVarWithLegacyFallback =
        workflowVars.has(wfSecret) &&
        documentedTableVars.has(wfSecret) &&
        setupSecretsSection.includes(`vars.${wfSecret}`) &&
        setupSecretsSection.includes(`secrets.${wfSecret}`);
      if (!documentedTableSecrets.has(wfSecret) && !migratedToVarWithLegacyFallback) {
        errors.push(
          `DEPLOYMENT.md: Workflow secret "${wfSecret}" used in .github/workflows/*.yml is missing from Setup and Secrets table`
        );
      }
    }

    for (const docVar of documentedTableVars) {
      if (!workflowVars.has(docVar)) {
        errors.push(
          `DEPLOYMENT.md: Variable "${docVar}" in Setup and Secrets table is not referenced via vars.* in any .github/workflows/*.yml file`
        );
      }
    }
    for (const wfVar of workflowVars) {
      if (!documentedTableVars.has(wfVar)) {
        errors.push(
          `DEPLOYMENT.md: Workflow variable "${wfVar}" used in .github/workflows/*.yml is missing from Setup and Secrets Variables table`
        );
      }
    }
  }

  // Validate GitHub Environment subsections do not list runtime-only non-workflow entries and classify SERVICE_URL as a variable
  const githubEnvSection = extractSectionSlice(
    deploymentMd,
    /^###\s+.*GitHub Environment Setup\b/,
    '### '
  );
  if (githubEnvSection) {
    let inEnvSecretsList = false;
    for (const line of githubEnvSection.split(/\r?\n/)) {
      if (/^\s*\d+\.\s+\*\*Environment Secrets\*\*/i.test(line)) {
        inEnvSecretsList = true;
        continue;
      }
      if (/^\s*(?:\d+\.\s+\*\*|####\s+)/.test(line)) {
        inEnvSecretsList = false;
      }
      const bulletEntryMatch = line.match(/^\s*-\s+`([A-Z0-9_]+)`\s*:/);
      if (bulletEntryMatch) {
        const entryName = bulletEntryMatch[1];
        if (!workflowSecrets.has(entryName) && !workflowVars.has(entryName)) {
          errors.push(
            `DEPLOYMENT.md: GitHub Environment secret "${entryName}" is not consumed by any GitHub Actions workflow`
          );
        }
        if (inEnvSecretsList && workflowVars.has(entryName)) {
          errors.push(
            `DEPLOYMENT.md: GitHub Environment Setup lists ${entryName} under Environment Secrets instead of Environment Variables (vars.${entryName})`
          );
        }
      }
    }

    if (workflowVars.has('SERVICE_URL')) {
      if (!githubEnvSection.includes('vars.SERVICE_URL') || !githubEnvSection.includes('secrets.SERVICE_URL')) {
        errors.push(
          'DEPLOYMENT.md: GitHub Environment Setup must document vars.SERVICE_URL as primary and secrets.SERVICE_URL as legacy fallback'
        );
      }
    }
  }

  if (workflowVars.has('SERVICE_URL')) {
    if (!gcpMd.includes('vars.SERVICE_URL') || !gcpMd.includes('secrets.SERVICE_URL')) {
      errors.push(
        'docs/deployment/gcp-cloud-run.md: Must document vars.SERVICE_URL as primary and secrets.SERVICE_URL as legacy fallback'
      );
    }
    const gcpAutomatedSection = extractSectionSlice(
      gcpMd,
      /^###\s+Automated Deployment via GitHub Actions\b/,
      '### '
    );
    if (gcpAutomatedSection) {
      let inGcpSecretsBullets = false;
      for (const line of gcpAutomatedSection.split(/\r?\n/)) {
        if (/^\*\s+\*\*GitHub Environment Secrets\*\*/i.test(line.trim())) {
          inGcpSecretsBullets = true;
          continue;
        }
        if (/^\*\s+\*\*/.test(line.trim())) {
          inGcpSecretsBullets = false;
        }
        if (inGcpSecretsBullets) {
          const secretBulletMatch = line.match(/^\s*\*\s+`([A-Z0-9_]+)`\s*:/);
          if (secretBulletMatch && workflowVars.has(secretBulletMatch[1])) {
            errors.push(
              `docs/deployment/gcp-cloud-run.md: Lists ${secretBulletMatch[1]} under GitHub Environment Secrets instead of GitHub Environment Variables (vars.${secretBulletMatch[1]})`
            );
          }
        }
      }
      for (const requiredGcpVar of [
        'CLOUD_RUN_SERVICE',
        'CLOUD_RUN_REGION',
        'GCP_WORKLOAD_IDENTITY_PROVIDER',
        'GCP_SERVICE_ACCOUNT',
      ]) {
        if (workflowVars.has(requiredGcpVar) && !gcpAutomatedSection.includes(requiredGcpVar)) {
          errors.push(
            `docs/deployment/gcp-cloud-run.md: Automated Deployment section must document GitHub Environment Variable "${requiredGcpVar}"`
          );
        }
      }
    }
  }

  // 5. Rollback workflow jq `.data.status` / `.data.database` & `publish-artifact.yml` `v*` tag checks
  const rollbackWorkflowRaw = fs.readFileSync(path.join(workflowsDir, 'rollback.yml'), 'utf8');
  if (!rollbackWorkflowRaw.includes('.data.status') || !rollbackWorkflowRaw.includes('.data.database')) {
    errors.push('.github/workflows/rollback.yml: Health check jq query must read `.data.status` and `.data.database`');
  }
  if (/jq\s+-r\s+['"]\.(?:status|database)\s*\/\//.test(rollbackWorkflowRaw)) {
    errors.push(
      '.github/workflows/rollback.yml: Unwrapped `.status` or `.database` jq query detected (must read `.data.status` / `.data.database`)'
    );
  }
  for (const relPath of ['DEPLOYMENT.md', 'docs/deployment/gcp-cloud-run.md']) {
    const content = runbookContents.get(relPath) ?? '';
    if (!content.includes('.data.status') || !content.includes('.data.database')) {
      errors.push(`${relPath}: Rollback health probe documentation must reference \`.data.status\` and \`.data.database\``);
    }
  }

  if (
    !publishArtifactRaw.includes('GITHUB_REF_NAME') ||
    !/refs\/tags\/v\*/.test(publishArtifactRaw) ||
    !publishArtifactRaw.includes('${RESOLVED_SHA}')
  ) {
    errors.push(
      '.github/workflows/publish-artifact.yml: Must publish `GITHUB_REF_NAME` alongside `${RESOLVED_SHA}` on `refs/tags/v*` pushes'
    );
  }
  for (const relPath of ['DEPLOYMENT.md', 'docs/deployment/gcp-cloud-run.md']) {
    const content = runbookContents.get(relPath) ?? '';
    if (!content.includes('GITHUB_REF_NAME')) {
      errors.push(`${relPath}: Must document \`GITHUB_REF_NAME\` tag publication in \`publish-artifact.yml\` on \`v*\` tag pushes`);
    }
    for (const line of content.split(/\r?\n/)) {
      if (
        /(?:deploy\.yml`?\s+(?:automatically\s+)?(?:triggers?|runs?)\s+on\s+[^.;\n]*\bv\*|\bv\*`?\s+(?:tag\s+pushes?\s+|tags?\s+)?(?:automatically\s+)?(?:triggers?|invokes?)\s+`?(?:\.github\/workflows\/)?deploy\.yml)/i.test(
          line
        ) &&
        !/\b(?:not|without|never)\b/i.test(line)
      ) {
        errors.push(`${relPath}: Stale claim that \`v*\` tag pushes automatically trigger \`deploy.yml\``);
      }
    }
  }

  // 6. Vercel cron (`vercel.json`), Stripe webhook & CRON_SECRET scheduler instructions, and MULTISITE_ENABLED shared tables
  const vercelJsonRaw = fs.readFileSync(path.join(repoRoot, 'vercel.json'), 'utf8');
  let vercelCronConfigured = false;
  try {
    const parsedVercel = JSON.parse(vercelJsonRaw) as {
      crons?: Array<{ path?: string; schedule?: string }>;
    };
    vercelCronConfigured = Boolean(
      parsedVercel.crons?.some(
        (cron) =>
          cron.path === '/api/cron/broadcasts' &&
          typeof cron.schedule === 'string' &&
          cron.schedule.trim().split(/\s+/).length === 5
      )
    );
  } catch {
    errors.push('vercel.json: Invalid JSON syntax');
  }
  if (!vercelCronConfigured) {
    errors.push('vercel.json: Must configure a valid 5-field cron schedule for `/api/cron/broadcasts`');
  }
  if (!vercelMd.includes('vercel.json')) {
    errors.push('docs/deployment/vercel.md: Must document root `vercel.json` cron schedule for `/api/cron/broadcasts`');
  }

  const hostingGuides = [
    'DEPLOYMENT.md',
    'docs/deployment/README.md',
    'docs/deployment/docker-vps.md',
    'docs/deployment/gcp-cloud-run.md',
    'docs/deployment/railway-render.md',
    'docs/deployment/vercel.md',
  ];
  for (const relPath of hostingGuides) {
    const content = runbookContents.get(relPath) ?? '';
    if (
      !content.includes('/api/registry/webhook/stripe') ||
      !content.includes('payment_intent.succeeded') ||
      !content.includes('STRIPE_WEBHOOK_SECRET')
    ) {
      errors.push(
        `${relPath}: Missing Stripe \`payment_intent.succeeded\` webhook setup (\`/api/registry/webhook/stripe\` & \`STRIPE_WEBHOOK_SECRET\`)`
      );
    }
    if (!content.includes('/api/cron/broadcasts') || !content.includes('CRON_SECRET')) {
      errors.push(`${relPath}: Missing scheduled broadcast cron instructions (\`/api/cron/broadcasts\` & \`CRON_SECRET\`)`);
    }
  }

  const forwardedIdx = configTsRaw.indexOf("'x-forwarded-host'");
  const hostIdx = configTsRaw.indexOf("headersList.get('host')");
  if (forwardedIdx === -1 || hostIdx === -1 || forwardedIdx > hostIdx) {
    errors.push("src/lib/config.ts: `getSubdomainFromHeaders` must check `'x-forwarded-host'` before `'host'`");
  }

  const prismaSchemaRaw = fs.readFileSync(path.join(repoRoot, 'prisma/schema.prisma'), 'utf8');
  const totalModels = (prismaSchemaRaw.match(/^model\s+[A-Za-z0-9_]+\s*\{/gm) ?? []).length;
  const sharedTableCount = Math.max(0, totalModels - 1);
  for (const relPath of runbookRelPaths) {
    const content = runbookContents.get(relPath) ?? '';
    if (!new RegExp(`\\b${sharedTableCount}\\s+tables\\b`).test(content) || !content.includes('AppConfig')) {
      errors.push(
        `${relPath}: Must state that \`prisma/schema.prisma\` shares ${sharedTableCount} tables across subdomains (\`MULTISITE_ENABLED\` switches \`AppConfig\` rows only)`
      );
    }
  }

  return errors;
}

function main(): void {
  const errors = verifyDeploymentRunbooks(process.cwd());
  if (errors.length > 0) {
    console.error('❌ Deployment runbook verification failed:');
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }
  console.log('✅ All deployment runbooks match live repository configurations and workflows.');
}

const isMain =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main();
}
