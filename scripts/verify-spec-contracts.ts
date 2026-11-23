import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ts from 'typescript';
import {
  getMiddlewarePublicApiExclusions,
  isMiddlewarePublicApiMethod,
} from './generate-docs';
import { ARCHITECTURAL_DOCS } from './check-doc-links';

interface RouteContractEntry {
  routePath: string;
  handlerPath: string;
  methods: string[];
}

const scriptDir = typeof __dirname !== 'undefined'
  ? __dirname
  : path.dirname(fileURLToPath(import.meta.url));

const ROOT_DIR = path.resolve(scriptDir, '..');

const HTTP_METHODS_SET = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'HEAD',
]);

const PRIMITIVE_KEYWORDS = new Set([
  'true',
  'false',
  'null',
  'undefined',
  'string',
  'number',
  'boolean',
  'bigint',
  'symbol',
  'object',
  'void',
  'never',
  'any',
  'unknown',
]);

const BUILTIN_GLOBAL_IDENTIFIERS = new Set([
  'AbortController',
  'AbortSignal',
  'ArrayBuffer',
  'Blob',
  'Buffer',
  'Date',
  'Error',
  'File',
  'FormData',
  'Headers',
  'Intl',
  'JSON',
  'Map',
  'Math',
  'Promise',
  'ReadableStream',
  'RegExp',
  'Request',
  'Response',
  'Set',
  'TextDecoder',
  'TextEncoder',
  'TransformStream',
  'TypeError',
  'URL',
  'URLSearchParams',
  'Uint8Array',
  'WritableStream',
]);

const STANDARD_HTTP_HEADERS = new Set([
  'Accept',
  'Authorization',
  'Cookie',
  'Host',
  'Location',
  'Origin',
  'Referer',
]);

const REPO_GITHUB_BLOB_URL_RE =
  /^https?:\/\/github\.com\/fderuiter\/wedding_website\/blob\/[^/]+\/([^?#]+)(?:\?[^#]*)?(?:#(.*))?$/;

const LINE_RANGE_FRAGMENT_RE = /^L(\d+)(?:C\d+)?(?:-L?(\d+)(?:C\d+)?)?$/;

const PROSE_LOWERCASE_LINK_LABELS = new Set([
  'details',
  'docs',
  'example',
  'file',
  'handler',
  'here',
  'implementation',
  'link',
  'module',
  'more',
  'repo',
  'route',
  'sample',
  'schema',
  'service',
  'source',
  'target',
]);

type ConstPrimitiveValue = string | number | boolean;

export interface SpecContractVerificationOptions {
  specFiles?: string[];
}

export interface SpecContractVerificationResult {
  errors: string[];
  checkedRoutes: number;
  checkedSymbols: number;
}

interface ModuleSymbolInventory {
  exportsValues: Set<string>;
  exportsTypes: Set<string>;
  topLevelDeclarations: Set<string>;
  classAndObjectMembers: Map<string, Set<string>>;
  allClassMemberNames: Set<string>;
  propertyAndConstLiterals: Set<string>;
  exportedConstLiterals: Map<string, string>;
  constInitializers: Map<string, Set<ConstPrimitiveValue>>;
  exportedConstInitializers: Map<string, Set<ConstPrimitiveValue>>;
  localImports: Map<string, { specifier: string; importedName: string }>;
}

interface FileSliceInventory {
  lineCount: number;
  lines: string[];
  declRanges: Map<string, Array<{ start: number; end: number }>>;
}

function collectMarkdownFilesUnderDir(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  const found: string[] = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectMarkdownFilesUnderDir(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      found.push(fullPath);
    }
  }
  return found;
}

function discoverSpecFiles(rootDir: string, explicitSpecFiles?: string[]): string[] {
  if (explicitSpecFiles && explicitSpecFiles.length > 0) {
    return explicitSpecFiles.filter((rel) => fs.existsSync(path.join(rootDir, rel)));
  }

  const ordered = new Set<string>();
  const candidates = ['README.md', ...ARCHITECTURAL_DOCS.map((doc) => doc.src)];
  for (const rel of candidates) {
    if (fs.existsSync(path.join(rootDir, rel))) {
      ordered.add(rel.replace(/\\/g, '/'));
    }
  }

  for (const absDoc of collectMarkdownFilesUnderDir(path.join(rootDir, 'docs'))) {
    const rel = path.relative(rootDir, absDoc).replace(/\\/g, '/');
    ordered.add(rel);
  }

  if (ordered.size === 0 && fs.existsSync(rootDir)) {
    for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        ordered.add(entry.name);
      }
    }
  }

  return Array.from(ordered);
}

function extractEnvVarNames(rootDir: string): Set<string> {
  const envVars = new Set<string>(['NODE_ENV', 'PORT', 'HOSTNAME', 'CI']);
  const envFilePath = path.join(rootDir, 'src/env.ts');
  if (!fs.existsSync(envFilePath)) {
    return envVars;
  }

  const sf = getCachedSourceFile(envFilePath).sf;
  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
      if (/^[A-Z][A-Z0-9_]+$/.test(node.name.text)) {
        envVars.add(node.name.text);
      }
    } else if (
      ts.isPropertyAccessExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'process' &&
      node.expression.name.text === 'env' &&
      /^[A-Z][A-Z0-9_]+$/.test(node.name.text)
    ) {
      envVars.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return envVars;
}

function collectBindingIdentifiers(name: ts.BindingName, target: Set<string>) {
  if (ts.isIdentifier(name)) {
    target.add(name.text);
  } else if (ts.isObjectBindingPattern(name)) {
    for (const el of name.elements) {
      collectBindingIdentifiers(el.name, target);
    }
  } else if (ts.isArrayBindingPattern(name)) {
    for (const el of name.elements) {
      if (ts.isBindingElement(el)) {
        collectBindingIdentifiers(el.name, target);
      }
    }
  }
}

function collectInheritedClassMembers(
  classDecl: ts.ClassDeclaration,
  filePath: string,
  sourceFile: ts.SourceFile,
  rootDir: string,
  visited: Set<string>,
): Set<string> {
  const members = new Set<string>();
  if (!classDecl.heritageClauses) return members;

  const importMap = new Map<string, { specifier: string; importedName: string }>();
  for (const stmt of sourceFile.statements) {
    if (
      ts.isImportDeclaration(stmt) &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      stmt.importClause?.namedBindings &&
      ts.isNamedImports(stmt.importClause.namedBindings)
    ) {
      for (const el of stmt.importClause.namedBindings.elements) {
        importMap.set(el.name.text, {
          specifier: stmt.moduleSpecifier.text,
          importedName: el.propertyName ? el.propertyName.text : el.name.text,
        });
      }
    }
  }

  for (const clause of classDecl.heritageClauses) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
    for (const typeExpr of clause.types) {
      if (!ts.isIdentifier(typeExpr.expression)) continue;
      const baseIdent = typeExpr.expression.text;
      const imp = importMap.get(baseIdent);
      if (!imp) continue;
      const resolved = resolveLocalTsModule(filePath, imp.specifier, rootDir);
      if (!resolved || visited.has(`${resolved}::${imp.importedName}`)) continue;

      const nextVisited = new Set(visited);
      nextVisited.add(`${resolved}::${imp.importedName}`);
      const baseInventory = getModuleSymbolInventory(resolved, rootDir, nextVisited);
      const baseMembers = baseInventory.classAndObjectMembers.get(imp.importedName);
      if (baseMembers) {
        for (const m of baseMembers) {
          members.add(m);
        }
      }
    }
  }

  return members;
}

const symbolInventoryCache = new Map<string, ModuleSymbolInventory>();
const sliceInventoryCache = new Map<string, FileSliceInventory>();
const exportedConstInitializersCache = new Map<string, Map<string, Set<ConstPrimitiveValue>>>();
const parsedSourceCache = new Map<string, { content: string; sf: ts.SourceFile }>();
const moduleExportsCache = new Map<string, { values: Set<string>; types: Set<string> }>();
const localModuleResolveCache = new Map<string, string | null>();

function hasExportModifier(node: ts.Node): boolean {
  return Boolean(
    ts.canHaveModifiers(node) &&
      ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword),
  );
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

  const cacheKey = `${rootDir}::${base}`;
  if (localModuleResolveCache.has(cacheKey)) {
    return localModuleResolveCache.get(cacheKey)!;
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
      localModuleResolveCache.set(cacheKey, candidate);
      return candidate;
    }
  }

  localModuleResolveCache.set(cacheKey, null);
  return null;
}

function getCachedSourceFile(filePath: string): { content: string; sf: ts.SourceFile } {
  const cached = parsedSourceCache.get(filePath);
  if (cached) return cached;
  const content = fs.readFileSync(filePath, 'utf8');
  const sf = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    false,
    filePath.endsWith('.tsx') || filePath.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const entry = { content, sf };
  parsedSourceCache.set(filePath, entry);
  return entry;
}

function collectCachedModuleExports(
  filePath: string,
  rootDir: string,
  visited: Set<string> = new Set(),
): { values: Set<string>; types: Set<string> } {
  const cached = moduleExportsCache.get(filePath);
  if (cached) {
    return { values: new Set(cached.values), types: new Set(cached.types) };
  }

  const values = new Set<string>();
  const types = new Set<string>();
  if (visited.has(filePath) || !fs.existsSync(filePath)) {
    return { values, types };
  }

  const nextVisited = new Set(visited);
  nextVisited.add(filePath);

  const sourceFile = getCachedSourceFile(filePath).sf;
  const localValues = new Set<string>();
  const localTypes = new Set<string>();

  for (const stmt of sourceFile.statements) {
    if (ts.isVariableStatement(stmt)) {
      const target = hasExportModifier(stmt) ? values : localValues;
      for (const decl of stmt.declarationList.declarations) {
        collectBindingIdentifiers(decl.name, target);
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
        const sub = collectCachedModuleExports(resolvedTarget, rootDir, nextVisited);
        if (stmt.isTypeOnly) {
          for (const v of sub.values) types.add(v);
          for (const t of sub.types) types.add(t);
        } else {
          for (const v of sub.values) values.add(v);
          for (const t of sub.types) types.add(t);
        }
      }
    } else if (ts.isNamedExports(stmt.exportClause)) {
      const targetExports = resolvedTarget
        ? collectCachedModuleExports(resolvedTarget, rootDir, nextVisited)
        : null;
      for (const spec of stmt.exportClause.elements) {
        const origName = spec.propertyName ? spec.propertyName.text : spec.name.text;
        const exportedName = spec.name.text;
        if (stmt.isTypeOnly || spec.isTypeOnly) {
          types.add(exportedName);
        } else if (targetExports) {
          if (targetExports.values.has(origName)) values.add(exportedName);
          else if (targetExports.types.has(origName)) types.add(exportedName);
          else values.add(exportedName);
        } else {
          if (localTypes.has(origName) && !localValues.has(origName)) types.add(exportedName);
          else values.add(exportedName);
        }
      }
    }
  }

  if (visited.size === 0) {
    moduleExportsCache.set(filePath, { values: new Set(values), types: new Set(types) });
  }
  return { values, types };
}

