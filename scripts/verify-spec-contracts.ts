import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ts from 'typescript';
import {
  collectApiRouteEntries,
  collectModuleExports,
  extractAdminEntityRows,
  hasExportModifier,
  parseTsSourceFile,
  resolveLocalTsModule,
  type ApiRouteEntry,
} from './generate-docs';
import { ARCHITECTURAL_DOCS } from './check-doc-links';

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
  astIdentifiers: Set<string>;
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

  const sf = parseTsSourceFile(envFilePath);
  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
      if (/^[A-Z][A-Z0-9_]+$/.test(node.name.text)) {
        envVars.add(node.name.text);
      }
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

function getModuleSymbolInventory(
  filePath: string,
  rootDir: string,
  visited: Set<string> = new Set(),
): ModuleSymbolInventory {
  if (visited.size === 0) {
    const cached = symbolInventoryCache.get(filePath);
    if (cached) return cached;
  }

  const { values: exportsValues, types: exportsTypes } = collectModuleExports(filePath, rootDir);
  const topLevelDeclarations = new Set<string>([...exportsValues, ...exportsTypes]);
  const classAndObjectMembers = new Map<string, Set<string>>();
  const allClassMemberNames = new Set<string>();
  const propertyAndConstLiterals = new Set<string>();
  const exportedConstLiterals = new Map<string, string>();
  const astIdentifiers = new Set<string>();

  if (!fs.existsSync(filePath)) {
    return {
      exportsValues,
      exportsTypes,
      topLevelDeclarations,
      classAndObjectMembers,
      allClassMemberNames,
      propertyAndConstLiterals,
      exportedConstLiterals,
      astIdentifiers,
    };
  }

  const sf = parseTsSourceFile(filePath);
  const localImports = new Map<string, { specifier: string; importedName: string }>();

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

    const members = subInv.classAndObjectMembers.get(importedName);
    if (members) {
      for (const m of members) {
        recordMember(exportedName, m);
        allClassMemberNames.add(m);
      }
    }
  }

  function collectPropertiesAndLiterals(node: ts.Node) {
    if (ts.isIdentifier(node)) {
      astIdentifiers.add(node.text);
    }
    if (
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
      node.name &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
    ) {
      propertyAndConstLiterals.add(node.name.text);
    } else if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer))
    ) {
      propertyAndConstLiterals.add(node.initializer.text);
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
    astIdentifiers,
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
  apiEntries: ApiRouteEntry[],
  adminEntityKeys: Set<string>,
  hasExplicitMethods: boolean,
): { kind: 'wildcard' } | { kind: 'entry'; entry: ApiRouteEntry } | { kind: 'error'; reason: string } {
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

function resolveDocCitedSrcPath(rawTarget: string, docAbsPath: string, rootDir: string): string | null {
  const withoutAnchor = rawTarget.replace(/[?#].*$/, '').trim();
  if (!withoutAnchor || !/\.tsx?$/.test(withoutAnchor)) {
    return null;
  }

  let candidateAbs: string;
  if (withoutAnchor.startsWith('src/')) {
    candidateAbs = path.join(rootDir, withoutAnchor);
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
}

function extractBacktickedSymbolIdentifiers(segment: string): string[] {
  const results: string[] = [];
  const symRegex = /`([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)?(?:\(\))?)`/g;
  let match: RegExpExecArray | null;
  while ((match = symRegex.exec(segment)) !== null) {
    const cleaned = match[1].replace(/\(\)$/, '');
    if (PRIMITIVE_KEYWORDS.has(cleaned)) continue;
    results.push(cleaned);
  }
  return results;
}

function extractSymbolCitationsFromLine(
  line: string,
  docAbsPath: string,
  rootDir: string,
  envVarNames: Set<string>,
): SymbolCitation[] {
  const citations: SymbolCitation[] = [];

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
          citations.push({ symbol: sym, srcRelPath: barrelRel, requireExported: true });
        }
      }
    }

    if (cells.length === 5) {
      const barrelMatch = cells[2].match(/^`(src\/features\/[^`]+\/index\.tsx?)`$/);
      const classMatch = cells[1].match(/^`([A-Za-z_$][A-Za-z0-9_$]*)`$/);
      if (barrelMatch && classMatch) {
        citations.push({
          symbol: classMatch[1],
          srcRelPath: barrelMatch[1],
          requireExported: true,
        });
      }
    }
  }

  const singleSym = '`[A-Za-z_$][A-Za-z0-9_$]*(?:\\.[A-Za-z_$][A-Za-z0-9_$]*)?(?:\\(\\))?`';
  const symGroup = `(${singleSym}(?:\\s*(?:,|\\/|\\band\\b|\\bor\\b|&|->|→)\\s*(?:handler\\s*(?:->|→)\\s*)?${singleSym})*)`;
  const srcTarget =
    '(?:\\[[^\\]]+\\]\\(([^)#?\\s]+\\.tsx?)(?:[#?][^)\\s]*)?\\)|`([^`\\s#?]+\\.tsx?)(?:[#?][^`\\s]*)?`)';
  const roleNoun =
    '(?:\\s+(handler|handlers|function|functions|helper|helpers|method|methods|schema|schemas|class|classes|type|types|interface|interfaces|constant|constants|service|services|hook|hooks))?';

  const connectorPattern = new RegExp(
    `${symGroup}${roleNoun}\\s+(?:in|from|at|inside|within|via|defined in|declared in|exported by|exported from|implemented in)\\s+${srcTarget}`,
    'g',
  );
  const parenPattern = new RegExp(
    `${symGroup}${roleNoun}\\s*\\(\\s*(?:see\\s+|in\\s+|at\\s+|via\\s+)?${srcTarget}`,
    'g',
  );

  for (const regex of [connectorPattern, parenPattern]) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(line)) !== null) {
      const symSegment = match[1];
      const roleWord = match[2];
      const rawPath = match[3] ?? match[4];
      if (!rawPath) continue;
      const srcRelPath = resolveDocCitedSrcPath(rawPath, docAbsPath, rootDir);
      if (!srcRelPath) continue;

      const isApiOrRouteModule =
        /(?:^|\/)route\.tsx?$/.test(srcRelPath) || srcRelPath.includes('/api/');
      const symbols = extractBacktickedSymbolIdentifiers(symSegment);
      for (const symbol of symbols) {
        if (srcRelPath !== 'src/env.ts' && envVarNames.has(symbol)) {
          continue;
        }
        if (BUILTIN_GLOBAL_IDENTIFIERS.has(symbol) || STANDARD_HTTP_HEADERS.has(symbol)) {
          continue;
        }
        if (HTTP_METHODS_SET.has(symbol) && !isApiOrRouteModule) {
          continue;
        }
        citations.push({
          symbol,
          srcRelPath,
          requireExported: false,
          roleWord,
        });
      }
    }
  }

  return citations;
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
    return null;
  }

  if (
    inventory.topLevelDeclarations.has(citation.symbol) ||
    inventory.allClassMemberNames.has(citation.symbol) ||
    inventory.propertyAndConstLiterals.has(citation.symbol) ||
    inventory.astIdentifiers.has(citation.symbol) ||
    ((citation.roleWord === 'schema' || citation.roleWord === 'schemas') &&
      inventory.topLevelDeclarations.has(`${citation.symbol}Schema`))
  ) {
    return null;
  }

  return `Symbol "${citation.symbol}" is not declared or exported in ${citation.srcRelPath}`;
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
  if (
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
  const errors: string[] = [];
  let checkedRoutes = 0;
  let checkedSymbols = 0;

  if (!options.specFiles || options.specFiles.includes('public/openapi.json')) {
    errors.push(...verifyOpenApiProbeContracts(rootDir));
  }

  const apiEntries = collectApiRouteEntries(rootDir);
  let adminEntityKeys = new Set<string>();
  const adminRegistryPath = path.join(rootDir, 'src/features/admin/registry.ts');
  if (fs.existsSync(adminRegistryPath)) {
    try {
      adminEntityKeys = new Set(extractAdminEntityRows(rootDir).map((row) => row.entityKey));
    } catch {
      adminEntityKeys = new Set<string>();
    }
  }

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
      );
      for (const symCitation of symbolCitations) {
        checkedSymbols++;
        const symError = verifySymbolInModule(symCitation, rootDir);
        if (symError) {
          errors.push(`${specRelPath}:${lineNum}: ${symError}`);
        }
      }
    }
  }

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
