import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ts from 'typescript';
import { AppConfigSchema, PublicAppConfigSchema } from '../src/features/content/schemas';
import {
  DEFAULT_MODULE_CONFIG,
  FEATURE_METADATA,
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

// Shared TypeScript AST & Module Resolution Helpers
const sourceFileCache = new Map<string, { mtimeMs: number; sf: ts.SourceFile }>();

export function hasExportModifier(node: ts.Node): boolean {
  return Boolean(
    ts.canHaveModifiers(node) &&
      ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword),
  );
}

export function parseTsSourceFile(filePath: string): ts.SourceFile {
  const stat = fs.statSync(filePath);
  const cached = sourceFileCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.sf;
  }
  const sourceText = fs.readFileSync(filePath, 'utf8');
  const scriptKind =
    filePath.endsWith('.tsx') || filePath.endsWith('.jsx')
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
  sourceFileCache.set(filePath, { mtimeMs: stat.mtimeMs, sf });
  return sf;
}

export function resolveLocalTsModule(fromFile: string, specifier: string, rootDir: string): string | null {
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

export function collectModuleExports(
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

export function findExportOriginFile(
  entryFile: string,
  symbolName: string,
  rootDir: string,
  visited: Set<string> = new Set(),
): { filePath: string; originalName: string } | null {
  const visitKey = `${entryFile}::${symbolName}`;
  if (visited.has(visitKey) || !fs.existsSync(entryFile)) {
    return null;
  }

  const nextVisited = new Set(visited);
  nextVisited.add(visitKey);

  const sourceFile = parseTsSourceFile(entryFile);
  const localImports = collectNamedImportsMap(sourceFile);

  for (const stmt of sourceFile.statements) {
    if (!hasExportModifier(stmt)) continue;
    if (
      (ts.isClassDeclaration(stmt) ||
        ts.isFunctionDeclaration(stmt) ||
        ts.isInterfaceDeclaration(stmt) ||
        ts.isTypeAliasDeclaration(stmt) ||
        ts.isEnumDeclaration(stmt)) &&
      stmt.name?.text === symbolName
    ) {
      return { filePath: entryFile, originalName: symbolName };
    }
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        const names = new Set<string>();
        collectBindingNames(decl.name, names);
        if (names.has(symbolName)) {
          if (ts.isIdentifier(decl.name) && decl.initializer && ts.isIdentifier(decl.initializer)) {
            const imported = localImports.get(decl.initializer.text);
            if (imported) {
              const target = resolveLocalTsModule(entryFile, imported.specifier, rootDir);
              if (target) {
                return (
                  findExportOriginFile(target, imported.importedName, rootDir, nextVisited) ?? {
                    filePath: target,
                    originalName: imported.importedName,
                  }
                );
              }
            }
          }
          return { filePath: entryFile, originalName: symbolName };
        }
      }
    }
  }

  for (const stmt of sourceFile.statements) {
    if (!ts.isExportDeclaration(stmt)) continue;

    if (stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
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
    } else if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      for (const el of stmt.exportClause.elements) {
        if (el.name.text === symbolName) {
          const localName = el.propertyName ? el.propertyName.text : el.name.text;
          const imported = localImports.get(localName);
          if (imported) {
            const target = resolveLocalTsModule(entryFile, imported.specifier, rootDir);
            if (target) {
              return (
                findExportOriginFile(target, imported.importedName, rootDir, nextVisited) ?? {
                  filePath: target,
                  originalName: imported.importedName,
                }
              );
            }
          }
          return { filePath: entryFile, originalName: localName };
        }
      }
    }
  }

  return null;
}

function collectNamedImportsMap(
  sourceFile: ts.SourceFile,
): Map<string, { specifier: string; importedName: string }> {
  const map = new Map<string, { specifier: string; importedName: string }>();
  for (const stmt of sourceFile.statements) {
    if (
      ts.isImportDeclaration(stmt) &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      stmt.importClause?.namedBindings &&
      ts.isNamedImports(stmt.importClause.namedBindings)
    ) {
      const specifier = stmt.moduleSpecifier.text;
      for (const el of stmt.importClause.namedBindings.elements) {
        map.set(el.name.text, {
          specifier,
          importedName: el.propertyName ? el.propertyName.text : el.name.text,
        });
      }
    }
  }
  return map;
}