function collectFastApiRouteEntries(rootDir: string): RouteContractEntry[] {
  const apiRoot = path.join(rootDir, 'src/app/api');
  if (!fs.existsSync(apiRoot)) return [];

  const routeFiles: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && /^route\.(tsx|ts|jsx|js)$/.test(entry.name)) {
        routeFiles.push(fullPath);
      }
    }
  };
  walk(apiRoot);

  return routeFiles.map((fullPath) => {
    const relFromRoot = path.relative(rootDir, fullPath).replace(/\\/g, '/');
    const routePath =
      '/' + relFromRoot.replace(/^src\/app\//, '').replace(/\/route\.(tsx|ts|jsx|js)$/, '');
    const { values } = collectCachedModuleExports(fullPath, rootDir);
    const methods = Array.from(HTTP_METHODS_SET).filter((m) => values.has(m));
    return { routePath, handlerPath: relFromRoot, methods };
  });
}

function extractFastAdminEntityKeys(rootDir: string): Set<string> {
  const registryPath = path.join(rootDir, 'src/features/admin/registry.ts');
  if (!fs.existsSync(registryPath)) return new Set();

  const sf = getCachedSourceFile(registryPath).sf;
  const importedClasses = new Map<string, { specifier: string; importedName: string }>();

  const visitRegistry = (node: ts.Node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings)
    ) {
      for (const el of node.importClause.namedBindings.elements) {
        importedClasses.set(el.name.text, {
          specifier: node.moduleSpecifier.text,
          importedName: el.propertyName ? el.propertyName.text : el.name.text,
        });
      }
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.initializer &&
      ts.isAwaitExpression(node.initializer) &&
      ts.isCallExpression(node.initializer.expression) &&
      node.initializer.expression.arguments.length > 0 &&
      ts.isArrayLiteralExpression(node.initializer.expression.arguments[0])
    ) {
      const importCalls = node.initializer.expression.arguments[0].elements;
      node.name.elements.forEach((bindingEl, idx) => {
        const importCall = importCalls[idx];
        if (
          !ts.isBindingElement(bindingEl) ||
          !ts.isObjectBindingPattern(bindingEl.name) ||
          !importCall ||
          !ts.isCallExpression(importCall) ||
          importCall.expression.kind !== ts.SyntaxKind.ImportKeyword ||
          importCall.arguments.length === 0 ||
          !ts.isStringLiteral(importCall.arguments[0])
        ) {
          return;
        }
        const spec = importCall.arguments[0].text;
        for (const prop of bindingEl.name.elements) {
          if (ts.isIdentifier(prop.name)) {
            importedClasses.set(prop.name.text, {
              specifier: spec,
              importedName:
                prop.propertyName && ts.isIdentifier(prop.propertyName)
                  ? prop.propertyName.text
                  : prop.name.text,
            });
          }
        }
      });
    }
    ts.forEachChild(node, visitRegistry);
  };
  visitRegistry(sf);

  const findEntityKeyInFile = (
    targetFile: string,
    className: string,
    seen: Set<string> = new Set(),
  ): string | null => {
    if (seen.has(targetFile) || !fs.existsSync(targetFile)) return null;
    seen.add(targetFile);
    const targetSf = getCachedSourceFile(targetFile).sf;
    for (const stmt of targetSf.statements) {
      if (ts.isClassDeclaration(stmt) && stmt.name?.text === className) {
        for (const member of stmt.members) {
          if (
            ts.isPropertyDeclaration(member) &&
            member.name &&
            ts.isIdentifier(member.name) &&
            member.name.text === 'ENTITY_KEY' &&
            member.initializer &&
            (ts.isStringLiteral(member.initializer) ||
              ts.isNoSubstitutionTemplateLiteral(member.initializer))
          ) {
            return member.initializer.text;
          }
        }
      }
    }
    for (const stmt of targetSf.statements) {
      if (
        ts.isExportDeclaration(stmt) &&
        stmt.moduleSpecifier &&
        ts.isStringLiteral(stmt.moduleSpecifier)
      ) {
        const nextFile = resolveLocalTsModule(targetFile, stmt.moduleSpecifier.text, rootDir);
        if (nextFile) {
          const found = findEntityKeyInFile(nextFile, className, seen);
          if (found) return found;
        }
      }
    }
    return null;
  };

  const keys = new Set<string>();
  for (const [, info] of importedClasses) {
    const resolved = resolveLocalTsModule(registryPath, info.specifier, rootDir);
    if (!resolved) continue;
    const key = findEntityKeyInFile(resolved, info.importedName);
    if (key) keys.add(key);
  }
  return keys;
}

function getExportedConstInitializers(
  filePath: string,
  rootDir: string,
  visited: Set<string> = new Set(),
): Map<string, Set<ConstPrimitiveValue>> {
  const cached = exportedConstInitializersCache.get(filePath);
  if (cached) return cached;

  const result = new Map<string, Set<ConstPrimitiveValue>>();
  if (!fs.existsSync(filePath) || visited.has(filePath)) {
    return result;
  }

  const nextVisited = new Set(visited);
  nextVisited.add(filePath);

  const sf = getCachedSourceFile(filePath).sf;
  const localImports = new Map<string, { specifier: string; importedName: string }>();

  const addVal = (name: string, val: ConstPrimitiveValue) => {
    const set = result.get(name) ?? new Set<ConstPrimitiveValue>();
    set.add(val);
    result.set(name, set);
  };

  for (const stmt of sf.statements) {
    if (
      ts.isImportDeclaration(stmt) &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      stmt.importClause?.namedBindings &&
      ts.isNamedImports(stmt.importClause.namedBindings)
    ) {
      for (const el of stmt.importClause.namedBindings.elements) {
        localImports.set(el.name.text, {
          specifier: stmt.moduleSpecifier.text,
          importedName: el.propertyName ? el.propertyName.text : el.name.text,
        });
      }
    } else if (ts.isVariableStatement(stmt) && hasExportModifier(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) {
          const val = evaluateStaticExpression(decl.initializer);
          if (val !== null) {
            addVal(decl.name.text, val);
          }
        }
      }
    } else if (ts.isExportDeclaration(stmt)) {
      const specifier =
        stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)
          ? stmt.moduleSpecifier.text
          : null;
      if (specifier && !stmt.exportClause) {
        const targetPath = resolveLocalTsModule(filePath, specifier, rootDir);
        if (targetPath) {
          const subMap = getExportedConstInitializers(targetPath, rootDir, nextVisited);
          for (const [k, vals] of subMap.entries()) {
            for (const v of vals) addVal(k, v);
          }
        }
      } else if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) {
          const localOrImported = el.propertyName ? el.propertyName.text : el.name.text;
          const exportedName = el.name.text;
          if (specifier) {
            const targetPath = resolveLocalTsModule(filePath, specifier, rootDir);
            if (targetPath) {
              const subMap = getExportedConstInitializers(targetPath, rootDir, nextVisited);
              const vals = subMap.get(localOrImported);
              if (vals) {
                for (const v of vals) addVal(exportedName, v);
              }
            }
          } else {
            const imp = localImports.get(localOrImported);
            if (imp) {
              const targetPath = resolveLocalTsModule(filePath, imp.specifier, rootDir);
              if (targetPath) {
                const subMap = getExportedConstInitializers(targetPath, rootDir, nextVisited);
                const vals = subMap.get(imp.importedName);
                if (vals) {
                  for (const v of vals) addVal(exportedName, v);
                }
              }
            }
          }
        }
      }
    }
  }

  exportedConstInitializersCache.set(filePath, result);
  return result;
}

function unwrapExpression(expr: ts.Expression): ts.Expression {
  let current = expr;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function evaluateStaticExpression(expr: ts.Expression): ConstPrimitiveValue | null {
  const node = unwrapExpression(expr);
  if (ts.isNumericLiteral(node)) {
    const val = Number(node.text.replace(/_/g, ''));
    return Number.isFinite(val) ? val : null;
  }
  if (
    ts.isPrefixUnaryExpression(node) &&
    (node.operator === ts.SyntaxKind.MinusToken || node.operator === ts.SyntaxKind.PlusToken)
  ) {
    const inner = evaluateStaticExpression(node.operand);
    if (typeof inner === 'number') {
      return node.operator === ts.SyntaxKind.MinusToken ? -inner : inner;
    }
    return null;
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }
  if (node.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }
  if (ts.isBinaryExpression(node)) {
    const left = evaluateStaticExpression(node.left);
    const right = evaluateStaticExpression(node.right);
    if (typeof left === 'number' && typeof right === 'number') {
      switch (node.operatorToken.kind) {
        case ts.SyntaxKind.PlusToken:
          return left + right;
        case ts.SyntaxKind.MinusToken:
          return left - right;
        case ts.SyntaxKind.AsteriskToken:
          return left * right;
        case ts.SyntaxKind.SlashToken:
          return right !== 0 ? left / right : null;
        case ts.SyntaxKind.AsteriskAsteriskToken:
          return left ** right;
        default:
          return null;
      }
    }
  }
  return null;
}

function parseStaticConstSnippet(rawValueExpr: string): ConstPrimitiveValue | null {
  const trimmed = rawValueExpr.trim();
  if (!trimmed) return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^[+-]?\d+(?:_\d+)*(?:\.\d+)?$/.test(trimmed)) {
    const num = Number(trimmed.replace(/_/g, ''));
    return Number.isFinite(num) ? num : null;
  }
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'") && !trimmed.slice(1, -1).includes("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"') && !trimmed.slice(1, -1).includes('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  if (/^\d+(?:\s*\*\s*\d+)+$/.test(trimmed)) {
    return trimmed
      .split('*')
      .map((part) => Number(part.trim()))
      .reduce((acc, n) => acc * n, 1);
  }
  if (!/^[0-9+\-*/()._\s'"]+$/.test(trimmed)) {
    return null;
  }
  try {
    const sf = ts.createSourceFile(
      'inline-const.ts',
      `const __val = (${trimmed});`,
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.TS,
    );
    const stmt = sf.statements[0];
    if (
      stmt &&
      ts.isVariableStatement(stmt) &&
      stmt.declarationList.declarations.length === 1 &&
      stmt.declarationList.declarations[0].initializer
    ) {
      return evaluateStaticExpression(stmt.declarationList.declarations[0].initializer);
    }
  } catch {
    return null;
  }
  return null;
}

