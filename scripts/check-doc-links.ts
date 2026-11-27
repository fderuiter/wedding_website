import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';
import ts from 'typescript';
import { isMap, isPair, isScalar, isSeq, LineCounter, parseDocument } from 'yaml';
import {
  buildTsDeclRanges, escapeRegExp, extractFilePathFromLinkTarget, extractMarkdownHeadings,
  getTsPropertyKeyName, HTTP_METHOD_NAMES, type InlineCodeSpan, LINE_FRAGMENT_RE,
  type ParsedMarkdownLink, parseLineFragmentRange, parseTsSourceFile, PROSE_LINK_WORDS,
  REPO_GITHUB_URL_RE, safeDecodeURIComponent, scanLinksAndCodeInLine, scanMarkdownDocument,
  type TsDeclRange,
} from './doc-markdown-utils';

export {
  buildTsDeclRanges, type ExtractFilePathOptions, extractFilePathFromLinkTarget,
  extractMarkdownHeadings, type FenceTransitionResult, findInlineCodeEnd, type FrontmatterScanMode,
  githubSlugify, type HtmlCommentScanMode, type InlineCodeSpan, type MarkdownFenceState,
  type MarkdownHeading, type MarkdownScanOptions, type ParsedMarkdownLink, parseLineFragmentRange,
  resolveVitePressHeadingSlug, safeDecodeURIComponent, scanLinksAndCodeInLine, scanMarkdownDocument,
  type ScannedMermaidBlock, stepMarkdownFence, stripHtmlTags, stripInlineMarkdown,
  transformNonFencedMarkdownLines, type TsDeclRange, vitepressSlugify,
} from './doc-markdown-utils';

const ROOT_DIR = process.cwd();

export interface DocMapping {
  src: string;
  dest: string;
  category: 'Architecture' | 'Deployment' | 'Features' | 'Security' | 'Guides' | 'Development';
  title: string;
}

export const ARCHITECTURAL_DOCS: DocMapping[] = [
  // Development
  {
    src: 'README.md',
    dest: 'development/readme.md',
    category: 'Development',
    title: 'Project Overview',
  },
  {
    src: 'docs/developer-setup.md',
    dest: 'development/developer-setup.md',
    category: 'Development',
    title: 'Local Environment Setup',
  },
  {
    src: '.github/TESTING.md',
    dest: 'development/testing.md',
    category: 'Development',
    title: 'Testing Strategy',
  },
  {
    src: '.github/CONTRIBUTING.md',
    dest: 'development/contributing.md',
    category: 'Development',
    title: 'Contribution Guidelines',
  },
  {
    src: 'AGENTS.md',
    dest: 'development/agents.md',
    category: 'Development',
    title: 'Agent & Contributor Guidelines',
  },
  // Architecture
  {
    src: 'ARCHITECTURE.md',
    dest: 'architecture/architecture.md',
    category: 'Architecture',
    title: 'System Architecture',
  },
  {
    src: 'docs/runtime-contract.md',
    dest: 'architecture/runtime-contract.md',
    category: 'Architecture',
    title: 'Runtime Contract',
  },
  // Deployment
  {
    src: 'DEPLOYMENT.md',
    dest: 'deployment/deployment.md',
    category: 'Deployment',
    title: 'Deployment Strategy',
  },
  {
    src: 'docs/deployment/README.md',
    dest: 'deployment/recipes.md',
    category: 'Deployment',
    title: 'Deployment Recipes Overview',
  },
  {
    src: 'docs/deployment/docker-vps.md',
    dest: 'deployment/docker-vps.md',
    category: 'Deployment',
    title: 'Generic Docker / VPS',
  },
  {
    src: 'docs/deployment/gcp-cloud-run.md',
    dest: 'deployment/gcp-cloud-run.md',
    category: 'Deployment',
    title: 'Google Cloud Run',
  },
  {
    src: 'docs/deployment/railway-render.md',
    dest: 'deployment/railway-render.md',
    category: 'Deployment',
    title: 'Railway & Render',
  },
  {
    src: 'docs/deployment/vercel.md',
    dest: 'deployment/vercel.md',
    category: 'Deployment',
    title: 'Vercel',
  },
  // Features
  {
    src: 'FEATURE_MODULES.md',
    dest: 'features/feature-modules.md',
    category: 'Features',
    title: 'Feature Modules',
  },
  {
    src: 'docs/ASSET_STORAGE.md',
    dest: 'features/asset-storage.md',
    category: 'Features',
    title: 'Asset Storage',
  },
  {
    src: 'docs/3D_TECHNICAL_GUIDE.md',
    dest: 'features/3d-technical-guide.md',
    category: 'Features',
    title: '3D Technical Guide',
  },
  {
    src: 'SCRAPER.md',
    dest: 'features/scraper.md',
    category: 'Features',
    title: 'Web Scraper Pipeline',
  },
  {
    src: 'docs/BROADCASTS.md',
    dest: 'features/broadcasts.md',
    category: 'Features',
    title: 'Guest Broadcasts & Messaging',
  },
  // Security
  {
    src: 'SECURITY.md',
    dest: 'security/security.md',
    category: 'Security',
    title: 'Security Policy',
  },
  {
    src: 'docs/THREAT_MODEL.md',
    dest: 'security/threat-model.md',
    category: 'Security',
    title: 'Threat Model',
  },
  // Guides
  {
    src: 'docs/upgrading.md',
    dest: 'guides/upgrading.md',
    category: 'Guides',
    title: 'Upgrading Guide',
  },
  {
    src: 'docs/versioning.md',
    dest: 'guides/versioning.md',
    category: 'Guides',
    title: 'Versioning Policy',
  },
  {
    src: 'CHANGELOG.md',
    dest: 'guides/changelog.md',
    category: 'Guides',
    title: 'Changelog',
  },
];

const PORTAL_ROUTE_TO_SRC = new Map<string, string>();
for (const doc of ARCHITECTURAL_DOCS) {
  const cleanDest = doc.dest.replace(/\\/g, '/').replace(/\.md$/, '').replace(/^\/+|\/+$/g, '');
  PORTAL_ROUTE_TO_SRC.set(cleanDest, doc.src);
  if (cleanDest.endsWith('/index')) {
    PORTAL_ROUTE_TO_SRC.set(cleanDest.slice(0, -'/index'.length), doc.src);
  }
}

const EXCLUDE_SEGMENTS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.turbo',
  'out',
  'build',
  'dist',
  'storybook-static',
  'coverage',
  'test-results',
  '.jules',
  '.Jules',
]);

const EXCLUDE_REL_PATHS = [
  'docs-portal/.vitepress',
  'docs-portal/architecture',
  'docs-portal/deployment',
  'docs-portal/development',
  'docs-portal/features',
  'docs-portal/security',
  'docs-portal/guides',
  'docs-portal/public',
];

const PAREN_LINE_CITATION_RE = /\(L(\d+)(?:\s*[-–—]\s*L?(\d+))?\)/g;
const FILE_TOKEN_RE = /^(?:\.{0,2}\/)?[A-Za-z0-9_.\-/\[\]@%]+\.[A-Za-z0-9]{1,6}$/;

export interface LinkError {
  sourceFile: string;
  line: number;
  linkText: string;
  targetPath: string;
  resolvedPath: string;
}

interface FileCandidate {
  rawPath: string;
  position: number;
}

export interface ExtractedMermaidBlock {
  sourceFile: string;
  fenceStartLine: number;
  code: string;
}

interface MermaidParserApi {
  parse: (_text: string, _parseOptions?: { suppressErrors?: boolean }) => Promise<unknown>;
}

interface MermaidRuntime {
  api: MermaidParserApi;
  domWindow: Record<string, unknown>;
  hostGlobal: Record<string, unknown>;
}

let cachedMermaidRuntimePromise: Promise<MermaidRuntime> | null = null;
let cachedShikiLanguages: Set<string> | null = null;
const vitePressAliasCache = new Map<
  string,
  { mtimeMs: number; aliases: Array<{ alias: string; target: string; line: number }> }
>();

function createNativeNodeRequire(): NodeRequire {
  const scriptFile =
    typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url);
  const createHostRequire = vm.runInThisContext(
    "(filename) => process.getBuiltinModule('node:module').createRequire(filename)"
  ) as (_filename: string) => NodeRequire;
  return createHostRequire(scriptFile);
}

