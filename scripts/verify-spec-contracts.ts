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
import { ARCHITECTURAL_DOCS } from './generate-portal';

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

  if (!fs.existsSync(filePath)) {
    return {
      exportsValues,
      exportsTypes,
      topLevelDeclarations,
      classAndObjectMembers,
      allClassMemberNames,
      propertyAndConstLiterals,
    };
  }

  const sf = parseTsSourceFile(filePath);

  function recordMember(container: string, memberName: string) {
    const set = classAndObjectMembers.get(container) ?? new Set<string>();
    set.add(memberName);
    classAndObjectMembers.set(container, set);
  }

  function collectPropertiesAndLiterals(node: ts.Node) {
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
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
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
        // [entity] must only match literal '[entity]' here; concrete slugs are checked against ENTITY_KEY
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

  // Allow 1-segment route group directory prefixes (e.g. `/api/admin`, `/api/cron`) when cited without an HTTP method
  if (!hasExplicitMethods && /^\/api\/[a-z0-9-]+$/.test(routePath)) {
    const hasGroupChildren = apiEntries.some((e) => e.routePath.startsWith(`${routePath}/`));
    if (hasGroupChildren) {
      return { kind: 'wildcard' };
    }
  }

  // Check /api/admin/<slug>(/[id]|/batch)? against registered AdminCrudService ENTITY_KEY slugs
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

    // Embedded /api/... inside inline code (e.g. curl URLs, fetch('/api/...'), etc.)
    const embeddedRegex = /(?:^|[\s'"(]|https?:\/\/[^/\s]+)(\/api\/[A-Za-z0-9_[\]./*{}-]+)/g;
    let embMatch: RegExpExecArray | null;
    while ((embMatch = embeddedRegex.exec(trimmed)) !== null) {
      const fullPrefixIdx = embMatch.index;
      // Skip filesystem paths like src/app/api/...
      if (fullPrefixIdx > 0 && /[A-Za-z0-9_.-]$/.test(trimmed.slice(0, fullPrefixIdx))) {
        continue;
      }
      for (const normalized of normalizeRouteToken(embMatch[1])) {
        citations.push({ methods: [], routePath: normalized });
      }
    }
  }

  // Mask inline code spans and Markdown link destinations ](...) to check bare /api/... citations
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

  // 1. Structured Markdown table rows (FEATURE_BARRELS and ADMIN_ENTITIES)
  if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
    const cells = line
      .trim()
      .slice(1, -1)
      .split(/(?<!\\)\|/)
      .map((c) => c.trim());

    // FEATURE_BARRELS row: | `domain` | `src/features/<domain>/index.ts` | Runtime Exports | Type Exports |
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

    // ADMIN_ENTITIES row: | `slug` | `AdminServiceClass` | `src/features/<domain>/index.ts` | `Model` | Endpoints |
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

  // 2. Module-qualified inline symbol citations:
  //    e.g. `foo` in [src/bar.ts](...), `foo()` and `bar()` in `src/bar.ts`, `Foo.bar` ([src/bar.ts](...))
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
    ((citation.roleWord === 'schema' || citation.roleWord === 'schemas') &&
      inventory.topLevelDeclarations.has(`${citation.symbol}Schema`))
  ) {
    return null;
  }

  return `Symbol "${citation.symbol}" is not declared or exported in ${citation.srcRelPath}`;
}

export function verifySpecContracts(
  rootDir: string = ROOT_DIR,
  options: SpecContractVerificationOptions = {},
): SpecContractVerificationResult {
  symbolInventoryCache.clear();
  const errors: string[] = [];
  let checkedRoutes = 0;
  let checkedSymbols = 0;

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