function getFileSliceInventory(filePath: string): FileSliceInventory {
  const cached = sliceInventoryCache.get(filePath);
  if (cached) return cached;

  const { content, sf } = getCachedSourceFile(filePath);
  const lines = content.length === 0 ? [] : content.replace(/\r?\n$/, '').split(/\r?\n/);
  const lineCount = lines.length;
  const declRanges = new Map<string, Array<{ start: number; end: number }>>();

  const lineStarts = sf.getLineStarts();

  function offsetToLine(pos: number): number {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      if (lineStarts[mid] <= pos) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return high + 1;
  }

  function skipTriviaOffset(pos: number, end: number): number {
    let p = pos;
    while (p < end) {
      const ch = content.charCodeAt(p);
      if (ch === 32 || ch === 9 || ch === 10 || ch === 13) {
        p++;
      } else if (ch === 47 && content.charCodeAt(p + 1) === 47) {
        p += 2;
        while (p < end && content.charCodeAt(p) !== 10) p++;
      } else if (ch === 47 && content.charCodeAt(p + 1) === 42) {
        p += 2;
        while (p + 1 < end && !(content.charCodeAt(p) === 42 && content.charCodeAt(p + 1) === 47)) {
          p++;
        }
        p += 2;
      } else {
        break;
      }
    }
    return p;
  }

  function addDeclRange(name: string, rangeNode: ts.Node) {
    const start = offsetToLine(skipTriviaOffset(rangeNode.pos, rangeNode.end));
    const end = offsetToLine(Math.max(rangeNode.pos, rangeNode.end - 1));
    const existing = declRanges.get(name) ?? [];
    existing.push({ start, end });
    declRanges.set(name, existing);
  }

  function visitDecls(node: ts.Node) {
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isEnumDeclaration(node)) &&
      node.name
    ) {
      addDeclRange(node.name.text, node);
    } else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          addDeclRange(decl.name.text, node);
        }
      }
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      addDeclRange(node.name.text, node);
    } else if (
      (ts.isMethodDeclaration(node) ||
        ts.isPropertyDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isSetAccessorDeclaration(node) ||
        ts.isPropertyAssignment(node)) &&
      node.name &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
    ) {
      addDeclRange(node.name.text, node);
    }
    ts.forEachChild(node, visitDecls);
  }

  visitDecls(sf);

  const sliceInv: FileSliceInventory = { lineCount, lines, declRanges };
  sliceInventoryCache.set(filePath, sliceInv);
  return sliceInv;
}

function collectSliceTokens(
  lines: string[],
  start: number,
  end: number,
  isTsx: boolean,
): Set<string> {
  const sliceText = lines.slice(start - 1, end).join('\n');
  const tokens = new Set<string>();
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    isTsx ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard,
    sliceText,
  );
  let tok = scanner.scan();
  while (tok !== ts.SyntaxKind.EndOfFileToken) {
    if (
      tok === ts.SyntaxKind.Identifier ||
      tok === ts.SyntaxKind.StringLiteral ||
      tok === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
      (tok >= ts.SyntaxKind.FirstKeyword && tok <= ts.SyntaxKind.LastKeyword)
    ) {
      tokens.add(scanner.getTokenValue());
    }
    tok = scanner.scan();
  }
  return tokens;
}

function getModuleSymbolInventory(
  filePath: string,
  rootDir: string,
  visited: Set<string> = new Set(),
): ModuleSymbolInventory {
  const cached = symbolInventoryCache.get(filePath);
  if (cached) return cached;

  const { values: exportsValues, types: exportsTypes } = collectCachedModuleExports(filePath, rootDir);
  const topLevelDeclarations = new Set<string>([...exportsValues, ...exportsTypes]);
  const classAndObjectMembers = new Map<string, Set<string>>();
  const allClassMemberNames = new Set<string>();
  const propertyAndConstLiterals = new Set<string>();
  const exportedConstLiterals = new Map<string, string>();
  const constInitializers = new Map<string, Set<ConstPrimitiveValue>>();
  const exportedConstInitializers = new Map<string, Set<ConstPrimitiveValue>>();
  const localImports = new Map<string, { specifier: string; importedName: string }>();

  if (!fs.existsSync(filePath)) {
    return {
      exportsValues,
      exportsTypes,
      topLevelDeclarations,
      classAndObjectMembers,
      allClassMemberNames,
      propertyAndConstLiterals,
      exportedConstLiterals,
      constInitializers,
      exportedConstInitializers,
      localImports,
    };
  }

  const sf = getCachedSourceFile(filePath).sf;

  function recordConstValue(
    map: Map<string, Set<ConstPrimitiveValue>>,
    name: string,
    val: ConstPrimitiveValue,
  ) {
    const set = map.get(name) ?? new Set<ConstPrimitiveValue>();
    set.add(val);
    map.set(name, set);
  }

  function recordMember(container: string, memberName: string) {
    const set = classAndObjectMembers.get(container) ?? new Set<string>();
    set.add(memberName);
    classAndObjectMembers.set(container, set);
  }

  function mergeReExportedSymbol(
    specifier: string,
    importedName: string,
    exportedName: string,
  ) {
    const targetPath = resolveLocalTsModule(filePath, specifier, rootDir);
    if (!targetPath || visited.has(`${targetPath}::reexport::${importedName}`)) return;
    const nextVisited = new Set(visited);
    nextVisited.add(`${targetPath}::reexport::${importedName}`);
    const subInv = getModuleSymbolInventory(targetPath, rootDir, nextVisited);

    const literalVal = subInv.exportedConstLiterals.get(importedName);
    if (literalVal !== undefined) {
      propertyAndConstLiterals.add(literalVal);
      exportedConstLiterals.set(exportedName, literalVal);
    }

    const constVals = subInv.exportedConstInitializers.get(importedName);
    if (constVals) {
      for (const v of constVals) {
        recordConstValue(constInitializers, exportedName, v);
        recordConstValue(exportedConstInitializers, exportedName, v);
      }
    }

    const members = subInv.classAndObjectMembers.get(importedName);
    if (members) {
      for (const m of members) {
        recordMember(exportedName, m);
        allClassMemberNames.add(m);
      }
    }
  }

  function collectPropertiesAndLiterals(node: ts.Node) {
    if (
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
      node.name &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
    ) {
      propertyAndConstLiterals.add(node.name.text);
      if (ts.isPropertyAssignment(node)) {
        const staticVal = evaluateStaticExpression(node.initializer);
        if (staticVal !== null) {
          recordConstValue(constInitializers, node.name.text, staticVal);
        }
      }
    } else if (ts.isVariableDeclaration(node) && node.initializer) {
      if (
        ts.isStringLiteral(node.initializer) ||
        ts.isNoSubstitutionTemplateLiteral(node.initializer)
      ) {
        propertyAndConstLiterals.add(node.initializer.text);
      }
      if (ts.isIdentifier(node.name)) {
        const staticVal = evaluateStaticExpression(node.initializer);
        if (staticVal !== null) {
          recordConstValue(constInitializers, node.name.text, staticVal);
        }
      }
    } else if (
      (ts.isBindingElement(node) || ts.isParameter(node) || ts.isPropertyDeclaration(node)) &&
      node.initializer &&
      node.name &&
      ts.isIdentifier(node.name)
    ) {
      const staticVal = evaluateStaticExpression(node.initializer);
      if (staticVal !== null) {
        recordConstValue(constInitializers, node.name.text, staticVal);
      }
    } else if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'enum' &&
      node.arguments.length > 0 &&
      ts.isArrayLiteralExpression(node.arguments[0])
    ) {
      for (const el of node.arguments[0].elements) {
        if (ts.isStringLiteral(el) || ts.isNoSubstitutionTemplateLiteral(el)) {
          propertyAndConstLiterals.add(el.text);
        }
      }
    }
    ts.forEachChild(node, collectPropertiesAndLiterals);
  }
  collectPropertiesAndLiterals(sf);

  for (const stmt of sf.statements) {
    if (
      ts.isImportDeclaration(stmt) &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      stmt.importClause?.namedBindings &&
      ts.isNamedImports(stmt.importClause.namedBindings)
    ) {
      for (const el of stmt.importClause.namedBindings.elements) {
        localImports.set(el.name.text, {
          specifier: stmt.moduleSpecifier.text,
          importedName: el.propertyName ? el.propertyName.text : el.name.text,
        });
      }
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      topLevelDeclarations.add(stmt.name.text);
    } else if (ts.isVariableStatement(stmt)) {
      const isExported = hasExportModifier(stmt);
      for (const decl of stmt.declarationList.declarations) {
        collectBindingIdentifiers(decl.name, topLevelDeclarations);
        if (isExported && ts.isIdentifier(decl.name)) {
          exportsValues.add(decl.name.text);
        }
        if (ts.isIdentifier(decl.name) && decl.initializer) {
          const containerName = decl.name.text;
          let init = decl.initializer;
          while (
            ts.isAsExpression(init) ||
            ts.isSatisfiesExpression(init) ||
            ts.isParenthesizedExpression(init)
          ) {
            init = init.expression;
          }
          if (isExported) {
            const staticVal = evaluateStaticExpression(init);
            if (staticVal !== null) {
              recordConstValue(exportedConstInitializers, containerName, staticVal);
            }
          }
          if (
            isExported &&
            (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init))
          ) {
            exportedConstLiterals.set(containerName, init.text);
          }
          if (ts.isObjectLiteralExpression(init)) {
            for (const prop of init.properties) {
              if (
                (ts.isPropertyAssignment(prop) ||
                  ts.isShorthandPropertyAssignment(prop) ||
                  ts.isMethodDeclaration(prop)) &&
                prop.name &&
                (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))
              ) {
                recordMember(containerName, prop.name.text);
              }
            }
          }
        }
      }
    } else if (ts.isExportDeclaration(stmt)) {
      const specifier =
        stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)
          ? stmt.moduleSpecifier.text
          : null;
      if (specifier && !stmt.exportClause) {
        const targetPath = resolveLocalTsModule(filePath, specifier, rootDir);
        if (targetPath && !visited.has(`${targetPath}::reexport::*`)) {
          const nextVisited = new Set(visited);
          nextVisited.add(`${targetPath}::reexport::*`);
          const subInv = getModuleSymbolInventory(targetPath, rootDir, nextVisited);
          for (const [k, v] of subInv.exportedConstLiterals.entries()) {
            propertyAndConstLiterals.add(v);
            exportedConstLiterals.set(k, v);
          }
          for (const [k, vals] of subInv.exportedConstInitializers.entries()) {
            for (const v of vals) {
              recordConstValue(constInitializers, k, v);
              recordConstValue(exportedConstInitializers, k, v);
            }
          }
          for (const [container, members] of subInv.classAndObjectMembers.entries()) {
            if (subInv.exportsValues.has(container) || subInv.exportsTypes.has(container)) {
              for (const m of members) {
                recordMember(container, m);
                allClassMemberNames.add(m);
              }
            }
          }
        }
      } else if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) {
          const localOrImported = el.propertyName ? el.propertyName.text : el.name.text;
          const exportedName = el.name.text;
          if (specifier) {
            mergeReExportedSymbol(specifier, localOrImported, exportedName);
          } else {
            const imp = localImports.get(localOrImported);
            if (imp) {
              mergeReExportedSymbol(imp.specifier, imp.importedName, exportedName);
            }
          }
        }
      }
    } else if (ts.isClassDeclaration(stmt) && stmt.name) {
      const className = stmt.name.text;
      topLevelDeclarations.add(className);
      const inherited = collectInheritedClassMembers(stmt, filePath, sf, rootDir, visited);
      for (const m of inherited) {
        recordMember(className, m);
        allClassMemberNames.add(m);
      }
      for (const member of stmt.members) {
        if (
          (ts.isMethodDeclaration(member) ||
            ts.isPropertyDeclaration(member) ||
            ts.isGetAccessorDeclaration(member) ||
            ts.isSetAccessorDeclaration(member)) &&
          member.name &&
          (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))
        ) {
          recordMember(className, member.name.text);
          allClassMemberNames.add(member.name.text);
        }
      }
    } else if (ts.isInterfaceDeclaration(stmt)) {
      const ifaceName = stmt.name.text;
      topLevelDeclarations.add(ifaceName);
      for (const member of stmt.members) {
        if (
          (ts.isPropertySignature(member) || ts.isMethodSignature(member)) &&
          member.name &&
          (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))
        ) {
          recordMember(ifaceName, member.name.text);
        }
      }
    } else if (ts.isTypeAliasDeclaration(stmt)) {
      topLevelDeclarations.add(stmt.name.text);
    } else if (ts.isEnumDeclaration(stmt)) {
      const enumName = stmt.name.text;
      topLevelDeclarations.add(enumName);
      for (const member of stmt.members) {
        if (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) {
          recordMember(enumName, member.name.text);
        }
      }
    }
  }

  const inventory: ModuleSymbolInventory = {
    exportsValues,
    exportsTypes,
    topLevelDeclarations,
    classAndObjectMembers,
    allClassMemberNames,
    propertyAndConstLiterals,
    exportedConstLiterals,
    constInitializers,
    exportedConstInitializers,
    localImports,
  };

  if (visited.size === 0) {
    symbolInventoryCache.set(filePath, inventory);
  }
  return inventory;
}

