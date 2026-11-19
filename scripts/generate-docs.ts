import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ts from 'typescript';
import { AppConfigSchema, PublicAppConfigSchema } from '../src/features/content/schemas';
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

export function generateConfigTable(): string {
  const shape = AppConfigSchema.shape;
  const prismaColumns = getPrismaAppConfigColumns();
  const publicKeys = new Set(Object.keys(PublicAppConfigSchema.shape));
  const { adminOnlyKeys, maskedSecrets } = getAdminDtoExposureMetadata();

  let markdown = '| Field | Type | Storage | DTO Exposure | Description |\n|---|---|---|---|---|\n';

  for (const [key, value] of Object.entries(shape)) {
    const type = getZodType(value).replace(/\|/g, '\\|');
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
    const sanitizedDesc = description.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();

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

export function generateRoutesDiagram(): string {
  const srcAppPath = path.join(ROOT_DIR, 'src/app');
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
      id = 'node_' + node.relativePath.replace(/\\/g, '/').split('/').join('_').replace(/\[|\]|-/g, '');
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

function getMiddlewarePublicApiExclusions(): Set<string> {
  const middlewarePath = path.join(ROOT_DIR, 'src/middleware.ts');
  const source = fs.readFileSync(middlewarePath, 'utf8');
  const excluded = new Set<string>();
  const regex = /normalizedPath\s*===\s*'(\/api\/[^']+)'/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    if (match[1] !== '/api/cron') {
      excluded.add(match[1]);
    }
  }
  return excluded;
}

function resolveRouteAccessTier(
  routePath: string,
  methods: string[],
  publicApiExclusions: Set<string>,
): string {
  if (routePath === '/api/cron' || routePath.startsWith('/api/cron/')) {
    return '`Bearer (CRON_SECRET)`';
  }

  const tierMethods = new Map<string, string[]>();
  for (const method of methods) {
    let tier: string;
    if (isProtectedRoute(routePath, method)) {
      tier = 'Admin-only';
    } else if (publicApiExclusions.has(routePath)) {
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
    const accessTier = resolveRouteAccessTier(routePath, methods, publicApiExclusions);

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
  void generateOpenApiSpec();
}