function unwrapAstExpression(expr: ts.Expression): ts.Expression {
  let current = expr;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

// 2b. Generate Grouped API Routes Specification
export interface RouteFeatureCheck {
  featureId: string;
  status: number;
}

export interface ApiRouteEntry {
  group: string;
  routePath: string;
  handlerPath: string;
  methods: string[];
  accessTier: string;
  usesApiMiddleware: boolean;
  unwrappedMethods: string[];
  checksInviteSession: boolean;
  checksStripeSignature: boolean;
  edgeCookieBypassMethods: string[];
  featureChecksByMethod: Record<string, RouteFeatureCheck[]>;
  importsCalendarHelper: boolean;
}

function collectApiRouteFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
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

function extractExportedHttpMethods(filePath: string, rootDir: string): string[] {
  const { values } = collectModuleExports(filePath, rootDir);
  return HTTP_METHODS.filter((method) => values.has(method));
}

interface MiddlewareApiExclusions {
  exactAllMethods: Set<string>;
  exactByMethod: Map<string, Set<string>>;
  prefixes: string[];
}

function extractMiddlewareConditionExclusions(
  node: ts.Expression,
  exclusions: MiddlewareApiExclusions,
  scopedMethod?: string,
) {
  const expr = unwrapAstExpression(node);

  if (ts.isBinaryExpression(expr)) {
    if (expr.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      extractMiddlewareConditionExclusions(expr.left, exclusions, scopedMethod);
      extractMiddlewareConditionExclusions(expr.right, exclusions, scopedMethod);
      return;
    }

    if (expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      const methodMatch =
        extractEqualityLiteral(expr.left, 'method') ??
        extractEqualityLiteral(expr.right, 'method');
      extractMiddlewareConditionExclusions(expr.left, exclusions, methodMatch ?? scopedMethod);
      extractMiddlewareConditionExclusions(expr.right, exclusions, methodMatch ?? scopedMethod);
      return;
    }

    const exactPath = extractEqualityLiteral(expr, 'normalizedPath');
    if (exactPath && exactPath.startsWith('/api/') && exactPath !== '/api/cron') {
      if (scopedMethod) {
        const set = exclusions.exactByMethod.get(exactPath) ?? new Set<string>();
        set.add(scopedMethod);
        exclusions.exactByMethod.set(exactPath, set);
      } else {
        exclusions.exactAllMethods.add(exactPath);
      }
      return;
    }
  }

  if (
    ts.isCallExpression(expr) &&
    ts.isPropertyAccessExpression(expr.expression) &&
    ts.isIdentifier(expr.expression.expression) &&
    expr.expression.expression.text === 'normalizedPath' &&
    expr.expression.name.text === 'startsWith' &&
    expr.arguments.length > 0 &&
    ts.isStringLiteralLike(expr.arguments[0])
  ) {
    const prefix = expr.arguments[0].text;
    if (prefix.startsWith('/api/') && prefix !== '/api/' && prefix !== '/api/cron/') {
      exclusions.prefixes.push(prefix);
    }
  }
}

function extractEqualityLiteral(expr: ts.Expression, identName: string): string | null {
  const unwrapped = unwrapAstExpression(expr);
  if (
    !ts.isBinaryExpression(unwrapped) ||
    (unwrapped.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken &&
      unwrapped.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsToken)
  ) {
    return null;
  }
  const left = unwrapAstExpression(unwrapped.left);
  const right = unwrapAstExpression(unwrapped.right);
  if (ts.isIdentifier(left) && left.text === identName && ts.isStringLiteralLike(right)) {
    return right.text;
  }
  if (ts.isIdentifier(right) && right.text === identName && ts.isStringLiteralLike(left)) {
    return left.text;
  }
  return null;
}

function getMiddlewarePublicApiExclusions(rootDir: string): MiddlewareApiExclusions {
  const exclusions: MiddlewareApiExclusions = {
    exactAllMethods: new Set<string>(),
    exactByMethod: new Map<string, Set<string>>(),
    prefixes: [],
  };
  const middlewarePath = path.join(rootDir, 'src/middleware.ts');
  if (!fs.existsSync(middlewarePath)) {
    return exclusions;
  }

  const sf = parseTsSourceFile(middlewarePath);
  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'isExcluded' &&
      node.initializer
    ) {
      extractMiddlewareConditionExclusions(node.initializer, exclusions);
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);

  return exclusions;
}

function isMiddlewarePublicApiMethod(
  routePath: string,
  method: string,
  exclusions: MiddlewareApiExclusions,
): boolean {
  if (exclusions.exactAllMethods.has(routePath)) {
    return true;
  }
  if (exclusions.prefixes.some((prefix) => routePath.startsWith(prefix))) {
    return true;
  }
  const allowedMethods = exclusions.exactByMethod.get(routePath);
  return Boolean(allowedMethods && allowedMethods.has(method));
}

function findLocalDeclarationNode(sourceFile: ts.SourceFile, symbolName: string): ts.Node | null {
  for (const stmt of sourceFile.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === symbolName) {
      return stmt;
    }
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === symbolName) {
          return decl;
        }
      }
    }
  }
  return null;
}

function collectReachableNodesInFile(
  sourceFile: ts.SourceFile,
  rootNode: ts.Node,
): ts.Node[] {
  const nodes: ts.Node[] = [rootNode];
  const visitedLocals = new Set<string>();
  if (
    (ts.isFunctionDeclaration(rootNode) || ts.isVariableDeclaration(rootNode)) &&
    rootNode.name &&
    ts.isIdentifier(rootNode.name)
  ) {
    visitedLocals.add(rootNode.name.text);
  }

  function scanReferences(node: ts.Node) {
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const isDeclName =
        parent &&
        ((ts.isFunctionDeclaration(parent) && parent.name === node) ||
          (ts.isVariableDeclaration(parent) && parent.name === node) ||
          (ts.isParameter(parent) && parent.name === node) ||
          (ts.isPropertyAssignment(parent) && parent.name === node) ||
          (ts.isPropertyAccessExpression(parent) && parent.name === node));
      if (!isDeclName && !visitedLocals.has(node.text)) {
        visitedLocals.add(node.text);
        const localDecl = findLocalDeclarationNode(sourceFile, node.text);
        if (localDecl) {
          nodes.push(localDecl);
          scanReferences(localDecl);
        }
      }
    }
    ts.forEachChild(node, scanReferences);
  }

  scanReferences(rootNode);
  return nodes;
}

function expressionCallsApiMiddleware(
  expr: ts.Expression,
  filePath: string,
  sourceFile: ts.SourceFile,
  rootDir: string,
  visited = new Set<string>(),
): boolean {
  const unwrapped = unwrapAstExpression(expr);

  if (ts.isIdentifier(unwrapped)) {
    const localDecl = findLocalDeclarationNode(sourceFile, unwrapped.text);
    if (
      localDecl &&
      ts.isVariableDeclaration(localDecl) &&
      localDecl.initializer &&
      !visited.has(`${filePath}::local::${unwrapped.text}`)
    ) {
      const next = new Set(visited);
      next.add(`${filePath}::local::${unwrapped.text}`);
      return expressionCallsApiMiddleware(localDecl.initializer, filePath, sourceFile, rootDir, next);
    }
    return false;
  }

  if (!ts.isCallExpression(unwrapped)) {
    return false;
  }

  const callee = unwrapAstExpression(unwrapped.expression);
  if (ts.isIdentifier(callee)) {
    if (callee.text === 'withApiMiddleware') {
      return true;
    }

    const imports = collectNamedImportsMap(sourceFile);
    const imported = imports.get(callee.text);
    if (imported) {
      const targetFile = resolveLocalTsModule(filePath, imported.specifier, rootDir);
      const visitKey = `${targetFile}::${imported.importedName}`;
      if (targetFile && !visited.has(visitKey)) {
        const next = new Set(visited);
        next.add(visitKey);
        const origin = findExportOriginFile(targetFile, imported.importedName, rootDir) ?? {
          filePath: targetFile,
          originalName: imported.importedName,
        };
        const originSf = parseTsSourceFile(origin.filePath);
        const originDecl = findLocalDeclarationNode(originSf, origin.originalName);
        if (originDecl && nodeContainsIdentifierCall(originDecl, 'withApiMiddleware')) {
          return true;
        }
      }
    }
  }

  return unwrapped.arguments.some(
    (arg) => ts.isExpression(arg) && expressionCallsApiMiddleware(arg, filePath, sourceFile, rootDir, visited),
  );
}

