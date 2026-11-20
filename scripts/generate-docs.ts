import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ts from 'typescript';
import { AppConfigSchema, PublicAppConfigSchema } from '../src/features/content/schemas';
import {
  DEFAULT_MODULE_CONFIG,
  FEATURE_METADATA,
  type FeatureId,
  type FeatureMetadata,
} from '../src/lib/modules';
import { isProtectedRoute } from '../src/lib/routes';

const scriptDir = typeof __dirname !== 'undefined'
  ? __dirname
  : path.dirname(fileURLToPath(import.meta.url));

const ROOT_DIR = path.resolve(scriptDir, '..');

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const;

const API_GROUP_LABELS: Record<string, string> = {
  admin: 'Admin Routes',
  cron: 'Cron Routes',
  guest: 'Guest Routes',
  health: 'Health Check Routes',
  media: 'Media Routes',
  og: 'Open Graph Routes',
  photos: 'Photos Routes',
  ready: 'Readiness Probe Routes',
  registry: 'Registry Routes',
  rsvp: 'RSVP Routes',
  schedule: 'Schedule Routes',
  uploads: 'Uploads Routes',
  weather: 'Weather Routes',
};

function compareAscii(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// 1. Generate Configuration Markdown from Schema
export function getZodType(schema: any): string {
  if (!schema) return 'unknown';

  let s = schema;
  let depth = 0;
  while (s && depth < 20) {
    depth++;
    const t = s.type || s._def?.typeName;
    if (
      t === 'default' || t === 'ZodDefault' ||
      t === 'optional' || t === 'ZodOptional' ||
      t === 'exactOptional' || t === 'ZodExactOptional' ||
      t === 'nullable' || t === 'ZodNullable' ||
      t === 'prefault' || t === 'ZodPrefault' ||
      t === 'nonoptional' || t === 'ZodNonOptional' ||
      t === 'readonly' || t === 'ZodReadonly' ||
      t === 'catch' || t === 'ZodCatch' ||
      t === 'brand' || t === 'ZodBrand'
    ) {
      s = s.def?.innerType || s._def?.innerType || (typeof s.unwrap === 'function' ? s.unwrap() : undefined);
    } else if (t === 'effects' || t === 'ZodEffects') {
      s = s.def?.schema || s._def?.schema || s.def?.innerType || s._def?.innerType || (typeof s.unwrap === 'function' ? s.unwrap() : undefined);
    } else if (t === 'pipe' || t === 'pipeline' || t === 'ZodPipe' || t === 'ZodPipeline') {
      const out = s.def?.out || s._def?.out || s.out;
      if (out && (out.type === 'transform' || out._def?.typeName === 'ZodTransform')) {
        s = s.def?.in || s._def?.in || s.in;
      } else if (out) {
        s = out;
      } else {
        s = s.def?.in || s._def?.in || s.in;
      }
    } else {
      break;
    }
  }

  if (!s) return 'unknown';

  const t = s.type || s._def?.typeName;
  if (t === 'string' || t === 'ZodString') return 'string';
  if (t === 'number' || t === 'ZodNumber') return 'number';
  if (t === 'boolean' || t === 'ZodBoolean') return 'boolean';
  if (t === 'date' || t === 'ZodDate') return 'date';
  if (t === 'literal' || t === 'ZodLiteral') {
    const val = s.value !== undefined ? s.value : (s.def?.value ?? s._def?.value);
    return typeof val === 'string' ? `'${val}'` : String(val);
  }
  if (t === 'enum' || t === 'ZodEnum') {
    const values = s.options || s._def?.values || (s.def?.entries ? Object.keys(s.def.entries) : undefined) || (s.enum ? Object.keys(s.enum) : undefined);
    return values && values.length > 0 ? values.map((v: any) => typeof v === 'string' ? `'${v}'` : String(v)).join(' | ') : 'enum';
  }
  if (t === 'record' || t === 'ZodRecord') return 'record';
  if (t === 'union' || t === 'ZodUnion') {
    const options = s.options || s.def?.options || s._def?.options;
    return options?.map(getZodType).join(' | ') || 'union';
  }
  if (t === 'array' || t === 'ZodArray') {
    const element = s.element || s.def?.element || (typeof s.def?.type === 'object' ? s.def.type : undefined) || (typeof s._def?.type === 'object' ? s._def.type : undefined);
    return getZodType(element) + '[]';
  }
  if (t === 'object' || t === 'ZodObject') return 'object';
  if (t === 'any' || t === 'ZodAny' || t === 'transform' || t === 'ZodTransform') return 'any';
  if (t === 'unknown' || t === 'ZodUnknown') return 'unknown';

  return t || 'unknown';
}

export function getZodDescription(schema: any): string | undefined {
  if (!schema || typeof schema !== 'object') return undefined;

  const visited = new Set<object>();
  const queue: any[] = [schema];

  while (queue.length > 0 && visited.size < 40) {
    const s = queue.shift();
    if (!s || typeof s !== 'object' || visited.has(s)) continue;
    visited.add(s);

    const rawDesc =
      typeof s.description === 'string' && s.description.trim().length > 0
        ? s.description
        : typeof s.def?.description === 'string' && s.def.description.trim().length > 0
          ? s.def.description
          : typeof s._def?.description === 'string' && s._def.description.trim().length > 0
            ? s._def.description
            : undefined;

    if (rawDesc) {
      return rawDesc.trim();
    }

    let unwrapped: any;
    if (typeof s.unwrap === 'function') {
      try {
        unwrapped = s.unwrap();
      } catch {
        unwrapped = undefined;
      }
    }

    const nextCandidates = [
      s.def?.innerType,
      s._def?.innerType,
      s.def?.schema,
      s._def?.schema,
      s.def?.out,
      s._def?.out,
      s.out,
      s.def?.in,
      s._def?.in,
      s.in,
      unwrapped,
    ];

    for (const candidate of nextCandidates) {
      if (candidate && typeof candidate === 'object' && !visited.has(candidate)) {
        queue.push(candidate);
      }
    }
  }

  return undefined;
}

function getPrismaAppConfigColumns(): Set<string> {
  const prismaSchemaPath = path.join(ROOT_DIR, 'prisma/schema.prisma');
  const prismaSource = fs.readFileSync(prismaSchemaPath, 'utf8');
  const modelMatch = prismaSource.match(/model\s+AppConfig\s*\{([\s\S]*?)\n\}/);
  if (!modelMatch) {
    throw new Error('Failed to locate model AppConfig in prisma/schema.prisma');
  }

  const columns = new Set<string>();
  for (const rawLine of modelMatch[1].split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@@')) {
      continue;
    }
    const fieldMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+/);
    if (fieldMatch) {
      columns.add(fieldMatch[1]);
    }
  }

  return columns;
}