function getShikiSupportedLanguages(): Set<string> {
  if (cachedShikiLanguages) {
    return cachedShikiLanguages;
  }
  const langs = new Set<string>(['txt', 'text', 'plain', 'ansi']);
  const hostReq = createNativeNodeRequire();
  const vpPkgPath = hostReq.resolve('vitepress/package.json');
  const createHostRequire = vm.runInThisContext(
    "(filename) => process.getBuiltinModule('node:module').createRequire(filename)"
  ) as (_filename: string) => NodeRequire;
  const vpReq = createHostRequire(vpPkgPath);
  const shikiMod = vpReq('shiki') as {
    bundledLanguages?: Record<string, unknown>;
  };
  if (shikiMod.bundledLanguages) {
    for (const key of Object.keys(shikiMod.bundledLanguages)) {
      langs.add(key.toLowerCase());
    }
  }
  cachedShikiLanguages = langs;
  return langs;
}

function getVitePressLanguageAliases(
  rootDir: string
): Array<{ alias: string; target: string; line: number }> {
  const configAbs = path.join(rootDir, 'docs-portal/.vitepress/config.mts');
  if (!fs.existsSync(configAbs)) {
    return [];
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(configAbs);
    if (!stat.isFile()) return [];
  } catch {
    return [];
  }

  const cached = vitePressAliasCache.get(configAbs);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.aliases;
  }

  let content: string;
  try {
    content = fs.readFileSync(configAbs, 'utf8');
  } catch {
    return [];
  }

  const sf = parseTsSourceFile(configAbs, content, true);

  const aliases: Array<{ alias: string; target: string; line: number }> = [];

  function visit(node: ts.Node) {
    if (
      ts.isPropertyAssignment(node) &&
      getTsPropertyKeyName(node.name) === 'languageAlias' &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const prop of node.initializer.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        const aliasKey = getTsPropertyKeyName(prop.name);
        if (!aliasKey) continue;
        if (
          ts.isStringLiteral(prop.initializer) ||
          ts.isNoSubstitutionTemplateLiteral(prop.initializer)
        ) {
          aliases.push({
            alias: aliasKey,
            target: prop.initializer.text,
            line: sf.getLineAndCharacterOfPosition(prop.initializer.getStart(sf)).line + 1,
          });
        }
      }
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  vitePressAliasCache.set(configAbs, { mtimeMs: stat.mtimeMs, aliases });
  return aliases;
}

function isSupportedShikiFenceLanguage(lang: string, rootDir: string): boolean {
  const normalized = lang.trim().toLowerCase();
  if (!normalized) return true;
  const supported = getShikiSupportedLanguages();
  if (supported.has(normalized)) {
    return true;
  }
  const aliases = getVitePressLanguageAliases(rootDir);
  for (const entry of aliases) {
    if (entry.alias.toLowerCase() === normalized) {
      return supported.has(entry.target.trim().toLowerCase());
    }
  }
  return false;
}

async function withMermaidDomGlobals<T>(
  hostGlobal: Record<string, unknown>,
  domWindow: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  const hadWindow = 'window' in hostGlobal;
  const hadDocument = 'document' in hostGlobal;
  const prevWindow = hostGlobal.window;
  const prevDocument = hostGlobal.document;

  if (!hostGlobal.window) {
    hostGlobal.window = domWindow;
    hostGlobal.document = domWindow.document;
  }

  try {
    return await fn();
  } finally {
    if (!hadWindow) {
      delete hostGlobal.window;
    } else {
      hostGlobal.window = prevWindow;
    }
    if (!hadDocument) {
      delete hostGlobal.document;
    } else {
      hostGlobal.document = prevDocument;
    }
  }
}

function getMermaidRuntime(): Promise<MermaidRuntime> {
  if (!cachedMermaidRuntimePromise) {
    cachedMermaidRuntimePromise = (async () => {
      const scriptFile =
        typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url);

      const hostGlobal = vm.runInThisContext('globalThis') as Record<string, unknown>;
      const createHostRequire = vm.runInThisContext(
        "(filename) => process.getBuiltinModule('node:module').createRequire(filename)"
      ) as (_filename: string) => NodeRequire;

      const hostReq = createHostRequire(scriptFile);
      const jsdomMod = hostReq('jsdom') as {
        JSDOM: new (_html?: string, _opts?: { url?: string }) => {
          window: Record<string, unknown>;
        };
      };
      const domWindow = new jsdomMod.JSDOM('', { url: 'http://localhost/' }).window;

      const api = await withMermaidDomGlobals(hostGlobal, domWindow, async () => {
        const mod = hostReq('mermaid') as {
          default?: MermaidParserApi;
        } & Partial<MermaidParserApi>;
        const resolved = mod.default ?? (mod as MermaidParserApi);
        if (!resolved || typeof resolved.parse !== 'function') {
          throw new Error('Failed to load mermaid.parse from installed mermaid package');
        }
        return resolved;
      });

      return { api, domWindow, hostGlobal };
    })();
  }
  return cachedMermaidRuntimePromise;
}

function isExcludedRelPath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalized) {
    return false;
  }

  const segments = normalized.split('/');
  if (segments.some(seg => EXCLUDE_SEGMENTS.has(seg))) {
    return true;
  }

  return EXCLUDE_REL_PATHS.some(
    ex => normalized === ex || normalized.startsWith(`${ex}/`)
  );
}

export function findMarkdownFiles(
  dir: string,
  fileList: string[] = [],
  rootDir: string = dir
): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/');

    if (isExcludedRelPath(relPath)) {
      continue;
    }

    if (entry.isDirectory()) {
      findMarkdownFiles(fullPath, fileList, rootDir);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      fileList.push(fullPath);
    }
  }

  return fileList;
}

interface SourceSliceCacheEntry {
  content: string;
  lines: string[];
  declRanges?: Map<string, TsDeclRange[]>;
}

const GENERIC_SLICE_STOP_TOKENS = new Set([
  'true',
  'false',
  'null',
  'undefined',
  'string',
  'number',
  'boolean',
  'object',
  'any',
  'unknown',
  'void',
  'never',
  'async',
  'await',
  'const',
  'let',
  'var',
  'function',
  'return',
  'export',
  'import',
  'default',
  'new',
  'if',
  'else',
  'id',
  'ids',
  'url',
  'urls',
  'config',
  'data',
  'error',
  'errors',
  'result',
  'results',
  'options',
  'params',
  'item',
  'items',
  'value',
  'values',
  'type',
  'name',
  'status',
  'code',
  'email',
  'message',
  'body',
  'request',
  'response',
  'req',
  'res',
  'page',
  'limit',
  'total',
  'button',
  'div',
  'article',
  'main',
  'span',
  'Prisma',
  'Stripe',
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]);

function getSourceSliceData(
  filePath: string,
  sliceCache: Map<string, SourceSliceCacheEntry>,
  lineCountCache: Map<string, number>
): SourceSliceCacheEntry {
  const cached = sliceCache.get(filePath);
  if (cached) {
    return cached;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.length === 0 ? [] : content.replace(/\r?\n$/, '').split(/\r?\n/);
  lineCountCache.set(filePath, lines.length);
  const entry: SourceSliceCacheEntry = { content, lines };
  sliceCache.set(filePath, entry);
  return entry;
}

function getTsDeclRanges(
  filePath: string,
  entry: SourceSliceCacheEntry
): Map<string, TsDeclRange[]> {
  if (!entry.declRanges) {
    entry.declRanges = buildTsDeclRanges(filePath, entry.content);
  }
  return entry.declRanges;
}

function textContainsCueToken(haystack: string, cue: string): boolean {
  if (!cue) return false;
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(cue)) {
    return new RegExp(`\\b${escapeRegExp(cue)}\\b`).test(haystack);
  }
  return haystack.includes(cue);
}

interface SliceLineContext {
  lineText: string;
  links: ParsedMarkdownLink[];
  codeSpans: InlineCodeSpan[];
  citeStart: number;
  citeEnd: number;
  linkText?: string;
  fileDir: string;
  rootDir: string;
}