function nodeContainsIdentifierCall(root: ts.Node, targetIdentifier: string): boolean {
  let found = false;
  function visit(node: ts.Node) {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const callee = unwrapAstExpression(node.expression);
      if (ts.isIdentifier(callee) && callee.text === targetIdentifier) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(root);
  return found;
}

function nodesCheckStripeSignature(nodes: ts.Node[]): boolean {
  let found = false;
  function visit(node: ts.Node) {
    if (found) return;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const propName = node.expression.name.text;
      if (
        propName === 'get' &&
        node.arguments.length > 0 &&
        ts.isStringLiteralLike(node.arguments[0]) &&
        node.arguments[0].text.toLowerCase() === 'stripe-signature'
      ) {
        found = true;
        return;
      }
      if (propName === 'constructEvent') {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  for (const n of nodes) {
    visit(n);
    if (found) return true;
  }
  return false;
}

function extractHttpStatusFromStatement(stmt: ts.Statement): number | null {
  let status: number | null = null;
  function visit(node: ts.Node) {
    if (status !== null) return;
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'ApiError' &&
      node.arguments &&
      node.arguments.length > 0 &&
      ts.isNumericLiteral(node.arguments[0])
    ) {
      status = Number(node.arguments[0].text);
      return;
    }
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && node.expression.text === 'notFound') {
        status = 404;
        return;
      }
      for (const arg of node.arguments) {
        if (ts.isObjectLiteralExpression(arg)) {
          for (const prop of arg.properties) {
            if (
              ts.isPropertyAssignment(prop) &&
              ts.isIdentifier(prop.name) &&
              prop.name.text === 'status' &&
              ts.isNumericLiteral(prop.initializer)
            ) {
              status = Number(prop.initializer.text);
              return;
            }
          }
        }
      }
    }
    if (ts.isNewExpression(node) && node.arguments) {
      for (const arg of node.arguments) {
        if (ts.isObjectLiteralExpression(arg)) {
          for (const prop of arg.properties) {
            if (
              ts.isPropertyAssignment(prop) &&
              ts.isIdentifier(prop.name) &&
              prop.name.text === 'status' &&
              ts.isNumericLiteral(prop.initializer)
            ) {
              status = Number(prop.initializer.text);
              return;
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(stmt);
  return status;
}

function conditionNegatesIdentifier(cond: ts.Expression, varName: string): boolean {
  const expr = unwrapAstExpression(cond);
  if (
    ts.isPrefixUnaryExpression(expr) &&
    expr.operator === ts.SyntaxKind.ExclamationToken
  ) {
    const operand = unwrapAstExpression(expr.operand);
    if (ts.isIdentifier(operand) && operand.text === varName) {
      return true;
    }
  }
  if (
    ts.isBinaryExpression(expr) &&
    expr.operatorToken.kind === ts.SyntaxKind.BarBarToken
  ) {
    return (
      conditionNegatesIdentifier(expr.left, varName) ||
      conditionNegatesIdentifier(expr.right, varName)
    );
  }
  return false;
}

function expressionReferencesAnyIdentifier(node: ts.Node, names: Set<string>): boolean {
  let found = false;
  function visit(n: ts.Node) {
    if (found) return;
    if (ts.isIdentifier(n) && names.has(n.text)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  }
  visit(node);
  return found;
}

function nodesRequireInviteSession(nodes: ts.Node[]): boolean {
  const sessionVars = new Set<string>();
  const fallbackAuthVars = new Set<string>(['isAdminRequest', 'isGuestRequest']);

  for (const root of nodes) {
    const collectVars = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        if (nodeContainsIdentifierCall(node.initializer, 'getGuestInviteSession')) {
          sessionVars.add(node.name.text);
        }
        if (
          nodeContainsIdentifierCall(node.initializer, 'isAdminRequest') ||
          nodeContainsIdentifierCall(node.initializer, 'isGuestRequest')
        ) {
          fallbackAuthVars.add(node.name.text);
        }
      }
      ts.forEachChild(node, collectVars);
    };
    collectVars(root);
  }

  if (sessionVars.size === 0) {
    return false;
  }

  let enforces401 = false;
  for (const root of nodes) {
    const checkGuards = (node: ts.Node) => {
      if (enforces401) return;
      if (ts.isIfStatement(node)) {
        const checksMissingSession = Array.from(sessionVars).some((v) =>
          conditionNegatesIdentifier(node.expression, v),
        );
        const hasFallback = expressionReferencesAnyIdentifier(node.expression, fallbackAuthVars);
        if (checksMissingSession && !hasFallback) {
          const status = extractHttpStatusFromStatement(node.thenStatement);
          if (status === 401) {
            enforces401 = true;
            return;
          }
        }
      }
      ts.forEachChild(node, checkGuards);
    };
    checkGuards(root);
  }

  return enforces401;
}

function extractFeatureChecksFromNodes(nodes: ts.Node[]): RouteFeatureCheck[] {
  const checks: RouteFeatureCheck[] = [];
  const seen = new Set<string>();

  for (const root of nodes) {
    const visit = (node: ts.Node) => {
      if (ts.isIfStatement(node)) {
        const featureId = extractNegatedIsFeatureEnabledCall(node.expression);
        if (featureId) {
          const status = extractHttpStatusFromStatement(node.thenStatement) ?? 404;
          const key = `${featureId}:${status}`;
          if (!seen.has(key)) {
            seen.add(key);
            checks.push({ featureId, status });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(root);
  }

  return checks;
}

function extractNegatedIsFeatureEnabledCall(expr: ts.Expression): string | null {
  const unwrapped = unwrapAstExpression(expr);
  if (
    ts.isPrefixUnaryExpression(unwrapped) &&
    unwrapped.operator === ts.SyntaxKind.ExclamationToken
  ) {
    const inner = unwrapAstExpression(unwrapped.operand);
    if (
      ts.isCallExpression(inner) &&
      ts.isIdentifier(inner.expression) &&
      inner.expression.text === 'isFeatureEnabled' &&
      inner.arguments.length > 0 &&
      ts.isStringLiteralLike(inner.arguments[0])
    ) {
      return inner.arguments[0].text;
    }
  }
  if (
    ts.isBinaryExpression(unwrapped) &&
    (unwrapped.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      unwrapped.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    return (
      extractNegatedIsFeatureEnabledCall(unwrapped.left) ??
      extractNegatedIsFeatureEnabledCall(unwrapped.right)
    );
  }
  return null;
}

interface MethodHandlerAnalysis {
  usesApiMiddleware: boolean;
  checksStripeSignature: boolean;
  requiresInviteSession: boolean;
  featureChecks: RouteFeatureCheck[];
  importsCalendarHelper: boolean;
}

function analyzeMethodHandler(
  routeFilePath: string,
  method: string,
  rootDir: string,
): MethodHandlerAnalysis {
  const origin = findExportOriginFile(routeFilePath, method, rootDir) ?? {
    filePath: routeFilePath,
    originalName: method,
  };
  const originSf = parseTsSourceFile(origin.filePath);
  const declNode = findLocalDeclarationNode(originSf, origin.originalName) ?? originSf;
  const reachableNodes = collectReachableNodesInFile(originSf, declNode);

  let usesApiMiddleware = false;
  if (ts.isVariableDeclaration(declNode) && declNode.initializer) {
    usesApiMiddleware = expressionCallsApiMiddleware(
      declNode.initializer,
      origin.filePath,
      originSf,
      rootDir,
    );
  }

  let importsCalendarHelper = false;
  for (const stmt of originSf.statements) {
    if (
      ts.isImportDeclaration(stmt) &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      (stmt.moduleSpecifier.text === '@/utils/calendar' ||
        stmt.moduleSpecifier.text.endsWith('/calendar'))
    ) {
      importsCalendarHelper = true;
      break;
    }
  }

  return {
    usesApiMiddleware,
    checksStripeSignature: nodesCheckStripeSignature(reachableNodes),
    requiresInviteSession: nodesRequireInviteSession(reachableNodes),
    featureChecks: extractFeatureChecksFromNodes(reachableNodes),
    importsCalendarHelper,
  };
}

function resolveRouteAccessTier(
  routePath: string,
  methods: string[],
  methodAnalyses: Record<string, MethodHandlerAnalysis>,
  publicApiExclusions: MiddlewareApiExclusions,
): string {
  if (routePath === '/api/cron' || routePath.startsWith('/api/cron/')) {
    return '`Bearer (CRON_SECRET)`';
  }

  if (methods.some((m) => methodAnalyses[m]?.checksStripeSignature)) {
    return '`stripeSignature (STRIPE_WEBHOOK_SECRET)`';
  }

  const tierMethods = new Map<string, string[]>();
  for (const method of methods) {
    const analysis = methodAnalyses[method];
    let tier: string;
    if (isProtectedRoute(routePath, method)) {
      tier = 'Admin-only';
    } else if (analysis?.requiresInviteSession) {
      tier = 'Invite-only';
    } else if (isMiddlewarePublicApiMethod(routePath, method, publicApiExclusions)) {
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

export function collectApiRouteEntries(rootDir: string = ROOT_DIR): ApiRouteEntry[] {
  const apiRoot = path.join(rootDir, 'src/app/api');
  const routeFiles = collectApiRouteFiles(apiRoot);
  const publicApiExclusions = getMiddlewarePublicApiExclusions(rootDir);

  const entries: ApiRouteEntry[] = routeFiles.map((fullPath) => {
    const relFromRoot = path.relative(rootDir, fullPath).replace(/\\/g, '/');
    const routePath = '/' + relFromRoot
      .replace(/^src\/app\//, '')
      .replace(/\/route\.(tsx|ts|jsx|js)$/, '');
    const segments = routePath.replace(/^\/api\//, '').split('/');
    const group = segments[0] || 'root';
    const methods = extractExportedHttpMethods(fullPath, rootDir);

    const methodAnalyses: Record<string, MethodHandlerAnalysis> = {};
    const featureChecksByMethod: Record<string, RouteFeatureCheck[]> = {};
    const unwrappedMethods: string[] = [];
    let checksInviteSession = false;
    let checksStripeSignature = false;
    let importsCalendarHelper = false;

    for (const method of methods) {
      const analysis = analyzeMethodHandler(fullPath, method, rootDir);
      methodAnalyses[method] = analysis;
      featureChecksByMethod[method] = analysis.featureChecks;
      if (!analysis.usesApiMiddleware) {
        unwrappedMethods.push(method);
      }
      if (analysis.requiresInviteSession) {
        checksInviteSession = true;
      }
      if (analysis.checksStripeSignature) {
        checksStripeSignature = true;
      }
      if (analysis.importsCalendarHelper) {
        importsCalendarHelper = true;
      }
    }

    const edgeCookieBypassMethods = HTTP_METHODS.filter((m) =>
      isMiddlewarePublicApiMethod(routePath, m, publicApiExclusions),
    );
    const accessTier = resolveRouteAccessTier(
      routePath,
      methods,
      methodAnalyses,
      publicApiExclusions,
    );

    return {
      group,
      routePath,
      handlerPath: relFromRoot,
      methods,
      accessTier,
      usesApiMiddleware: methods.length > 0 && unwrappedMethods.length === 0,
      unwrappedMethods,
      checksInviteSession,
      checksStripeSignature,
      edgeCookieBypassMethods,
      featureChecksByMethod,
      importsCalendarHelper,
    };
  });

  entries.sort((a, b) => compareAscii(a.group, b.group) || compareAscii(a.routePath, b.routePath));
  return entries;
}

export function generateApiRoutesSection(rootDir: string = ROOT_DIR): string {
  const entries = collectApiRouteEntries(rootDir);

  const grouped = new Map<string, ApiRouteEntry[]>();
  for (const entry of entries) {
    const list = grouped.get(entry.group) ?? [];
    list.push(entry);
    grouped.set(entry.group, list);
  }

  const wrappedCount = entries.filter((e) => e.usesApiMiddleware).length;
  const unwrappedEntries = entries.filter((e) => !e.usesApiMiddleware);
  const inviteOnlyEntries = entries.filter((e) => e.accessTier === '`Invite-only`');
  const stripeWebhookEntries = entries.filter((e) => e.checksStripeSignature);

  const summaryLines: string[] = [
    `Total API route handlers: **${entries.length}** across **${grouped.size}** route groups.`,
  ];

  const middlewareDetails: string[] = [];
  if (entries.length > 0) {
    const unwrappedSummary =
      unwrappedEntries.length > 0
        ? `**${unwrappedEntries.length}** unwrapped (${unwrappedEntries.map((e) => `\`${e.routePath}\``).join(', ')})`
        : '**0** unwrapped';
    middlewareDetails.push(
      `- **Middleware Wrapper (\`withApiMiddleware\`):** **${wrappedCount}** wrapped handlers; ${unwrappedSummary}.`,
    );
  }

  const gateNotes: string[] = [];
  if (inviteOnlyEntries.length > 0) {
    gateNotes.push(
      `\`Invite-only\` handlers (${inviteOnlyEntries.map((e) => `\`${e.routePath}\``).join(', ')}) require a verified \`guest_invite_session\` cookie via \`getGuestInviteSession\``,
    );
  }
  for (const webhook of stripeWebhookEntries) {
    if (webhook.edgeCookieBypassMethods.length === 0) {
      gateNotes.push(
        `\`${webhook.routePath}\` remains behind the Edge cookie gate in \`src/middleware.ts\` and enforces \`stripe-signature\` (\`STRIPE_WEBHOOK_SECRET\`) in the handler`,
      );
    } else if (webhook.edgeCookieBypassMethods.length < HTTP_METHODS.length) {
      const bypassed = webhook.edgeCookieBypassMethods.map((m) => `\`${m}\``).join(', ');
      gateNotes.push(
        `\`${webhook.routePath}\` bypasses the Edge cookie gate on ${bypassed} in \`src/middleware.ts\` (retaining Edge cookie enforcement on other methods) and verifies \`stripe-signature\` (\`STRIPE_WEBHOOK_SECRET\`) in the handler`,
      );
    } else {
      gateNotes.push(
        `\`${webhook.routePath}\` bypasses the Edge cookie gate in \`src/middleware.ts\` and verifies \`stripe-signature\` (\`STRIPE_WEBHOOK_SECRET\`) in the handler`,
      );
    }
  }
  if (gateNotes.length > 0) {
    middlewareDetails.push(`- **Handler Session & Webhook Gates:** ${gateNotes.join('; ')}.`);
  }

  const sections: string[] = [
    middlewareDetails.length > 0
      ? `${summaryLines.join('\n')}\n\n${middlewareDetails.join('\n')}`
      : summaryLines.join('\n'),
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
export interface FeatureRuntimeEnforcement {
  persistence: string;
  uiCoverage: string;
  apiCoverage: string;
}

export interface AdminEntityRow {
  entityKey: string;
  serviceClass: string;
  barrelPath: string;
  prismaModel: string;
}

function extractPrismaAppConfigFields(rootDir: string): Set<string> {
  const schemaPath = path.join(rootDir, 'prisma/schema.prisma');
  const fields = new Set<string>();
  if (!fs.existsSync(schemaPath)) {
    return fields;
  }
  const content = fs.readFileSync(schemaPath, 'utf8');
  const lines = content.split(/\r?\n/);
  let inAppConfig = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^model\s+AppConfig\s*\{/.test(line)) {
      inAppConfig = true;
      continue;
    }
    if (inAppConfig) {
      if (line.startsWith('}')) break;
      if (!line || line.startsWith('//') || line.startsWith('@@')) continue;
      const fieldMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s+/.exec(line);
      if (fieldMatch) {
        fields.add(fieldMatch[1]);
      }
    }
  }
  return fields;
}

function extractNavRouteFeatureMap(rootDir: string): {
  navGatedFeatures: Set<string>;
  navPathByFeature: Map<string, string>;
} {
  const navGatedFeatures = new Set<string>();
  const navPathByFeature = new Map<string, string>();
  const routesPath = path.join(rootDir, 'src/lib/routes.ts');
  if (!fs.existsSync(routesPath)) {
    return { navGatedFeatures, navPathByFeature };
  }

  const sf = parseTsSourceFile(routesPath);
  if (!nodeContainsIdentifierCall(sf, 'isFeatureEnabled')) {
    return { navGatedFeatures, navPathByFeature };
  }

  function visit(node: ts.Node) {
    if (ts.isObjectLiteralExpression(node)) {
      let navPath: string | null = null;
      let requiredModule: string | null = null;
      let showInNav = false;
      for (const prop of node.properties) {
        if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
        if (prop.name.text === 'path' && ts.isStringLiteralLike(prop.initializer)) {
          navPath = prop.initializer.text;
        } else if (prop.name.text === 'requiredModule' && ts.isStringLiteralLike(prop.initializer)) {
          requiredModule = prop.initializer.text;
        } else if (
          prop.name.text === 'showInNav' &&
          prop.initializer.kind === ts.SyntaxKind.TrueKeyword
        ) {
          showInNav = true;
        }
      }
      if (requiredModule && showInNav) {
        navGatedFeatures.add(requiredModule);
        if (navPath && !navPathByFeature.has(requiredModule)) {
          navPathByFeature.set(requiredModule, navPath);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);

  return { navGatedFeatures, navPathByFeature };
}

function extractAdminLayoutFeatureMap(rootDir: string): Map<string, string> {
  const adminHrefByFeature = new Map<string, string>();
  const layoutPath = path.join(rootDir, 'src/app/admin/dashboard/layout.tsx');
  if (!fs.existsSync(layoutPath)) {
    return adminHrefByFeature;
  }

  const sf = parseTsSourceFile(layoutPath);
  if (!nodeContainsIdentifierCall(sf, 'isFeatureEnabled')) {
    return adminHrefByFeature;
  }

  function visit(node: ts.Node) {
    if (ts.isObjectLiteralExpression(node)) {
      let href: string | null = null;
      let featureId: string | null = null;
      for (const prop of node.properties) {
        if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
        if (prop.name.text === 'href' && ts.isStringLiteralLike(prop.initializer)) {
          href = prop.initializer.text;
        } else if (prop.name.text === 'featureId' && ts.isStringLiteralLike(prop.initializer)) {
          featureId = prop.initializer.text;
        }
      }
      if (featureId && href) {
        adminHrefByFeature.set(featureId, href);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);

  return adminHrefByFeature;
}

function collectUiPageFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  const results: string[] = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    .sort((a, b) => compareAscii(a.name, b.name));

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'api' || entry.name === '__tests__') continue;
      results.push(...collectUiPageFiles(fullPath));
    } else if (entry.isFile() && /^page\.(tsx|ts|jsx|js)$/.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

function collectTsFilesInDir(dirPath: string, excludeApi = false): string[] {
  if (!fs.existsSync(dirPath)) return [];
  const results: string[] = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    .sort((a, b) => compareAscii(a.name, b.name));

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || (excludeApi && entry.name === 'api')) continue;
      results.push(...collectTsFilesInDir(fullPath, excludeApi));
    } else if (
      entry.isFile() &&
      /\.(tsx|ts)$/.test(entry.name) &&
      !/\.(test|spec|stories)\.(tsx|ts)$/.test(entry.name)
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

interface ComponentFeatureUsage {
  featureId: string;
  pairedConfigProp: string | null;
}

function extractIsFeatureEnabledCallsInComponent(sf: ts.SourceFile): ComponentFeatureUsage[] {
  const usages: ComponentFeatureUsage[] = [];
  const seen = new Set<string>();

  function findPairedConfigProp(callNode: ts.CallExpression): string | null {
    let cur: ts.Node = callNode;
    while (cur.parent) {
      const parent = cur.parent;
      if (
        ts.isBinaryExpression(parent) &&
        parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
      ) {
        const sibling = parent.left === cur ? parent.right : parent.left;
        const unwrappedSibling = unwrapAstExpression(sibling);
        if (
          ts.isPropertyAccessExpression(unwrappedSibling) &&
          ts.isIdentifier(unwrappedSibling.expression) &&
          unwrappedSibling.expression.text === 'config'
        ) {
          return unwrappedSibling.name.text;
        }
      }
      if (ts.isStatement(parent) || ts.isJsxExpression(parent)) {
        break;
      }
      cur = parent;
    }
    return null;
  }

  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'isFeatureEnabled' &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      const featureId = node.arguments[0].text;
      const pairedConfigProp = findPairedConfigProp(node);
      const key = `${featureId}:${pairedConfigProp ?? ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        usages.push({ featureId, pairedConfigProp });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return usages;
}

export function extractFeatureRuntimeEnforcement(
  rootDir: string = ROOT_DIR,
  metadata: Record<string, FeatureMetadata> = FEATURE_METADATA,
): Record<string, FeatureRuntimeEnforcement> {
  const prismaFields = extractPrismaAppConfigFields(rootDir);
  const { navGatedFeatures, navPathByFeature } = extractNavRouteFeatureMap(rootDir);
  const adminHrefByFeature = extractAdminLayoutFeatureMap(rootDir);
  const apiEntries = collectApiRouteEntries(rootDir);

  let adminEntities: AdminEntityRow[] = [];
  const adminRegistryPath = path.join(rootDir, 'src/features/admin/registry.ts');
  if (fs.existsSync(adminRegistryPath)) {
    try {
      adminEntities = extractAdminEntityRows(rootDir);
    } catch {
      adminEntities = [];
    }
  }

  const appDir = path.join(rootDir, 'src/app');
  const pageFiles = collectUiPageFiles(appDir);
  const allUiRoutePaths: string[] = [];
  const pageFeaturesChecked = new Map<string, Set<string>>();
  const ui404PagesByFeature = new Map<string, string[]>();
  const uiInlinePagesByFeature = new Map<string, string[]>();
  const homeImportedFiles = new Set<string>();

  for (const pageFile of pageFiles) {
    const rel = path.relative(appDir, pageFile).replace(/\\/g, '/');
    const routeSegment = rel.replace(/(?:^|\/)page\.(tsx|ts|jsx|js)$/, '');
    const uiRoute = routeSegment ? `/${routeSegment}` : '/';
    allUiRoutePaths.push(uiRoute);

    const sf = parseTsSourceFile(pageFile);
    const checks = extractFeatureChecksFromNodes([sf]);
    const usages = extractIsFeatureEnabledCallsInComponent(sf);
    const checkedSet = new Set<string>();

    for (const c of checks) {
      checkedSet.add(c.featureId);
      if (c.status === 404) {
        const list = ui404PagesByFeature.get(c.featureId) ?? [];
        if (!list.includes(uiRoute)) list.push(uiRoute);
        ui404PagesByFeature.set(c.featureId, list);
      }
    }
    for (const u of usages) {
      checkedSet.add(u.featureId);
      if (!checks.some((c) => c.featureId === u.featureId && c.status === 404)) {
        const list = uiInlinePagesByFeature.get(u.featureId) ?? [];
        if (!list.includes(uiRoute)) list.push(uiRoute);
        uiInlinePagesByFeature.set(u.featureId, list);
      }
    }
    pageFeaturesChecked.set(uiRoute, checkedSet);

    if (uiRoute === '/') {
      for (const stmt of sf.statements) {
        if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
          const resolved = resolveLocalTsModule(pageFile, stmt.moduleSpecifier.text, rootDir);
          if (resolved) {
            homeImportedFiles.add(resolved);
          }
        }
      }
    }
  }

  const pairedPrismaPropByFeature = new Map<string, string>();
  const homeWidgetFeatures = new Set<string>();
  const otherComponentRouteByFeature = new Map<string, Set<string>>();

  const componentFiles = [
    ...collectTsFilesInDir(path.join(rootDir, 'src/components')),
    ...collectTsFilesInDir(path.join(rootDir, 'src/features'), true),
  ];

  for (const compFile of componentFiles) {
    const sf = parseTsSourceFile(compFile);
    const usages = extractIsFeatureEnabledCallsInComponent(sf);
    if (usages.length === 0) continue;

    const isHomeComponent =
      homeImportedFiles.has(compFile) ||
      compFile.replace(/\\/g, '/').includes('/components/home/');

    for (const u of usages) {
      if (u.pairedConfigProp && prismaFields.has(u.pairedConfigProp)) {
        pairedPrismaPropByFeature.set(u.featureId, u.pairedConfigProp);
      }
      if (isHomeComponent) {
        homeWidgetFeatures.add(u.featureId);
      } else {
        const set = otherComponentRouteByFeature.get(u.featureId) ?? new Set<string>();
        const relComp = path.relative(rootDir, compFile).replace(/\\/g, '/');
        set.add(relComp);
        otherComponentRouteByFeature.set(u.featureId, set);
      }
    }
  }

  const middlewarePath = path.join(rootDir, 'src/middleware.ts');
  const middlewareHasExists = fs.existsSync(middlewarePath);
  const middlewareFeatures = new Set<string>();
  if (middlewareHasExists) {
    const mwSf = parseTsSourceFile(middlewarePath);
    for (const u of extractIsFeatureEnabledCallsInComponent(mwSf)) {
      middlewareFeatures.add(u.featureId);
    }
  }

  const adminEntityRouteSkipsFeature = (() => {
    const entry = apiEntries.find((e) => e.routePath === '/api/admin/[entity]');
    if (!entry) return false;
    return Object.values(entry.featureChecksByMethod).every((arr) => arr.length === 0);
  })();

  const domainToFeatureId: Record<string, string> = {
    registry: 'registry',
    'wedding-party': 'weddingParty',
    attractions: 'attractions',
    media: 'gallery',
    weather: 'weather',
  };
  const adminEntitySlugsByFeature = new Map<string, string[]>();
  for (const row of adminEntities) {
    const barrelMatch = /^src\/features\/([^/]+)\//.exec(row.barrelPath);
    const domain = barrelMatch ? barrelMatch[1] : '';
    const mappedFeature = domainToFeatureId[domain];
    if (mappedFeature) {
      const slugs = adminEntitySlugsByFeature.get(mappedFeature) ?? [];
      slugs.push(row.entityKey);
      adminEntitySlugsByFeature.set(mappedFeature, slugs);
    }
  }

  const result: Record<string, FeatureRuntimeEnforcement> = {};

  for (const [featureId, meta] of Object.entries(metadata)) {
    const pairedProp = pairedPrismaPropByFeature.get(featureId);
    const hasPersistedModulesColumn = prismaFields.has('modules');
    const persistence = hasPersistedModulesColumn
      ? pairedProp
        ? `\`Prisma\` (\`modules\` + \`${pairedProp}\`)`
        : '`Prisma` (`modules`)'
      : pairedProp
        ? `\`Virtual DTO\` + \`Prisma\` (\`${pairedProp}\`)`
        : prismaFields.has(featureId)
          ? '`Prisma`'
          : '`Virtual DTO`';

    // Build UI Coverage from AST
    const uiParts: string[] = [];
    const hasNavGate = navGatedFeatures.has(featureId);
    const hasHomeWidget = homeWidgetFeatures.has(featureId) || (uiInlinePagesByFeature.get(featureId) ?? []).includes('/');
    const pages404 = (ui404PagesByFeature.get(featureId) ?? []).sort(compareAscii);
    const inlinePages = (uiInlinePagesByFeature.get(featureId) ?? [])
      .filter((p) => p !== '/')
      .sort(compareAscii);

    if (pairedProp && hasHomeWidget) {
      uiParts.push(`Homepage (\`/\`) widget (\`config.${pairedProp} && isFeatureEnabled\`)`);
    } else if (hasNavGate && hasHomeWidget) {
      uiParts.push('Nav + `/` link hidden');
    } else if (hasNavGate) {
      uiParts.push('Nav hidden');
    } else if (hasHomeWidget) {
      uiParts.push('Homepage (`/`) section hidden');
    }

    if (pages404.length > 0) {
      const formattedPages =
        pages404.length === 1
          ? `\`${pages404[0]}\` returns HTTP 404`
          : pages404.length === 2
            ? `${pages404.map((p) => `\`${p}\``).join(' & ')} return HTTP 404`
            : `${pages404.map((p) => `\`${p}\``).join(', ')} return HTTP 404`;
      const adminHref = adminHrefByFeature.get(featureId);
      const adminSkips =
        adminHref &&
        allUiRoutePaths.includes(adminHref) &&
        !pageFeaturesChecked.get(adminHref)?.has(featureId);
      uiParts.push(
        adminSkips
          ? `${formattedPages} (\`${adminHref}\` skips \`isFeatureEnabled\`)`
          : formattedPages,
      );
    }

    for (const p of inlinePages) {
      uiParts.push(`\`${p}\` conditional render`);
    }

    const otherComponents = otherComponentRouteByFeature.get(featureId);
    if (otherComponents && otherComponents.size > 0 && uiParts.length === 0) {
      uiParts.push(
        Array.from(otherComponents)
          .sort(compareAscii)
          .map((c) => `\`${c}\``)
          .join(', '),
      );
    }

    const navBasePath = navPathByFeature.get(featureId);
    if (navBasePath && pages404.length === 0) {
      const domainPages = allUiRoutePaths
        .filter((p) => p === navBasePath || p.startsWith(`${navBasePath}/`))
        .filter((p) => !pageFeaturesChecked.get(p)?.has(featureId))
        .sort(compareAscii);
      if (domainPages.length > 0) {
        const verb = domainPages.length === 1 ? 'skips' : 'skip';
        uiParts.push(`${domainPages.map((p) => `\`${p}\``).join(', ')} ${verb} server \`isFeatureEnabled\``);
      }
    }

    let uiCoverage = uiParts.join('; ');
    if (!uiCoverage) {
      if (featureId === 'guestPasscode') {
        const guestPages = allUiRoutePaths
          .filter((p) => p === '/guest' || p.startsWith('/guest/'))
          .filter((p) => !pageFeaturesChecked.get(p)?.has(featureId))
          .sort(compareAscii);
        if (guestPages.length > 0 || (middlewareHasExists && !middlewareFeatures.has(featureId))) {
          const targets = [
            ...guestPages.map((p) => `\`${p}\``),
            ...(middlewareHasExists && !middlewareFeatures.has(featureId) ? ['`src/middleware.ts`'] : []),
          ];
          uiCoverage = `Unchecked (${targets.join(', ')} skip \`isFeatureEnabled\`)`;
        } else {
          uiCoverage = 'N/A';
        }
      } else if (
        meta.dependencies?.includes('registry') &&
        allUiRoutePaths.includes('/registry')
      ) {
        uiCoverage = 'Unchecked in UI (`/registry` delegates enforcement to contribution APIs)';
      } else {
        uiCoverage = 'N/A';
      }
    }

    // Build API Coverage from AST
    const guardedRouteMatches: Array<{
      entry: ApiRouteEntry;
      methods: string[];
      status: number;
    }> = [];

    for (const entry of apiEntries) {
      const matchingMethods: string[] = [];
      let matchedStatus: number | null = null;
      for (const method of entry.methods) {
        const check = (entry.featureChecksByMethod[method] ?? []).find(
          (c) => c.featureId === featureId,
        );
        if (check) {
          matchingMethods.push(method);
          matchedStatus = check.status;
        }
      }
      if (matchingMethods.length > 0 && matchedStatus !== null) {
        guardedRouteMatches.push({
          entry,
          methods: matchingMethods,
          status: matchedStatus,
        });
      }
    }

    let apiCoverage = 'N/A';
    if (guardedRouteMatches.length > 0) {
      const byStatus = new Map<number, typeof guardedRouteMatches>();
      for (const item of guardedRouteMatches) {
        const list = byStatus.get(item.status) ?? [];
        list.push(item);
        byStatus.set(item.status, list);
      }

      const statusClauses: string[] = [];
      for (const [status, items] of Array.from(byStatus.entries()).sort((a, b) => a[0] - b[0])) {
        if (items.length <= 2 && items.every((i) => i.methods.length === 1)) {
          const formatted = items
            .map((i) => `\`${i.methods[0]} ${i.entry.routePath}\``)
            .join(' & ');
          statusClauses.push(`HTTP ${status} on ${formatted}`);
        } else {
          const formatted = items.map((i) => `\`${i.entry.routePath}\``).join(', ');
          statusClauses.push(`HTTP ${status} on ${formatted}`);
        }
      }

      const guardedPaths = new Set(guardedRouteMatches.map((m) => m.entry.routePath));
      const groupCounts = new Map<string, number>();
      for (const item of guardedRouteMatches) {
        groupCounts.set(item.entry.group, (groupCounts.get(item.entry.group) ?? 0) + 1);
      }

      const skippedTokens: string[] = [];
      if (!meta.dependencies || meta.dependencies.length === 0) {
        for (const [grp, count] of groupCounts.entries()) {
          if (grp === 'admin' || count < 2) continue;
          const prefix = `/api/${grp}/`;
          const skippedInGroup = apiEntries
            .filter((e) => e.group === grp && !guardedPaths.has(e.routePath))
            .map((e) =>
              e.routePath.startsWith(prefix) ? e.routePath.slice(prefix.length) : e.routePath,
            );
          for (const sub of skippedInGroup) {
            skippedTokens.push(`\`${sub}\``);
          }
        }
      }

      if (
        skippedTokens.length > 0 &&
        adminEntityRouteSkipsFeature &&
        (adminEntitySlugsByFeature.get(featureId)?.length ?? 0) > 0
      ) {
        skippedTokens.push('`/api/admin/[entity]`');
      }

      apiCoverage =
        skippedTokens.length > 0
          ? `${statusClauses.join('; ')}; skipped on ${skippedTokens.join(', ')}`
          : statusClauses.join('; ');
    } else {
      const entitySlugs = adminEntitySlugsByFeature.get(featureId) ?? [];
      if (adminEntityRouteSkipsFeature && entitySlugs.length > 0) {
        const slugStr = entitySlugs.map((s) => `\`${s}\``).join(', ');
        apiCoverage = `Unchecked (\`/api/admin/[entity]\` with ${slugStr} skips \`isFeatureEnabled\`)`;
      } else if (featureId === 'guestPasscode') {
        const guestLogin = apiEntries.find((e) => e.routePath === '/api/guest/login');
        if (guestLogin) {
          const m = guestLogin.methods[0] ?? 'POST';
          apiCoverage = `Unchecked (\`${m} /api/guest/login\` skips \`isFeatureEnabled\`)`;
        }
      } else if (featureId === 'addToCalendar') {
        const icsRoute = apiEntries.find((e) => e.importsCalendarHelper);
        if (icsRoute) {
          const m = icsRoute.methods[0] ?? 'GET';
          apiCoverage = `N/A (\`${m} ${icsRoute.routePath}\` skips \`isFeatureEnabled\`)`;
        }
      }
    }

    result[featureId] = {
      persistence,
      uiCoverage,
      apiCoverage,
    };
  }

  return result;
}

export function generateFeatureMetadataTable(
  metadata: Record<string, FeatureMetadata> = FEATURE_METADATA,
  defaults: Record<string, boolean> = DEFAULT_MODULE_CONFIG,
  rootDir: string = ROOT_DIR,
): string {
  const enforcementByFeature = extractFeatureRuntimeEnforcement(rootDir, metadata);
  let markdown =
    '| Feature Identifier | Title | Category | Default | Persistence | Dependencies | UI Route & Render Coverage | API Route Coverage | Description |\n' +
    '|---|---|---|---|---|---|---|---|---|\n';

  for (const [key, meta] of Object.entries(metadata)) {
    const defaultVal = defaults[key] ?? true;
    const enforcement = enforcementByFeature[key] ?? {
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

export function extractAdminEntityRows(rootDir: string = ROOT_DIR): AdminEntityRow[] {
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

  const rows: AdminEntityRow[] = [];

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

  return rows;
}

export function generateAdminEntityTable(rootDir: string = ROOT_DIR): string {
  const rows = extractAdminEntityRows(rootDir);

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
    `<!-- BEGIN AUTOGENERATED FEATURE_METADATA -->\n${generateFeatureMetadataTable(FEATURE_METADATA, DEFAULT_MODULE_CONFIG, rootDir)}\n<!-- END AUTOGENERATED FEATURE_METADATA -->`,
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