function getAdminDtoExposureMetadata(): {
  adminOnlyKeys: Set<string>;
  maskedSecrets: Map<string, string>;
} {
  const configPath = path.join(ROOT_DIR, 'src/lib/config.ts');
  const sourceText = fs.readFileSync(configPath, 'utf8');
  const sourceFile = ts.createSourceFile(configPath, sourceText, ts.ScriptTarget.Latest, true);

  const adminOnlyKeys = new Set<string>();
  const maskedSecrets = new Map<string, string>();

  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'toAdminAppConfig' && node.body) {
      for (const stmt of node.body.statements) {
        if (ts.isReturnStatement(stmt) && stmt.expression && ts.isObjectLiteralExpression(stmt.expression)) {
          for (const prop of stmt.expression.properties) {
            if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
              const propName = prop.name.text;
              const initText = prop.initializer.getText(sourceFile);
              const secretMatch = initText.match(/hasConfiguredSecret\(\s*[A-Za-z0-9_]+\.([A-Za-z0-9_]+)\s*\)/);
              if (secretMatch) {
                maskedSecrets.set(secretMatch[1], propName);
              } else {
                adminOnlyKeys.add(propName);
              }
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { adminOnlyKeys, maskedSecrets };
}

export function escapeMarkdownTableCell(value: string): string {
  return value.replace(/[\\|]/g, '\\$&');
}

export function generateConfigTable(schemaShape: Record<string, unknown> = AppConfigSchema.shape): string {
  const prismaColumns = getPrismaAppConfigColumns();
  const publicKeys = new Set(Object.keys(PublicAppConfigSchema.shape));
  const { adminOnlyKeys, maskedSecrets } = getAdminDtoExposureMetadata();

  let markdown = '| Field | Type | Storage | DTO Exposure | Description |\n|---|---|---|---|---|\n';

  for (const [key, value] of Object.entries(schemaShape)) {
    const type = escapeMarkdownTableCell(getZodType(value));
    const storage = prismaColumns.has(key) ? '`Prisma`' : '`Virtual DTO`';

    let dtoExposure: string;
    if (publicKeys.has(key)) {
      dtoExposure = '`Public`';
    } else if (maskedSecrets.has(key)) {
      dtoExposure = `\`Masked secret (${maskedSecrets.get(key)})\``;
    } else if (adminOnlyKeys.has(key)) {
      dtoExposure = '`Admin-only`';
    } else {
      dtoExposure = '`Server-only`';
    }

    const description = getZodDescription(value);
    if (!description) {
      throw new Error(`AppConfigSchema field "${key}" is missing .describe() metadata`);
    }
    const sanitizedDesc = escapeMarkdownTableCell(description).replace(/\r?\n/g, ' ').trim();

    markdown += `| \`${key}\` | \`${type}\` | ${storage} | ${dtoExposure} | ${sanitizedDesc} |\n`;
  }

  return markdown;
}

// 2. Generate Routing Structure
interface RouteNode {
  name: string;
  relativePath: string;
  hasPage: boolean;
  hasApi: boolean;
  children: RouteNode[];
}

function buildRouteTree(srcPath: string, relativePath: string = ''): RouteNode | null {
  const name = path.basename(srcPath);
  const entries = fs.readdirSync(srcPath, { withFileTypes: true })
    .sort((a, b) => compareAscii(a.name, b.name));

  let hasPage = false;
  let hasApi = false;
  const children: RouteNode[] = [];

  for (const entry of entries) {
    if (entry.isFile()) {
      if (/^page\.(tsx|ts|jsx|js)$/.test(entry.name)) {
        hasPage = true;
      }
      if (/^route\.(tsx|ts|jsx|js)$/.test(entry.name)) {
        hasApi = true;
      }
    } else if (entry.isDirectory()) {
      if (entry.name.includes('__tests__') || entry.name.includes('components')) {
        continue;
      }

      const childFullPath = path.join(srcPath, entry.name);
      const childRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name;
      const childNode = buildRouteTree(childFullPath, childRelativePath);

      if (childNode !== null) {
        children.push(childNode);
      }
    }
  }

  if (hasPage || hasApi || children.length > 0) {
    return {
      name: relativePath ? path.basename(relativePath) : name,
      relativePath,
      hasPage,
      hasApi,
      children,
    };
  }

  return null;
}

const MERMAID_CHAR_TOKENS: Record<string, string> = {
  '/': '__',
  '-': '_d_',
  '_': '_u_',
  '[': '_lb_',
  ']': '_rb_',
  '.': '_p_',
  '(': '_lp_',
  ')': '_rp_',
  '@': '_at_',
};

export function encodeRouteMermaidNodeId(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalized) {
    return 'App';
  }

  let encoded = 'node_';
  for (const ch of normalized) {
    if (/[A-Za-z0-9]/.test(ch)) {
      encoded += ch;
    } else if (Object.prototype.hasOwnProperty.call(MERMAID_CHAR_TOKENS, ch)) {
      encoded += MERMAID_CHAR_TOKENS[ch];
    } else {
      encoded += `_x${ch.codePointAt(0)!.toString(16)}_`;
    }
  }
  return encoded;
}

export function generateRoutesDiagram(srcAppPath: string = path.join(ROOT_DIR, 'src/app')): string {
  const tree = buildRouteTree(srcAppPath);

  let treeMarkdown = '```mermaid\nflowchart LR\n';
  treeMarkdown += '    classDef page fill:#0284c7,stroke:#0369a1,color:#ffffff,stroke-width:2px;\n';
  treeMarkdown += '    classDef api fill:#4c1d95,stroke:#3b82f6,color:#ffffff,stroke-width:2px;\n\n';

  if (!tree) {
    treeMarkdown += '    App["src/app"]\n```\n';
    return treeMarkdown;
  }

  const nodes = new Map<string, { id: string; name: string; type: 'page' | 'api' | 'none' }>();
  const edges: { from: string; to: string }[] = [];

  function traverse(node: RouteNode, parentId: string | null) {
    let id: string;
    let displayName = node.name;
    if (node.relativePath === '') {
      id = 'App';
      displayName = 'src/app';
    } else {
      id = encodeRouteMermaidNodeId(node.relativePath);
    }

    let type: 'page' | 'api' | 'none' = 'none';
    if (node.hasPage) type = 'page';
    else if (node.hasApi) type = 'api';

    nodes.set(id, { id, name: displayName, type });

    if (parentId) {
      edges.push({ from: parentId, to: id });
    }

    for (const child of node.children) {
      traverse(child, id);
    }
  }

  traverse(tree, null);

  for (const [id, info] of nodes.entries()) {
    treeMarkdown += `    ${id}["${info.name}"]\n`;
  }

  for (const edge of edges) {
    treeMarkdown += `    ${edge.from} --> ${edge.to}\n`;
  }

  for (const [id, info] of nodes.entries()) {
    if (info.type === 'page') {
      treeMarkdown += `    class ${id} page;\n`;
    } else if (info.type === 'api') {
      treeMarkdown += `    class ${id} api;\n`;
    }
  }

  treeMarkdown += '```\n';
  return treeMarkdown;
}

// 2b. Generate Grouped API Routes Specification
interface ApiRouteEntry {
  group: string;
  routePath: string;
  handlerPath: string;
  methods: string[];
  accessTier: string;
}

function collectApiRouteFiles(dirPath: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    .sort((a, b) => compareAscii(a.name, b.name));

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      results.push(...collectApiRouteFiles(fullPath));
    } else if (entry.isFile() && /^route\.(tsx|ts|jsx|js)$/.test(entry.name)) {
      results.push(fullPath);
    }
  }

  return results;
}