function expandBraces(routePath: string): string[] {
  const braceMatch = routePath.match(/^(.*)\{([^{}]+)\}(.*)$/);
  if (!braceMatch) return [routePath];
  const [, prefix, inner, suffix] = braceMatch;
  return inner
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => expandBraces(`${prefix}${part}${suffix}`));
}

function normalizeRouteToken(rawRoute: string): string[] {
  let cleaned = rawRoute.trim();
  cleaned = cleaned.replace(/[?#].*$/, '');
  cleaned = cleaned.replace(/[.,;:)'"]+$/, '');
  if (cleaned.length > 1 && cleaned.endsWith('/')) {
    cleaned = cleaned.slice(0, -1);
  }
  if (!cleaned.startsWith('/api/') || cleaned === '/api') {
    return [];
  }
  return expandBraces(cleaned);
}

function matchDynamicRouteSegments(patternSegments: string[], targetSegments: string[]): boolean {
  let pIdx = 0;
  let tIdx = 0;

  while (pIdx < patternSegments.length) {
    const pSeg = patternSegments[pIdx];
    if (pSeg.startsWith('[[...') && pSeg.endsWith(']]')) {
      return true;
    }
    if (pSeg.startsWith('[...') && pSeg.endsWith(']')) {
      return tIdx < targetSegments.length;
    }
    if (tIdx >= targetSegments.length) {
      return false;
    }
    if (pSeg.startsWith('[') && pSeg.endsWith(']')) {
      if (pSeg === '[entity]') {
        if (targetSegments[tIdx] !== '[entity]') {
          return false;
        }
      }
      pIdx++;
      tIdx++;
      continue;
    }
    if (pSeg !== targetSegments[tIdx]) {
      return false;
    }
    pIdx++;
    tIdx++;
  }

  return tIdx === targetSegments.length;
}

function resolveApiRouteMatch(
  routePath: string,
  apiEntries: RouteContractEntry[],
  adminEntityKeys: Set<string>,
  hasExplicitMethods: boolean,
): { kind: 'wildcard' } | { kind: 'entry'; entry: RouteContractEntry } | { kind: 'error'; reason: string } {
  if (routePath.endsWith('/*')) {
    const prefix = routePath.slice(0, -2);
    const hasMatch =
      prefix === '/api'
        ? apiEntries.length > 0
        : apiEntries.some(
          (e) => e.routePath === prefix || e.routePath.startsWith(`${prefix}/`),
        );
    if (!hasMatch) {
      return {
        kind: 'error',
        reason: `Route wildcard "${routePath}" does not match any Next.js route under src/app/api/`,
      };
    }
    return { kind: 'wildcard' };
  }

  const exact = apiEntries.find((e) => e.routePath === routePath);
  if (exact) {
    return { kind: 'entry', entry: exact };
  }

  if (!hasExplicitMethods && /^\/api\/[a-z0-9-]+$/.test(routePath)) {
    const hasGroupChildren = apiEntries.some((e) => e.routePath.startsWith(`${routePath}/`));
    if (hasGroupChildren) {
      return { kind: 'wildcard' };
    }
  }

  const adminDynamicMatch = routePath.match(/^\/api\/admin\/([^/]+)(?:\/(.+))?$/);
  if (adminDynamicMatch) {
    const [, slug, rest] = adminDynamicMatch;
    if (slug !== '[entity]' && adminEntityKeys.has(slug)) {
      const canonicalAdminPath = rest ? `/api/admin/[entity]/${rest}` : '/api/admin/[entity]';
      const canonicalExact = apiEntries.find((e) => e.routePath === canonicalAdminPath);
      if (canonicalExact) {
        return { kind: 'entry', entry: canonicalExact };
      }
      const canonicalTargetSegs = canonicalAdminPath.split('/').filter(Boolean);
      const canonicalDynamic = apiEntries.find((e) =>
        matchDynamicRouteSegments(e.routePath.split('/').filter(Boolean), canonicalTargetSegs),
      );
      if (canonicalDynamic) {
        return { kind: 'entry', entry: canonicalDynamic };
      }
    }
  }

  const targetSegments = routePath.split('/').filter(Boolean);
  const dynamicEntry = apiEntries.find((e) =>
    matchDynamicRouteSegments(e.routePath.split('/').filter(Boolean), targetSegments),
  );
  if (dynamicEntry) {
    return { kind: 'entry', entry: dynamicEntry };
  }

  if (adminDynamicMatch && adminDynamicMatch[1] !== '[entity]') {
    return {
      kind: 'error',
      reason: `Route "${routePath}" does not match a static route under src/app/api/admin/ or any registered ENTITY_KEY in src/features/admin/registry.ts`,
    };
  }

  return {
    kind: 'error',
    reason: `Route "${routePath}" does not exist under src/app/api/`,
  };
}

interface InlineCodeSpan {
  code: string;
  start: number;
  end: number;
}

function extractInlineCodeSpans(line: string): InlineCodeSpan[] {
  const spans: InlineCodeSpan[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] !== '`') {
      i++;
      continue;
    }
    let tickCount = 1;
    while (i + tickCount < line.length && line[i + tickCount] === '`') {
      tickCount++;
    }
    const closer = '`'.repeat(tickCount);
    const closeIdx = line.indexOf(closer, i + tickCount);
    if (closeIdx === -1) {
      i += tickCount;
      continue;
    }
    spans.push({
      code: line.slice(i + tickCount, closeIdx),
      start: i,
      end: closeIdx + tickCount,
    });
    i = closeIdx + tickCount;
  }
  return spans;
}

function parseMethodsList(rawMethods: string | undefined): string[] {
  if (!rawMethods) return [];
  return rawMethods
    .split(/(?:\s*\/\s*|\s*,\s*|\s+\band\b\s+|\s+\bor\b\s+)/)
    .map((m) => m.trim())
    .filter((m) => HTTP_METHODS_SET.has(m));
}

function extractRouteCitationsFromLine(line: string): Array<{ methods: string[]; routePath: string }> {
  const citations: Array<{ methods: string[]; routePath: string }> = [];
  const spans = extractInlineCodeSpans(line);

  for (const span of spans) {
    const trimmed = span.code.trim();
    const directMatch = trimmed.match(
      /^(?:((?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)(?:\s*(?:\/|,|\band\b|\bor\b)\s*(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD))*)\s+)?(\/api\/[^\s`]+)$/,
    );
    if (directMatch) {
      const methods = parseMethodsList(directMatch[1]);
      for (const normalized of normalizeRouteToken(directMatch[2])) {
        citations.push({ methods, routePath: normalized });
      }
      continue;
    }

    const embeddedRegex = /(?:^|[\s'"(]|https?:\/\/[^/\s]+)(\/api\/[A-Za-z0-9_[\]./*{}-]+)/g;
    let embMatch: RegExpExecArray | null;
    while ((embMatch = embeddedRegex.exec(trimmed)) !== null) {
      const fullPrefixIdx = embMatch.index;
      if (fullPrefixIdx > 0 && /[A-Za-z0-9_.-]$/.test(trimmed.slice(0, fullPrefixIdx))) {
        continue;
      }
      for (const normalized of normalizeRouteToken(embMatch[1])) {
        citations.push({ methods: [], routePath: normalized });
      }
    }
  }

  let masked = '';
  let cursor = 0;
  for (const span of spans) {
    masked += line.slice(cursor, span.start) + ' '.repeat(span.end - span.start);
    cursor = span.end;
  }
  masked += line.slice(cursor);
  masked = masked.replace(/\]\([^)]*\)/g, (m) => ' '.repeat(m.length));

  const bareRegex =
    /(?:^|[\s(])(?:((?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)(?:\/(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD))*)\s+)?(\/api\/[A-Za-z0-9_[\]./*{}-]+)/g;
  let bareMatch: RegExpExecArray | null;
  while ((bareMatch = bareRegex.exec(masked)) !== null) {
    const methods = parseMethodsList(bareMatch[1]);
    for (const normalized of normalizeRouteToken(bareMatch[2])) {
      citations.push({ methods, routePath: normalized });
    }
  }

  return citations;
}

function safeDecodeTargetPath(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function parseLineRangeFromTarget(rawTarget: string): { start: number; end: number } | undefined {
  const hashIdx = rawTarget.indexOf('#');
  if (hashIdx === -1) return undefined;
  const fragment = rawTarget.slice(hashIdx + 1).trim();
  const match = fragment.match(LINE_RANGE_FRAGMENT_RE);
  if (!match) return undefined;
  const start = Number.parseInt(match[1], 10);
  const end = match[2] !== undefined ? Number.parseInt(match[2], 10) : start;
  return { start, end };
}

function resolveDocCitedSrcPath(rawTarget: string, docAbsPath: string, rootDir: string): string | null {
  const trimmedTarget = rawTarget.trim();
  const repoMatch = trimmedTarget.match(REPO_GITHUB_BLOB_URL_RE);
  if (repoMatch) {
    const repoRel = safeDecodeTargetPath(repoMatch[1]).replace(/\/+$/, '');
    if (!repoRel.startsWith('src/') || !/\.tsx?$/.test(repoRel)) {
      return null;
    }
    return repoRel;
  }

  const withoutAnchor = safeDecodeTargetPath(trimmedTarget.replace(/[?#].*$/, '').trim());
  if (!withoutAnchor || !/\.tsx?$/.test(withoutAnchor)) {
    return null;
  }

  let candidateAbs: string;
  if (withoutAnchor.startsWith('src/')) {
    candidateAbs = path.join(rootDir, withoutAnchor);
  } else if (withoutAnchor.startsWith('/src/')) {
    candidateAbs = path.join(rootDir, withoutAnchor.slice(1));
  } else if (withoutAnchor.startsWith('./') || withoutAnchor.startsWith('../')) {
    candidateAbs = path.resolve(path.dirname(docAbsPath), withoutAnchor);
  } else {
    return null;
  }

  const relToRoot = path.relative(rootDir, candidateAbs).replace(/\\/g, '/');
  if (!relToRoot.startsWith('src/')) {
    return null;
  }
  return relToRoot;
}

interface SymbolCitation {
  symbol: string;
  srcRelPath: string;
  requireExported: boolean;
  roleWord?: string;
  lineRange?: { start: number; end: number };
  additionalLineRanges?: Array<{ start: number; end: number }>;
  expectedValue?: ConstPrimitiveValue;
  rawExpectedValue?: string;
}

interface ParsedSpanSymbol {
  symbol: string;
  expectedValue?: ConstPrimitiveValue;
  rawExpectedValue?: string;
}

function parseAssignedSpan(rawInner: string): ParsedSpanSymbol | null {
  const trimmed = rawInner.trim();
  const assignMatch = trimmed.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([^=].*)$/);
  if (!assignMatch) return null;
  const ident = assignMatch[1];
  const rhs = assignMatch[2].trim();
  if (PRIMITIVE_KEYWORDS.has(ident)) return null;
  const evaluated = parseStaticConstSnippet(rhs);
  if (evaluated === null) return null;
  return {
    symbol: ident,
    expectedValue: evaluated,
    rawExpectedValue: rhs,
  };
}

function extractBacktickedSymbolEntries(segment: string): ParsedSpanSymbol[] {
  const results: ParsedSpanSymbol[] = [];
  const spans = extractInlineCodeSpans(segment);
  for (const span of spans) {
    const inner = span.code.trim();
    const assigned = parseAssignedSpan(inner);
    if (assigned) {
      results.push(assigned);
      continue;
    }
    const symMatch = inner.match(
      /^([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)?)(?:\(\))?$/,
    );
    if (!symMatch) continue;
    const cleaned = symMatch[1];
    if (PRIMITIVE_KEYWORDS.has(cleaned)) continue;
    results.push({ symbol: cleaned });
  }
  return results;
}

function extractBacktickedSymbolIdentifiers(segment: string): string[] {
  return extractBacktickedSymbolEntries(segment)
    .filter((entry) => entry.expectedValue === undefined)
    .map((entry) => entry.symbol);
}

function scanMarkdownLinksInLine(
  line: string,
): Array<{ label: string; rawTarget: string; start: number; end: number }> {
  const found: Array<{ label: string; rawTarget: string; start: number; end: number }> = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '\\') {
      i += 2;
      continue;
    }
    if (line[i] === '`') {
      let tickCount = 1;
      while (i + tickCount < line.length && line[i + tickCount] === '`') tickCount++;
      const closer = '`'.repeat(tickCount);
      const closeIdx = line.indexOf(closer, i + tickCount);
      i = closeIdx === -1 ? i + tickCount : closeIdx + tickCount;
      continue;
    }
    if (line[i] === '[' && (i === 0 || line[i - 1] !== '!')) {
      let depth = 1;
      let j = i + 1;
      while (j < line.length && depth > 0) {
        if (line[j] === '\\') {
          j += 2;
          continue;
        }
        if (line[j] === '`') {
          let tickCount = 1;
          while (j + tickCount < line.length && line[j + tickCount] === '`') tickCount++;
          const closer = '`'.repeat(tickCount);
          const closeIdx = line.indexOf(closer, j + tickCount);
          j = closeIdx === -1 ? j + tickCount : closeIdx + tickCount;
          continue;
        }
        if (line[j] === '[') depth++;
        else if (line[j] === ']') depth--;
        j++;
      }
      if (depth === 0 && j < line.length && line[j] === '(') {
        let pDepth = 1;
        let k = j + 1;
        while (k < line.length && pDepth > 0) {
          if (line[k] === '\\') {
            k += 2;
            continue;
          }
          if (line[k] === '(') pDepth++;
          else if (line[k] === ')') pDepth--;
          k++;
        }
        if (pDepth === 0) {
          const label = line.slice(i + 1, j - 1);
          const rawInner = line.slice(j + 1, k - 1).trim();
          const rawTarget = rawInner.replace(/^<([^>]+)>$/, '$1').split(/\s+/)[0] ?? '';
          found.push({ label, rawTarget, start: i, end: k });
          i = k;
          continue;
        }
      }
    }
    i++;
  }
  return found;
}

function extractSymbolCitationsFromLine(
  line: string,
  docAbsPath: string,
  rootDir: string,
  envVarNames: Set<string>,
  fallbackConstSrcRelPath?: string | null,
): SymbolCitation[] {
  const citations: SymbolCitation[] = [];
  const seenKeys = new Set<string>();

  function pushCitation(c: SymbolCitation) {
    const key = `${c.symbol}::${c.srcRelPath}::${c.lineRange ? `${c.lineRange.start}-${c.lineRange.end}` : 'module'}::${c.expectedValue !== undefined ? String(c.expectedValue) : ''}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    citations.push(c);
  }

  function shouldSkipSymbol(symbol: string, srcRelPath: string): boolean {
    if (PRIMITIVE_KEYWORDS.has(symbol)) return true;
    if (srcRelPath !== 'src/env.ts' && envVarNames.has(symbol)) return true;
    if (BUILTIN_GLOBAL_IDENTIFIERS.has(symbol) || STANDARD_HTTP_HEADERS.has(symbol)) return true;
    const isApiOrRouteModule =
      /(?:^|\/)route\.tsx?$/.test(srcRelPath) || srcRelPath.includes('/api/');
    if (HTTP_METHODS_SET.has(symbol) && !isApiOrRouteModule) return true;
    return false;
  }

  if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
    const cells = line
      .trim()
      .slice(1, -1)
      .split(/(?<!\\)\|/)
      .map((c) => c.trim());

    if (cells.length === 4) {
      const barrelMatch = cells[1].match(/^`(src\/features\/[^`]+\/index\.tsx?)`$/);
      if (barrelMatch && /^`[a-z0-9-]+`$/i.test(cells[0])) {
        const barrelRel = barrelMatch[1];
        for (const sym of [
          ...extractBacktickedSymbolIdentifiers(cells[2]),
          ...extractBacktickedSymbolIdentifiers(cells[3]),
        ]) {
          pushCitation({ symbol: sym, srcRelPath: barrelRel, requireExported: true });
        }
      }
    }

    if (cells.length === 5) {
      const barrelMatch = cells[2].match(/^`(src\/features\/[^`]+\/index\.tsx?)`$/);
      const classMatch = cells[1].match(/^`([A-Za-z_$][A-Za-z0-9_$]*)`$/);
      if (barrelMatch && classMatch) {
        pushCitation({
          symbol: classMatch[1],
          srcRelPath: barrelMatch[1],
          requireExported: true,
        });
      }
    }
  }

  // Extract [Symbol](src/...) and [`Symbol`](src/...) link labels
  const lineLinks = scanMarkdownLinksInLine(line);
  const resolvedLineTargets: Array<{
    srcRelPath: string;
    lineRange?: { start: number; end: number };
    start: number;
    end: number;
  }> = [];

  for (const link of lineLinks) {
    const srcRelPath = resolveDocCitedSrcPath(link.rawTarget, docAbsPath, rootDir);
    if (!srcRelPath) continue;
    const lineRange = parseLineRangeFromTarget(link.rawTarget);
    resolvedLineTargets.push({ srcRelPath, lineRange, start: link.start, end: link.end });

    const trimmedLabel = link.label.trim();
    const isBacktickedLabel = /^`[^`]+`$/.test(trimmedLabel);
    let innerLabel = isBacktickedLabel ? trimmedLabel.slice(1, -1).trim() : trimmedLabel;
    if (innerLabel.includes('/') || /\.[A-Za-z0-9]+$/.test(innerLabel)) {
      continue;
    }
    const jsxMatch = innerLabel.match(/^<\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\/?\s*>$/);
    if (jsxMatch) {
      innerLabel = jsxMatch[1];
    }
    const hasCallParens = innerLabel.endsWith('()');
    if (hasCallParens) {
      innerLabel = innerLabel.slice(0, -2);
    }

    const assignedLabel = isBacktickedLabel ? parseAssignedSpan(innerLabel) : null;
    if (assignedLabel) {
      if (!shouldSkipSymbol(assignedLabel.symbol, srcRelPath)) {
        pushCitation({
          symbol: assignedLabel.symbol,
          srcRelPath,
          requireExported: false,
          lineRange,
          expectedValue: assignedLabel.expectedValue,
          rawExpectedValue: assignedLabel.rawExpectedValue,
        });
      }
      continue;
    }

    if (!/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)?$/.test(innerLabel)) {
      continue;
    }
    if (!isBacktickedLabel && !hasCallParens && PROSE_LOWERCASE_LINK_LABELS.has(innerLabel)) {
      continue;
    }
    if (shouldSkipSymbol(innerLabel, srcRelPath)) {
      continue;
    }
    pushCitation({
      symbol: innerLabel,
      srcRelPath,
      requireExported: false,
      lineRange,
    });
  }

  const lineCodeSpans = extractInlineCodeSpans(line);

  // Also record bare backticked `src/...ts(x)` targets on the line for symbol & constant resolution
  for (const span of lineCodeSpans) {
    if (lineLinks.some((lk) => span.start >= lk.start && span.end <= lk.end)) continue;
    const srcRelPath = resolveDocCitedSrcPath(span.code, docAbsPath, rootDir);
    if (!srcRelPath) continue;
    const lineRange = parseLineRangeFromTarget(span.code);
    resolvedLineTargets.push({ srcRelPath, lineRange, start: span.start, end: span.end });
  }
  resolvedLineTargets.sort((a, b) => a.start - b.start);

  const roleNounSuffixRe =
    /^(.*?)(\s+(?:handler|handlers|function|functions|helper|helpers|method|methods|schema|schemas|class|classes|type|types|interface|interfaces|constant|constants|service|services|hook|hooks))?(?:(?:\s*,)?\s+(?:in|from|at|inside|within|via|defined in|declared in|exported by|exported from|implemented in)\s+|\s*\(\s*(?:see\s+|in\s+|at\s+|via\s+)?|\s*,\s*)$/;
  const symChainSepRe = /^\s*(?:,|\/|\band\b|\bor\b|&|->|→)\s*(?:handler\s*(?:->|→)\s*)?$/;
  const joinedTargetsBetweenRe =
    /^(?:\s*\(L\d+(?:-L?\d+)?\))?\s*(?:,|\/|\band\b|\bor\b|&)\s*(?:mapped in\s+|in\s+|at\s+)?$/i;

  const collectJoinedRangesAfter = (targetIdx: number): Array<{ start: number; end: number }> => {
    const base = resolvedLineTargets[targetIdx];
    if (!base.lineRange) return [];
    const extras: Array<{ start: number; end: number }> = [];
    let prev = base;
    for (let nextIdx = targetIdx + 1; nextIdx < resolvedLineTargets.length; nextIdx++) {
      const next = resolvedLineTargets[nextIdx];
      const between = line.slice(prev.end, next.start);
      if (!joinedTargetsBetweenRe.test(between)) break;
      if (next.srcRelPath === base.srcRelPath && next.lineRange) {
        extras.push(next.lineRange);
      }
      prev = next;
    }
    return extras;
  };

  for (let tIdx = 0; tIdx < resolvedLineTargets.length; tIdx++) {
    const target = resolvedLineTargets[tIdx];
    const prefix = line.slice(0, target.start);
    const suffixMatch = prefix.match(roleNounSuffixRe);
    if (!suffixMatch) continue;
    // Only allow trailing `, ` suffix when inside an unclosed `(` (e.g. `(`sym`, [src/...])`)
    if (/,\s*$/.test(prefix) && !/\([^()]*$/.test(prefix)) {
      continue;
    }
    const head = suffixMatch[1];
    const roleWord = suffixMatch[2]?.trim();
    const headTrimmedLen = head.replace(/\s+$/, '').length;

    let spanIdx = -1;
    for (let s = lineCodeSpans.length - 1; s >= 0; s--) {
      if (lineCodeSpans[s].end === headTrimmedLen) {
        spanIdx = s;
        break;
      }
    }
    if (spanIdx === -1) continue;

    const chainEntries: ParsedSpanSymbol[] = [];
    let currIdx = spanIdx;
    while (currIdx >= 0) {
      const spanText = `\`${lineCodeSpans[currIdx].code}\``;
      const parsedEntries = extractBacktickedSymbolEntries(spanText);
      if (parsedEntries.length === 0) break;
      chainEntries.unshift(...parsedEntries);

      if (currIdx === 0) break;
      const prevSpan = lineCodeSpans[currIdx - 1];
      const between = head.slice(prevSpan.end, lineCodeSpans[currIdx].start);
      if (!symChainSepRe.test(between)) break;
      currIdx--;
    }

    const additionalLineRanges = collectJoinedRangesAfter(tIdx);
    for (const entry of chainEntries) {
      if (shouldSkipSymbol(entry.symbol, target.srcRelPath)) {
        continue;
      }
      const isEnvVarInEnvTs = target.srcRelPath === 'src/env.ts' && envVarNames.has(entry.symbol);
      pushCitation({
        symbol: entry.symbol,
        srcRelPath: target.srcRelPath,
        requireExported: false,
        roleWord,
        lineRange: target.lineRange,
        additionalLineRanges: additionalLineRanges.length > 0 ? additionalLineRanges : undefined,
        expectedValue: isEnvVarInEnvTs ? undefined : entry.expectedValue,
        rawExpectedValue: isEnvVarInEnvTs ? undefined : entry.rawExpectedValue,
      });
    }
  }

  // Extract assigned constant code spans like `REGISTRY_LOAD_MORE_INCREMENT = 8` paired with a module citation on the line (or intro header)
  for (const span of lineCodeSpans) {
    const rawTrimmed = span.code.trim();
    // Require SCREAMING_SNAKE_CASE constant with spaces around `=` for unbound clause-level constant spans
    if (!/^[A-Z][A-Z0-9_]*_[A-Z0-9_]*\s+=\s+[^=]|^[A-Z]{2,}[A-Z0-9]*\s+=\s+[^=]/.test(rawTrimmed)) {
      continue;
    }
    const parsed = parseAssignedSpan(rawTrimmed);
    if (!parsed || parsed.expectedValue === undefined) {
      continue;
    }
    const alreadyBound = citations.some(
      (c) => c.symbol === parsed.symbol && c.expectedValue !== undefined,
    );
    if (alreadyBound) {
      continue;
    }

    if (resolvedLineTargets.length > 0) {
      const afterTargets = resolvedLineTargets.filter((t) => t.start > span.end);
      const chosen = afterTargets.length > 0 ? afterTargets[0] : resolvedLineTargets[resolvedLineTargets.length - 1];
      if (!shouldSkipSymbol(parsed.symbol, chosen.srcRelPath)) {
        pushCitation({
          symbol: parsed.symbol,
          srcRelPath: chosen.srcRelPath,
          requireExported: false,
          lineRange: chosen.lineRange,
          expectedValue: parsed.expectedValue,
          rawExpectedValue: parsed.rawExpectedValue,
        });
      }
    } else if (fallbackConstSrcRelPath) {
      if (!shouldSkipSymbol(parsed.symbol, fallbackConstSrcRelPath)) {
        pushCitation({
          symbol: parsed.symbol,
          srcRelPath: fallbackConstSrcRelPath,
          requireExported: false,
          expectedValue: parsed.expectedValue,
          rawExpectedValue: parsed.rawExpectedValue,
        });
      }
    }
  }

  return citations;
}

function formatConstValue(value: ConstPrimitiveValue): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

function resolveImportedConstValues(
  symbol: string,
  absTarget: string,
  inventory: ModuleSymbolInventory,
  rootDir: string,
): Set<ConstPrimitiveValue> | undefined {
  const imp = inventory.localImports.get(symbol);
  if (!imp) return undefined;
  const targetPath = resolveLocalTsModule(absTarget, imp.specifier, rootDir);
  if (!targetPath) return undefined;
  return getExportedConstInitializers(targetPath, rootDir).get(imp.importedName);
}

function verifyExpectedConstantValue(
  citation: SymbolCitation,
  absTarget: string,
  inventory: ModuleSymbolInventory,
  rootDir: string,
): string | null {
  if (citation.expectedValue === undefined) {
    return null;
  }
  const combined = new Set<ConstPrimitiveValue>();
  const localVals = inventory.constInitializers.get(citation.symbol);
  if (localVals) {
    for (const v of localVals) combined.add(v);
  }
  const importedVals = resolveImportedConstValues(citation.symbol, absTarget, inventory, rootDir);
  if (importedVals) {
    for (const v of importedVals) combined.add(v);
  }

  if (combined.size === 0) {
    return `Constant "${citation.symbol}" is not declared or assigned a static constant value in ${citation.srcRelPath}`;
  }
  if (!combined.has(citation.expectedValue)) {
    const actualList = Array.from(combined).map(formatConstValue).join(' | ');
    return `Constant "${citation.symbol}" in ${citation.srcRelPath} has value ${actualList}, expected ${formatConstValue(citation.expectedValue)}`;
  }
  return null;
}

function verifySymbolInModule(
  citation: SymbolCitation,
  rootDir: string,
): string | null {
  const absTarget = path.join(rootDir, citation.srcRelPath);
  if (!fs.existsSync(absTarget)) {
    return `Referenced source module "${citation.srcRelPath}" (for symbol "${citation.symbol}") does not exist`;
  }

  const inventory = getModuleSymbolInventory(absTarget, rootDir);

  if (citation.lineRange) {
    const { start, end } = citation.lineRange;
    const allRanges = [citation.lineRange, ...(citation.additionalLineRanges ?? [])];
    const sliceInv = getFileSliceInventory(absTarget);
    for (const r of allRanges) {
      if (r.start < 1 || r.end < r.start || r.end > sliceInv.lineCount) {
        return `Line range #L${r.start}-L${r.end} is out of bounds for ${citation.srcRelPath} (${sliceInv.lineCount} lines)`;
      }
    }

    const sliceTokens = new Set<string>();
    const isTsx = citation.srcRelPath.endsWith('.tsx');
    for (const r of allRanges) {
      for (const tok of collectSliceTokens(sliceInv.lines, r.start, r.end, isTsx)) {
        sliceTokens.add(tok);
      }
    }

    const matchesSliceOrEnclosingDecl = (token: string): boolean => {
      if (sliceTokens.has(token)) {
        return true;
      }
      const ranges = sliceInv.declRanges.get(token);
      if (
        ranges &&
        allRanges.some((citeR) => ranges.some((r) => r.start <= citeR.start && citeR.end <= r.end))
      ) {
        return true;
      }
      return false;
    };

    if (citation.symbol.includes('.')) {
      const [containerName, memberName] = citation.symbol.split('.');
      if (!inventory.topLevelDeclarations.has(containerName)) {
        return `Symbol "${containerName}" (from "${citation.symbol}") is not declared or exported in ${citation.srcRelPath}`;
      }
      const members = inventory.classAndObjectMembers.get(containerName);
      if (!members || !members.has(memberName)) {
        return `Member "${memberName}" on "${containerName}" ("${citation.symbol}") does not exist in ${citation.srcRelPath}`;
      }
      if (!matchesSliceOrEnclosingDecl(memberName)) {
        return `Member "${memberName}" on "${containerName}" ("${citation.symbol}") is not in ${citation.srcRelPath}#L${start}-L${end}`;
      }
      return null;
    }

    const sliceMatched =
      matchesSliceOrEnclosingDecl(citation.symbol) ||
      ((citation.roleWord === 'schema' || citation.roleWord === 'schemas') &&
        matchesSliceOrEnclosingDecl(`${citation.symbol}Schema`));

    if (!sliceMatched) {
      return `Symbol "${citation.symbol}" is not declared or referenced in ${citation.srcRelPath}#L${start}-L${end}`;
    }

    return verifyExpectedConstantValue(citation, absTarget, inventory, rootDir);
  }

  if (citation.symbol.includes('.')) {
    const [containerName, memberName] = citation.symbol.split('.');
    if (!inventory.topLevelDeclarations.has(containerName)) {
      return `Symbol "${containerName}" (from "${citation.symbol}") is not declared or exported in ${citation.srcRelPath}`;
    }
    const members = inventory.classAndObjectMembers.get(containerName);
    if (!members || !members.has(memberName)) {
      return `Member "${memberName}" on "${containerName}" ("${citation.symbol}") does not exist in ${citation.srcRelPath}`;
    }
    return null;
  }

  if (citation.requireExported) {
    if (!inventory.exportsValues.has(citation.symbol) && !inventory.exportsTypes.has(citation.symbol)) {
      return `Symbol "${citation.symbol}" is not exported by ${citation.srcRelPath}`;
    }
    return verifyExpectedConstantValue(citation, absTarget, inventory, rootDir);
  }

  if (
    inventory.topLevelDeclarations.has(citation.symbol) ||
    inventory.allClassMemberNames.has(citation.symbol) ||
    inventory.propertyAndConstLiterals.has(citation.symbol) ||
    ((citation.roleWord === 'schema' || citation.roleWord === 'schemas') &&
      inventory.topLevelDeclarations.has(`${citation.symbol}Schema`)) ||
    (citation.expectedValue !== undefined &&
      (inventory.constInitializers.has(citation.symbol) ||
        resolveImportedConstValues(citation.symbol, absTarget, inventory, rootDir) !== undefined))
  ) {
    return verifyExpectedConstantValue(citation, absTarget, inventory, rootDir);
  }

  return `Symbol "${citation.symbol}" is not declared or exported in ${citation.srcRelPath}`;
}

interface UnprotectedRouteSpec {
  sourceRelPath: string;
  routePath: string;
  methods?: string[];
}

function extractUnprotectedApiRoutes(rootDir: string): UnprotectedRouteSpec[] {
  const results: UnprotectedRouteSpec[] = [];
  const routesFilePath = path.join(rootDir, 'src/lib/routes.ts');

  if (fs.existsSync(routesFilePath)) {
    const sf = getCachedSourceFile(routesFilePath).sf;
    function visit(node: ts.Node) {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === 'APP_ROUTES' &&
        node.initializer &&
        ts.isArrayLiteralExpression(node.initializer)
      ) {
        for (const el of node.initializer.elements) {
          if (!ts.isObjectLiteralExpression(el)) continue;
          let routePath: string | null = null;
          const roles: string[] = [];
          const methods: string[] = [];
          let hasRequiredModule = false;

          for (const prop of el.properties) {
            if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
            const propName = prop.name.text;
            if (propName === 'path' && ts.isStringLiteralLike(prop.initializer)) {
              routePath = prop.initializer.text;
            } else if (propName === 'roles' && ts.isArrayLiteralExpression(prop.initializer)) {
              for (const roleEl of prop.initializer.elements) {
                if (ts.isStringLiteralLike(roleEl)) {
                  roles.push(roleEl.text);
                }
              }
            } else if (propName === 'methods' && ts.isArrayLiteralExpression(prop.initializer)) {
              for (const methodEl of prop.initializer.elements) {
                if (ts.isStringLiteralLike(methodEl)) {
                  methods.push(methodEl.text.toUpperCase());
                }
              }
            } else if (propName === 'requiredModule') {
              hasRequiredModule = true;
            }
          }

          if (
            routePath &&
            routePath.startsWith('/api/') &&
            roles.includes('public') &&
            !hasRequiredModule
          ) {
            results.push({
              sourceRelPath: 'src/lib/routes.ts',
              routePath,
              methods: methods.length > 0 ? methods : undefined,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);
  }

  const metadataFilePath = path.join(rootDir, 'src/app/metadata.ts');
  if (fs.existsSync(metadataFilePath)) {
    const metadataSource = fs.readFileSync(metadataFilePath, 'utf8');
    if (/\/api\/og(?=[?'"`\s/]|$)/.test(metadataSource)) {
      if (!results.some((r) => r.routePath === '/api/og')) {
        results.push({
          sourceRelPath: 'src/app/metadata.ts',
          routePath: '/api/og',
          methods: ['GET'],
        });
      }
    }
  }

  return results;
}

function collectAuthModulePaths(rootDir: string): string[] {
  const authDir = path.join(rootDir, 'src/core/auth');
  if (!fs.existsSync(authDir)) return [];

  const entries = fs.readdirSync(authDir, { withFileTypes: true });
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        /\.tsx?$/.test(entry.name) &&
        !/\.(?:test|spec)\.tsx?$/.test(entry.name) &&
        !entry.name.endsWith('.d.ts'),
    )
    .map((entry) => `src/core/auth/${entry.name}`)
    .sort();
}

function collectSiteEnvOverridesFromConfig(rootDir: string): string[] {
  const configPath = path.join(rootDir, 'src/lib/config.ts');
  if (!fs.existsSync(configPath)) return [];

  const sf = getCachedSourceFile(configPath).sf;
  const found = new Set<string>();

  function visit(node: ts.Node) {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text.startsWith('SITE_') &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'process' &&
      node.expression.name.text === 'env'
    ) {
      found.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);

  return Array.from(found).sort();
}

function stripFencesAndHtmlComments(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const kept: string[] = [];
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;

  for (const line of lines) {
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      const trailing = fenceMatch[2];
      if (!inFence) {
        inFence = true;
        fenceChar = marker[0];
        fenceLen = marker.length;
        continue;
      } else if (
        marker[0] === fenceChar &&
        marker.length >= fenceLen &&
        trailing.trim() === ''
      ) {
        inFence = false;
        fenceChar = '';
        fenceLen = 0;
        continue;
      }
    }
    if (inFence) continue;
    if (line.trim().startsWith('<!--') && line.trim().endsWith('-->')) continue;
    kept.push(line);
  }

  return kept.join('\n');
}

function verifyArchitectureAndMiddlewareContracts(
  rootDir: string,
  apiEntries: RouteContractEntry[],
  specFiles: string[],
  errors: string[],
): void {
  const middlewarePath = path.join(rootDir, 'src/middleware.ts');
  const unprotectedRoutes = extractUnprotectedApiRoutes(rootDir);
  const archAbsPath = path.join(rootDir, 'ARCHITECTURE.md');
  const hasArchSpec = specFiles.includes('ARCHITECTURE.md') && fs.existsSync(archAbsPath);
  const archProse = hasArchSpec
    ? stripFencesAndHtmlComments(fs.readFileSync(archAbsPath, 'utf8'))
    : null;

  if (unprotectedRoutes.length > 0 && fs.existsSync(middlewarePath)) {
    const middlewareExclusions = getMiddlewarePublicApiExclusions(rootDir);
    for (const item of unprotectedRoutes) {
      const matchingEntry = apiEntries.find((e) => e.routePath === item.routePath);
      const targetMethods =
        item.methods ??
        (matchingEntry && matchingEntry.methods.length > 0 ? matchingEntry.methods : ['GET']);

      for (const method of targetMethods) {
        if (!isMiddlewarePublicApiMethod(item.routePath, method, middlewareExclusions)) {
          errors.push(
            `${item.sourceRelPath}: Unprotected API route "${item.routePath}" (${method}) is not excluded from the cookie gate in src/middleware.ts`,
          );
        }
      }

      if (archProse !== null && matchingEntry) {
        const escapedRoute = item.routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const publicTableRowRegex = new RegExp(
          `^\\|\\s*\`${escapedRoute}\`\\s*\\|[^\\n]*\\|\\s*\`Public\`\\s*\\|\\s*$`,
          'm',
        );
        if (!publicTableRowRegex.test(archProse)) {
          errors.push(
            `ARCHITECTURE.md: Unprotected API route "${item.routePath}" from ${item.sourceRelPath} is not documented with Access Tier \`Public\``,
          );
        }
      }
    }
  }

  if (archProse !== null) {
    for (const authModuleRel of collectAuthModulePaths(rootDir)) {
      if (!archProse.includes(authModuleRel)) {
        errors.push(
          `ARCHITECTURE.md: Authentication module "${authModuleRel}" in src/core/auth/ is not documented in ARCHITECTURE.md`,
        );
      }
    }

    for (const siteEnvVar of collectSiteEnvOverridesFromConfig(rootDir)) {
      const envRegex = new RegExp(`\\b${siteEnvVar}\\b`);
      if (!envRegex.test(archProse)) {
        errors.push(
          `ARCHITECTURE.md: Environment variable override "${siteEnvVar}" in src/lib/config.ts is not documented in ARCHITECTURE.md`,
        );
      }
    }
  }
}

function verifyOpenApiProbeContracts(rootDir: string): string[] {
  const openapiPath = path.join(rootDir, 'public/openapi.json');
  if (!fs.existsSync(openapiPath)) {
    return [];
  }

  const errors: string[] = [];
  let parsed: {
    components?: {
      schemas?: Record<string, Record<string, unknown>>;
    };
    paths?: Record<
      string,
      {
        get?: {
          responses?: Record<
            string,
            {
              content?: Record<string, { schema?: Record<string, unknown> }>;
            }
          >;
        };
      }
    >;
  };

  try {
    parsed = JSON.parse(fs.readFileSync(openapiPath, 'utf8'));
  } catch {
    return ['public/openapi.json: Invalid JSON syntax'];
  }

  const getJsonSchema = (routePath: string, status: string): Record<string, unknown> | null => {
    const schema =
      parsed.paths?.[routePath]?.get?.responses?.[status]?.content?.['application/json']?.schema;
    if (!schema || typeof schema !== 'object') {
      return null;
    }
    if (typeof schema.$ref === 'string' && schema.$ref.startsWith('#/components/schemas/')) {
      const schemaName = schema.$ref.slice('#/components/schemas/'.length);
      const target = parsed.components?.schemas?.[schemaName];
      return target && typeof target === 'object' ? target : null;
    }
    return schema;
  };

  // 1. /api/live GET 200
  const live200 = getJsonSchema('/api/live', '200');
  const live200Props = (live200?.properties ?? {}) as Record<string, Record<string, unknown>>;
  if (
    !live200 ||
    !Array.isArray(live200Props.status?.enum) ||
    !live200Props.status.enum.includes('alive') ||
    live200Props.timestamp?.type !== 'string'
  ) {
    errors.push(
      'public/openapi.json: GET /api/live must document HTTP "200" application/json schema with status="alive" and timestamp'
    );
  }

  // 2. /api/health GET 200 & 503 (wrapped by withApiMiddleware)
  const health200 = getJsonSchema('/api/health', '200');
  const health200Props = (health200?.properties ?? {}) as Record<string, Record<string, unknown>>;
  const health200DataProps = ((health200Props.data?.properties ?? {}) as Record<
    string,
    Record<string, unknown>
  >);
  if (
    !health200 ||
    !Array.isArray(health200Props.success?.enum) ||
    !health200Props.success.enum.includes(true) ||
    !Array.isArray(health200DataProps.status?.enum) ||
    !health200DataProps.status.enum.includes('ok') ||
    !Array.isArray(health200DataProps.database?.enum) ||
    !health200DataProps.database.enum.includes('connected')
  ) {
    errors.push(
      'public/openapi.json: GET /api/health must document HTTP "200" wrapped schema (.success == true, .data.status == "ok", .data.database == "connected")'
    );
  }

  const health503 = getJsonSchema('/api/health', '503');
  const health503Props = (health503?.properties ?? {}) as Record<string, Record<string, unknown>>;
  const healthRouteAbsPath = path.join(rootDir, 'src/app/api/health/route.ts');
  const healthPreservesProbeFields =
    fs.existsSync(healthRouteAbsPath) &&
    fs.readFileSync(healthRouteAbsPath, 'utf8').includes('isHealthProbe');

  if (healthPreservesProbeFields) {
    if (
      !health503 ||
      !Array.isArray(health503Props.success?.enum) ||
      !health503Props.success.enum.includes(false) ||
      !Array.isArray(health503Props.status?.enum) ||
      !health503Props.status.enum.includes('degraded') ||
      !Array.isArray(health503Props.database?.enum) ||
      !health503Props.database.enum.includes('disconnected') ||
      health503Props.timestamp?.type !== 'string' ||
      health503Props.error?.type !== 'string'
    ) {
      errors.push(
        'public/openapi.json: GET /api/health must document HTTP "503" isHealthProbe schema with success=false, status="degraded", database="disconnected", timestamp, and error'
      );
    } else if (Object.prototype.hasOwnProperty.call(health503Props, 'referenceId')) {
      errors.push(
        'public/openapi.json: GET /api/health HTTP "503" isHealthProbe schema must omit "referenceId"'
      );
    }
  } else if (
    !health503 ||
    !Array.isArray(health503Props.success?.enum) ||
    !health503Props.success.enum.includes(false) ||
    health503Props.error?.type !== 'string' ||
    health503Props.referenceId?.type !== 'string'
  ) {
    errors.push(
      'public/openapi.json: GET /api/health must document HTTP "503" middleware error schema with success=false, error, and optional referenceId'
    );
  } else {
    for (const strippedKey of ['status', 'database', 'timestamp']) {
      if (Object.prototype.hasOwnProperty.call(health503Props, strippedKey)) {
        errors.push(
          `public/openapi.json: GET /api/health HTTP "503" schema must omit "${strippedKey}" (stripped by src/utils/withApiMiddleware.ts)`
        );
      }
    }
  }

  // 3. /api/ready GET 200 & 503 (unwrapped)
  const ready200 = getJsonSchema('/api/ready', '200');
  const ready200Props = (ready200?.properties ?? {}) as Record<string, Record<string, unknown>>;
  if (
    !ready200 ||
    !Array.isArray(ready200Props.status?.enum) ||
    !ready200Props.status.enum.includes('ready') ||
    !Array.isArray(ready200Props.database?.enum) ||
    !ready200Props.database.enum.includes('connected') ||
    ready200Props.timestamp?.type !== 'string'
  ) {
    errors.push(
      'public/openapi.json: GET /api/ready must document HTTP "200" unwrapped schema with status="ready", database="connected", and timestamp'
    );
  }

  const ready503 = getJsonSchema('/api/ready', '503');
  const ready503Props = (ready503?.properties ?? {}) as Record<string, Record<string, unknown>>;
  const readyRouteAbsPath = path.join(rootDir, 'src/app/api/ready/route.ts');
  const readyChecksSchemaTables =
    fs.existsSync(readyRouteAbsPath) &&
    fs.readFileSync(readyRouteAbsPath, 'utf8').includes('buildSchemaUnavailableResponse');
  const ready503DbEnum = Array.isArray(ready503Props.database?.enum)
    ? ready503Props.database.enum
    : [];
  if (
    !ready503 ||
    !Array.isArray(ready503Props.status?.enum) ||
    !ready503Props.status.enum.includes('unhealthy') ||
    !ready503DbEnum.includes('disconnected') ||
    (readyChecksSchemaTables && !ready503DbEnum.includes('connected')) ||
    ready503Props.error?.type !== 'string' ||
    ready503Props.timestamp?.type !== 'string'
  ) {
    errors.push(
      readyChecksSchemaTables
        ? 'public/openapi.json: GET /api/ready must document HTTP "503" unwrapped schema with status="unhealthy", database enum ["connected", "disconnected"], error, and timestamp'
        : 'public/openapi.json: GET /api/ready must document HTTP "503" unwrapped schema with status="unhealthy", database="disconnected", error, and timestamp'
    );
  }

  return errors;
}

export function verifySpecContracts(
  rootDir: string = ROOT_DIR,
  options: SpecContractVerificationOptions = {},
): SpecContractVerificationResult {
  symbolInventoryCache.clear();
  sliceInventoryCache.clear();
  exportedConstInitializersCache.clear();
  parsedSourceCache.clear();
  moduleExportsCache.clear();
  localModuleResolveCache.clear();
  const errors: string[] = [];
  let checkedRoutes = 0;
  let checkedSymbols = 0;

  if (!options.specFiles || options.specFiles.includes('public/openapi.json')) {
    errors.push(...verifyOpenApiProbeContracts(rootDir));
  }

  const apiEntries = collectFastApiRouteEntries(rootDir);
  const adminEntityKeys = extractFastAdminEntityKeys(rootDir);

  const envVarNames = extractEnvVarNames(rootDir);
  const specFiles = discoverSpecFiles(rootDir, options.specFiles);

  for (const specRelPath of specFiles) {
    const specAbsPath = path.join(rootDir, specRelPath);
    if (!fs.existsSync(specAbsPath)) continue;

    const content = fs.readFileSync(specAbsPath, 'utf8');
    const lines = content.split(/\r?\n/);

    let inFence = false;
    let fenceMarkerChar = '';
    let fenceMarkerLen = 0;
    let activeIntroConstSrcRelPath: string | null = null;

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      const lineNum = idx + 1;

      const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
      if (fenceMatch) {
        const marker = fenceMatch[1];
        const trailing = fenceMatch[2];
        if (!inFence) {
          inFence = true;
          fenceMarkerChar = marker[0];
          fenceMarkerLen = marker.length;
          activeIntroConstSrcRelPath = null;
          continue;
        } else if (
          marker[0] === fenceMarkerChar &&
          marker.length >= fenceMarkerLen &&
          trailing.trim() === ''
        ) {
          inFence = false;
          fenceMarkerChar = '';
          fenceMarkerLen = 0;
          continue;
        }
      }

      if (inFence) continue;
      if (line.trim().startsWith('<!--') && line.trim().endsWith('-->')) continue;
      if (/^\s{0,3}#{1,6}\s+/.test(line) || line.trim() === '---') {
        activeIntroConstSrcRelPath = null;
      } else if (line.trim() !== '' && !/^\s*(?:[-*+]|\d+\.)\s+/.test(line) && !line.trim().endsWith(':')) {
        activeIntroConstSrcRelPath = null;
      }

      const routeCitations = extractRouteCitationsFromLine(line);
      for (const routeCitation of routeCitations) {
        checkedRoutes++;
        const matchResult = resolveApiRouteMatch(
          routeCitation.routePath,
          apiEntries,
          adminEntityKeys,
          routeCitation.methods.length > 0,
        );
        if (matchResult.kind === 'error') {
          errors.push(`${specRelPath}:${lineNum}: ${matchResult.reason}`);
          continue;
        }
        if (matchResult.kind === 'entry' && routeCitation.methods.length > 0) {
          for (const method of routeCitation.methods) {
            if (!matchResult.entry.methods.includes(method)) {
              errors.push(
                `${specRelPath}:${lineNum}: Route "${routeCitation.routePath}" does not export HTTP method "${method}" (exported: [${matchResult.entry.methods.join(', ')}] in ${matchResult.entry.handlerPath})`,
              );
            }
          }
        }
      }

      const symbolCitations = extractSymbolCitationsFromLine(
        line,
        specAbsPath,
        rootDir,
        envVarNames,
        activeIntroConstSrcRelPath,
      );
      for (const symCitation of symbolCitations) {
        checkedSymbols++;
        const symError = verifySymbolInModule(symCitation, rootDir);
        if (symError) {
          errors.push(`${specRelPath}:${lineNum}: ${symError}`);
        }
      }

      if (line.trim().endsWith(':') && !/^\s{2,}(?:[-*+]|\d+\.)\s+/.test(line)) {
        const introPaths = new Set<string>();
        for (const link of scanMarkdownLinksInLine(line)) {
          const p = resolveDocCitedSrcPath(link.rawTarget, specAbsPath, rootDir);
          if (p) introPaths.add(p);
        }
        for (const span of extractInlineCodeSpans(line)) {
          const p = resolveDocCitedSrcPath(span.code, specAbsPath, rootDir);
          if (p) introPaths.add(p);
        }
        if (introPaths.size === 1) {
          activeIntroConstSrcRelPath = Array.from(introPaths)[0];
        }
      }
    }
  }

  verifyArchitectureAndMiddlewareContracts(rootDir, apiEntries, specFiles, errors);

  return {
    errors,
    checkedRoutes,
    checkedSymbols,
  };
}

function main(): void {
  const result = verifySpecContracts(ROOT_DIR);
  if (result.errors.length > 0) {
    console.error('❌ Specification route and symbol contract verification failed:');
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }
  console.log(
    `✅ Specification route and symbol contracts verified (${result.checkedRoutes} route citations, ${result.checkedSymbols} symbol citations).`,
  );
}

const isDirectExecution =
  typeof process.argv[1] === 'string' &&
  (path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url)) ||
    process.argv[1].endsWith('verify-spec-contracts.ts') ||
    process.argv[1].endsWith('verify-spec-contracts.js'));

if (isDirectExecution) {
  main();
}