function validateSliceContentAgainstContext(
  resolvedPath: string,
  start: number,
  end: number,
  ctx: SliceLineContext,
  sliceCache: Map<string, SourceSliceCacheEntry>,
  lineCountCache: Map<string, number>
): string | null {
  if (resolvedPath.endsWith('.md')) {
    return null;
  }

  const fileData = getSourceSliceData(resolvedPath, sliceCache, lineCountCache);
  const sliceRaw = fileData.lines.slice(start - 1, end).join('\n');
  if (!sliceRaw.trim()) {
    return `Empty slice L${start}-L${end}`;
  }

  const relTarget = path.relative(ctx.rootDir, resolvedPath).replace(/\\/g, '/');
  const isRouteOrApiHandler =
    /(?:^|\/)route\.[cm]?[jt]sx?$/.test(relTarget) || /\/api\/[^/]+\.[cm]?[jt]sx?$/.test(relTarget);

  const matchesSliceOrEnclosing = (token: string, targetSliceText: string = sliceRaw): boolean => {
    if (textContainsCueToken(targetSliceText, token)) {
      return true;
    }
    const decls = getTsDeclRanges(resolvedPath, fileData).get(token);
    if (decls && decls.some(r => r.start <= start && end <= r.end)) {
      return true;
    }
    return false;
  };

  // 1. Explicit symbol link label: [Symbol](src/...#L...) or [`Symbol`](src/...#L...)
  if (ctx.linkText !== undefined) {
    const rawLabel = ctx.linkText.trim();
    const isBackticked = /^`[^`]+`$/.test(rawLabel);
    let inner = isBackticked ? rawLabel.slice(1, -1).trim() : rawLabel;
    if (!inner.includes('/') && !/\.[A-Za-z0-9]{1,6}$/.test(inner)) {
      const jsxMatch = inner.match(/^<\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\/?\s*>$/);
      if (jsxMatch) inner = jsxMatch[1];
      const hasParens = inner.endsWith('()');
      if (hasParens) inner = inner.slice(0, -2);
      if (
        /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)?$/.test(inner) &&
        (isBackticked || hasParens || /[A-Z_$.]/.test(inner)) &&
        !PROSE_LINK_WORDS.has(inner)
      ) {
        const checkSym = inner.includes('.') ? inner.split('.')[1] : inner;
        if (!matchesSliceOrEnclosing(checkSym)) {
          return `Slice L${start}-L${end} does not contain cited link symbol "${inner}"`;
        }
      }
    }
  }

  // Scope to table cell if inside a Markdown table row
  let scopeStart = 0;
  let scopeEnd = ctx.lineText.length;
  if (ctx.lineText.trim().startsWith('|') && ctx.lineText.trim().endsWith('|')) {
    const pipePositions: number[] = [];
    for (let p = 0; p < ctx.lineText.length; p++) {
      if (ctx.lineText[p] === '|' && (p === 0 || ctx.lineText[p - 1] !== '\\')) {
        pipePositions.push(p);
      }
    }
    for (let idx = 0; idx + 1 < pipePositions.length; idx++) {
      if (pipePositions[idx] <= ctx.citeStart && ctx.citeStart <= pipePositions[idx + 1]) {
        scopeStart = pipePositions[idx] + 1;
        scopeEnd = pipePositions[idx + 1];
        break;
      }
    }
  }

  // Further narrow to the sentence containing the citation (splitting on `. ` or `; ` outside links/code)
  const maskedLine = ctx.lineText.split('');
  for (const sp of ctx.codeSpans) {
    for (let c = sp.startIndex; c < sp.endIndex && c < maskedLine.length; c++) maskedLine[c] = 'X';
  }
  for (const lk of ctx.links) {
    for (let c = lk.startIndex; c < lk.endIndex && c < maskedLine.length; c++) maskedLine[c] = 'L';
  }
  const maskedStr = maskedLine.join('');
  for (let p = scopeStart; p < scopeEnd - 1; p++) {
    if ((maskedStr[p] === '.' || maskedStr[p] === ';') && /\s/.test(maskedStr[p + 1])) {
      if (p + 1 <= ctx.citeStart) {
        scopeStart = p + 2;
      } else if (p >= ctx.citeEnd) {
        scopeEnd = p + 1;
        break;
      }
    }
  }

  // Identify all resolved file links in [scopeStart, scopeEnd]
  const scopedLinks = ctx.links
    .filter(lk => lk.startIndex >= scopeStart && lk.endIndex <= scopeEnd)
    .map(lk => {
      const targetAbs = extractFilePathFromLinkTarget(lk.rawTarget, ctx.fileDir, ctx.rootDir);
      const hashIdx = lk.rawTarget.indexOf('#');
      return {
        link: lk,
        targetAbs,
        lineRange: hashIdx === -1 ? null : parseLineFragmentRange(lk.rawTarget.slice(hashIdx + 1)),
      };
    })
    .filter(item => item.targetAbs !== null);

  // Determine the local sub-clause start (after any preceding file link unless joined by `and` / `&` inside shared parens)
  let attachedClauseStart = scopeStart;
  let sentenceClauseStart = scopeStart;
  const jointSliceTexts: string[] = [sliceRaw];
  for (const sl of scopedLinks) {
    if (sl.link.endIndex <= ctx.citeStart) {
      // If ctx is a prose (L...) immediately following its own [file](file#L...) link, don't advance past that link!
      if (
        sl.targetAbs === resolvedPath &&
        /^\s*$/.test(ctx.lineText.slice(sl.link.endIndex, ctx.citeStart))
      ) {
        continue;
      }
      const between = ctx.lineText.slice(sl.link.endIndex, ctx.citeStart);
      if ((sl.targetAbs === resolvedPath ? /^(?:\s*\(L\d+(?:-L?\d+)?\))?\s*(?:,|\/|\band\b|\bor\b|&)\s*(?:mapped in\s+|in\s+|at\s+)?$/i : /^\s*(?:,|\/|\band\b|\bor\b|&)\s*(?:mapped in\s+|in\s+|at\s+)?$/i).test(between)) {
        if (sl.targetAbs && sl.lineRange && fs.existsSync(sl.targetAbs) && fs.statSync(sl.targetAbs).isFile()) {
          const otherData = getSourceSliceData(sl.targetAbs, sliceCache, lineCountCache);
          if (isValidLineRange(sl.lineRange.start, sl.lineRange.end, otherData.lines.length)) {
            jointSliceTexts.push(
              otherData.lines.slice(sl.lineRange.start - 1, sl.lineRange.end).join('\n')
            );
          }
        }
      } else {
        attachedClauseStart = sl.link.endIndex;
        if (sl.targetAbs !== resolvedPath) {
          sentenceClauseStart = sl.link.endIndex;
        }
      }
    } else if (sl.link.startIndex >= ctx.citeEnd) {
      const between = ctx.lineText.slice(ctx.citeEnd, sl.link.startIndex);
      if ((sl.targetAbs === resolvedPath ? /^(?:\s*\(L\d+(?:-L?\d+)?\))?\s*(?:,|\/|\band\b|\bor\b|&)\s*$/i : /^\s*(?:,|\/|\band\b|\bor\b|&)\s*$/i).test(between)) {
        if (sl.targetAbs && sl.lineRange && fs.existsSync(sl.targetAbs) && fs.statSync(sl.targetAbs).isFile()) {
          const otherData = getSourceSliceData(sl.targetAbs, sliceCache, lineCountCache);
          if (isValidLineRange(sl.lineRange.start, sl.lineRange.end, otherData.lines.length)) {
            jointSliceTexts.push(
              otherData.lines.slice(sl.lineRange.start - 1, sl.lineRange.end).join('\n')
            );
          }
        }
      }
    }
  }
  const unionSliceRaw = jointSliceTexts.join('\n');

  // 2. Immediately attached symbol / Container.member right before this citation
  const effectiveAnchorStart = (() => {
    for (const sl of scopedLinks) {
      if (
        sl.targetAbs === resolvedPath &&
        sl.link.endIndex <= ctx.citeStart &&
        /^\s*$/.test(ctx.lineText.slice(sl.link.endIndex, ctx.citeStart))
      ) {
        return sl.link.startIndex;
      }
    }
    return ctx.citeStart;
  })();

  const beforeAnchor = ctx.lineText.slice(attachedClauseStart, effectiveAnchorStart);
  const attachedMatch = beforeAnchor.match(
    /`([^`]+)`(?:\s*\([^()]*\))?(?:\s+[a-z]+)?(?:\s*,)?\s*(?:(?:in|at|from|via|defined in|declared in|implemented in)\s+|\(\s*(?:see\s+|in\s+|at\s+|via\s+)?|,\s*)$/i
  );
  if (attachedMatch) {
    const rawSpan = attachedMatch[1].trim();
    const memberCallMatch = rawSpan.match(
      /^([A-Za-z_$][A-Za-z0-9_$]*)(?:\.([A-Za-z_$][A-Za-z0-9_$]*)|\['([A-Za-z_$][A-Za-z0-9_$]*)'\])(?:\(.*\))?$/
    );
    if (memberCallMatch) {
      const memberName = memberCallMatch[2] ?? memberCallMatch[3];
      if (memberName && !matchesSliceOrEnclosing(memberName, unionSliceRaw)) {
        return `Slice L${start}-L${end} does not contain cited member "${memberName}"`;
      }
    } else {
      const assignM = rawSpan.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*[^=]/);
      const plainSymM = rawSpan.match(/^([A-Za-z_$][A-Za-z0-9_$]*)(?:\(.*\))?$/);
      const sym = assignM?.[1] ?? plainSymM?.[1];
      if (sym && !GENERIC_SLICE_STOP_TOKENS.has(sym) && !FILE_TOKEN_RE.test(rawSpan)) {
        if (!matchesSliceOrEnclosing(sym, unionSliceRaw)) {
          return `Slice L${start}-L${end} does not contain cited symbol "${sym}"`;
        }
      }
    }
  }

  // Helper: check that any (...) group in [scopeStart, scopeEnd] enclosing [spanStart, spanEnd] also encloses [citeStart, citeEnd]
  const parenPairs: Array<{ open: number; close: number }> = [];
  const openStack: number[] = [];
  for (let p = scopeStart; p < scopeEnd; p++) {
    if (maskedStr[p] === '(') {
      openStack.push(p);
    } else if (maskedStr[p] === ')' && openStack.length > 0) {
      const open = openStack.pop()!;
      parenPairs.push({ open, close: p });
    }
  }
  const isSpanInCitationScope = (spanStart: number, spanEnd: number): boolean => {
    for (const pair of parenPairs) {
      const enclosesSpan = pair.open < spanStart && spanEnd <= pair.close;
      if (!enclosesSpan) continue;
      const enclosesCite = pair.open <= effectiveAnchorStart && ctx.citeEnd <= pair.close + 1;
      if (!enclosesCite) {
        return false;
      }
    }
    return true;
  };

  // 3. Assigned SCREAMING_SNAKE_CASE constants in the local clause (e.g. `REGISTRY_LOAD_MORE_INCREMENT = 8`)
  const clauseSpans = ctx.codeSpans.filter(
    sp =>
      sp.startIndex >= sentenceClauseStart &&
      sp.endIndex <= scopeEnd &&
      !(sp.startIndex >= ctx.citeStart && sp.endIndex <= ctx.citeEnd) &&
      isSpanInCitationScope(sp.startIndex, sp.endIndex)
  );
  for (const sp of clauseSpans) {
    const trimmed = sp.text.trim();
    const constMatch = trimmed.match(/^([A-Z][A-Z0-9_]*_[A-Z0-9_]*)\s+=\s+[^=]/);
    if (constMatch) {
      const constName = constMatch[1];
      if (!textContainsCueToken(unionSliceRaw, constName)) {
        return `Slice L${start}-L${end} does not contain cited constant "${constName}"`;
      }
    }
  }

  // 4. Route path cues & login redirect block swap guard
  const proseSentenceLower = maskedStr.slice(scopeStart, scopeEnd).toLowerCase();
  const hasAdminLoginInSlice = /['"`][^'"`\n]*\/admin\/login['"`]/.test(sliceRaw);
  const hasGuestLoginInSlice = /['"`][^'"`\n]*\/guest\/login['"`]/.test(sliceRaw);
  if (hasAdminLoginInSlice && !hasGuestLoginInSlice) {
    const mentionsGuestLogin =
      /\bguest\s+(?:passcode\s+|session\s+)?login\b/.test(proseSentenceLower) ||
      ctx.codeSpans.some(
        sp =>
          sp.startIndex >= scopeStart &&
          sp.endIndex <= scopeEnd &&
          (sp.text.includes('/guest/login') || sp.text.includes('/api/guest/login'))
      );
    const mentionsAdminLogin =
      /\badmin\s+login\b/.test(proseSentenceLower) ||
      ctx.codeSpans.some(
        sp => sp.startIndex >= scopeStart && sp.endIndex <= scopeEnd && sp.text.includes('/admin/login')
      );
    if (mentionsGuestLogin && !mentionsAdminLogin) {
      return `Slice L${start}-L${end} contains "/admin/login" redirect block instead of guest login gatekeeping`;
    }
  }
  if (hasGuestLoginInSlice && !hasAdminLoginInSlice) {
    const mentionsAdminLogin =
      /\badmin\s+login\b/.test(proseSentenceLower) ||
      ctx.codeSpans.some(
        sp => sp.startIndex >= scopeStart && sp.endIndex <= scopeEnd && sp.text.includes('/admin/login')
      );
    const mentionsGuestLogin =
      /\bguest\s+(?:passcode\s+|session\s+)?login\b/.test(proseSentenceLower) ||
      ctx.codeSpans.some(
        sp =>
          sp.startIndex >= scopeStart &&
          sp.endIndex <= scopeEnd &&
          (sp.text.includes('/guest/login') || sp.text.includes('/api/guest/login'))
      );
    if (mentionsAdminLogin && !mentionsGuestLogin) {
      return `Slice L${start}-L${end} contains "/guest/login" redirect block instead of admin login gatekeeping`;
    }
  }

  // Unpaired route code spans in the local clause (e.g. `GET /api/registry/items/[id]` on useRegistry.ts)
  for (const sp of clauseSpans) {
    const routeM = sp.text
      .trim()
      .match(/^(?:(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+)?(\/(?:api|guest|admin)\/[^\s`]+)$/);
    if (!routeM) continue;
    const httpMethod = routeM[1];
    const rawRoute = routeM[2].split('?')[0];
    // Skip if another file link in scope points directly to this route's handler file
    const routeStaticNoApi = rawRoute.replace(/^\/api\//, '/').replace(/\/(?:\[[^\]]+\]|<[^>]+>)$/, '');
    const handledByOtherLink = scopedLinks.some(sl => {
      if (!sl.targetAbs || sl.targetAbs === resolvedPath) return false;
      const otherRel = path.relative(ctx.rootDir, sl.targetAbs).replace(/\\/g, '/');
      return routeStaticNoApi.length > 1 && otherRel.includes(routeStaticNoApi);
    });
    if (handledByOtherLink) continue;

    if (isRouteOrApiHandler && httpMethod && textContainsCueToken(unionSliceRaw, httpMethod)) {
      continue;
    }
    if (isRouteOrApiHandler && relTarget.includes(rawRoute.replace(/^\/+/, ''))) {
      continue;
    }

    const hadTrailingDynamic = /\/(?:\[[^\]]+\]|<[^>]+>)$/.test(rawRoute);
    const staticStem =
      rawRoute.replace(/(?:\/(?:\[[^\]]+\]|<[^>]+>))+$/, '') + (hadTrailingDynamic ? '/' : '');
    const uiCounterpart = staticStem.startsWith('/api/') ? staticStem.slice(4) : null;
    const fileHasRouteLiteral =
      (staticStem.length > 1 && fileData.content.includes(staticStem)) ||
      (uiCounterpart !== null && uiCounterpart.length > 1 && fileData.content.includes(uiCounterpart));
    if (fileHasRouteLiteral) {
      const sliceHasRouteLiteral =
        (staticStem.length > 1 && unionSliceRaw.includes(staticStem)) ||
        (uiCounterpart !== null && uiCounterpart.length > 1 && unionSliceRaw.includes(uiCounterpart));
      if (!sliceHasRouteLiteral) {
        return `Slice L${start}-L${end} does not contain cited route path "${staticStem}"`;
      }
    }
  }

  // 5. In-file code-span cue check: if the sentence/cell cites specific symbols/literals that DO exist in resolvedPath, at least one must appear in the target slice (or its enclosing declaration)
  const inFileSpecificCues: string[] = [];
  for (const sp of clauseSpans) {
    const raw = sp.text.trim();
    if (!raw || FILE_TOKEN_RE.test(raw) || raw.startsWith('/')) continue;

    const methodRouteM = raw.match(
      /^((?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)(?:\/(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS))*)\s+\/\S+$/
    );
    if (methodRouteM) {
      if (isRouteOrApiHandler) {
        for (const method of methodRouteM[1].split('/')) {
          if (textContainsCueToken(fileData.content, method)) {
            inFileSpecificCues.push(method);
          }
        }
      }
      continue;
    }

    // Extract string literals inside quotes
    const quoteRe = /'([^']{3,})'|"([^"]{3,})"/g;
    let qm: RegExpExecArray | null;
    while ((qm = quoteRe.exec(raw)) !== null) {
      const lit = qm[1] ?? qm[2];
      if (lit && fileData.content.includes(lit)) {
        inFileSpecificCues.push(lit);
      }
    }

    // CSS custom property prefixes like `--motion-*` or `--glow-filter`
    if (raw.startsWith('--')) {
      const cssPrefix = raw.replace(/\*+$/, '');
      if (cssPrefix.length > 3 && fileData.content.includes(cssPrefix)) {
        inFileSpecificCues.push(cssPrefix);
      }
      continue;
    }

    // Extract non-generic identifiers
    const idRe = /[A-Za-z_$][A-Za-z0-9_$]*/g;
    let im: RegExpExecArray | null;
    while ((im = idRe.exec(raw)) !== null) {
      const id = im[0];
      if (id.length < 3 || GENERIC_SLICE_STOP_TOKENS.has(id) || HTTP_METHOD_NAMES.has(id)) {
        continue;
      }
      if (textContainsCueToken(fileData.content, id)) {
        inFileSpecificCues.push(id);
      }
    }
  }

  if (inFileSpecificCues.length > 0) {
    // Prefer direct slice token matches; only allow enclosing declaration match if the declaration isn't a whole-file wrapper when more specific cues exist
    const directHit = inFileSpecificCues.some(cue => textContainsCueToken(unionSliceRaw, cue));
    if (!directHit) {
      const declMap = getTsDeclRanges(resolvedPath, fileData);
      const nonWrapperEnclosingHit = inFileSpecificCues.some(cue => {
        const ranges = declMap.get(cue);
        if (!ranges) return false;
        return ranges.some(r => {
          if (!(r.start <= start && end <= r.end)) return false;
          // If there are other cues in the file that aren't this outer wrapper, don't let a 200+ line outer wrapper mask a shifted inner slice
          const spanLen = r.end - r.start + 1;
          return inFileSpecificCues.length === 1 || spanLen <= 120;
        });
      });
      if (!nonWrapperEnclosingHit) {
        return `Slice L${start}-L${end} does not contain cited symbol/token (${inFileSpecificCues.slice(0, 3).join(', ')})`;
      }
    }
  }

  return null;
}

function getFileLineCount(
  filePath: string,
  cache: Map<string, number>,
  sliceCache?: Map<string, SourceSliceCacheEntry>
): number {
  const cached = cache.get(filePath);
  if (cached !== undefined) {
    return cached;
  }
  if (sliceCache) {
    return getSourceSliceData(filePath, sliceCache, cache).lines.length;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const count =
    content.length === 0 ? 0 : content.replace(/\r?\n$/, '').split(/\r?\n/).length;
  cache.set(filePath, count);
  return count;
}

function getHeadingSlugSet(
  filePath: string,
  cache: Map<string, Set<string>>
): Set<string> {
  const cached = cache.get(filePath);
  if (cached) {
    return cached;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const headings = extractMarkdownHeadings(content);
  const slugs = new Set<string>();
  for (const h of headings) {
    if (h.githubSlug) slugs.add(h.githubSlug);
    if (h.vitepressSlug) slugs.add(h.vitepressSlug);
  }
  // Also allow explicit HTML id="..." attributes on elements inside Markdown
  const htmlIdRe = /\bid=["']([^"']+)["']/g;
  let idMatch: RegExpExecArray | null;
  while ((idMatch = htmlIdRe.exec(content)) !== null) {
    slugs.add(idMatch[1]);
  }
  cache.set(filePath, slugs);
  return slugs;
}

function isValidLineRange(start: number, end: number, lineCount: number): boolean {
  return (
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 1 &&
    end >= start &&
    end <= lineCount
  );
}

function validateFragmentOnFile(
  resolvedPath: string,
  fragment: string,
  lineCountCache: Map<string, number>,
  headingSlugCache: Map<string, Set<string>>,
  sliceContext?: SliceLineContext,
  sliceCache?: Map<string, SourceSliceCacheEntry>
): { valid: boolean; reason?: string } {
  const parsedRange = parseLineFragmentRange(fragment);
  if (parsedRange) {
    const { start, end } = parsedRange;
    const totalLines = getFileLineCount(resolvedPath, lineCountCache, sliceCache);
    if (!isValidLineRange(start, end, totalLines)) {
      return { valid: false, reason: `file has ${totalLines} lines` };
    }
    if (sliceContext && sliceCache) {
      const mismatch = validateSliceContentAgainstContext(
        resolvedPath,
        start,
        end,
        sliceContext,
        sliceCache,
        lineCountCache
      );
      if (mismatch) {
        return { valid: false, reason: mismatch };
      }
    }
    return { valid: true };
  }

  if (/^L\d/i.test(fragment) && !resolvedPath.endsWith('.md')) {
    return { valid: false };
  }

  if (resolvedPath.endsWith('.md')) {
    const decodedAnchor = safeDecodeURIComponent(fragment);
    const slugs = getHeadingSlugSet(resolvedPath, headingSlugCache);
    return { valid: slugs.has(decodedAnchor) };
  }

  // Non-Markdown files only support valid #L<start>[-L<end>] fragments
  return { valid: false };
}

function resolveProseFileToken(
  rawToken: string,
  fileDir: string,
  rootDir: string
): string {
  const decoded = safeDecodeURIComponent(rawToken.trim());
  if (decoded.startsWith('./') || decoded.startsWith('../')) {
    return path.resolve(fileDir, decoded);
  }
  const relCandidate = path.resolve(fileDir, decoded);
  if (fs.existsSync(relCandidate)) {
    return relCandidate;
  }
  return path.resolve(rootDir, decoded);
}

const ALLOWLISTED_PORTAL_SHOWCASE_ROUTES = new Set(['demo', 'storybook']);

function normalizePortalRouteRel(
  cleanRoute: string,
  sourceAbsPath: string,
  portalDir: string
): string {
  if (cleanRoute.startsWith('/')) {
    return cleanRoute
      .replace(/^\/+/, '')
      .replace(/\.(?:html|md)$/, '')
      .replace(/\/+$/, '');
  }
  const resolvedFromSource = path.resolve(path.dirname(sourceAbsPath), cleanRoute);
  return path
    .relative(portalDir, resolvedFromSource)
    .replace(/\\/g, '/')
    .replace(/\.(?:html|md)$/, '')
    .replace(/\/+$/, '');
}

function isAllowlistedPortalShowcaseRoute(
  cleanRoute: string,
  sourceAbsPath: string,
  rootDir: string
): boolean {
  const portalDir = path.join(rootDir, 'docs-portal');
  const routeRel = normalizePortalRouteRel(cleanRoute, sourceAbsPath, portalDir);
  return ALLOWLISTED_PORTAL_SHOWCASE_ROUTES.has(routeRel);
}

function resolvePortalRouteToSourceFile(
  cleanRoute: string,
  sourceAbsPath: string,
  rootDir: string
): string | null {
  const portalDir = path.join(rootDir, 'docs-portal');
  const routeRel = normalizePortalRouteRel(cleanRoute, sourceAbsPath, portalDir);

  if (routeRel.startsWith('..')) {
    return null;
  }

  if (routeRel === '' || routeRel === 'index') {
    const homeFile = path.join(portalDir, 'index.md');
    return fs.existsSync(homeFile) && fs.statSync(homeFile).isFile() ? homeFile : null;
  }

  const mappedSrc = PORTAL_ROUTE_TO_SRC.get(routeRel);
  if (mappedSrc) {
    const mappedAbs = path.resolve(rootDir, mappedSrc);
    if (fs.existsSync(mappedAbs) && fs.statSync(mappedAbs).isFile()) {
      return mappedAbs;
    }
  }

  const authoredCandidates = [
    path.join(portalDir, `${routeRel}.md`),
    path.join(portalDir, routeRel, 'index.md'),
  ];
  for (const candidate of authoredCandidates) {
    const relFromRoot = path.relative(rootDir, candidate).replace(/\\/g, '/');
    if (!isExcludedRelPath(relFromRoot) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
}

export type QueryTargetMode = 'skip' | 'error';
export type PortalRouteMode = 'none' | 'always' | 'root-fallback';
export type IntraFileAnchorMode = 'direct' | 'markdown-only';

export interface LinkTargetValidationOptions {
  queryTargetMode: QueryTargetMode;
  portalRouteMode: PortalRouteMode;
  intraFileAnchorMode: IntraFileAnchorMode;
}

export function validateLinkTarget(
  rawTarget: string,
  sourceAbsPath: string,
  relSource: string,
  lineNum: number,
  linkText: string,
  options: LinkTargetValidationOptions,
  errors: LinkError[],
  rootDir: string = ROOT_DIR,
  lineCountCache: Map<string, number> = new Map(),
  headingSlugCache: Map<string, Set<string>> = new Map(),
  sliceContext?: SliceLineContext,
  sliceCache?: Map<string, SourceSliceCacheEntry>
): void {
  const trimmed = rawTarget.trim();
  if (!trimmed) {
    errors.push({
      sourceFile: relSource,
      line: lineNum,
      linkText,
      targetPath: rawTarget,
      resolvedPath: relSource,
    });
    return;
  }

  if (trimmed.startsWith('mailto:') || trimmed.startsWith('tel:')) {
    return;
  }

  if (trimmed.startsWith('#')) {
    const fragment = trimmed.slice(1);
    const requiresMdSource = options.intraFileAnchorMode === 'markdown-only';
    const fragRes =
      !fragment || (requiresMdSource && !sourceAbsPath.endsWith('.md'))
        ? { valid: false }
        : validateFragmentOnFile(
          sourceAbsPath,
          fragment,
          lineCountCache,
          headingSlugCache,
          sliceContext,
          sliceCache
        );
    if (!fragRes.valid) {
      errors.push({
        sourceFile: relSource,
        line: lineNum,
        linkText,
        targetPath: trimmed,
        resolvedPath: fragRes.reason
          ? `${relSource}${trimmed} (${fragRes.reason})`
          : `${relSource}${trimmed}`,
      });
    }
    return;
  }

  // Repository GitHub URL (blob / tree) — validated strictly offline against local repo
  const repoMatch = trimmed.match(REPO_GITHUB_URL_RE);
  if (repoMatch) {
    const refKind = repoMatch[1];
    const repoRel = safeDecodeURIComponent(repoMatch[2]).replace(/\/+$/, '');
    const fragment = repoMatch[3] || '';
    const resolvedRepoPath = repoRel ? path.resolve(rootDir, repoRel) : rootDir;
    const relResolved = path.relative(rootDir, resolvedRepoPath).replace(/\\/g, '/');

    if (!fs.existsSync(resolvedRepoPath)) {
      errors.push({
        sourceFile: relSource,
        line: lineNum,
        linkText,
        targetPath: trimmed,
        resolvedPath: relResolved,
      });
      return;
    }

    const stat = fs.statSync(resolvedRepoPath);
    if (refKind === 'tree') {
      if (!stat.isDirectory() || LINE_FRAGMENT_RE.test(fragment)) {
        errors.push({
          sourceFile: relSource,
          line: lineNum,
          linkText,
          targetPath: trimmed,
          resolvedPath: `${relResolved}${fragment ? '#' + fragment : ''}`,
        });
      }
      return;
    }

    if (!stat.isFile()) {
      errors.push({
        sourceFile: relSource,
        line: lineNum,
        linkText,
        targetPath: trimmed,
        resolvedPath: relResolved,
      });
      return;
    }

    if (fragment) {
      const fragRes = validateFragmentOnFile(
        resolvedRepoPath,
        fragment,
        lineCountCache,
        headingSlugCache,
        sliceContext,
        sliceCache
      );
      if (!fragRes.valid) {
        errors.push({
          sourceFile: relSource,
          line: lineNum,
          linkText,
          targetPath: trimmed,
          resolvedPath: fragRes.reason
            ? `${relResolved}#${fragment} (${fragRes.reason})`
            : `${relResolved}#${fragment}`,
        });
      }
    }
    return;
  }

  // Skip external third-party URLs (strictly offline)
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return;
  }

  const hashIdx = trimmed.indexOf('#');
  const beforeHash = hashIdx === -1 ? trimmed : trimmed.slice(0, hashIdx);
  const fragment = hashIdx === -1 ? '' : trimmed.slice(hashIdx + 1);
  const cleanTarget = safeDecodeURIComponent(beforeHash.split('?')[0]);

  if (!cleanTarget) {
    if (options.queryTargetMode === 'error') {
      errors.push({
        sourceFile: relSource,
        line: lineNum,
        linkText,
        targetPath: trimmed,
        resolvedPath: relSource,
      });
    }
    return;
  }

  if (options.portalRouteMode !== 'always') {
    const fileDir = path.dirname(sourceAbsPath);
    const resolvedPath = cleanTarget.startsWith('/')
      ? path.resolve(rootDir, cleanTarget.slice(1))
      : path.resolve(fileDir, cleanTarget);
    const relResolved = path.relative(rootDir, resolvedPath).replace(/\\/g, '/');

    if (fs.existsSync(resolvedPath)) {
      if (fragment) {
        const stat = fs.statSync(resolvedPath);
        const fragRes = stat.isFile()
          ? validateFragmentOnFile(
            resolvedPath,
            fragment,
            lineCountCache,
            headingSlugCache,
            sliceContext,
            sliceCache
          )
          : { valid: false };
        if (!fragRes.valid) {
          errors.push({
            sourceFile: relSource,
            line: lineNum,
            linkText,
            targetPath: trimmed,
            resolvedPath: fragRes.reason
              ? `${relResolved}#${fragment} (${fragRes.reason})`
              : `${relResolved}#${fragment}`,
          });
        }
      }
      return;
    }

    if (!(options.portalRouteMode === 'root-fallback' && cleanTarget.startsWith('/'))) {
      errors.push({
        sourceFile: relSource,
        line: lineNum,
        linkText,
        targetPath: trimmed,
        resolvedPath: relResolved,
      });
      return;
    }
  }

  if (isAllowlistedPortalShowcaseRoute(cleanTarget, sourceAbsPath, rootDir)) {
    if (fragment) {
      errors.push({
        sourceFile: relSource,
        line: lineNum,
        linkText,
        targetPath: trimmed,
        resolvedPath: `docs-portal/${cleanTarget.replace(/^\/+/, '')}#${fragment}`,
      });
    }
    return;
  }

  const resolvedPortalFile = resolvePortalRouteToSourceFile(cleanTarget, sourceAbsPath, rootDir);
  if (!resolvedPortalFile) {
    errors.push({
      sourceFile: relSource,
      line: lineNum,
      linkText,
      targetPath: trimmed,
      resolvedPath: `docs-portal/${cleanTarget.replace(/^\/+/, '')}`,
    });
    return;
  }

  if (fragment) {
    const fragRes = validateFragmentOnFile(
      resolvedPortalFile,
      fragment,
      lineCountCache,
      headingSlugCache,
      sliceContext,
      sliceCache
    );
    if (!fragRes.valid) {
      const relPortalFile = path.relative(rootDir, resolvedPortalFile).replace(/\\/g, '/');
      errors.push({
        sourceFile: relSource,
        line: lineNum,
        linkText,
        targetPath: trimmed,
        resolvedPath: fragRes.reason
          ? `${relPortalFile}#${fragment} (${fragRes.reason})`
          : `${relPortalFile}#${fragment}`,
      });
    }
  }
}

function checkFrontmatterLinks(
  frontmatterLines: string[],
  filePath: string,
  relSource: string,
  errors: LinkError[],
  rootDir: string,
  lineCountCache: Map<string, number>,
  headingSlugCache: Map<string, Set<string>>
) {
  const fmContent = frontmatterLines.join('\n');
  if (!fmContent.trim()) {
    return;
  }

  const lineCounter = new LineCounter();
  const doc = parseDocument(fmContent, { lineCounter });
  const isPortalDoc = relSource === 'docs-portal' || relSource.startsWith('docs-portal/');
  const frontmatterOptions: LinkTargetValidationOptions = {
    queryTargetMode: 'error',
    portalRouteMode: isPortalDoc ? 'always' : 'none',
    intraFileAnchorMode: 'markdown-only',
  };

  function visitYamlNode(node: unknown) {
    if (isMap(node)) {
      let contextLabel = 'frontmatter link';
      for (const pair of node.items) {
        if (isPair(pair) && isScalar(pair.key) && isScalar(pair.value)) {
          const keyName = String(pair.key.value);
          if ((keyName === 'text' || keyName === 'title') && pair.value.value) {
            contextLabel = String(pair.value.value);
            break;
          }
        }
      }

      for (const pair of node.items) {
        if (!isPair(pair)) {
          continue;
        }
        if (isScalar(pair.key) && String(pair.key.value) === 'link') {
          if (pair.value && isMap(pair.value)) {
            visitYamlNode(pair.value);
            continue;
          }
          const offset =
            (pair.value &&
            typeof pair.value === 'object' &&
            'range' in pair.value &&
            Array.isArray(pair.value.range)
              ? pair.value.range[0]
              : undefined) ??
            pair.key.range?.[0] ??
            0;
          const fileLine = lineCounter.linePos(offset).line + 1;
          const rawVal =
            pair.value && isScalar(pair.value) && pair.value.value !== null && pair.value.value !== undefined
              ? String(pair.value.value)
              : '';

          validateLinkTarget(
            rawVal,
            filePath,
            relSource,
            fileLine,
            contextLabel,
            frontmatterOptions,
            errors,
            rootDir,
            lineCountCache,
            headingSlugCache
          );
          continue;
        }
        visitYamlNode(pair.value);
      }
      return;
    }

    if (isSeq(node)) {
      for (const item of node.items) {
        visitYamlNode(item);
      }
    }
  }

  visitYamlNode(doc.contents);
}

export function checkVitePressConfigLinks(
  rootDir: string,
  errors: LinkError[],
  lineCountCache: Map<string, number> = new Map(),
  headingSlugCache: Map<string, Set<string>> = new Map()
) {
  const configRel = 'docs-portal/.vitepress/config.mts';
  const configAbs = path.join(rootDir, configRel);
  if (!fs.existsSync(configAbs) || !fs.statSync(configAbs).isFile()) {
    return;
  }

  let content: string;
  try {
    content = fs.readFileSync(configAbs, 'utf8');
  } catch {
    return;
  }

  const sf = parseTsSourceFile(configAbs, content, true);
  const configOptions: LinkTargetValidationOptions = {
    queryTargetMode: 'error',
    portalRouteMode: 'always',
    intraFileAnchorMode: 'markdown-only',
  };

  function scanNavOrSidebarSubtree(node: ts.Node, sectionLabel: string) {
    if (ts.isObjectLiteralExpression(node)) {
      let itemLabel = `${sectionLabel} link`;
      for (const prop of node.properties) {
        if (ts.isPropertyAssignment(prop) && getTsPropertyKeyName(prop.name) === 'text') {
          if (ts.isStringLiteral(prop.initializer) || ts.isNoSubstitutionTemplateLiteral(prop.initializer)) {
            itemLabel = prop.initializer.text;
          }
        }
      }

      for (const prop of node.properties) {
        if (ts.isPropertyAssignment(prop) && getTsPropertyKeyName(prop.name) === 'link') {
          const lineNum = sf.getLineAndCharacterOfPosition(prop.initializer.getStart(sf)).line + 1;
          if (ts.isStringLiteral(prop.initializer) || ts.isNoSubstitutionTemplateLiteral(prop.initializer)) {
            validateLinkTarget(
              prop.initializer.text,
              configAbs,
              configRel,
              lineNum,
              itemLabel,
              configOptions,
              errors,
              rootDir,
              lineCountCache,
              headingSlugCache
            );
          } else {
            errors.push({
              sourceFile: configRel,
              line: lineNum,
              linkText: itemLabel,
              targetPath: prop.initializer.getText(sf),
              resolvedPath: configRel,
            });
          }
        } else {
          ts.forEachChild(prop, child => scanNavOrSidebarSubtree(child, sectionLabel));
        }
      }
      return;
    }

    ts.forEachChild(node, child => scanNavOrSidebarSubtree(child, sectionLabel));
  }

  function visitRoot(node: ts.Node) {
    if (ts.isPropertyAssignment(node)) {
      const propName = getTsPropertyKeyName(node.name);
      if (propName === 'nav' || propName === 'sidebar') {
        scanNavOrSidebarSubtree(node.initializer, propName);
        return;
      }
      if (
        propName === 'languageAlias' &&
        ts.isObjectLiteralExpression(node.initializer)
      ) {
        const supported = getShikiSupportedLanguages();
        for (const aliasProp of node.initializer.properties) {
          if (!ts.isPropertyAssignment(aliasProp)) continue;
          const aliasKey = getTsPropertyKeyName(aliasProp.name);
          if (!aliasKey) continue;
          const lineNum =
            sf.getLineAndCharacterOfPosition(aliasProp.initializer.getStart(sf)).line + 1;
          if (
            ts.isStringLiteral(aliasProp.initializer) ||
            ts.isNoSubstitutionTemplateLiteral(aliasProp.initializer)
          ) {
            const targetLang = aliasProp.initializer.text.trim().toLowerCase();
            if (!supported.has(targetLang)) {
              errors.push({
                sourceFile: configRel,
                line: lineNum,
                linkText: `languageAlias.${aliasKey}`,
                targetPath: aliasProp.initializer.text,
                resolvedPath: `Unsupported Shiki target grammar "${aliasProp.initializer.text}"`,
              });
            }
          }
        }
        return;
      }
    }
    ts.forEachChild(node, visitRoot);
  }

  visitRoot(sf);
}

async function validateMermaidBlocks(
  blocks: ExtractedMermaidBlock[],
  errors: LinkError[]
): Promise<void> {
  if (blocks.length === 0) {
    return;
  }

  const { api: mermaidApi, domWindow, hostGlobal } = await getMermaidRuntime();

  await withMermaidDomGlobals(hostGlobal, domWindow, async () => {
    for (const block of blocks) {
      if (!block.code.trim()) {
        errors.push({
          sourceFile: block.sourceFile,
          line: block.fenceStartLine,
          linkText: 'mermaid diagram',
          targetPath: '```mermaid',
          resolvedPath: 'Empty Mermaid diagram block',
        });
        continue;
      }

      try {
        const result = await mermaidApi.parse(block.code, { suppressErrors: false });
        if (result === false) {
          throw new Error('Invalid Mermaid diagram syntax');
        }
      } catch (err: unknown) {
        const rawMsg = err instanceof Error ? err.message : String(err);
        const lineMatch = rawMsg.match(/\bon line (\d+)\b/i);
        const hashLine =
          typeof (err as { hash?: { line?: unknown } })?.hash?.line === 'number'
            ? (err as { hash: { line: number } }).hash.line + 1
            : null;
        const relLine = lineMatch ? parseInt(lineMatch[1], 10) : hashLine;
        const blockLineCount = block.code.split(/\r?\n/).length;
        const clampedRel = relLine && relLine >= 1 ? Math.min(relLine, blockLineCount) : 0;
        const errorLine = clampedRel > 0 ? block.fenceStartLine + clampedRel : block.fenceStartLine;
        const summary =
          rawMsg
            .split(/\r?\n/)
            .map(s => s.trim())
            .filter(Boolean)
            .slice(0, 2)
            .join(' ') || 'Mermaid syntax error';

        errors.push({
          sourceFile: block.sourceFile,
          line: errorLine,
          linkText: 'mermaid diagram',
          targetPath: '```mermaid',
          resolvedPath: summary,
        });
      }
    }
  });
}

export function checkLinksInFile(
  filePath: string,
  errors: LinkError[],
  rootDir: string = ROOT_DIR,
  lineCountCache: Map<string, number> = new Map(),
  headingSlugCache: Map<string, Set<string>> = new Map(),
  mermaidBlocks: ExtractedMermaidBlock[] = [],
  sliceCache: Map<string, SourceSliceCacheEntry> = new Map()
) {
  const relSource = path.relative(rootDir, filePath).replace(/\\/g, '/');
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return;
  }

  const fileDir = path.dirname(filePath);
  const isPortalDoc = relSource === 'docs-portal' || relSource.startsWith('docs-portal/');
  const bodyLinkOptions: LinkTargetValidationOptions = {
    queryTargetMode: 'skip',
    portalRouteMode: isPortalDoc ? 'root-fallback' : 'none',
    intraFileAnchorMode: 'direct',
  };

  let paragraphCandidates: FileCandidate[] = [];

  scanMarkdownDocument(
    content,
    (lineText, lineNum) => {
      if (!lineText.trim() || /^\s{0,3}#{1,6}\s+/.test(lineText)) {
        paragraphCandidates = [];
      }

      const { links, codeSpans } = scanLinksAndCodeInLine(lineText, lineNum);

      for (const link of links) {
        validateLinkTarget(
          link.rawTarget,
          filePath,
          relSource,
          lineNum,
          link.linkText,
          bodyLinkOptions,
          errors,
          rootDir,
          lineCountCache,
          headingSlugCache,
          {
            lineText,
            links,
            codeSpans,
            citeStart: link.startIndex,
            citeEnd: link.endIndex,
            linkText: link.linkText,
            fileDir,
            rootDir,
          },
          sliceCache
        );
      }

      // Collect file-like references on this line for parenthetical (L<start>-L<end>) validation
      const lineCandidates: FileCandidate[] = [];
      for (const span of codeSpans) {
        const trimmed = span.text.trim();
        if (FILE_TOKEN_RE.test(trimmed)) {
          lineCandidates.push({ rawPath: trimmed, position: span.startIndex });
        }
      }
      for (const link of links) {
        const extracted = extractFilePathFromLinkTarget(link.rawTarget, fileDir, rootDir);
        if (extracted) {
          lineCandidates.push({
            rawPath: path.relative(rootDir, extracted).replace(/\\/g, '/'),
            position: link.startIndex,
          });
        }
      }
      lineCandidates.sort((a, b) => a.position - b.position);

      // Mask out inline code spans and markdown links before scanning prose for (L<start>-L<end>)
      const chars = lineText.split('');
      for (const span of codeSpans) {
        for (let c = span.startIndex; c < span.endIndex && c < chars.length; c++) {
          chars[c] = ' ';
        }
      }
      for (const link of links) {
        for (let c = link.startIndex; c < link.endIndex && c < chars.length; c++) {
          chars[c] = ' ';
        }
      }
      const proseOnly = chars.join('');

      PAREN_LINE_CITATION_RE.lastIndex = 0;
      let parenMatch: RegExpExecArray | null;
      while ((parenMatch = PAREN_LINE_CITATION_RE.exec(proseOnly)) !== null) {
        const citationText = parenMatch[0];
        const startLine = parseInt(parenMatch[1], 10);
        const endLine =
          parenMatch[2] !== undefined ? parseInt(parenMatch[2], 10) : startLine;
        const matchPos = parenMatch.index;

        const precedingOnLine = lineCandidates.filter(c => c.position < matchPos);
        const chosenCandidate =
          precedingOnLine.length > 0
            ? precedingOnLine[precedingOnLine.length - 1]
            : paragraphCandidates.length > 0
              ? paragraphCandidates[paragraphCandidates.length - 1]
              : null;

        if (!chosenCandidate) {
          continue;
        }

        const resolvedTarget = resolveProseFileToken(
          chosenCandidate.rawPath,
          fileDir,
          rootDir
        );
        const relResolved = path.relative(rootDir, resolvedTarget).replace(/\\/g, '/');

        if (!fs.existsSync(resolvedTarget) || !fs.statSync(resolvedTarget).isFile()) {
          errors.push({
            sourceFile: relSource,
            line: lineNum,
            linkText: chosenCandidate.rawPath,
            targetPath: `${chosenCandidate.rawPath} ${citationText}`,
            resolvedPath: `${relResolved} ${citationText}`,
          });
          continue;
        }

        const totalLines = getFileLineCount(resolvedTarget, lineCountCache, sliceCache);
        if (!isValidLineRange(startLine, endLine, totalLines)) {
          errors.push({
            sourceFile: relSource,
            line: lineNum,
            linkText: chosenCandidate.rawPath,
            targetPath: `${chosenCandidate.rawPath} ${citationText}`,
            resolvedPath: `${relResolved} ${citationText} (file has ${totalLines} lines)`,
          });
          continue;
        }

        const sliceMismatch = validateSliceContentAgainstContext(
          resolvedTarget,
          startLine,
          endLine,
          {
            lineText,
            links,
            codeSpans,
            citeStart: matchPos,
            citeEnd: matchPos + citationText.length,
            fileDir,
            rootDir,
          },
          sliceCache,
          lineCountCache
        );
        if (sliceMismatch) {
          errors.push({
            sourceFile: relSource,
            line: lineNum,
            linkText: chosenCandidate.rawPath,
            targetPath: `${chosenCandidate.rawPath} ${citationText}`,
            resolvedPath: `${relResolved} ${citationText} (${sliceMismatch})`,
          });
        }
      }

      if (lineCandidates.length > 0) {
        paragraphCandidates.push(...lineCandidates);
      }
    },
    {
      frontmatterMode: 'collect',
      htmlCommentMode: 'pad',
      onFrontmatter: frontmatterLines => {
        checkFrontmatterLinks(
          frontmatterLines,
          filePath,
          relSource,
          errors,
          rootDir,
          lineCountCache,
          headingSlugCache
        );
      },
      onFenceOpen: (infoString, marker, lineNum) => {
        const rawFenceInfo = infoString.trim();
        const infoLang = rawFenceInfo.split(/[\s{[:]/)[0]?.toLowerCase() ?? '';
        if (infoLang && !isSupportedShikiFenceLanguage(infoLang, rootDir)) {
          errors.push({
            sourceFile: relSource,
            line: lineNum,
            linkText: `code fence "${infoLang}"`,
            targetPath: `${marker}${rawFenceInfo}`,
            resolvedPath: `Unsupported Shiki fence language "${infoLang}"`,
          });
        }
      },
      onFenceBoundary: () => {
        paragraphCandidates = [];
      },
      onMermaidBlock: ({ fenceStartLine, code }) => {
        mermaidBlocks.push({
          sourceFile: relSource,
          fenceStartLine,
          code,
        });
      },
    }
  );
}

function hasStagedMarkdownRemoval(rootDir: string): boolean {
  if (!fs.existsSync(path.join(rootDir, '.git'))) {
    return false;
  }
  const res = spawnSync(
    'git',
    ['diff', '--cached', '--diff-filter=DR', '--name-only', '-z'],
    {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }
  );
  if (res.status !== 0 || !res.stdout) {
    return false;
  }
  return res.stdout
    .split('\0')
    .some((entry) => entry.toLowerCase().endsWith('.md'));
}

function resolveScopedMarkdownSelection(
  rootDir: string,
  targetFiles?: string[]
): { mdFiles: string[]; checkPortalConfig: boolean } {
  if (!targetFiles || targetFiles.length === 0) {
    return {
      mdFiles: findMarkdownFiles(rootDir),
      checkPortalConfig: true,
    };
  }

  const seen = new Set<string>();
  const scopedMdFiles: string[] = [];
  let hasMissingMarkdownTarget = false;
  let touchesPortalConfig = false;

  for (const rawTarget of targetFiles) {
    const absPath = path.resolve(rootDir, rawTarget);
    const relPath = path.relative(rootDir, absPath).replace(/\\/g, '/');
    if (relPath === 'docs-portal/.vitepress/config.mts') {
      touchesPortalConfig = true;
    }
    if (!absPath.toLowerCase().endsWith('.md')) {
      continue;
    }
    if (seen.has(absPath)) {
      continue;
    }
    seen.add(absPath);

    let isExistingFile = false;
    try {
      isExistingFile = fs.existsSync(absPath) && fs.statSync(absPath).isFile();
    } catch {
      isExistingFile = false;
    }

    if (!isExistingFile) {
      hasMissingMarkdownTarget = true;
      continue;
    }

    if (!relPath.startsWith('..') && !path.isAbsolute(relPath) && !isExcludedRelPath(relPath)) {
      scopedMdFiles.push(absPath);
    }
  }

  if (hasMissingMarkdownTarget || hasStagedMarkdownRemoval(rootDir)) {
    return {
      mdFiles: findMarkdownFiles(rootDir),
      checkPortalConfig: true,
    };
  }

  return {
    mdFiles: scopedMdFiles,
    checkPortalConfig: touchesPortalConfig,
  };
}

export async function checkDocLinks(
  rootDir: string = ROOT_DIR,
  targetFiles?: string[]
): Promise<{ passed: boolean; errors: LinkError[]; count: number }> {
  const { mdFiles, checkPortalConfig } = resolveScopedMarkdownSelection(rootDir, targetFiles);
  const errors: LinkError[] = [];
  const lineCountCache = new Map<string, number>();
  const headingSlugCache = new Map<string, Set<string>>();
  const sliceCache = new Map<string, SourceSliceCacheEntry>();
  const mermaidBlocks: ExtractedMermaidBlock[] = [];

  for (const file of mdFiles) {
    checkLinksInFile(
      file,
      errors,
      rootDir,
      lineCountCache,
      headingSlugCache,
      mermaidBlocks,
      sliceCache
    );
  }

  if (checkPortalConfig) {
    checkVitePressConfigLinks(rootDir, errors, lineCountCache, headingSlugCache);
  }
  await validateMermaidBlocks(mermaidBlocks, errors);

  return { passed: errors.length === 0, errors, count: mdFiles.length };
}

async function main() {
  const cliArgs = process.argv.slice(2);
  const unknownFlags = cliArgs.filter((arg) => arg.startsWith('-'));
  if (unknownFlags.length > 0) {
    console.error(`❌ Unknown option(s) passed to check-doc-links.ts: ${unknownFlags.join(', ')}`);
    process.exit(1);
  }

  const scopedFiles = cliArgs.length > 0 ? cliArgs : undefined;
  const { passed, errors, count } = await checkDocLinks(ROOT_DIR, scopedFiles);

  if (!passed) {
    console.error('\n❌ Dead documentation link(s) detected:\n');
    errors.forEach((err, idx) => {
      console.error(`  [${idx + 1}] ${err.sourceFile}:${err.line}`);
      console.error(`      Link text: "${err.linkText}"`);
      console.error(`      Target: "${err.targetPath}" (Resolved: "${err.resolvedPath}")`);
    });

    console.error(`
================================================================================
ACTIONABLE REMEDIATION:
--------------------------------------------------------------------------------
1. Fix or remove broken relative file links, #anchor slugs, #L / (L...) line
   citations, frontmatter links, or VitePress nav/sidebar routes.
2. Ensure target file paths, headings, line ranges, and fenced Mermaid diagram
   blocks parse and resolve cleanly offline.
================================================================================
`);
    process.exit(1);
  } else {
    console.log(`✅ Documentation link check passed! Verified ${count} Markdown file(s).`);
    process.exit(0);
  }
}

const isMain =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch(err => {
    console.error('Documentation link check failed with unexpected error:', err);
    process.exit(1);
  });
}