function extractExportedHttpMethods(filePath: string): string[] {
  const sourceText = fs.readFileSync(filePath, 'utf8');
  const scriptKind = filePath.endsWith('.tsx') || filePath.endsWith('.jsx')
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
  const found = new Set<string>();

  for (const stmt of sourceFile.statements) {
    const hasExport = ts.canHaveModifiers(stmt) &&
      ts.getModifiers(stmt)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

    if (hasExport && ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          found.add(decl.name.text);
        }
      }
    } else if (hasExport && ts.isFunctionDeclaration(stmt) && stmt.name) {
      found.add(stmt.name.text);
    } else if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      for (const element of stmt.exportClause.elements) {
        found.add(element.name.text);
      }
    }
  }

  return HTTP_METHODS.filter((method) => found.has(method));
}

interface MiddlewareApiExclusions {
  exact: Set<string>;
  prefixes: string[];
}

function getMiddlewarePublicApiExclusions(): MiddlewareApiExclusions {
  const middlewarePath = path.join(ROOT_DIR, 'src/middleware.ts');
  const source = fs.readFileSync(middlewarePath, 'utf8');
  const exact = new Set<string>();
  const prefixes: string[] = [];

  const exactRegex = /normalizedPath\s*===\s*'(\/api\/[^']+)'/g;
  let match: RegExpExecArray | null;
  while ((match = exactRegex.exec(source)) !== null) {
    if (match[1] !== '/api/cron') {
      exact.add(match[1]);
    }
  }

  const prefixRegex = /normalizedPath\.startsWith\(\s*'(\/api\/[^']+)'\s*\)/g;
  while ((match = prefixRegex.exec(source)) !== null) {
    if (match[1] !== '/api/' && match[1] !== '/api/cron/') {
      prefixes.push(match[1]);
    }
  }

  return { exact, prefixes };
}

function isMiddlewarePublicApiRoute(
  routePath: string,
  exclusions: MiddlewareApiExclusions,
): boolean {
  if (exclusions.exact.has(routePath)) {
    return true;
  }
  return exclusions.prefixes.some((prefix) => routePath.startsWith(prefix));
}

