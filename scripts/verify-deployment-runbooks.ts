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
        // Intentional container flag clearing an optional shadow URL (`-e POSTGRES_URL_NON_POOLING=""`)
        if (
          unquotedValue === '' &&
          envKey !== 'DATABASE_URL' &&
          /(?:^|\s)(?:-e|--env)(?:=|\s*)$/.test(prefixBeforeMatch)
        ) {
          continue;
        }
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
  appInit: boolean;
  appStopGracePeriod: string | null;
  appReadOnly: boolean;
  appCapDropAll: boolean;
  appNoNewPrivileges: boolean;
  appTmpfs: string[];
  appUploadsVolumeMounted: boolean;
  topLevelUploadsVolumeDeclared: boolean;
  topLevelVolumes: string[];
} {
  const lines = composeContent.split(/\r?\n/);
  const services: string[] = [];
  const topLevelVolumes: string[] = [];
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
  let appInit = false;
  let appStopGracePeriod: string | null = null;
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
      const volMatch = line.match(/^  ([a-zA-Z0-9_-]+):\s*(?:#.*)?$/);
      if (volMatch) {
        topLevelVolumes.push(volMatch[1]);
        if (volMatch[1] === 'uploads_data') {
          topLevelUploadsVolumeDeclared = true;
        }
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
        if (/^    init:\s*true\s*(?:#.*)?$/.test(line)) {
          appInit = true;
        }
        const stopGraceMatch = line.match(/^    stop_grace_period:\s*(.+?)\s*(?:#.*)?$/);
        if (stopGraceMatch) {
          appStopGracePeriod = stopGraceMatch[1].replace(/^["']|["']$/g, '').trim();
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
    appInit,
    appStopGracePeriod,
    appReadOnly,
    appCapDropAll,
    appNoNewPrivileges,
    appTmpfs,
    appUploadsVolumeMounted,
    topLevelUploadsVolumeDeclared,
    topLevelVolumes,
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

const BASELINE_0_1_0_LAST_MIGRATION = '20260930000000_neutral_partner_names';

const BASELINE_0_1_0_ENV_KEYS = new Set([
  'NODE_ENV',
  'DATABASE_URL',
  'POSTGRES_URL_NON_POOLING',
  'ADMIN_PASSWORD',
  'ALLOWED_HOSTS',
  'MULTISITE_ENABLED',
  'GUEST_PASSCODE',
  'HISTORY_VERSION_LIMIT',
  'S3_BUCKET',
  'S3_REGION',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_ENDPOINT',
  'S3_PUBLIC_URL',
]);

const BASELINE_0_1_0_MODELS = new Set([
  'AppConfig',
  'Media',
  'WeddingPartyMember',
  'Attraction',
  'RegistryItem',
  'Contributor',
  'InvitationCode',
  'ContentNode',
  'SnapshotVersion',
]);

function parsePrismaSchemaStats(schemaContent: string): {
  modelNames: string[];
  appConfigFieldCount: number;
} {
  const modelNames: string[] = [];
  let inAppConfig = false;
  let appConfigFieldCount = 0;

  for (const rawLine of schemaContent.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    const modelMatch = trimmed.match(/^model\s+([A-Za-z0-9_]+)\s*\{$/);
    if (modelMatch) {
      const name = modelMatch[1];
      modelNames.push(name);
      inAppConfig = name === 'AppConfig';
      continue;
    }
    if (inAppConfig) {
      if (trimmed === '}') {
        inAppConfig = false;
        continue;
      }
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@@')) {
        continue;
      }
      appConfigFieldCount += 1;
    }
  }

  return { modelNames, appConfigFieldCount };
}

function parseModuleConfigKeys(modulesContent: string): string[] {
  const sourceFile = ts.createSourceFile('modules.ts', modulesContent, ts.ScriptTarget.Latest, true);
  const keys: string[] = [];

  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(sourceFile) === 'ModuleConfigSchema' &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      node.initializer.arguments.length > 0 &&
      ts.isObjectLiteralExpression(node.initializer.arguments[0])
    ) {
      for (const prop of node.initializer.arguments[0].properties) {
        if (ts.isPropertyAssignment(prop)) {
          keys.push(prop.name.getText(sourceFile).replace(/^['"]|['"]$/g, ''));
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return keys;
}

function parseBackupSchemaVersion(exportRouteContent: string): string | null {
  const match = exportRouteContent.match(/\bBACKUP_SCHEMA_VERSION\s*=\s*['"]([^'"]+)['"]/);
  return match ? match[1] : null;
}

function listPrismaMigrations(migrationsDir: string): {
  allMigrations: string[];
  postBaselineMigrations: string[];
  latestMigration: string | null;
} {
  if (!fs.existsSync(migrationsDir)) {
    return { allMigrations: [], postBaselineMigrations: [], latestMigration: null };
  }
  const allMigrations = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const postBaselineMigrations = allMigrations.filter((name) => name > BASELINE_0_1_0_LAST_MIGRATION);
  const latestMigration =
    allMigrations.length > 0 ? allMigrations[allMigrations.length - 1] : null;

  return { allMigrations, postBaselineMigrations, latestMigration };
}

function extractPost010ChangelogSlice(changelogMd: string): {
  topReleaseHeading: string | null;
  topReleaseBody: string;
  post010Body: string;
  releaseCount: number;
} {
  const lines = changelogMd.split(/\r?\n/);
  let topReleaseHeading: string | null = null;
  const topLines: string[] = [];
  const post010Lines: string[] = [];
  let releaseIndex = 0;
  let reached010 = false;
  let inFence = false;

  for (const line of lines) {
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      inFence = !inFence;
    }
    if (!inFence && /^##\s+\[[^\]]+\]/.test(line)) {
      if (/^##\s+\[0\.1\.0\]/.test(line)) {
        reached010 = true;
        break;
      }
      releaseIndex += 1;
      if (releaseIndex === 1) {
        topReleaseHeading = line.trim();
      }
      post010Lines.push(line);
      continue;
    }
    if (releaseIndex >= 1 && !reached010) {
      post010Lines.push(line);
      if (releaseIndex === 1) {
        topLines.push(line);
      }
    }
  }

  return {
    topReleaseHeading,
    topReleaseBody: topLines.join('\n'),
    post010Body: post010Lines.join('\n'),
    releaseCount: releaseIndex,
  };
}

export function verifyDeploymentRunbooks(repoRoot: string = process.cwd()): string[] {
  const errors: string[] = [];

  const requiredFiles = [
    '.nvmrc',
    'package.json',
    'prisma.config.ts',
    'prisma/schema.prisma',
    'Dockerfile',
    'docker-entrypoint.sh',
    'docker-compose.yml',
    'docker-compose.ci.yml',
    'next.config.ts',
    'vercel.json',
    'src/env.ts',
    'src/lib/config.ts',
    'src/lib/prisma.ts',
    'src/lib/postgres-url.js',
    'src/lib/modules.ts',
    'src/utils/withApiMiddleware.ts',
    'src/middleware.ts',
    'src/app/api/uploads/[...path]/route.ts',
    'src/app/api/admin/maintenance/export/route.ts',
    'scripts/preflight-env.ts',
    'ARCHITECTURE.md',
    'CHANGELOG.md',
    'DEPLOYMENT.md',
    'docs/upgrading.md',
    'docs/versioning.md',
    'docs/runtime-contract.md',
    'docs/deployment/README.md',
    'docs/deployment/vercel.md',
    'docs/deployment/gcp-cloud-run.md',
    'docs/deployment/docker-vps.md',
    'docs/deployment/railway-render.md',
    'scripts/generate-docs.ts',
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

    const orderedSnippets = extractOrderedSnippets(content);
    for (const { text: snippetText } of orderedSnippets) {
      if (/\bgcloud\s+run\s+jobs\s+(?:create|update|deploy)\b/.test(snippetText)) {
        if (/--(?:command|entrypoint)(?:=|\s+)["']?(?:\/usr\/local\/bin\/)?npx["']?(?:\s|$)/.test(snippetText) || /--(?:command|entrypoint)(?:=|\s+)/.test(snippetText)) {
          errors.push(
            `${relPath}: Cloud Run job command \`${snippetText}\` must not override ENTRYPOINT with \`--command\` (e.g. \`--command="npx"\`); omit \`--command\` and pass \`--args="./node_modules/.bin/prisma,migrate,deploy"\` to preserve \`/usr/bin/tini\` and \`docker-entrypoint.sh\``
          );
        }
        if (
          /--args(?:=|\s+)["']?(?:npx,|prisma,migrate)/.test(snippetText) &&
          !snippetText.includes('./node_modules/.bin/prisma,migrate')
        ) {
          errors.push(
            `${relPath}: Cloud Run job command \`${snippetText}\` must pass \`--args="./node_modules/.bin/prisma,migrate,deploy"\` to invoke the isolated Prisma CLI offline`
          );
        }
      }

      if (
        prismaMajor >= 7 &&
        urlEnvKey &&
        shadowUrlEnvKey &&
        /\bdocker(?:\s+compose|-compose)\b[\s\S]*?\brun\b/.test(snippetText) &&
        new RegExp(`(?:^|[\\s"'])${urlEnvKey}=`).test(snippetText)
      ) {
        const guardsShadowEnv =
          new RegExp(`(?:env\\s+-u\\s+${shadowUrlEnvKey}|unset\\s+${shadowUrlEnvKey})`).test(
            snippetText
          ) ||
          new RegExp(
            `(?:-e|--env)(?:=|\\s+)${shadowUrlEnvKey}=(?:""|''|(?=\\s|$))`
          ).test(snippetText);
        if (!guardsShadowEnv) {
          errors.push(
            `${relPath}: \`${snippetText}\` overrides ${urlEnvKey} on \`docker compose run\` without unsetting or clearing ${shadowUrlEnvKey} (triggers Prisma 7 P3025 shadow database collision)`
          );
        }
      }
    }
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

    if (/\bgcloud\s+run\s+deploy\b/.test(line) && !/\bTRUST_PROXY=2\b/.test(line)) {
      errors.push(
        'docs/deployment/gcp-cloud-run.md: Manual `gcloud run deploy` command must set TRUST_PROXY=2 for two-hop Cloud Run ingress'
      );
    }
  }

  // Verify unescaped commas in gcloud --set-env-vars across all runbooks
  for (const [relPath, content] of runbookContents.entries()) {
    for (const line of extractFencedLogicalLines(content)) {
      if (!/\bgcloud\b/.test(line)) {
        continue;
      }
      const envVarsFlagRegex = /--(?:set|update)-env-vars(?:=|\s+)(?:"([^"]*)"|'([^']*)'|(\S+))/g;
      let envFlagMatch: RegExpExecArray | null;
      while ((envFlagMatch = envVarsFlagRegex.exec(line)) !== null) {
        const rawSpec = envFlagMatch[1] ?? envFlagMatch[2] ?? envFlagMatch[3] ?? '';
        let delimiter = ',';
        let body = rawSpec;
        const customDelimMatch = rawSpec.match(/^\^(.+?)\^(.*)$/);
        if (customDelimMatch) {
          delimiter = customDelimMatch[1];
          body = customDelimMatch[2];
        }
        const entries = body.split(delimiter).filter((item) => item.length > 0);
        const hasMalformedEntry =
          entries.length === 0 ||
          entries.some((entry) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(entry));
        if (hasMalformedEntry) {
          errors.push(
            `${relPath}: Unescaped delimiter/comma in gcloud \`--set-env-vars\` value "${rawSpec}" (use \`^|^KEY=VAL1,VAL2|...\` custom delimiter escaping)`
          );
        }
      }
    }
  }

  const gcpMigrateJobLines = gcpFencedLines.filter((line) =>
    /\bgcloud\s+run\s+jobs\s+(?:create|update)\s+wedding-migrate\b/.test(line)
  );
  if (gcpMigrateJobLines.length === 0) {
    errors.push(
      'docs/deployment/gcp-cloud-run.md: Missing `gcloud run jobs create wedding-migrate` secondary migration command'
    );
  }
  if (
    gcpMigrateJobLines.length === 0 ||
    !gcpMigrateJobLines.some((line) => line.includes('./node_modules/.bin/prisma,migrate,deploy'))
  ) {
    errors.push(
      'docs/deployment/gcp-cloud-run.md: Cloud Run migration job must pass `--args="./node_modules/.bin/prisma,migrate,deploy"` without `--command`'
    );
  }
  for (const jobLine of gcpMigrateJobLines) {
    if (!/--(?:set|add)-cloudsql-instances(?:=|\s+)\S+/.test(jobLine)) {
      errors.push(
        'docs/deployment/gcp-cloud-run.md: `wedding-migrate` Cloud Run Job must attach Cloud SQL via `--set-cloudsql-instances` (or `--add-cloudsql-instances`)'
      );
    }
  }

  for (const [relPath, content] of runbookContents.entries()) {
    const invalidProbeFlagMatches = content.match(/--(?:startup|liveness)-probe-[a-z0-9-]+/gi) ?? [];
    for (const invalidFlag of Array.from(new Set(invalidProbeFlagMatches))) {
      errors.push(
        `${relPath}: Invalid Cloud Run CLI flag "${invalidFlag}"; use composite \`--liveness-probe=httpGet.path=...,httpGet.port=...\` or Knative \`startupProbe\` / \`livenessProbe\` YAML blocks`
      );
    }
  }

  if (
    !gcpMd.includes('--liveness-probe=httpGet.path=/api/live,httpGet.port=3000,periodSeconds=30') ||
    !gcpMd.includes('startupProbe:') ||
    !gcpMd.includes('livenessProbe:') ||
    !gcpMd.includes('path: /api/health') ||
    !gcpMd.includes('path: /api/live')
  ) {
    errors.push(
      'docs/deployment/gcp-cloud-run.md: Must document `--liveness-probe=httpGet.path=/api/live,httpGet.port=3000,periodSeconds=30` and Knative `startupProbe` (`/api/health`) and `livenessProbe` (`/api/live`) YAML blocks'
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

  if (!composeContract.migrationDatabaseUrl?.startsWith('${CONTAINER_DATABASE_URL:-')) {
    errors.push(
      'docker-compose.yml: `migration` service must scope container `DATABASE_URL` overrides via `${CONTAINER_DATABASE_URL:-...}`'
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
  if (!composeContract.appEnvMap.get('DATABASE_URL')?.startsWith('${CONTAINER_DATABASE_URL:-')) {
    errors.push(
      'docker-compose.yml: `app` service must scope container `DATABASE_URL` overrides via `${CONTAINER_DATABASE_URL:-...}`'
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
  if (composeContract.appEnvMap.get('TRUST_PROXY') !== '${TRUST_PROXY:-1}') {
    errors.push(
      'docker-compose.yml: `app` service must set `TRUST_PROXY: ${TRUST_PROXY:-1}` by default'
    );
  }
  const rolloutComposePath = path.join(repoRoot, 'docker-compose.rollout.yml');
  if (fs.existsSync(rolloutComposePath)) {
    const rolloutComposeRaw = fs.readFileSync(rolloutComposePath, 'utf8');
    if (!/^\s*TRUST_PROXY:\s*\$\{TRUST_PROXY:-1\}\s*(?:#.*)?$/m.test(rolloutComposeRaw)) {
      errors.push(
        'docker-compose.rollout.yml: `app-standby` service must set `TRUST_PROXY: ${TRUST_PROXY:-1}` by default'
      );
    }
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
    for (const envVar of ['DB_USER', 'DB_PASSWORD', 'DB_NAME', 'DB_PORT', 'CONTAINER_DATABASE_URL']) {
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

  const dockerSection1 = extractSectionSlice(dockerMd, /^##\s+1\.\s+Database\b/, '## ');
  const dockerSection6 = extractSectionSlice(dockerMd, /^##\s+6\.\s+Build\s+&\s+Deploy\b/, '## ');
  for (const [secLabel, secContent] of [
    ['Section 1', dockerSection1],
    ['Section 6', dockerSection6],
  ] as const) {
    if (/^\s*(?:DATABASE_URL|POSTGRES_URL_NON_POOLING)=["']/m.test(secContent)) {
      errors.push(
        `docs/deployment/docker-vps.md (${secLabel}): Must not wrap \`.env\` DATABASE_URL / POSTGRES_URL_NON_POOLING values in quotes (breaks \`docker run --env-file\`)`
      );
    }
  }
  const dockerSection6FencedLines = extractFencedLogicalLines(dockerSection6);
  const hasHostNodeHashCmd = dockerSection6FencedLines.some(
    (line) =>
      line.includes('generate-password-hash.mjs') && !/\bdocker\b/.test(line)
  );
  const hasDockerHashCmd = dockerSection6FencedLines.some(
    (line) =>
      line.includes('generate-password-hash.mjs') && /\bdocker\b/.test(line)
  );
  if (hasHostNodeHashCmd || !hasDockerHashCmd) {
    errors.push(
      'docs/deployment/docker-vps.md (Section 6): Must generate `ADMIN_HASH` inside Docker (`docker run --rm ... node scripts/generate-password-hash.mjs ...`) without requiring host `node`'
    );
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
      if (!/(?:^|\s)--stop-timeout(?:=|\s+)15(?:\s|$)/.test(line)) {
        errors.push(
          `docs/deployment/docker-vps.md: Rollback \`docker run\` command must pass \`--stop-timeout 15\` matching stop_grace_period: \`${line}\``
        );
      }
      if (/\$\{DB_(?:USER|PASSWORD|NAME)\b/.test(line)) {
        errors.push(
          `docs/deployment/docker-vps.md: Rollback \`docker run\` command must not expand unset host \${DB_*} variables over \`--env-file .env\`: \`${line}\``
        );
      }
    }
  }

  // Verify Railway & Render PaaS runbook invariants (HOSTNAME=0.0.0.0, Pre-Deploy Command, Nixpacks devDependencies + postbuild, healthcheck.railway.app)
  const railwayRenderMd = runbookContents.get('docs/deployment/railway-render.md') ?? '';
  if (/\bRelease\s+Command\b/i.test(railwayRenderMd)) {
    errors.push(
      'docs/deployment/railway-render.md: References nonexistent Render "Release Command" (must use Render "Pre-Deploy Command")'
    );
  }
  if (!/\bPre-Deploy\s+Command\b/.test(railwayRenderMd)) {
    errors.push(
      'docs/deployment/railway-render.md: Must document Render `Pre-Deploy Command` for `npx prisma migrate deploy`'
    );
  }
  if (!/\|\s*`HOSTNAME`\s*\|/.test(railwayRenderMd) || !railwayRenderMd.includes('HOSTNAME=0.0.0.0')) {
    errors.push(
      'docs/deployment/railway-render.md: Must document `HOSTNAME` (`HOSTNAME=0.0.0.0`) in Section 2 and Nixpacks setup'
    );
  }
  const railwayBuildSection = extractSectionSlice(
    railwayRenderMd,
    /^##\s+6\.\s+Build\s+&\s+Deploy\b/,
    '## '
  );
  if (
    !railwayBuildSection.includes('npm ci --include=dev') ||
    !railwayBuildSection.includes('npm run postbuild')
  ) {
    errors.push(
      'docs/deployment/railway-render.md (Section 6): Railway Nixpacks instructions must include `npm ci --include=dev` and `npm run postbuild`'
    );
  }
  if (!railwayRenderMd.includes('healthcheck.railway.app')) {
    errors.push(
      'docs/deployment/railway-render.md: Must document `healthcheck.railway.app` probe host support'
    );
  }

  // Verify Section 4 Asset Storage lists all six S3_* keys across all four provider guides
  const providerGuides = [
    'docs/deployment/docker-vps.md',
    'docs/deployment/gcp-cloud-run.md',
    'docs/deployment/railway-render.md',
    'docs/deployment/vercel.md',
  ] as const;
  const requiredS3SectionKeys = [
    'S3_BUCKET',
    'S3_REGION',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
    'S3_ENDPOINT',
    'S3_PUBLIC_URL',
  ] as const;
  for (const guideRelPath of providerGuides) {
    const guideText = runbookContents.get(guideRelPath) ?? '';
    const assetSection = extractSectionSlice(guideText, /^##\s+4\.\s+Asset\s+Storage\b/, '## ');
    if (!assetSection) {
      errors.push(`${guideRelPath}: Missing "## 4. Asset Storage" section`);
      continue;
    }
    const missingS3Keys = requiredS3SectionKeys.filter((key) => !assetSection.includes(key));
    if (missingS3Keys.length > 0) {
      errors.push(
        `${guideRelPath} (Section 4): Missing S3 configuration keys: ${missingS3Keys.join(', ')}`
      );
    }
    if (!assetSection.includes('r2.cloudflarestorage.com') || !assetSection.includes('storage.googleapis.com')) {
      errors.push(
        `${guideRelPath} (Section 4): Must document both Cloudflare R2 (\`*.r2.cloudflarestorage.com\`) and Google Cloud Storage (\`https://storage.googleapis.com\`) S3_ENDPOINT examples`
      );
    }
  }

  // Verify HOSTNAME=0.0.0.0 and uploads_data:/app/public/uploads across Dockerfile, docker-compose.yml, and docs
  const dockerfileRaw = fs.readFileSync(path.join(repoRoot, 'Dockerfile'), 'utf8');
  const runtimeContractMd = runbookContents.get('docs/runtime-contract.md') ?? '';
  if (!/^ENV\s+HOSTNAME=(?:"0\.0\.0\.0"|'0\.0\.0\.0'|0\.0\.0\.0)\s*$/m.test(dockerfileRaw)) {
    errors.push('Dockerfile: Missing `ENV HOSTNAME="0.0.0.0"` in runner image');
  }
  if (!dockerfileRaw.includes('/usr/local/etc/npmrc') || !dockerfileRaw.includes('update-notifier=false')) {
    errors.push(
      'Dockerfile: Must write `update-notifier=false` to `/usr/local/etc/npmrc` to suppress npm update notices in Node global config'
    );
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
  if (extractSemverMajor(packageJson.engines?.node) !== expectedNodeMajor) {
    errors.push(
      `package.json: \`engines.node\` ("${packageJson.engines?.node ?? ''}") must target Node.js ${expectedNodeMajor} matching .nvmrc`
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

  const architectureMd = fs.readFileSync(path.join(repoRoot, 'ARCHITECTURE.md'), 'utf8');
  const staleArchitectureNodeRegex = new RegExp(
    `^-\\s+\\*\\*Node\\.js\\*\\*:\\s*v(?!${expectedNodeMajor}\\b)\\d+`,
    'm'
  );
  if (
    !architectureMd.includes(`- **Node.js**: v${expectedNodeMajor}.x`) ||
    staleArchitectureNodeRegex.test(architectureMd)
  ) {
    errors.push(
      `ARCHITECTURE.md: Must specify \`- **Node.js**: v${expectedNodeMajor}.x\` matching .nvmrc`
    );
  }

  const generateDocsRaw = fs.readFileSync(path.join(repoRoot, 'scripts/generate-docs.ts'), 'utf8');
  const generateEnvSpecsSection =
    generateDocsRaw.split('export function generateEnvSpecs')[1]?.split('// 4. Update ARCHITECTURE.md')[0] ?? '';
  const staleGenerateDocsNodeLiteralRegex = new RegExp(
    `['"\`]v?(?!${expectedNodeMajor}\\b)\\d+\\.x['"\`]`
  );
  if (
    !generateEnvSpecsSection ||
    !generateEnvSpecsSection.includes(`${expectedNodeMajor}.x`) ||
    staleGenerateDocsNodeLiteralRegex.test(generateEnvSpecsSection)
  ) {
    errors.push(
      `scripts/generate-docs.ts: \`generateEnvSpecs\` must specify Node.js \`${expectedNodeMajor}.x\` matching .nvmrc`
    );
  }

  // Verify npm packageManager lock (^10.9.0 & devEngines) and exact devEngines.runtime Node range (^22.12.0) across package.json and runbooks
  const expectedNodeRange = packageJson.devEngines?.runtime?.version ?? '^22.12.0';
  const expectedNpmRange = packageJson.engines?.npm ?? '^10.9.0';
  if (
    !packageJson.engines?.npm ||
    packageJson.devEngines?.runtime?.name !== 'node' ||
    packageJson.devEngines?.runtime?.onFail !== 'error' ||
    packageJson.devEngines?.packageManager?.name !== 'npm' ||
    packageJson.devEngines?.packageManager?.version !== packageJson.engines.npm ||
    packageJson.devEngines?.packageManager?.onFail !== 'error'
  ) {
    errors.push(
      'package.json: `engines.npm`, `devEngines.runtime`, and `devEngines.packageManager` (`onFail: "error"`) must lock Node (`^22.12.0`) and npm (`^10.9.0`)'
    );
  }
  for (const [docLabel, docContent] of [
    ['docs/runtime-contract.md', runtimeContractMd],
    ['DEPLOYMENT.md', deploymentMd],
    ['docs/deployment/README.md', deploymentOverviewMd],
    ['docs/deployment/docker-vps.md', dockerMd],
  ] as const) {
    if (!docContent.includes(expectedNodeRange) || !docContent.includes(expectedNpmRange) || !docContent.includes('devEngines')) {
      errors.push(
        `${docLabel}: Must document Node \`${expectedNodeRange}\` and \`npm\` \`${expectedNpmRange}\` (\`devEngines\` in \`package.json\`)`
      );
    }
  }

  // Verify PostgreSQL 15+ baseline and reject stale PostgreSQL 14 claims
  for (const [docLabel, docContent] of runbookContents.entries()) {
    if (/\bPostgreSQL\s+14\b/i.test(docContent)) {
      errors.push(`${docLabel}: References stale "PostgreSQL 14" instead of PostgreSQL 15+`);
    }
  }
  for (const [docLabel, docContent] of [
    ['docs/runtime-contract.md', runtimeContractMd],
    ['DEPLOYMENT.md', deploymentMd],
    ['docs/deployment/README.md', deploymentOverviewMd],
    ['docs/deployment/docker-vps.md', dockerMd],
  ] as const) {
    if (
      !/(?:PostgreSQL\s+(?:version\s+)?(?:\*\*)?15(?:\.0\b|\+|\s+or\s+higher\b)|postgres:15-alpine\b)/i.test(
        docContent
      )
    ) {
      errors.push(`${docLabel}: Must specify PostgreSQL 15+ minimum database requirement`);
    }
  }

  // Verify container layout (/opt/prisma-cli outside /app and /app/scripts/generate-password-hash.mjs), RUN_MIGRATIONS=1, and offline Compose migrations
  const entrypointRaw = fs.readFileSync(path.join(repoRoot, 'docker-entrypoint.sh'), 'utf8');
  if (
    !/\[\s*"\$RUN_MIGRATIONS"\s*=\s*"true"\s*\]/.test(entrypointRaw) ||
    !/\[\s*"\$RUN_MIGRATIONS"\s*=\s*"1"\s*\]/.test(entrypointRaw)
  ) {
    errors.push('docker-entrypoint.sh: Must accept both RUN_MIGRATIONS="true" and RUN_MIGRATIONS="1"');
  }
  if (!runtimeContractMd.includes('/opt/prisma-cli') || !/outside\s+`\/app`/i.test(runtimeContractMd)) {
    errors.push('docs/runtime-contract.md: Must state that Dockerfile installs `/opt/prisma-cli` outside `/app`');
  }
  if (!runtimeContractMd.includes('/app/scripts/generate-password-hash.mjs')) {
    errors.push(
      'docs/runtime-contract.md: Must state that Dockerfile copies `/app/scripts/generate-password-hash.mjs` rather than the entire `scripts` directory'
    );
  }
  if (
    /(?:\/opt\/prisma-cli[^.\n]*packaged under\s+`?\/app`?|packaged under\s+`?\/app`?[^.\n]*\/opt\/prisma-cli)/i.test(
      runtimeContractMd
    )
  ) {
    errors.push('docs/runtime-contract.md: Stale claim that `/opt/prisma-cli` is packaged under `/app`');
  }
  if (!runtimeContractMd.includes('RUN_MIGRATIONS=1')) {
    errors.push('docs/runtime-contract.md: Must document `RUN_MIGRATIONS=1` alongside `RUN_MIGRATIONS=true`');
  }
  for (const [docLabel, docContent] of [
    ['DEPLOYMENT.md', deploymentMd],
    ['docs/deployment/README.md', deploymentOverviewMd],
  ] as const) {
    if (!docContent.includes('./node_modules/.bin/prisma migrate deploy')) {
      errors.push(
        `${docLabel}: Must document offline \`./node_modules/.bin/prisma migrate deploy\` for the Docker Compose \`migration\` service`
      );
    }
    for (const line of docContent.split(/\r?\n/)) {
      if (
        /`?migration`?\s+(?:task\s+)?service\s+(?:runs|executes)\s+`npx\s+prisma\s+migrate\s+deploy`/i.test(
          line
        )
      ) {
        errors.push(
          `${docLabel}: Stale claim that Docker Compose \`migration\` service runs \`npx prisma migrate deploy\` instead of \`./node_modules/.bin/prisma migrate deploy\``
        );
      }
    }
  }

  // Verify /api/live liveness vs /api/health 503 field stripping & referenceId masking
  const apiMiddlewareRaw = fs.readFileSync(path.join(repoRoot, 'src/utils/withApiMiddleware.ts'), 'utf8');
  const healthProbeSection = extractSectionSlice(
    deploymentMd,
    /^##\s+Health Checks & Liveness Probes\b/,
    '## '
  );
  if (
    !healthProbeSection.includes('/api/live') ||
    /query\s+`?\/api\/health`?[^.\n]*for\s+liveness/i.test(deploymentMd)
  ) {
    errors.push(
      'DEPLOYMENT.md: Health Checks & Liveness Probes section must direct container liveness checks to `/api/live` rather than `/api/health`'
    );
  }
  if (apiMiddlewareRaw.includes('referenceId') && apiMiddlewareRaw.includes('response.status >= 400')) {
    for (const [docLabel, docContent] of [
      ['docs/runtime-contract.md', runtimeContractMd],
      ['DEPLOYMENT.md', deploymentMd],
      ['docs/deployment/docker-vps.md', dockerMd],
    ] as const) {
      if (
        !docContent.includes('referenceId') ||
        !/strip(?:s|ping)\s+`status`,\s*`database`,\s*and\s*`timestamp`/i.test(docContent)
      ) {
        errors.push(
          `${docLabel}: Must document that \`withApiMiddleware\` strips \`status\`, \`database\`, and \`timestamp\` from \`GET /api/health\` 503 responses and includes \`referenceId\` in production`
        );
      }
    }
  }

  // Verify Prisma pool timeout, shutdown drain timers (5000ms), exit codes (130/143), and stop_grace_period: 15s
  const prismaTsRaw = fs.readFileSync(path.join(repoRoot, 'src/lib/prisma.ts'), 'utf8');
  const postgresUrlRaw = fs.readFileSync(path.join(repoRoot, 'src/lib/postgres-url.js'), 'utf8');
  const connTimeoutMatch = postgresUrlRaw.match(/DEFAULT_POSTGRES_CONNECTION_TIMEOUT_MS\s*=\s*([0-9_]+)/);
  const expectedConnTimeoutMs = connTimeoutMatch
    ? Number(connTimeoutMatch[1].replace(/_/g, ''))
    : 10000;
  const drainTimerMatch = prismaTsRaw.match(/setTimeout\([\s\S]{0,120}?,\s*(\d+)\s*\)/);
  const expectedDrainTimerMs = drainTimerMatch ? Number(drainTimerMatch[1]) : 5000;

  if (!composeContract.appInit || composeContract.appStopGracePeriod !== '15s') {
    errors.push('docker-compose.yml: `app` service must configure `init: true` and `stop_grace_period: 15s`');
  }
  if (
    !runtimeContractMd.includes('globalThis') ||
    !runtimeContractMd.includes(`${expectedConnTimeoutMs}ms`) ||
    !runtimeContractMd.includes('process.exit') ||
    !runtimeContractMd.includes(`${expectedDrainTimerMs}ms`) ||
    !runtimeContractMd.includes('`130`') ||
    !runtimeContractMd.includes('`143`') ||
    !runtimeContractMd.includes('stop_grace_period: 15s')
  ) {
    errors.push(
      `docs/runtime-contract.md: Must document Prisma \`globalThis\` pool sharing, \`${expectedConnTimeoutMs}ms\` default connection timeout, \`process.exit\` interception, \`${expectedDrainTimerMs}ms\` drain timer, exit codes \`130\`/\`143\`, and \`stop_grace_period: 15s\``
    );
  }
  for (const [docLabel, docContent] of [
    ['DEPLOYMENT.md', deploymentMd],
    ['docs/deployment/README.md', deploymentOverviewMd],
    ['docs/deployment/docker-vps.md', dockerMd],
  ] as const) {
    if (!docContent.includes('stop_grace_period: 15s') || !docContent.includes('--stop-timeout 15')) {
      errors.push(`${docLabel}: Must document \`stop_grace_period: 15s\` and \`--stop-timeout 15\``);
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
      let jobHasSetupNode = false;
      let jobInvokesNodeRuntime = false;
      for (const stepItem of stepsNode.items) {
        if (!isMap(stepItem)) {
          continue;
        }
        const runNode: unknown = stepItem.get('run', true);
        if (
          isScalar(runNode) &&
          typeof runNode.value === 'string' &&
          /(?:^|\s|&&|\|\||;)(?:node|npm|npx)\s/.test(runNode.value)
        ) {
          jobInvokesNodeRuntime = true;
        }
        const usesNode: unknown = stepItem.get('uses', true);
        if (
          !isScalar(usesNode) ||
          typeof usesNode.value !== 'string' ||
          !usesNode.value.trim().startsWith('actions/setup-node@')
        ) {
          continue;
        }
        jobHasSetupNode = true;
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
      if (jobInvokesNodeRuntime && !jobHasSetupNode) {
        errors.push(
          `${wfRelPath} (job "${jobKey}"): Workflow job invokes node/npm/npx without \`actions/setup-node\` bound to \`.nvmrc\``
        );
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
  if (!hasDependabotMajorIgnore('docker-compose', 'postgres')) {
    errors.push(
      '.github/dependabot.yml: Missing `version-update:semver-major` ignore rule for `postgres` under `docker-compose` ecosystem'
    );
  }
  if (!hasDependabotMajorIgnore('npm', '@types/node')) {
    errors.push(
      '.github/dependabot.yml: Missing `version-update:semver-major` ignore rule for `@types/node` under `npm` ecosystem'
    );
  }

  // Verify PostgreSQL 15 parity across docker-compose.yml, .github/workflows/ci.yml, and runtime/deployment docs
  const expectedPostgresMajor = '15';
  const expectedPostgresImagePrefix = `postgres:${expectedPostgresMajor}-alpine@sha256:`;
  const mismatchedPostgresImageRegex = new RegExp(
    `\\bpostgres:(?!//|${expectedPostgresMajor}-alpine@sha256:[a-f0-9]{64}\\b)[A-Za-z0-9][A-Za-z0-9._@-]*`
  );
  if (
    !composeRaw.includes(expectedPostgresImagePrefix) ||
    mismatchedPostgresImageRegex.test(composeRaw)
  ) {
    errors.push(
      `docker-compose.yml: \`db\` service must pin \`postgres:${expectedPostgresMajor}-alpine@sha256:<64-hex>\` to preserve \`db_data\` volume compatibility`
    );
  }
  const ciDoc = parseDocument(ciWorkflowRaw, { version: '1.2' });
  const ciResolvesComposeDbImage =
    ciWorkflowRaw.includes('steps.resolve-db-image.outputs.db_image') &&
    ciWorkflowRaw.includes('docker-compose.yml') &&
    ciWorkflowRaw.includes('["services", "db", "image"]');
  const ciDbServiceImages: string[] = [];
  const ciJobsMap: unknown = isMap(ciDoc.contents) ? ciDoc.contents.get('jobs', true) : null;
  if (isMap(ciJobsMap)) {
    for (const jobPair of ciJobsMap.items) {
      const jobMap: unknown = jobPair.value;
      const servicesMap: unknown = isMap(jobMap) ? jobMap.get('services', true) : null;
      const dbServiceMap: unknown = isMap(servicesMap) ? servicesMap.get('db', true) : null;
      const dbImageNode: unknown = isMap(dbServiceMap) ? dbServiceMap.get('image', true) : null;
      if (isScalar(dbImageNode) && typeof dbImageNode.value === 'string') {
        ciDbServiceImages.push(dbImageNode.value.trim());
      }
    }
  }
  const exactPinnedPostgresRegex = new RegExp(
    `^postgres:${expectedPostgresMajor}-alpine@sha256:[a-f0-9]{64}$`
  );
  const allCiDbImagesValid =
    ciDbServiceImages.length > 0 &&
    ciDbServiceImages.every(
      (img) =>
        exactPinnedPostgresRegex.test(img) ||
        (img === '${{ needs.verify.outputs.db_image }}' && ciResolvesComposeDbImage)
    );
  if (!allCiDbImagesValid || mismatchedPostgresImageRegex.test(ciWorkflowRaw)) {
    errors.push(
      `.github/workflows/ci.yml: PostgreSQL service containers must pin \`postgres:${expectedPostgresMajor}-alpine@sha256:<64-hex>\` (or \`\${{ needs.verify.outputs.db_image }}\`) matching docker-compose.yml`
    );
  }
  if (
    !runtimeContractMd.includes(`PostgreSQL version **${expectedPostgresMajor}.0 or higher**`) ||
    !runtimeContractMd.includes(`PostgreSQL ${expectedPostgresMajor}-alpine`) ||
    new RegExp(`PostgreSQL\\s+(?!${expectedPostgresMajor}-alpine\\b)\\d+-alpine`).test(runtimeContractMd)
  ) {
    errors.push(
      `docs/runtime-contract.md: Must specify PostgreSQL ${expectedPostgresMajor}.0+ and \`PostgreSQL ${expectedPostgresMajor}-alpine\` matching docker-compose.yml`
    );
  }
  for (const [docLabel, docContent] of [
    ['DEPLOYMENT.md', deploymentMd],
    ['docs/deployment/README.md', deploymentOverviewMd],
  ] as const) {
    if (
      !docContent.includes(`PostgreSQL ${expectedPostgresMajor}+`) ||
      new RegExp(`\\bPostgreSQL\\s+(?!${expectedPostgresMajor}\\+)\\d+\\+`).test(docContent)
    ) {
      errors.push(
        `${docLabel}: Must specify \`PostgreSQL ${expectedPostgresMajor}+\` matching docker-compose.yml`
      );
    }
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

  // Verify container healthchecks call loopback /api/live directly without Host header overrides
  const forbiddenHealthcheckHostOverride = /fetch\([^\r\n]*\/api\/live[^\r\n]*headers\s*:\s*\{\s*Host\b/i;
  if (forbiddenHealthcheckHostOverride.test(dockerfileRaw)) {
    errors.push('Dockerfile: `HEALTHCHECK` on `/api/live` must not override `Host` header in `fetch()`');
  }
  if (composeRaw && forbiddenHealthcheckHostOverride.test(composeRaw)) {
    errors.push('docker-compose.yml: `app` `healthcheck` on `/api/live` must not override `Host` header in `fetch()`');
  }
  if (
    fs.existsSync(rolloutComposePath) &&
    forbiddenHealthcheckHostOverride.test(fs.readFileSync(rolloutComposePath, 'utf8'))
  ) {
    errors.push(
      'docker-compose.rollout.yml: `app-standby` `healthcheck` on `/api/live` must not override `Host` header in `fetch()`'
    );
  }
  if (forbiddenHealthcheckHostOverride.test(dockerMd)) {
    errors.push('docs/deployment/docker-vps.md: Documented `healthcheck` on `/api/live` must not override `Host` header in `fetch()`');
  }

  // Verify middleware probe syntax validation & webhook/uploads exclusions preserve ALLOWED_HOSTS check
  const middlewareRaw = fs.readFileSync(path.join(repoRoot, 'src/middleware.ts'), 'utf8');
  const hostCheckIdx = middlewareRaw.indexOf('!isHostAllowed(');
  const syntaxCheckIdx = middlewareRaw.indexOf('!isHostSyntaxValid(');
  const excludedGuardIdx = middlewareRaw.indexOf('const isExcluded');
  if (hostCheckIdx === -1 || excludedGuardIdx === -1 || hostCheckIdx > excludedGuardIdx) {
    errors.push('src/middleware.ts: `isHostAllowed` perimeter check must execute before `isExcluded` evaluation');
  }
  if (syntaxCheckIdx === -1 || syntaxCheckIdx > excludedGuardIdx) {
    errors.push('src/middleware.ts: `isHostSyntaxValid` probe perimeter check must execute before `isExcluded` evaluation');
  }
  if (
    !middlewareRaw.includes('isReadOnlyProbeRequest ? !isHostSyntaxValid(host) : !isHostAllowed(host)') ||
    !middlewareRaw.includes("method === 'GET' || method === 'HEAD'")
  ) {
    errors.push(
      'src/middleware.ts: Must validate `GET` and `HEAD` probes on `/api/live`, `/api/health`, and `/api/ready` with `isHostSyntaxValid` while enforcing `isHostAllowed` on all other requests'
    );
  }
  if (
    !runtimeContractMd.includes('startupProbe') ||
    !runtimeContractMd.includes('--liveness-probe') ||
    !runtimeContractMd.includes('healthcheck.railway.app')
  ) {
    errors.push(
      'docs/runtime-contract.md: Must document `startupProbe`, `--liveness-probe`, and `healthcheck.railway.app` probe host behavior'
    );
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

  for (const requiredCiJob of ['static-export-build', 'storybook-build', 'deploy-docs']) {
    if (ciJobIds.includes(requiredCiJob) && !deploymentMd.includes(requiredCiJob)) {
      errors.push(`DEPLOYMENT.md: Missing ci.yml job reference "${requiredCiJob}"`);
    }
  }

  // 4a. Verify ci.yml `verify` job npm scripts are documented in DEPLOYMENT.md (`verify` (`ci.yml`) overview)
  const storybookWorkflowRaw = fs.readFileSync(path.join(workflowsDir, 'storybook.yml'), 'utf8');
  const storybookDoc = parseDocument(storybookWorkflowRaw, { version: '1.2' });

  const extractJobSteps = (doc: ReturnType<typeof parseDocument>, jobId: string): unknown[] => {
    const jobsNode: unknown = isMap(doc.contents) ? doc.contents.get('jobs', true) : null;
    if (!isMap(jobsNode)) return [];
    const jobNode: unknown = jobsNode.get(jobId, true);
    if (!isMap(jobNode)) return [];
    const stepsNode: unknown = jobNode.get('steps', true);
    return isSeq(stepsNode) ? stepsNode.items : [];
  };

  const ciVerifyScripts: string[] = [];
  for (const stepItem of extractJobSteps(ciDoc, 'verify')) {
    if (!isMap(stepItem)) continue;
    const runNode: unknown = stepItem.get('run', true);
    if (!isScalar(runNode) || typeof runNode.value !== 'string') continue;
    const npmRunRegex = /\bnpm\s+run\s+([a-zA-Z0-9:_-]+)\b/g;
    let scriptMatch: RegExpExecArray | null;
    while ((scriptMatch = npmRunRegex.exec(runNode.value)) !== null) {
      const scriptName = scriptMatch[1];
      if (scriptName !== 'prisma:generate' && !ciVerifyScripts.includes(scriptName)) {
        ciVerifyScripts.push(scriptName);
      }
    }
  }

  const ciOverviewSection = extractSectionSlice(
    deploymentMd,
    /^###\s+1\.\s+Continuous Integration\b/,
    '### '
  );
  const verifyJobBulletLine =
    ciOverviewSection
      .split(/\r?\n/)
      .find((line) => /^\s*-\s+`verify`\s*\(`ci\.yml`\):/.test(line)) ?? '';
  if (!verifyJobBulletLine) {
    errors.push('DEPLOYMENT.md: Missing `- \`verify\` (\`ci.yml\`):` job bullet in Workflows Overview');
  } else {
    for (const verifyScript of ciVerifyScripts) {
      if (!verifyJobBulletLine.includes(verifyScript)) {
        errors.push(
          `DEPLOYMENT.md: \`verify\` (\`ci.yml\`) job overview omits CI verification script "${verifyScript}" from .github/workflows/ci.yml`
        );
      }
    }
  }

  // 4b. Verify storybook.yml `actions/cache` parity with ci.yml `storybook-build`
  const extractCacheConfig = (
    steps: unknown[]
  ): { uses: string; paths: string[]; key: string; restoreKeys: string[] } | null => {
    for (const stepItem of steps) {
      if (!isMap(stepItem)) continue;
      const usesNode: unknown = stepItem.get('uses', true);
      if (
        !isScalar(usesNode) ||
        typeof usesNode.value !== 'string' ||
        !usesNode.value.trim().startsWith('actions/cache@')
      ) {
        continue;
      }
      const withNode: unknown = stepItem.get('with', true);
      const pathNode: unknown = isMap(withNode) ? withNode.get('path', true) : undefined;
      const keyNode: unknown = isMap(withNode) ? withNode.get('key', true) : undefined;
      const restoreNode: unknown = isMap(withNode) ? withNode.get('restore-keys', true) : undefined;
      const rawPath = isScalar(pathNode) && typeof pathNode.value === 'string' ? pathNode.value : '';
      const rawKey = isScalar(keyNode) && typeof keyNode.value === 'string' ? keyNode.value.trim() : '';
      const rawRestore =
        isScalar(restoreNode) && typeof restoreNode.value === 'string' ? restoreNode.value : '';
      return {
        uses: usesNode.value.trim(),
        paths: rawPath
          .split(/\r?\n/)
          .map((p) => p.trim())
          .filter(Boolean),
        key: rawKey,
        restoreKeys: rawRestore
          .split(/\r?\n/)
          .map((k) => k.trim())
          .filter(Boolean),
      };
    }
    return null;
  };

  const ciStorybookCache = extractCacheConfig(extractJobSteps(ciDoc, 'storybook-build'));
  const standaloneStorybookCache = extractCacheConfig(extractJobSteps(storybookDoc, 'build'));
  if (!ciStorybookCache) {
    errors.push('.github/workflows/ci.yml: `storybook-build` job is missing `actions/cache` step');
  }
  if (!standaloneStorybookCache) {
    errors.push(
      '.github/workflows/storybook.yml: `build` job is missing `actions/cache` step matching .github/workflows/ci.yml `storybook-build`'
    );
  } else {
    for (const requiredCachePath of ['node_modules/.cache/webpack', 'node_modules/.cache/storybook']) {
      if (!standaloneStorybookCache.paths.includes(requiredCachePath)) {
        errors.push(
          `.github/workflows/storybook.yml: \`actions/cache\` must cache "${requiredCachePath}"`
        );
      }
    }
    if (
      ciStorybookCache &&
      (standaloneStorybookCache.uses !== ciStorybookCache.uses ||
        standaloneStorybookCache.paths.join('\n') !== ciStorybookCache.paths.join('\n') ||
        standaloneStorybookCache.key !== ciStorybookCache.key ||
        standaloneStorybookCache.restoreKeys.join('\n') !== ciStorybookCache.restoreKeys.join('\n'))
    ) {
      errors.push(
        '.github/workflows/storybook.yml: `actions/cache` configuration (`uses`, `path`, `key`, `restore-keys`) must match .github/workflows/ci.yml `storybook-build`'
      );
    }
  }

  // 4c. Verify deploy-provider.yml signed webhook wire contract is documented in DEPLOYMENT.md & docs/deployment/docker-vps.md
  const usesSignedWebhookAdapter =
    deployProviderRaw.includes('DEPLOY_WEBHOOK_URL') &&
    deployProviderRaw.includes('DEPLOY_WEBHOOK_SECRET') &&
    deployProviderRaw.includes('X-Hub-Signature-256') &&
    deployProviderRaw.includes('X-Deploy-Timestamp') &&
    deployProviderRaw.includes('X-Deploy-Signature-256');
  if (usesSignedWebhookAdapter) {
    for (const [docLabel, docText] of [
      ['DEPLOYMENT.md', deploymentMd],
      ['docs/deployment/docker-vps.md', dockerMd],
    ] as const) {
      for (const requiredToken of [
        'deploy-provider.yml',
        'docker-host',
        'generic-webhook',
        'DEPLOY_WEBHOOK_URL',
        'DEPLOY_WEBHOOK_SECRET',
        'X-Hub-Signature-256',
        'X-Deploy-Timestamp',
        'X-Deploy-Signature-256',
        'jq -n',
      ]) {
        if (!docText.includes(requiredToken)) {
          errors.push(
            `${docLabel}: Signed webhook adapter documentation is missing "${requiredToken}" from .github/workflows/deploy-provider.yml`
          );
        }
      }
      if (
        !(
          (docText.includes('"image"') &&
            docText.includes('"digest"') &&
            docText.includes('"environment"')) ||
          /\{\s*image\s*,\s*digest\s*,\s*environment\s*\}/.test(docText)
        )
      ) {
        errors.push(
          `${docLabel}: Must document the webhook POST JSON payload schema \`{image, digest, environment}\``
        );
      }
      if (!/\$\{X-Deploy-Timestamp\}\.\$\{PAYLOAD\}/.test(docText)) {
        errors.push(
          `${docLabel}: Must document timestamp-prefixed HMAC formula \`\${X-Deploy-Timestamp}.\${PAYLOAD}\` for \`X-Deploy-Signature-256\``
        );
      }
      if (!/raw[-\s]+(?:HTTP\s+)?(?:request\s+)?(?:body|bytes|buffer|PAYLOAD)/i.test(docText)) {
        errors.push(
          `${docLabel}: Must warn operators to verify webhook HMAC signatures over raw multi-line \`jq -n\` request bytes rather than re-serialized JSON`
        );
      }
    }
  }

  // 4d. Verify release_ref & image_digest promotion commit resolution alignment across deploy.yml, DEPLOYMENT.md, and gcp-cloud-run.md
  const deployDoc = parseDocument(deployWorkflowRaw, { version: '1.2' });
  const deployOnNode: unknown = isMap(deployDoc.contents) ? deployDoc.contents.get('on', true) : null;
  const hasTriggerInput = (triggerKey: string, inputKey: string): boolean => {
    if (!isMap(deployOnNode)) return false;
    const triggerNode: unknown = deployOnNode.get(triggerKey, true);
    if (!isMap(triggerNode)) return false;
    const inputsNode: unknown = triggerNode.get('inputs', true);
    return isMap(inputsNode) && inputsNode.has(inputKey);
  };
  if (
    !hasTriggerInput('workflow_dispatch', 'release_ref') ||
    !hasTriggerInput('workflow_call', 'release_ref')
  ) {
    errors.push(
      '.github/workflows/deploy.yml: Must define `release_ref` input on both `workflow_dispatch` and `workflow_call`'
    );
  }
  if (
    !deployWorkflowRaw.includes('RELEASE_REF: ${{ inputs.release_ref }}') ||
    !deployWorkflowRaw.includes('/commits/${RELEASE_REF}') ||
    !deployWorkflowRaw.includes('gh attestation verify')
  ) {
    errors.push(
      '.github/workflows/deploy.yml: `ci-gate` must resolve `target_sha` from `inputs.release_ref` and `inputs.image_digest` OIDC attestation'
    );
  }
  if (
    !/schema-compatibility:[\s\S]*?Align Workspace to Verified Commit SHA[\s\S]*?inputs\.release_ref != ''[\s\S]*?inputs\.image_digest != ''/.test(
      deployWorkflowRaw
    )
  ) {
    errors.push(
      '.github/workflows/deploy.yml: `schema-compatibility` must align checkout to `target_sha` when `release_ref` or `image_digest` is supplied'
    );
  }
  for (const [docLabel, docText] of [
    ['DEPLOYMENT.md', deploymentMd],
    ['docs/deployment/gcp-cloud-run.md', gcpMd],
  ] as const) {
    if (!docText.includes('release_ref') || !docText.includes('target_sha')) {
      errors.push(
        `${docLabel}: Must document \`release_ref\` and \`target_sha\` commit resolution for manual tag/digest promotions in \`deploy.yml\``
      );
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

  // 7. Release Notes (CHANGELOG.md), Downstream Upgrade Guide (docs/upgrading.md), & Env Preflight CLI Contract
  const changelogMd = fs.readFileSync(path.join(repoRoot, 'CHANGELOG.md'), 'utf8');
  const upgradingMd = fs.readFileSync(path.join(repoRoot, 'docs/upgrading.md'), 'utf8');
  const dockerEntrypointRaw = fs.readFileSync(path.join(repoRoot, 'docker-entrypoint.sh'), 'utf8');
  const modulesTsRaw = fs.readFileSync(path.join(repoRoot, 'src/lib/modules.ts'), 'utf8');
  const exportRouteRaw = fs.readFileSync(
    path.join(repoRoot, 'src/app/api/admin/maintenance/export/route.ts'),
    'utf8'
  );

  for (const [docLabel, docContent] of [
    ['CHANGELOG.md', changelogMd],
    ['docs/upgrading.md', upgradingMd],
  ] as const) {
    if (docContent.includes('scrypt:c2FsdA==:aGFzaA==')) {
      errors.push(
        `${docLabel}: Must not document invalid 4-byte placeholder hash "scrypt:c2FsdA==:aGFzaA==" (Remediation: Reference node scripts/generate-password-hash.mjs instead of placeholder hashes)`
      );
    }
    if (staleDocNodeLtsRegex.test(docContent) || staleDocNodeImageRegex.test(docContent)) {
      errors.push(
        `${docLabel}: References stale Node.js LTS major or container base image instead of Node.js v${expectedNodeMajor}.x LTS / node:${expectedNodeMajor}-bookworm-slim (Remediation: Align ${docLabel} with .nvmrc and Dockerfile)`
      );
    }
  }

  // Validate Prisma 7 CLI commands and PostgreSQL URIs inside docs/upgrading.md
  for (const cmd of extractPrismaMigrateCommands('docs/upgrading.md', upgradingMd)) {
    if (!VALID_MIGRATE_SUBCOMMANDS.has(cmd.subcommand)) {
      errors.push(
        `docs/upgrading.md: Invalid prisma migrate subcommand "${cmd.subcommand}" in \`${cmd.rawCommand}\` (Remediation: Use a valid Prisma ${prismaMajor} migrate subcommand)`
      );
      continue;
    }
    if (prismaMajor >= 7) {
      for (const flag of cmd.flags) {
        if (REMOVED_PRISMA_7_FLAGS.has(flag)) {
          errors.push(
            `docs/upgrading.md: Removed Prisma <7 flag "${flag}" used under Prisma ${prismaMajor}.x in \`${cmd.rawCommand}\` (Remediation: Replace removed Prisma 6 flags with Prisma 7 prisma.config.ts flags)`
          );
        } else {
          const allowedFlags = VALID_PRISMA_7_SUBCOMMAND_FLAGS[cmd.subcommand];
          if (allowedFlags && !allowedFlags.has(flag)) {
            errors.push(
              `docs/upgrading.md: Unsupported flag "${flag}" for "prisma migrate ${cmd.subcommand}" in \`${cmd.rawCommand}\``
            );
          }
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
          `docs/upgrading.md: \`${cmd.rawCommand}\` overrides ${urlEnvKey} from ${shadowUrlEnvKey} without \`env -u ${shadowUrlEnvKey}\` (Remediation: Unset ${shadowUrlEnvKey} when overriding ${urlEnvKey} for Prisma 7 CLI)`
        );
      }
    }
  }
  validateDocumentedPostgresUrlsInRunbook(
    'docs/upgrading.md',
    upgradingMd,
    [urlEnvKey ?? 'DATABASE_URL', shadowUrlEnvKey ?? 'POSTGRES_URL_NON_POOLING'],
    errors
  );

  // Verify package.json registers preflight:env CLI script
  if (
    !packageJson.scripts?.['preflight:env'] ||
    !packageJson.scripts['preflight:env'].includes('scripts/preflight-env.ts')
  ) {
    errors.push(
      'package.json: Missing `"preflight:env": "tsx scripts/preflight-env.ts"` npm script (Remediation: Register "preflight:env" in package.json scripts)'
    );
  }

  const { modelNames, appConfigFieldCount } = parsePrismaSchemaStats(prismaSchemaRaw);
  const post010Models = modelNames.filter((model) => !BASELINE_0_1_0_MODELS.has(model));
  const post010EnvKeys = envSchemaKeys.filter((key) => !BASELINE_0_1_0_ENV_KEYS.has(key));
  const moduleToggleKeys = parseModuleConfigKeys(modulesTsRaw);
  const backupSchemaVersion = parseBackupSchemaVersion(exportRouteRaw);
  const { allMigrations, postBaselineMigrations, latestMigration } = listPrismaMigrations(
    path.join(repoRoot, 'prisma/migrations')
  );
  const { topReleaseHeading, topReleaseBody, post010Body, releaseCount } =
    extractPost010ChangelogSlice(changelogMd);

  const hasPost010BreakingOrSchemaChanges =
    postBaselineMigrations.length > 0 ||
    post010EnvKeys.length > 0 ||
    composeContract.requiredVars.length > 0;

  if (!topReleaseHeading || !post010Body.trim()) {
    errors.push(
      'CHANGELOG.md: Missing post-0.1.0 release section (e.g., `## [Unreleased]`) above `## [0.1.0]` (Remediation: Add `## [Unreleased]` with Keep-a-Changelog categories per docs/versioning.md)'
    );
  } else {
    const adopterActionLineMatch = topReleaseBody.match(
      /^>\s*\*\*Adopter Action Required\*\*:\s*(Yes|No)\b.*$/m
    );
    if (!adopterActionLineMatch) {
      errors.push(
        `CHANGELOG.md (${topReleaseHeading}): Missing \`> **Adopter Action Required**: Yes|No\` callout (Remediation: Add the Adopter Action Required callout per docs/versioning.md)`
      );
    } else if (
      hasPost010BreakingOrSchemaChanges &&
      releaseCount === 1 &&
      adopterActionLineMatch[1] !== 'Yes'
    ) {
      errors.push(
        `CHANGELOG.md (${topReleaseHeading}): Sets \`Adopter Action Required: No\` despite ${postBaselineMigrations.length} post-0.1.0 migrations, ${post010EnvKeys.length} added envSchema keys, and ${composeContract.requiredVars.length} Docker Compose \`:?\` guards (Remediation: Set \`> **Adopter Action Required**: Yes\` and document operator migration steps in CHANGELOG.md)`
      );
    }

    for (const requiredHeading of [
      '### 🚀 Application Changes',
      '### 🗄️ Schema Changes',
      '### ⚙️ Configuration Changes',
      '### 🐳 Deployment & Infrastructure Changes',
      '### ⚠️ Breaking Changes & Migration Guide',
    ]) {
      if (!post010Body.includes(requiredHeading)) {
        errors.push(
          `CHANGELOG.md: Post-0.1.0 release notes missing required section "${requiredHeading}" (Remediation: Add "${requiredHeading}" per docs/versioning.md)`
        );
      }
    }

    const breakingSection = extractSectionSlice(
      post010Body,
      /^###\s+.*Breaking Changes & Migration Guide\b/,
      '### '
    );
    if (
      hasPost010BreakingOrSchemaChanges &&
      (!breakingSection.trim() || /^\s*-\s*None\.?\s*$/im.test(breakingSection.trim()))
    ) {
      errors.push(
        'CHANGELOG.md: "Breaking Changes & Migration Guide" cannot be empty or "- None." when post-0.1.0 schema/secret/Compose changes exist (Remediation: Provide step-by-step migration instructions in CHANGELOG.md)'
      );
    }

    if (postBaselineMigrations.length > 0) {
      if (
        !new RegExp(`\\b${postBaselineMigrations.length}\\b`).test(post010Body) ||
        !new RegExp(`\\b${allMigrations.length}\\s+migrations\\s+total\\b`, 'i').test(post010Body)
      ) {
        errors.push(
          `CHANGELOG.md: Migration count drift — prisma/migrations/ has ${postBaselineMigrations.length} post-0.1.0 migrations (${allMigrations.length} migrations total), which does not match CHANGELOG.md (Remediation: Update Schema Changes in CHANGELOG.md with the current migration counts)`
        );
      }
      if (latestMigration && !post010Body.includes(latestMigration)) {
        errors.push(
          `CHANGELOG.md: Latest Prisma migration "${latestMigration}" in prisma/migrations/ is not cited in post-0.1.0 release notes (Remediation: Document "${latestMigration}" and update migration counts in CHANGELOG.md)`
        );
      }
    }

    if (!new RegExp(`\\b${modelNames.length}\\s+models\\b`, 'i').test(post010Body)) {
      errors.push(
        `CHANGELOG.md: Schema model count drift — prisma/schema.prisma defines ${modelNames.length} models (Remediation: Update Schema Changes in CHANGELOG.md to reflect ${modelNames.length} models)`
      );
    }
    if (!new RegExp(`\\b${appConfigFieldCount}\\s+fields\\b`, 'i').test(post010Body)) {
      errors.push(
        `CHANGELOG.md: AppConfig field count drift — prisma/schema.prisma defines ${appConfigFieldCount} fields on AppConfig (Remediation: Update Schema Changes in CHANGELOG.md to reflect ${appConfigFieldCount} fields)`
      );
    }
    for (const modelName of post010Models) {
      if (!new RegExp(`\\b${modelName}\\b`).test(post010Body)) {
        errors.push(
          `CHANGELOG.md: Post-0.1.0 Prisma model "${modelName}" from prisma/schema.prisma is missing from release notes (Remediation: Document model "${modelName}" under Schema Changes in CHANGELOG.md)`
        );
      }
      if (!new RegExp(`\\b${modelName}\\b`).test(upgradingMd)) {
        errors.push(
          `docs/upgrading.md: Prisma model "${modelName}" from prisma/schema.prisma is missing from downstream upgrade/backup documentation (Remediation: Add "${modelName}" to docs/upgrading.md)`
        );
      }
    }

    for (const envKey of post010EnvKeys) {
      if (!new RegExp(`\\b${envKey}\\b`).test(post010Body)) {
        errors.push(
          `CHANGELOG.md: Added runtime environment variable "${envKey}" in src/env.ts is missing from post-0.1.0 Configuration Changes (Remediation: Document "${envKey}" in CHANGELOG.md)`
        );
      }
    }
    if (
      !post010Body.includes('scripts/generate-password-hash.mjs') ||
      !post010Body.includes('wedding2026') ||
      !/32\s+characters/i.test(post010Body)
    ) {
      errors.push(
        'CHANGELOG.md: Must document production secret validation rules (`scripts/generate-password-hash.mjs` 64-byte scrypt hash, rejected `wedding2026` passcode, and >= 32 characters `GUEST_SESSION_SECRET`) (Remediation: Update Configuration Changes in CHANGELOG.md)'
      );
    }

    if (
      moduleToggleKeys.length > 0 &&
      (!new RegExp(`\\b${moduleToggleKeys.length}\\s+feature\\s+toggles\\b`, 'i').test(post010Body) ||
        !moduleToggleKeys.every((toggle) => new RegExp(`\\b${toggle}\\b`).test(post010Body)) ||
        !post010Body.includes('guestPasscode'))
    ) {
      errors.push(
        `CHANGELOG.md: Module toggle contract drift with src/lib/modules.ts — must document all ${moduleToggleKeys.length} active ModuleConfigSchema toggles (${moduleToggleKeys.join(', ')}) and the retired \`guestPasscode\` toggle (Remediation: Reconcile CHANGELOG.md with src/lib/modules.ts)`
      );
    }
    if (
      moduleToggleKeys.length > 0 &&
      (!new RegExp(`\\b${moduleToggleKeys.length}\\s+feature\\s+toggles\\b`, 'i').test(upgradingMd) ||
        !moduleToggleKeys.every((toggle) => new RegExp(`\\b${toggle}\\b`).test(upgradingMd)))
    ) {
      errors.push(
        `docs/upgrading.md: Module toggle contract drift with src/lib/modules.ts — must list all ${moduleToggleKeys.length} active ModuleConfigSchema toggles (${moduleToggleKeys.join(', ')}) (Remediation: Reconcile Section 3 of docs/upgrading.md with src/lib/modules.ts)`
      );
    }

    if (backupSchemaVersion) {
      const expectedSchemaBadge = `schemaVersion: "${backupSchemaVersion}"`;
      if (
        !post010Body.includes(expectedSchemaBadge) ||
        !post010Body.includes('src/app/api/admin/maintenance/export/route.ts')
      ) {
        errors.push(
          `CHANGELOG.md: Backup schema version drift — src/app/api/admin/maintenance/export/route.ts sets BACKUP_SCHEMA_VERSION="${backupSchemaVersion}", so CHANGELOG.md must cite \`${expectedSchemaBadge}\` and \`src/app/api/admin/maintenance/export/route.ts\` (Remediation: Update CHANGELOG.md backup export notes)`
        );
      }
      if (!upgradingMd.includes(expectedSchemaBadge)) {
        errors.push(
          `docs/upgrading.md: Backup schema version drift — expected \`${expectedSchemaBadge}\` matching src/app/api/admin/maintenance/export/route.ts (Remediation: Update Backup & Restore instructions in docs/upgrading.md)`
        );
      }
    }

    for (const guardVar of composeContract.requiredVars) {
      if (!new RegExp(`\\b${guardVar}\\b`).test(post010Body)) {
        errors.push(
          `CHANGELOG.md: Docker Compose mandatory \`:?\` secret guard "${guardVar}" in docker-compose.yml is missing from post-0.1.0 release notes (Remediation: Document "${guardVar}" in CHANGELOG.md Deployment & Breaking Changes sections)`
        );
      }
      if (!new RegExp(`\\b${guardVar}\\b`).test(upgradingMd)) {
        errors.push(
          `docs/upgrading.md: Docker Compose mandatory \`:?\` secret guard "${guardVar}" in docker-compose.yml is missing from downstream upgrade guide (Remediation: Document "${guardVar}" in Step 7 / Compose preflight section of docs/upgrading.md)`
        );
      }
    }

    for (const volName of composeContract.topLevelVolumes) {
      if (!new RegExp(`\\b${volName}\\b`).test(post010Body)) {
        errors.push(
          `CHANGELOG.md: Persistent Docker Compose volume "${volName}" from docker-compose.yml is missing from post-0.1.0 release notes (Remediation: Document "${volName}" under Deployment & Infrastructure Changes in CHANGELOG.md)`
        );
      }
      if (!new RegExp(`\\b${volName}\\b`).test(upgradingMd)) {
        errors.push(
          `docs/upgrading.md: Persistent Docker Compose volume "${volName}" from docker-compose.yml is missing from downstream upgrade guide (Remediation: Document "${volName}" retention in docs/upgrading.md)`
        );
      }
    }
  }

  // Verify docs/upgrading.md covers Docker Compose, Standalone Docker, Host Node.js, Step 7 preflight CLI, volume retention, and rollbacks
  if (
    !dockerEntrypointRaw.includes('RUN_MIGRATIONS') ||
    !dockerEntrypointRaw.includes('prisma migrate deploy') ||
    !dockerfileRaw.includes('/opt/prisma-cli')
  ) {
    errors.push(
      'Dockerfile / docker-entrypoint.sh: Standalone container migration contract (`RUN_MIGRATIONS` -> `prisma migrate deploy` via `/opt/prisma-cli`) is missing (Remediation: Reconcile Dockerfile, docker-entrypoint.sh, and docs/upgrading.md)'
    );
  }

  const upgradingStep7 = extractSectionSlice(upgradingMd, /^###\s+Step\s+7\b/, '### ');
  if (
    !upgradingStep7 ||
    (!upgradingStep7.includes('scripts/preflight-env.ts') && !upgradingStep7.includes('preflight:env'))
  ) {
    errors.push(
      'docs/upgrading.md: Step 7 must invoke the local operator `.env` preflight CLI (`npm run preflight:env` / `npx tsx scripts/preflight-env.ts`) rather than relying only on `verify-env-docs.ts` (Remediation: Update Step 7 in docs/upgrading.md)'
    );
  }

  if (
    !upgradingMd.includes('docker compose up -d --build') ||
    !upgradingMd.includes('docker compose down -v') ||
    !upgradingMd.includes('/app/public/uploads')
  ) {
    errors.push(
      'docs/upgrading.md: Docker Compose upgrade track must document `docker compose up -d --build`, `/app/public/uploads` volume mounting, and warn against `docker compose down -v` (Remediation: Update Track A in docs/upgrading.md)'
    );
  }

  if (
    !upgradingMd.includes('RUN_MIGRATIONS=true') ||
    !upgradingMd.includes('docker-entrypoint.sh') ||
    !upgradingMd.includes('/opt/prisma-cli')
  ) {
    errors.push(
      'docs/upgrading.md: Standalone Docker upgrade track must document `RUN_MIGRATIONS=true` via `docker-entrypoint.sh` and `/opt/prisma-cli` (Remediation: Update Track B in docs/upgrading.md)'
    );
  }

  if (!upgradingMd.includes('npm run migrate:deploy') || !upgradingMd.includes('npm ci')) {
    errors.push(
      'docs/upgrading.md: Host Node.js upgrade track must document `npm ci` and `npm run migrate:deploy` (Remediation: Update Track C in docs/upgrading.md)'
    );
  }

  if (
    !upgradingMd.includes('wedding-website:previous') ||
    !upgradingMd.includes('docker tag wedding-website:latest wedding-website:previous') ||
    !upgradingMd.includes('docker compose up -d --no-deps app')
  ) {
    errors.push(
      'docs/upgrading.md: Must document `wedding-website:previous` pre-upgrade image tagging and `docker compose up -d --no-deps app` rollback aligned with docs/deployment/docker-vps.md (Remediation: Update Step 2 and Section 4 Rollback in docs/upgrading.md)'
    );
  }

  const upgradingRollbackSection = extractSectionSlice(upgradingMd, /^##\s+4\.\s+Rollback\b/, '## ');
  for (const line of extractFencedLogicalLines(upgradingRollbackSection)) {
    if (/\bdocker\s+run\b/.test(line)) {
      if (!/(?:^|\s)(?:-p\s|--publish(?:=|\s))/.test(line)) {
        errors.push(
          `docs/upgrading.md: Rollback \`docker run\` command lacks host port mapping (-p / --publish): \`${line}\` (Remediation: Bind 127.0.0.1:3000:3000 on rollback container)`
        );
      }
      if (!/(?:^|\s)--network(?:=|\s)/.test(line)) {
        errors.push(
          `docs/upgrading.md: Rollback \`docker run\` command lacks Compose network attachment (--network): \`${line}\` (Remediation: Attach --network wedding_website_default on rollback container)`
        );
      }
      if (/:latest(?:\s|$)/.test(line)) {
        errors.push(
          `docs/upgrading.md: Rollback \`docker run\` command must not deploy mutable :latest tag: \`${line}\` (Remediation: Deploy wedding-website:previous)`
        );
      }
      if (/\$\{DB_(?:USER|PASSWORD|NAME)\b/.test(line)) {
        errors.push(
          `docs/upgrading.md: Rollback \`docker run\` command must not expand unset host \${DB_*} variables over \`--env-file .env\`: \`${line}\` (Remediation: Load DATABASE_URL from --env-file .env)`
        );
      }
    }
  }

  return errors;
}

function main(): void {
  const errors = verifyDeploymentRunbooks(process.cwd());
  if (errors.length > 0) {
    console.error('❌ Deployment runbook & upgrade contract verification failed:');
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    console.error(`
================================================================================
ACTIONABLE REMEDIATION:
--------------------------------------------------------------------------------
Run "npm run check:runbooks" locally and reconcile drifted documentation or
runtime contracts across:
  - CHANGELOG.md & docs/upgrading.md (migrations, envSchema keys, ModuleConfigSchema
    toggles, BACKUP_SCHEMA_VERSION, Docker Compose ":?" guards & named volumes,
    and Step 7 "npm run preflight:env" instructions)
  - DEPLOYMENT.md, docs/runtime-contract.md, and docs/deployment/*.md
  - docker-compose.yml, docker-compose.ci.yml, Dockerfile, and .github/workflows/
================================================================================
`);
    process.exit(1);
  }
  console.log('✅ All deployment runbooks, CHANGELOG.md, and docs/upgrading.md match live repository contracts.');
}

const isMain =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main();
}