function resolveLocalModuleFile(fromFile: string, specifier: string): string | null {
  let baseResolved: string;
  if (specifier.startsWith('@/')) {
    baseResolved = path.join(ROOT_DIR, 'src', specifier.slice(2));
  } else if (specifier.startsWith('.')) {
    baseResolved = path.resolve(path.dirname(fromFile), specifier);
  } else {
    return null;
  }

  const candidates = [
    baseResolved,
    `${baseResolved}.ts`,
    `${baseResolved}.tsx`,
    path.join(baseResolved, 'index.ts'),
    path.join(baseResolved, 'index.tsx'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

function fileChecksStripeSignature(
  filePath: string,
  targetSymbols?: Set<string>,
  visited = new Set<string>(),
): boolean {
  const visitKey = `${filePath}::${targetSymbols ? Array.from(targetSymbols).sort().join(',') : '*'}`;
  if (visited.has(visitKey)) {
    return false;
  }
  visited.add(visitKey);

  const sourceText = fs.readFileSync(filePath, 'utf8');
  const sf = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);

  let hasReExports = false;
  for (const stmt of sf.statements) {
    if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
      hasReExports = true;
      const targetFile = resolveLocalModuleFile(filePath, stmt.moduleSpecifier.text);
      if (!targetFile) continue;

      if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        const nextSymbols = new Set<string>();
        for (const el of stmt.exportClause.elements) {
          const exportedName = el.name.text;
          const localName = el.propertyName ? el.propertyName.text : el.name.text;
          if (!targetSymbols || targetSymbols.has(exportedName)) {
            nextSymbols.add(localName);
          }
        }
        if (nextSymbols.size > 0 && fileChecksStripeSignature(targetFile, nextSymbols, visited)) {
          return true;
        }
      } else if (fileChecksStripeSignature(targetFile, targetSymbols, visited)) {
        return true;
      }
    } else if (ts.isImportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const targetFile = resolveLocalModuleFile(filePath, stmt.moduleSpecifier.text);
      if (!targetFile || !stmt.importClause?.namedBindings || !ts.isNamedImports(stmt.importClause.namedBindings)) {
        continue;
      }
      const nextSymbols = new Set<string>();
      for (const el of stmt.importClause.namedBindings.elements) {
        const importedLocal = el.name.text;
        const origName = el.propertyName ? el.propertyName.text : el.name.text;
        if (new RegExp(`\\b${importedLocal}\\b`).test(sourceText)) {
          nextSymbols.add(origName);
        }
      }
      if (nextSymbols.size > 0 && fileChecksStripeSignature(targetFile, nextSymbols, visited)) {
        return true;
      }
    }
  }

  if (!hasReExports && /headers\.get\(\s*['"]stripe-signature['"]\s*\)/.test(sourceText)) {
    return true;
  }

  return /headers\.get\(\s*['"]stripe-signature['"]\s*\)/.test(sourceText) && !filePath.endsWith('/index.ts');
}

function resolveRouteAccessTier(
  routePath: string,
  fullPath: string,
  methods: string[],
  publicApiExclusions: MiddlewareApiExclusions,
): string {
  if (routePath === '/api/cron' || routePath.startsWith('/api/cron/')) {
    return '`Bearer (CRON_SECRET)`';
  }

  const httpSymbolSet = new Set(methods);
  if (fileChecksStripeSignature(fullPath, httpSymbolSet)) {
    return '`stripeSignature (STRIPE_WEBHOOK_SECRET)`';
  }

  const tierMethods = new Map<string, string[]>();
  for (const method of methods) {
    let tier: string;
    if (isProtectedRoute(routePath, method)) {
      tier = 'Admin-only';
    } else if (isMiddlewarePublicApiRoute(routePath, publicApiExclusions)) {
      tier = 'Public';
    } else {
      tier = 'Guest / Admin';
    }
    const existing = tierMethods.get(tier) ?? [];
    existing.push(method);
    tierMethods.set(tier, existing);
  }

  if (tierMethods.size === 1) {
    const [onlyTier] = tierMethods.keys();
    return `\`${onlyTier}\``;
  }

  return Array.from(tierMethods.entries())
    .map(([tier, tierMeths]) => `\`${tier}\` (${tierMeths.map((m) => `\`${m}\``).join(', ')})`)
    .join('; ');
}

export function generateApiRoutesSection(): string {
  const apiRoot = path.join(ROOT_DIR, 'src/app/api');
  const routeFiles = collectApiRouteFiles(apiRoot);
  const publicApiExclusions = getMiddlewarePublicApiExclusions();

  const entries: ApiRouteEntry[] = routeFiles.map((fullPath) => {
    const relFromRoot = path.relative(ROOT_DIR, fullPath).replace(/\\/g, '/');
    const routePath = '/' + relFromRoot
      .replace(/^src\/app\//, '')
      .replace(/\/route\.(tsx|ts|jsx|js)$/, '');
    const segments = routePath.replace(/^\/api\//, '').split('/');
    const group = segments[0] || 'root';
    const methods = extractExportedHttpMethods(fullPath);
    const accessTier = resolveRouteAccessTier(routePath, fullPath, methods, publicApiExclusions);

    return {
      group,
      routePath,
      handlerPath: relFromRoot,
      methods,
      accessTier,
    };
  });

  entries.sort((a, b) => compareAscii(a.group, b.group) || compareAscii(a.routePath, b.routePath));

  const grouped = new Map<string, ApiRouteEntry[]>();
  for (const entry of entries) {
    const list = grouped.get(entry.group) ?? [];
    list.push(entry);
    grouped.set(entry.group, list);
  }

  const sections: string[] = [
    `Total API route handlers: **${entries.length}** across **${grouped.size}** route groups.`,
  ];

  for (const [group, groupEntries] of grouped.entries()) {
    const label = API_GROUP_LABELS[group] ?? `${group.charAt(0).toUpperCase() + group.slice(1)} Routes`;
    const countLabel = groupEntries.length === 1 ? '1 handler' : `${groupEntries.length} handlers`;
    let section = `#### ${label} (\`/api/${group}\` — ${countLabel})\n\n`;
    section += '| Route | Handler | Methods | Access Tier |\n|---|---|---|---|\n';
    for (const item of groupEntries) {
      const methodsStr = item.methods.map((m) => `\`${m}\``).join(', ');
      section += `| \`${item.routePath}\` | \`${item.handlerPath}\` | ${methodsStr} | ${item.accessTier} |\n`;
    }
    sections.push(section.trimEnd());
  }

  return sections.join('\n\n') + '\n';
}

// 3. Generate Environment Specs
export function generateEnvSpecs() {
  const pkgPath = path.join(ROOT_DIR, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  // We specify Node 22 as per requirements
  const nodeVersion = '22.x';

  return `- **Node.js**: v${nodeVersion}
- **Next.js**: ${pkg.dependencies.next}
- **React**: ${pkg.dependencies.react}
- **Prisma**: ${pkg.dependencies['@prisma/client'] || pkg.dependencies['@prisma/config'] || pkg.devDependencies['@prisma/client']}
- **Zod**: ${pkg.dependencies.zod}`;
}

// 4. Update ARCHITECTURE.md
export function updateArchitectureMd() {
  const filePath = path.join(ROOT_DIR, 'ARCHITECTURE.md');
  let content = fs.readFileSync(filePath, 'utf8');

  // Replace Env
  const envRegex = /<!-- BEGIN AUTOGENERATED ENV -->[\s\S]*?<!-- END AUTOGENERATED ENV -->/;
  content = content.replace(envRegex, `<!-- BEGIN AUTOGENERATED ENV -->\n${generateEnvSpecs()}\n<!-- END AUTOGENERATED ENV -->`);

  // Replace Routes Diagram
  const routesRegex = /<!-- BEGIN AUTOGENERATED ROUTES -->[\s\S]*?<!-- END AUTOGENERATED ROUTES -->/;
  content = content.replace(routesRegex, `<!-- BEGIN AUTOGENERATED ROUTES -->\n${generateRoutesDiagram()}\n<!-- END AUTOGENERATED ROUTES -->`);

  // Replace API Routes Inventory
  const apiRoutesRegex = /<!-- BEGIN AUTOGENERATED API_ROUTES -->[\s\S]*?<!-- END AUTOGENERATED API_ROUTES -->/;
  content = content.replace(apiRoutesRegex, `<!-- BEGIN AUTOGENERATED API_ROUTES -->\n${generateApiRoutesSection()}\n<!-- END AUTOGENERATED API_ROUTES -->`);

  // Replace Config
  const configRegex = /<!-- BEGIN AUTOGENERATED CONFIG -->[\s\S]*?<!-- END AUTOGENERATED CONFIG -->/;
  content = content.replace(configRegex, `<!-- BEGIN AUTOGENERATED CONFIG -->\n${generateConfigTable()}\n<!-- END AUTOGENERATED CONFIG -->`);

  fs.writeFileSync(filePath, content);
  console.log('Successfully updated ARCHITECTURE.md');
}

// 5. Generate FEATURE_MODULES.md Sections
interface FeatureRuntimeEnforcement {
  persistence: string;
  uiCoverage: string;
  apiCoverage: string;
}

const FEATURE_RUNTIME_ENFORCEMENT: Record<FeatureId, FeatureRuntimeEnforcement> = {
  registry: {
    persistence: '`Prisma` (`modules`)',
    uiCoverage:
      'Nav hidden; `/registry`, `/registry/add-item`, `/registry/edit-item/[id]` return HTTP 404 (`/admin/dashboard/registry` skips `isFeatureEnabled`)',
    apiCoverage:
      'HTTP 404 on `/api/registry/{items,items/[id],items/batch,capabilities,contribute,payment-intent,scrape/batch}`; skipped on `scrape`, `session`, `validate-code`, `webhook/stripe`, `/api/admin/[entity]`',
  },
  groupGifting: {
    persistence: '`Prisma` (`modules`)',
    uiCoverage: '`/registry` (group gift contribution UI)',
    apiCoverage: 'HTTP 400 on `POST /api/registry/contribute` & `POST /api/registry/payment-intent`',
  },
  weather: {
    persistence: '`Prisma` (`modules`)',
    uiCoverage: 'Nav hidden; `/weather` returns HTTP 404',
    apiCoverage: 'HTTP 404 on `GET /api/weather`',
  },
  weddingParty: {
    persistence: '`Prisma` (`modules`)',
    uiCoverage:
      'Nav hidden; `/wedding-party` returns HTTP 404 (`/admin/dashboard/wedding-party` skips `isFeatureEnabled`)',
    apiCoverage: 'Unchecked (`/api/admin/[entity]` with `wedding-party` skips `isFeatureEnabled`)',
  },
  attractions: {
    persistence: '`Prisma` (`modules`)',
    uiCoverage:
      'Nav hidden; `/things-to-do` returns HTTP 404 (`/admin/dashboard/attractions` skips `isFeatureEnabled`)',
    apiCoverage: 'Unchecked (`/api/admin/[entity]` with `attractions` skips `isFeatureEnabled`)',
  },
  gallery: {
    persistence: '`Prisma` (`modules`)',
    uiCoverage:
      'Nav + `/` link hidden; `/photos` & `/photos/slideshow` return HTTP 404 (`/admin/dashboard/media` skips `isFeatureEnabled`)',
    apiCoverage:
      'HTTP 404 on `/api/photos`, `/api/photos/upload`, `/api/guest/photos/upload`, `/api/media/*`, `/api/admin/photos/*`',
  },
  countdown: {
    persistence: '`Prisma` (`modules` + `showCountdown`)',
    uiCoverage: 'Homepage (`/`) widget (`config.showCountdown && isFeatureEnabled`)',
    apiCoverage: 'N/A',
  },
  addToCalendar: {
    persistence: '`Prisma` (`modules` + `showAddToCalendar`)',
    uiCoverage: 'Homepage (`/`) widget (`config.showAddToCalendar && isFeatureEnabled`)',
    apiCoverage: 'N/A (`GET /api/schedule/[id]/ics` skips `isFeatureEnabled`)',
  },
  interactive3D: {
    persistence: '`Prisma` (`modules`)',
    uiCoverage: 'Homepage (`/`) section hidden; `/heart` returns HTTP 404',
    apiCoverage: 'N/A',
  },
};

export function generateFeatureMetadataTable(
  metadata: Record<string, FeatureMetadata> = FEATURE_METADATA,
  defaults: Record<string, boolean> = DEFAULT_MODULE_CONFIG,
): string {
  let markdown =
    '| Feature Identifier | Title | Category | Default | Persistence | Dependencies | UI Route & Render Coverage | API Route Coverage | Description |\n' +
    '|---|---|---|---|---|---|---|---|---|\n';

  for (const [key, meta] of Object.entries(metadata)) {
    const defaultVal = defaults[key] ?? true;
    const enforcement = (FEATURE_RUNTIME_ENFORCEMENT as Record<string, FeatureRuntimeEnforcement | undefined>)[key] ?? {
      persistence: '`Virtual DTO`',
      uiCoverage: 'N/A',
      apiCoverage: 'N/A',
    };
    const deps =
      meta.dependencies && meta.dependencies.length > 0
        ? meta.dependencies.map((d) => `Requires \`${escapeMarkdownTableCell(d)}\``).join(', ')
        : 'None';

    const title = escapeMarkdownTableCell(meta.title.replace(/\r?\n/g, ' ').trim());
    const category = escapeMarkdownTableCell(meta.category);
    const persistence = escapeMarkdownTableCell(enforcement.persistence);
    const uiCoverage = escapeMarkdownTableCell(enforcement.uiCoverage);
    const apiCoverage = escapeMarkdownTableCell(enforcement.apiCoverage);
    const desc = escapeMarkdownTableCell(meta.description.replace(/\r?\n/g, ' ').trim());

    markdown +=
      `| \`${escapeMarkdownTableCell(key)}\` | ${title} | \`${category}\` | \`${defaultVal}\` | ${persistence} | ${deps} | ${uiCoverage} | ${apiCoverage} | ${desc} |\n`;
  }

  return markdown;
}

function hasExportModifier(node: ts.Node): boolean {
  return Boolean(
    ts.canHaveModifiers(node) &&
      ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword),
  );
}

function parseTsSourceFile(filePath: string): ts.SourceFile {
  const sourceText = fs.readFileSync(filePath, 'utf8');
  const scriptKind =
    filePath.endsWith('.tsx') || filePath.endsWith('.jsx')
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS;
  return ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
}

function resolveLocalTsModule(fromFile: string, specifier: string, rootDir: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) {
    base = path.join(rootDir, 'src', specifier.slice(2));
  } else if (specifier.startsWith('.')) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else {
    return null;
  }

  const strippedJs = base.replace(/\.(js|jsx|mjs|cjs)$/, '');
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${strippedJs}.ts`,
    `${strippedJs}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
}

function collectBindingNames(name: ts.BindingName, target: Set<string>) {
  if (ts.isIdentifier(name)) {
    target.add(name.text);
  } else if (ts.isObjectBindingPattern(name)) {
    for (const element of name.elements) {
      collectBindingNames(element.name, target);
    }
  } else if (ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) {
        collectBindingNames(element.name, target);
      }
    }
  }
}

function collectModuleExports(
  filePath: string,
  rootDir: string,
  visited: Set<string> = new Set(),
): { values: Set<string>; types: Set<string> } {
  const values = new Set<string>();
  const types = new Set<string>();

  if (visited.has(filePath) || !fs.existsSync(filePath)) {
    return { values, types };
  }

  const nextVisited = new Set(visited);
  nextVisited.add(filePath);

  const sourceFile = parseTsSourceFile(filePath);
  const localValues = new Set<string>();
  const localTypes = new Set<string>();

  for (const stmt of sourceFile.statements) {
    if (ts.isVariableStatement(stmt)) {
      const target = hasExportModifier(stmt) ? values : localValues;
      for (const decl of stmt.declarationList.declarations) {
        collectBindingNames(decl.name, target);
      }
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      (hasExportModifier(stmt) ? values : localValues).add(stmt.name.text);
    } else if (ts.isClassDeclaration(stmt) && stmt.name) {
      (hasExportModifier(stmt) ? values : localValues).add(stmt.name.text);
    } else if (ts.isEnumDeclaration(stmt)) {
      (hasExportModifier(stmt) ? values : localValues).add(stmt.name.text);
    } else if (ts.isInterfaceDeclaration(stmt)) {
      (hasExportModifier(stmt) ? types : localTypes).add(stmt.name.text);
    } else if (ts.isTypeAliasDeclaration(stmt)) {
      (hasExportModifier(stmt) ? types : localTypes).add(stmt.name.text);
    }
  }

  for (const stmt of sourceFile.statements) {
    if (!ts.isExportDeclaration(stmt)) continue;

    const moduleSpecifier =
      stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)
        ? stmt.moduleSpecifier.text
        : null;
    const resolvedTarget = moduleSpecifier
      ? resolveLocalTsModule(filePath, moduleSpecifier, rootDir)
      : null;

    if (!stmt.exportClause) {
      if (resolvedTarget) {
        const sub = collectModuleExports(resolvedTarget, rootDir, nextVisited);
        if (stmt.isTypeOnly) {
          for (const v of sub.values) types.add(v);
          for (const t of sub.types) types.add(t);
        } else {
          for (const v of sub.values) values.add(v);
          for (const t of sub.types) types.add(t);
        }
      }
    } else if (ts.isNamespaceExport(stmt.exportClause)) {
      if (stmt.isTypeOnly) {
        types.add(stmt.exportClause.name.text);
      } else {
        values.add(stmt.exportClause.name.text);
      }
    } else if (ts.isNamedExports(stmt.exportClause)) {
      const targetExports = resolvedTarget
        ? collectModuleExports(resolvedTarget, rootDir, nextVisited)
        : null;

      for (const el of stmt.exportClause.elements) {
        const exportedName = el.name.text;
        const origName = el.propertyName ? el.propertyName.text : el.name.text;

        if (stmt.isTypeOnly || el.isTypeOnly) {
          types.add(exportedName);
        } else if (origName === 'default') {
          values.add(exportedName);
        } else if (targetExports) {
          if (targetExports.values.has(origName)) {
            values.add(exportedName);
          } else if (targetExports.types.has(origName)) {
            types.add(exportedName);
          } else {
            values.add(exportedName);
          }
        } else if (localTypes.has(origName) && !localValues.has(origName)) {
          types.add(exportedName);
        } else {
          values.add(exportedName);
        }
      }
    }
  }

  for (const v of values) {
    types.delete(v);
  }

  return { values, types };
}

function findExportOriginFile(
  entryFile: string,
  symbolName: string,
  rootDir: string,
  visited: Set<string> = new Set(),
): { filePath: string; originalName: string } | null {
  if (visited.has(entryFile) || !fs.existsSync(entryFile)) {
    return null;
  }

  const nextVisited = new Set(visited);
  nextVisited.add(entryFile);

  const sourceFile = parseTsSourceFile(entryFile);

  for (const stmt of sourceFile.statements) {
    if (!hasExportModifier(stmt)) continue;
    if (
      (ts.isClassDeclaration(stmt) || ts.isFunctionDeclaration(stmt)) &&
      stmt.name?.text === symbolName
    ) {
      return { filePath: entryFile, originalName: symbolName };
    }
    if (ts.isVariableStatement(stmt)) {
      const names = new Set<string>();
      for (const decl of stmt.declarationList.declarations) {
        collectBindingNames(decl.name, names);
      }
      if (names.has(symbolName)) {
        return { filePath: entryFile, originalName: symbolName };
      }
    }
  }

  for (const stmt of sourceFile.statements) {
    if (!ts.isExportDeclaration(stmt) || !stmt.moduleSpecifier || !ts.isStringLiteral(stmt.moduleSpecifier)) {
      continue;
    }
    const resolvedTarget = resolveLocalTsModule(entryFile, stmt.moduleSpecifier.text, rootDir);
    if (!resolvedTarget) continue;

    if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      for (const el of stmt.exportClause.elements) {
        if (el.name.text === symbolName) {
          const origName = el.propertyName ? el.propertyName.text : el.name.text;
          return (
            findExportOriginFile(resolvedTarget, origName, rootDir, nextVisited) ?? {
              filePath: resolvedTarget,
              originalName: origName,
            }
          );
        }
      }
    } else if (!stmt.exportClause) {
      const found = findExportOriginFile(resolvedTarget, symbolName, rootDir, nextVisited);
      if (found) return found;
    }
  }

  return null;
}

function extractAdminServiceClassInfo(
  serviceFilePath: string,
  className: string,
): { entityKey: string | null; prismaModel: string } {
  const sourceFile = parseTsSourceFile(serviceFilePath);
  let entityKey: string | null = null;
  let prismaModel = 'N/A';

  for (const stmt of sourceFile.statements) {
    if (!ts.isClassDeclaration(stmt) || stmt.name?.text !== className) continue;

    for (const member of stmt.members) {
      if (
        ts.isPropertyDeclaration(member) &&
        ts.canHaveModifiers(member) &&
        ts.getModifiers(member)?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword) &&
        ts.isIdentifier(member.name) &&
        member.name.text === 'ENTITY_KEY' &&
        member.initializer &&
        (ts.isStringLiteral(member.initializer) || ts.isNoSubstitutionTemplateLiteral(member.initializer))
      ) {
        entityKey = member.initializer.text;
      }

      if (ts.isConstructorDeclaration(member) && member.body) {
        for (const bodyStmt of member.body.statements) {
          if (
            ts.isExpressionStatement(bodyStmt) &&
            ts.isCallExpression(bodyStmt.expression) &&
            bodyStmt.expression.expression.kind === ts.SyntaxKind.SuperKeyword
          ) {
            const modelArg = bodyStmt.expression.arguments[1];
            if (modelArg && (ts.isStringLiteral(modelArg) || ts.isNoSubstitutionTemplateLiteral(modelArg))) {
              prismaModel = modelArg.text;
            }
          }
        }
      }
    }
  }

  return { entityKey, prismaModel };
}

export function generateAdminEntityTable(rootDir: string = ROOT_DIR): string {
  const registryPath = path.join(rootDir, 'src/features/admin/registry.ts');
  if (!fs.existsSync(registryPath)) {
    throw new Error(`Admin entity registry not found at ${registryPath}`);
  }

  const sourceFile = parseTsSourceFile(registryPath);
  const importedSymbols = new Map<string, { specifier: string; importedName: string }>();

  function collectImports(node: ts.Node) {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings)
    ) {
      const specifier = node.moduleSpecifier.text;
      for (const el of node.importClause.namedBindings.elements) {
        importedSymbols.set(el.name.text, {
          specifier,
          importedName: el.propertyName ? el.propertyName.text : el.name.text,
        });
      }
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.initializer &&
      ts.isAwaitExpression(node.initializer) &&
      ts.isCallExpression(node.initializer.expression)
    ) {
      const callExpr = node.initializer.expression;
      const firstArg = callExpr.arguments[0];
      if (firstArg && ts.isArrayLiteralExpression(firstArg)) {
        node.name.elements.forEach((bindingEl, idx) => {
          const importCall = firstArg.elements[idx];
          if (
            !ts.isBindingElement(bindingEl) ||
            !ts.isObjectBindingPattern(bindingEl.name) ||
            !importCall ||
            !ts.isCallExpression(importCall) ||
            importCall.expression.kind !== ts.SyntaxKind.ImportKeyword
          ) {
            return;
          }
          const specArg = importCall.arguments[0];
          if (!specArg || !ts.isStringLiteral(specArg)) return;

          for (const propEl of bindingEl.name.elements) {
            if (ts.isIdentifier(propEl.name)) {
              const importedName =
                propEl.propertyName && ts.isIdentifier(propEl.propertyName)
                  ? propEl.propertyName.text
                  : propEl.name.text;
              importedSymbols.set(propEl.name.text, {
                specifier: specArg.text,
                importedName,
              });
            }
          }
        });
      }
    }

    ts.forEachChild(node, collectImports);
  }

  collectImports(sourceFile);

  let serviceMapLiteral: ts.ObjectLiteralExpression | null = null;
  function findServiceMap(node: ts.Node) {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) &&
      node.left.text === 'serviceMap' &&
      ts.isObjectLiteralExpression(node.right)
    ) {
      serviceMapLiteral = node.right;
      return;
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'serviceMap' &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      serviceMapLiteral = node.initializer;
      return;
    }
    ts.forEachChild(node, findServiceMap);
  }

  findServiceMap(sourceFile);

  if (!serviceMapLiteral) {
    throw new Error(`Failed to locate serviceMap object literal in ${registryPath}`);
  }

  const rows: {
    entityKey: string;
    serviceClass: string;
    barrelPath: string;
    prismaModel: string;
  }[] = [];

  for (const prop of (serviceMapLiteral as ts.ObjectLiteralExpression).properties) {
    if (!ts.isPropertyAssignment(prop)) continue;

    let serviceClass = '';
    if (ts.isNewExpression(prop.initializer) && ts.isIdentifier(prop.initializer.expression)) {
      serviceClass = prop.initializer.expression.text;
    }

    let directEntityKey: string | null = null;
    if (ts.isStringLiteral(prop.name) || ts.isNoSubstitutionTemplateLiteral(prop.name) || ts.isIdentifier(prop.name)) {
      directEntityKey = prop.name.text;
    } else if (
      ts.isComputedPropertyName(prop.name) &&
      ts.isPropertyAccessExpression(prop.name.expression) &&
      ts.isIdentifier(prop.name.expression.expression) &&
      prop.name.expression.name.text === 'ENTITY_KEY'
    ) {
      if (!serviceClass) {
        serviceClass = prop.name.expression.expression.text;
      }
    }

    const importInfo = serviceClass ? importedSymbols.get(serviceClass) : undefined;
    const barrelAbs = importInfo
      ? resolveLocalTsModule(registryPath, importInfo.specifier, rootDir)
      : null;
    const barrelRel = barrelAbs
      ? path.relative(rootDir, barrelAbs).replace(/\\/g, '/')
      : importInfo?.specifier ?? 'N/A';

    let entityKey = directEntityKey;
    let prismaModel = 'N/A';

    if (barrelAbs && importInfo) {
      const origin = findExportOriginFile(barrelAbs, importInfo.importedName, rootDir);
      if (origin) {
        const classInfo = extractAdminServiceClassInfo(origin.filePath, origin.originalName);
        if (!entityKey && classInfo.entityKey) {
          entityKey = classInfo.entityKey;
        }
        prismaModel = classInfo.prismaModel;
      }
    }

    if (!entityKey) {
      throw new Error(
        `Failed to resolve static ENTITY_KEY for "${serviceClass || prop.getText(sourceFile)}" in ${registryPath}`,
      );
    }

    rows.push({
      entityKey,
      serviceClass: serviceClass || 'UnknownService',
      barrelPath: barrelRel,
      prismaModel,
    });
  }

  let markdown =
    '| Entity Slug (`ENTITY_KEY`) | Admin Service Class | Feature Barrel | Prisma Model | Dynamic Endpoints |\n' +
    '|---|---|---|---|---|\n';

  for (const row of rows) {
    const slug = escapeMarkdownTableCell(row.entityKey);
    const cls = escapeMarkdownTableCell(row.serviceClass);
    const barrel = escapeMarkdownTableCell(row.barrelPath);
    const model = escapeMarkdownTableCell(row.prismaModel);
    markdown +=
      `| \`${slug}\` | \`${cls}\` | \`${barrel}\` | \`${model}\` | \`/api/admin/${slug}\`, \`/api/admin/${slug}/[id]\`, \`/api/admin/${slug}/batch\` |\n`;
  }

  return markdown;
}

export function generateFeatureBarrelsTable(rootDir: string = ROOT_DIR): string {
  const featuresDir = path.join(rootDir, 'src/features');
  if (!fs.existsSync(featuresDir)) {
    throw new Error(`Features directory not found at ${featuresDir}`);
  }

  const entries = fs
    .readdirSync(featuresDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .sort((a, b) => compareAscii(a.name, b.name));

  const modules: {
    domain: string;
    barrelRel: string;
    values: string[];
    types: string[];
  }[] = [];

  for (const entry of entries) {
    const barrelAbs = resolveLocalTsModule(
      path.join(featuresDir, 'index.ts'),
      `./${entry.name}`,
      rootDir,
    );
    if (!barrelAbs) continue;

    const { values, types } = collectModuleExports(barrelAbs, rootDir);
    const sortedValues = Array.from(values).sort(compareAscii);
    const sortedTypes = Array.from(types).sort(compareAscii);
    const barrelRel = path.relative(rootDir, barrelAbs).replace(/\\/g, '/');

    modules.push({
      domain: entry.name,
      barrelRel,
      values: sortedValues,
      types: sortedTypes,
    });
  }

  let markdown = `Total domain feature modules: **${modules.length}** under \`src/features/\`.\n\n`;
  markdown += '| Domain Module | Barrel Path | Runtime Exports | Type Exports |\n|---|---|---|---|\n';

  for (const mod of modules) {
    const valuesCell =
      mod.values.length > 0
        ? mod.values.map((v) => `\`${escapeMarkdownTableCell(v)}\``).join(', ')
        : '_None_';
    const typesCell =
      mod.types.length > 0
        ? mod.types.map((t) => `\`${escapeMarkdownTableCell(t)}\``).join(', ')
        : '_None_';

    markdown += `| \`${escapeMarkdownTableCell(mod.domain)}\` | \`${escapeMarkdownTableCell(mod.barrelRel)}\` | ${valuesCell} | ${typesCell} |\n`;
  }

  return markdown;
}

export function updateFeatureModulesMd(rootDir: string = ROOT_DIR) {
  const filePath = path.join(rootDir, 'FEATURE_MODULES.md');
  let content = fs.readFileSync(filePath, 'utf8');

  const metadataRegex =
    /<!-- BEGIN AUTOGENERATED FEATURE_METADATA -->[\s\S]*?<!-- END AUTOGENERATED FEATURE_METADATA -->/;
  const entitiesRegex =
    /<!-- BEGIN AUTOGENERATED ADMIN_ENTITIES -->[\s\S]*?<!-- END AUTOGENERATED ADMIN_ENTITIES -->/;
  const barrelsRegex =
    /<!-- BEGIN AUTOGENERATED FEATURE_BARRELS -->[\s\S]*?<!-- END AUTOGENERATED FEATURE_BARRELS -->/;

  if (!metadataRegex.test(content) || !entitiesRegex.test(content) || !barrelsRegex.test(content)) {
    throw new Error(
      'FEATURE_MODULES.md is missing one or more required AUTOGENERATED HTML marker blocks (FEATURE_METADATA, ADMIN_ENTITIES, FEATURE_BARRELS).',
    );
  }

  content = content.replace(
    metadataRegex,
    `<!-- BEGIN AUTOGENERATED FEATURE_METADATA -->\n${generateFeatureMetadataTable()}\n<!-- END AUTOGENERATED FEATURE_METADATA -->`,
  );
  content = content.replace(
    entitiesRegex,
    `<!-- BEGIN AUTOGENERATED ADMIN_ENTITIES -->\n${generateAdminEntityTable(rootDir)}\n<!-- END AUTOGENERATED ADMIN_ENTITIES -->`,
  );
  content = content.replace(
    barrelsRegex,
    `<!-- BEGIN AUTOGENERATED FEATURE_BARRELS -->\n${generateFeatureBarrelsTable(rootDir)}\n<!-- END AUTOGENERATED FEATURE_BARRELS -->`,
  );

  fs.writeFileSync(filePath, content);
  console.log('Successfully updated FEATURE_MODULES.md');
}

export async function generateOpenApiSpec() {
  const openApiScript = path.join(scriptDir, 'generate-openapi.ts');
  if (fs.existsSync(openApiScript)) {
    console.log('Generating OpenAPI specification...');
    await import('./generate-openapi.js');
  }
}

const isMain = typeof process.argv[1] === 'string' &&
               path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  updateArchitectureMd();
  updateFeatureModulesMd();
  void generateOpenApiSpec();
}
