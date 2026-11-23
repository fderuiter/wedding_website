import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';
import ts from 'typescript';
import { isMap, isPair, isScalar, isSeq, LineCounter, parseDocument } from 'yaml';

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

const REPO_GITHUB_URL_RE =
  /^https?:\/\/github\.com\/fderuiter\/wedding_website\/(blob|tree)\/[^/]+\/([^?#]*)(?:\?[^#]*)?(?:#(.*))?$/;

const LINE_FRAGMENT_RE = /^L(\d+)(?:C\d+)?(?:-L?(\d+)(?:C\d+)?)?$/;
const PAREN_LINE_CITATION_RE = /\(L(\d+)(?:\s*[-–—]\s*L?(\d+))?\)/g;
const FILE_TOKEN_RE = /^(?:\.{0,2}\/)?[A-Za-z0-9_.\-/\[\]@%]+\.[A-Za-z0-9]{1,6}$/;

const VP_CONTROL_RE = /[\u0000-\u001f]/g;
const VP_SPECIAL_RE = /[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'\u201C\u201D\u2018\u2019<>,.?/]+/g;
const VP_COMBINING_RE = /[\u0300-\u036F]/g;

export interface LinkError {
  sourceFile: string;
  line: number;
  linkText: string;
  targetPath: string;
  resolvedPath: string;
}

export interface ParsedMarkdownLink {
  line: number;
  startIndex: number;
  endIndex: number;
  linkText: string;
  rawTarget: string;
}

export interface MarkdownHeading {
  line: number;
  level: number;
  rawText: string;
  githubSlug: string;
  vitepressSlug: string;
}

interface InlineCodeSpan {
  text: string;
  startIndex: number;
  endIndex: number;
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

export function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function findInlineCodeEnd(
  line: string,
  start: number
): { tickLen: number; closeEnd: number | null } {
  let tickLen = 0;
  while (start + tickLen < line.length && line[start + tickLen] === '`') {
    tickLen++;
  }
  const ticks = '`'.repeat(tickLen);
  let searchFrom = start + tickLen;

  while (searchFrom < line.length) {
    const idx = line.indexOf(ticks, searchFrom);
    if (idx === -1) {
      break;
    }
    const beforeOk = idx === 0 || line[idx - 1] !== '`';
    const afterOk = idx + tickLen >= line.length || line[idx + tickLen] !== '`';
    if (beforeOk && afterOk) {
      return { tickLen, closeEnd: idx + tickLen };
    }
    searchFrom = idx + 1;
  }

  return { tickLen, closeEnd: null };
}

function normalizeLinkDestination(rawInner: string): string {
  const trimmed = rawInner.trim();
  if (trimmed.startsWith('<')) {
    const closeAngle = trimmed.indexOf('>');
    if (closeAngle !== -1) {
      return trimmed.slice(1, closeAngle).trim();
    }
  }
  const titleMatch = trimmed.match(/^(\S+)\s+(?:"[^"]*"|'[^']*')$/);
  return titleMatch ? titleMatch[1] : trimmed;
}

export function scanLinksAndCodeInLine(
  line: string,
  lineNumber: number
): { links: ParsedMarkdownLink[]; codeSpans: InlineCodeSpan[] } {
  const links: ParsedMarkdownLink[] = [];
  const codeSpans: InlineCodeSpan[] = [];

  let i = 0;
  while (i < line.length) {
    if (line[i] === '\\') {
      i += 2;
      continue;
    }

    if (line[i] === '`') {
      const { tickLen, closeEnd } = findInlineCodeEnd(line, i);
      if (closeEnd !== null) {
        codeSpans.push({
          text: line.slice(i + tickLen, closeEnd - tickLen),
          startIndex: i,
          endIndex: closeEnd,
        });
        i = closeEnd;
      } else {
        i += tickLen;
      }
      continue;
    }

    if (line[i] === '[') {
      let bracketDepth = 1;
      let j = i + 1;
      const innerCodeSpans: InlineCodeSpan[] = [];

      while (j < line.length && bracketDepth > 0) {
        if (line[j] === '\\') {
          j += 2;
          continue;
        }
        if (line[j] === '`') {
          const { tickLen, closeEnd } = findInlineCodeEnd(line, j);
          if (closeEnd !== null) {
            innerCodeSpans.push({
              text: line.slice(j + tickLen, closeEnd - tickLen),
              startIndex: j,
              endIndex: closeEnd,
            });
            j = closeEnd;
          } else {
            j += tickLen;
          }
          continue;
        }
        if (line[j] === '[') {
          bracketDepth++;
        } else if (line[j] === ']') {
          bracketDepth--;
        }
        j++;
      }

      if (bracketDepth === 0 && j < line.length && line[j] === '(') {
        let k = j + 1;
        let parenDepth = 1;
        let inAngleBrackets = false;

        let firstNonSpace = k;
        while (firstNonSpace < line.length && /\s/.test(line[firstNonSpace])) {
          firstNonSpace++;
        }
        if (line[firstNonSpace] === '<') {
          inAngleBrackets = true;
        }

        while (k < line.length && parenDepth > 0) {
          if (line[k] === '\\') {
            k += 2;
            continue;
          }
          if (inAngleBrackets && line[k] === '>') {
            inAngleBrackets = false;
            k++;
            continue;
          }
          if (!inAngleBrackets) {
            if (line[k] === '(') {
              parenDepth++;
            } else if (line[k] === ')') {
              parenDepth--;
            }
          }
          k++;
        }

        if (parenDepth === 0) {
          const linkText = line.slice(i + 1, j - 1);
          const rawTarget = normalizeLinkDestination(line.slice(j + 1, k - 1));
          links.push({
            line: lineNumber,
            startIndex: i,
            endIndex: k,
            linkText,
            rawTarget,
          });
          codeSpans.push(...innerCodeSpans);
          i = k;
          continue;
        }
      }
    }

    i++;
  }

  return { links, codeSpans };
}

export function stripHtmlTags(input: string): string {
  let result = '';
  let depth = 0;
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (depth > 0) {
      if (quote !== null) {
        if (ch === quote) {
          quote = null;
        }
        continue;
      }
      if (ch === '"' || ch === "'") {
        const closeQuote = input.indexOf(ch, i + 1);
        if (closeQuote !== -1 && input.indexOf('>', closeQuote + 1) !== -1) {
          quote = ch;
        }
        continue;
      }
      if (ch === '<') {
        depth++;
        continue;
      }
      if (ch === '>') {
        depth--;
        continue;
      }
      continue;
    }

    if (ch === '<') {
      depth = 1;
      continue;
    }

    if (ch === '>') {
      continue;
    }

    result += ch;
  }

  return result;
}

export function stripInlineMarkdown(raw: string): string {
  let s = raw;

  // Unwrap links/images iteratively first (preserves inline code spans inside link labels)
  let prev = '';
  while (s !== prev) {
    prev = s;
    const { links } = scanLinksAndCodeInLine(s, 1);
    if (links.length === 0) {
      break;
    }
    let rebuilt = '';
    let cursor = 0;
    for (const link of links) {
      const prefixEnd =
        link.startIndex > 0 && s[link.startIndex - 1] === '!'
          ? link.startIndex - 1
          : link.startIndex;
      rebuilt += s.slice(cursor, prefixEnd) + link.linkText;
      cursor = link.endIndex;
    }
    rebuilt += s.slice(cursor);
    s = rebuilt;
  }

  // Isolate inline code spans with collision-free sentinels so inner text is preserved literally
  let tokenPrefix = '\uE000CODE';
  while (s.includes(tokenPrefix)) {
    tokenPrefix += '_';
  }
  const codeContents: string[] = [];
  let tokenized = '';
  let idx = 0;
  while (idx < s.length) {
    if (s[idx] === '`') {
      const { tickLen, closeEnd } = findInlineCodeEnd(s, idx);
      if (closeEnd !== null) {
        const tokenIndex = codeContents.length;
        codeContents.push(s.slice(idx + tickLen, closeEnd - tickLen));
        tokenized += `${tokenPrefix}${tokenIndex}\uE001`;
        idx = closeEnd;
        continue;
      }
      tokenized += s.slice(idx, idx + tickLen);
      idx += tickLen;
      continue;
    }
    tokenized += s[idx];
    idx++;
  }
  s = tokenized;

  s = s.replace(/(\*\*|__)(.*?)\1/g, '$2');
  s = s.replace(/(\*|_)(?=\S)(.+?)(?<=\S)\1/g, '$2');
  s = s.replace(/~~(.*?)~~/g, '$1');
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!|])/g, '$1');
  s = stripHtmlTags(s);

  for (let c = 0; c < codeContents.length; c++) {
    s = s.split(`${tokenPrefix}${c}\uE001`).join(codeContents[c]);
  }

  return s.trim();
}

export function vitepressSlugify(str: string): string {
  return str
    .normalize('NFKD')
    .replace(VP_COMBINING_RE, '')
    .replace(VP_CONTROL_RE, '')
    .replace(VP_SPECIAL_RE, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^(\d)/, '_$1')
    .toLowerCase();
}

export function githubSlugify(str: string): string {
  return str
    .trim()
    .toLowerCase()
    .replace(/[\uFE00-\uFE0F\u200D]/g, '')
    .replace(/[^\p{L}\p{M}\p{N}_\- ]/gu, '')
    .replace(/ /g, '-');
}

const COMMONMARK_FENCE_RE = /^\s{0,3}(`{3,}|~{3,})(.*)$/;

export interface MarkdownFenceState {
  inFence: boolean;
  fenceChar: string;
  fenceLen: number;
}

export type FenceTransitionResult =
  | { kind: 'open'; infoString: string }
  | { kind: 'close' }
  | { kind: 'inside' }
  | { kind: 'outside' };

export function stepMarkdownFence(
  rawLine: string,
  state: MarkdownFenceState
): FenceTransitionResult {
  const fenceMatch = rawLine.match(COMMONMARK_FENCE_RE);
  if (fenceMatch) {
    const marker = fenceMatch[1];
    const rest = fenceMatch[2];
    const ch = marker[0];
    const len = marker.length;
    if (!state.inFence) {
      if (!(ch === '`' && rest.includes('`'))) {
        state.inFence = true;
        state.fenceChar = ch;
        state.fenceLen = len;
        return { kind: 'open', infoString: rest };
      }
    } else if (ch === state.fenceChar && len >= state.fenceLen && /^\s*$/.test(rest)) {
      state.inFence = false;
      state.fenceChar = '';
      state.fenceLen = 0;
      return { kind: 'close' };
    }
  }

  return state.inFence ? { kind: 'inside' } : { kind: 'outside' };
}

export type FrontmatterScanMode = 'none' | 'skip' | 'collect';
export type HtmlCommentScanMode = 'none' | 'strip' | 'pad';

export interface ScannedMermaidBlock {
  fenceStartLine: number;
  code: string;
}

export interface MarkdownScanOptions {
  frontmatterMode?: FrontmatterScanMode;
  htmlCommentMode?: HtmlCommentScanMode;
  onFrontmatter?: (_lines: string[]) => void;
  onFenceBoundary?: () => void;
  onMermaidBlock?: (_block: ScannedMermaidBlock) => void;
}

export function scanMarkdownDocument(
  content: string,
  onLine: (_line: string, _lineNumber: number) => void,
  options: MarkdownScanOptions = {}
): void {
  const frontmatterMode = options.frontmatterMode ?? 'none';
  const htmlCommentMode = options.htmlCommentMode ?? 'none';

  const lines = content.split(/\r?\n/);
  const fenceState: MarkdownFenceState = { inFence: false, fenceChar: '', fenceLen: 0 };

  let inFrontmatter = false;
  const frontmatterLines: string[] = [];
  let inMermaidFence = false;
  let mermaidFenceStartLine = 0;
  let mermaidLines: string[] = [];
  let inHtmlComment = false;

  lines.forEach((rawLine, index) => {
    const lineNum = index + 1;

    if (frontmatterMode !== 'none') {
      if (index === 0 && rawLine.trim() === '---') {
        inFrontmatter = true;
        return;
      }
      if (inFrontmatter) {
        if (rawLine.trim() === '---' || rawLine.trim() === '...') {
          inFrontmatter = false;
          if (frontmatterMode === 'collect') {
            options.onFrontmatter?.(frontmatterLines);
          }
        } else if (frontmatterMode === 'collect') {
          frontmatterLines.push(rawLine);
        }
        return;
      }
    }

    const fenceStep = stepMarkdownFence(rawLine, fenceState);
    if (fenceStep.kind === 'open') {
      if (options.onMermaidBlock) {
        const infoLang = fenceStep.infoString.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
        if (infoLang === 'mermaid' || infoLang === 'mmd') {
          inMermaidFence = true;
          mermaidFenceStartLine = lineNum;
          mermaidLines = [];
        }
      }
      options.onFenceBoundary?.();
      return;
    }
    if (fenceStep.kind === 'close') {
      if (inMermaidFence) {
        options.onMermaidBlock?.({
          fenceStartLine: mermaidFenceStartLine,
          code: mermaidLines.join('\n'),
        });
        inMermaidFence = false;
        mermaidFenceStartLine = 0;
        mermaidLines = [];
      }
      options.onFenceBoundary?.();
      return;
    }
    if (fenceStep.kind === 'inside') {
      if (inMermaidFence) {
        mermaidLines.push(rawLine);
      }
      return;
    }

    let lineText = rawLine;
    if (htmlCommentMode !== 'none') {
      if (inHtmlComment) {
        const endIdx = lineText.indexOf('-->');
        if (endIdx === -1) {
          return;
        }
        lineText =
          htmlCommentMode === 'pad'
            ? ' '.repeat(endIdx + 3) + lineText.slice(endIdx + 3)
            : lineText.slice(endIdx + 3);
        inHtmlComment = false;
      }
      while (lineText.includes('<!--')) {
        const startIdx = lineText.indexOf('<!--');
        const endIdx = lineText.indexOf('-->', startIdx + 4);
        if (endIdx === -1) {
          lineText = lineText.slice(0, startIdx);
          inHtmlComment = true;
          break;
        }
        lineText =
          htmlCommentMode === 'pad'
            ? lineText.slice(0, startIdx) +
              ' '.repeat(endIdx + 3 - startIdx) +
              lineText.slice(endIdx + 3)
            : lineText.slice(0, startIdx) + lineText.slice(endIdx + 3);
      }
    }

    onLine(lineText, lineNum);
  });

  if (inMermaidFence) {
    options.onMermaidBlock?.({
      fenceStartLine: mermaidFenceStartLine,
      code: mermaidLines.join('\n'),
    });
  }
}

export function transformNonFencedMarkdownLines(
  content: string,
  transformLine: (_line: string, _lineNumber: number) => string
): string {
  const chunks = content.match(/[^\r\n]*(?:\r?\n|$)/g) || [];
  const fenceState: MarkdownFenceState = { inFence: false, fenceChar: '', fenceLen: 0 };

  return chunks
    .map((chunk, idx) => {
      if (!chunk) {
        return '';
      }
      const lineMatch = chunk.match(/^([^\r\n]*)(\r?\n?)$/);
      const line = lineMatch ? lineMatch[1] : chunk;
      const eol = lineMatch ? lineMatch[2] : '';

      if (stepMarkdownFence(line, fenceState).kind !== 'outside') {
        return chunk;
      }

      return transformLine(line, idx + 1) + eol;
    })
    .join('');
}

export function extractMarkdownHeadings(content: string): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  const vpCounts = new Map<string, number>();
  const ghCounts = new Map<string, number>();

  scanMarkdownDocument(
    content,
    (line, lineNum) => {
      const headingMatch = line.match(/^\s{0,3}(#{1,6})\s+(.+?)(?:\s+#+\s*)?$/);
      if (!headingMatch) {
        return;
      }

      const level = headingMatch[1].length;
      const headingRaw = headingMatch[2].trim();
      const customIdMatch = headingRaw.match(/\s*\{#([^}]+)\}\s*$/);

      let baseVp: string;
      let baseGh: string;
      if (customIdMatch) {
        baseVp = customIdMatch[1];
        baseGh = customIdMatch[1];
      } else {
        const plain = stripInlineMarkdown(headingRaw);
        baseVp = vitepressSlugify(plain);
        baseGh = githubSlugify(plain);
      }

      const vpSeen = vpCounts.get(baseVp) || 0;
      vpCounts.set(baseVp, vpSeen + 1);
      const vitepressSlug = vpSeen === 0 ? baseVp : `${baseVp}-${vpSeen}`;

      const ghSeen = ghCounts.get(baseGh) || 0;
      ghCounts.set(baseGh, ghSeen + 1);
      const githubSlug = ghSeen === 0 ? baseGh : `${baseGh}-${ghSeen}`;

      headings.push({
        line: lineNum,
        level,
        rawText: headingRaw,
        githubSlug,
        vitepressSlug,
      });
    },
    {
      frontmatterMode: 'skip',
      htmlCommentMode: 'strip',
    }
  );

  return headings;
}

export function resolveVitePressHeadingSlug(
  targetMarkdownPath: string,
  rawHash: string,
  headingsCache?: Map<string, MarkdownHeading[]>
): string {
  if (!rawHash || LINE_FRAGMENT_RE.test(rawHash)) {
    return rawHash;
  }

  let headings = headingsCache?.get(targetMarkdownPath);
  if (!headings) {
    try {
      const content = fs.readFileSync(targetMarkdownPath, 'utf8');
      headings = extractMarkdownHeadings(content);
      headingsCache?.set(targetMarkdownPath, headings);
    } catch {
      return rawHash;
    }
  }

  const decoded = safeDecodeURIComponent(rawHash);
  const directVp = headings.find(h => h.vitepressSlug === decoded);
  if (directVp) {
    return directVp.vitepressSlug;
  }

  const fromGh = headings.find(h => h.githubSlug === decoded);
  if (fromGh) {
    return fromGh.vitepressSlug;
  }

  return rawHash;
}

function getFileLineCount(filePath: string, cache: Map<string, number>): number {
  const cached = cache.get(filePath);
  if (cached !== undefined) {
    return cached;
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
  headingSlugCache: Map<string, Set<string>>
): boolean {
  const lineMatch = fragment.match(LINE_FRAGMENT_RE);
  if (lineMatch) {
    const start = parseInt(lineMatch[1], 10);
    const end = lineMatch[2] !== undefined ? parseInt(lineMatch[2], 10) : start;
    const totalLines = getFileLineCount(resolvedPath, lineCountCache);
    return isValidLineRange(start, end, totalLines);
  }

  if (/^L\d/i.test(fragment) && !resolvedPath.endsWith('.md')) {
    return false;
  }

  if (resolvedPath.endsWith('.md')) {
    const decodedAnchor = safeDecodeURIComponent(fragment);
    const slugs = getHeadingSlugSet(resolvedPath, headingSlugCache);
    return slugs.has(decodedAnchor);
  }

  // Non-Markdown files only support valid #L<start>[-L<end>] fragments
  return false;
}

function extractFilePathFromLinkTarget(
  rawTarget: string,
  fileDir: string,
  rootDir: string
): string | null {
  const repoMatch = rawTarget.match(REPO_GITHUB_URL_RE);
  if (repoMatch) {
    if (repoMatch[1] === 'tree') {
      return null;
    }
    const repoRel = safeDecodeURIComponent(repoMatch[2]).replace(/\/+$/, '');
    return repoRel ? path.resolve(rootDir, repoRel) : null;
  }

  if (
    rawTarget.startsWith('http://') ||
    rawTarget.startsWith('https://') ||
    rawTarget.startsWith('mailto:') ||
    rawTarget.startsWith('tel:') ||
    rawTarget.startsWith('#')
  ) {
    return null;
  }

  const cleanPath = safeDecodeURIComponent(rawTarget.split('#')[0].split('?')[0]);
  if (!cleanPath) {
    return null;
  }

  return cleanPath.startsWith('/')
    ? path.resolve(rootDir, cleanPath.slice(1))
    : path.resolve(fileDir, cleanPath);
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

const vitepressIgnoredDeadLinksCache = new Map<string, RegExp[]>();

function getVitePressIgnoredDeadLinkPatterns(rootDir: string): RegExp[] {
  const cached = vitepressIgnoredDeadLinksCache.get(rootDir);
  if (cached) {
    return cached;
  }

  const patterns: RegExp[] = [];
  const configAbs = path.join(rootDir, 'docs-portal', '.vitepress', 'config.mts');
  if (fs.existsSync(configAbs) && fs.statSync(configAbs).isFile()) {
    try {
      const content = fs.readFileSync(configAbs, 'utf8');
      const sf = ts.createSourceFile(configAbs, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

      const visit = (node: ts.Node) => {
        if (
          ts.isPropertyAssignment(node) &&
          (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
          node.name.text === 'ignoreDeadLinks' &&
          ts.isArrayLiteralExpression(node.initializer)
        ) {
          for (const elem of node.initializer.elements) {
            if (ts.isRegularExpressionLiteral(elem)) {
              const rawRegex = elem.text;
              const lastSlash = rawRegex.lastIndexOf('/');
              if (rawRegex.startsWith('/') && lastSlash > 0) {
                try {
                  patterns.push(new RegExp(rawRegex.slice(1, lastSlash), rawRegex.slice(lastSlash + 1)));
                } catch {
                  // Ignore malformed regex literal
                }
              }
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    } catch {
      // Ignore parse errors
    }
  }

  vitepressIgnoredDeadLinksCache.set(rootDir, patterns);
  return patterns;
}

function isIgnoredPortalDeadLink(
  cleanRoute: string,
  sourceAbsPath: string,
  rootDir: string
): boolean {
  const normalized = cleanRoute.startsWith('/') ? cleanRoute : `/${cleanRoute}`;
  const portalRoot = path.join(rootDir, 'docs-portal') + path.sep;
  if (
    sourceAbsPath.startsWith(portalRoot) &&
    /^\/(?:demo|storybook)\/?$/.test(normalized) &&
    fs.existsSync(path.join(rootDir, 'scripts', 'build-pages-bundle.mjs'))
  ) {
    return true;
  }
  const patterns = getVitePressIgnoredDeadLinkPatterns(rootDir);
  return patterns.some((re) => re.test(normalized));
}

function resolvePortalRouteToSourceFile(
  cleanRoute: string,
  sourceAbsPath: string,
  rootDir: string
): string | null {
  const portalDir = path.join(rootDir, 'docs-portal');
  let routeRel: string;

  if (cleanRoute.startsWith('/')) {
    routeRel = cleanRoute
      .replace(/^\/+/, '')
      .replace(/\.(?:html|md)$/, '')
      .replace(/\/+$/, '');
  } else {
    const resolvedFromSource = path.resolve(path.dirname(sourceAbsPath), cleanRoute);
    routeRel = path
      .relative(portalDir, resolvedFromSource)
      .replace(/\\/g, '/')
      .replace(/\.(?:html|md)$/, '')
      .replace(/\/+$/, '');
  }

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
  headingSlugCache: Map<string, Set<string>> = new Map()
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
    if (
      !fragment ||
      (requiresMdSource && !sourceAbsPath.endsWith('.md')) ||
      !validateFragmentOnFile(sourceAbsPath, fragment, lineCountCache, headingSlugCache)
    ) {
      errors.push({
        sourceFile: relSource,
        line: lineNum,
        linkText,
        targetPath: trimmed,
        resolvedPath: `${relSource}${trimmed}`,
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

    if (
      fragment &&
      !validateFragmentOnFile(resolvedRepoPath, fragment, lineCountCache, headingSlugCache)
    ) {
      errors.push({
        sourceFile: relSource,
        line: lineNum,
        linkText,
        targetPath: trimmed,
        resolvedPath: `${relResolved}#${fragment}`,
      });
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
        if (
          !stat.isFile() ||
          !validateFragmentOnFile(resolvedPath, fragment, lineCountCache, headingSlugCache)
        ) {
          errors.push({
            sourceFile: relSource,
            line: lineNum,
            linkText,
            targetPath: trimmed,
            resolvedPath: `${relResolved}#${fragment}`,
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

  const resolvedPortalFile = resolvePortalRouteToSourceFile(cleanTarget, sourceAbsPath, rootDir);
  if (!resolvedPortalFile) {
    if (!fragment && isIgnoredPortalDeadLink(cleanTarget, sourceAbsPath, rootDir)) {
      return;
    }
    errors.push({
      sourceFile: relSource,
      line: lineNum,
      linkText,
      targetPath: trimmed,
      resolvedPath: `docs-portal/${cleanTarget.replace(/^\/+/, '')}`,
    });
    return;
  }

  if (
    fragment &&
    !validateFragmentOnFile(resolvedPortalFile, fragment, lineCountCache, headingSlugCache)
  ) {
    const relPortalFile = path.relative(rootDir, resolvedPortalFile).replace(/\\/g, '/');
    errors.push({
      sourceFile: relSource,
      line: lineNum,
      linkText,
      targetPath: trimmed,
      resolvedPath: `${relPortalFile}#${fragment}`,
    });
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

  const sf = ts.createSourceFile(configAbs, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const configOptions: LinkTargetValidationOptions = {
    queryTargetMode: 'error',
    portalRouteMode: 'always',
    intraFileAnchorMode: 'markdown-only',
  };

  function getPropertyKeyName(nameNode: ts.PropertyName): string | null {
    if (ts.isIdentifier(nameNode) || ts.isStringLiteral(nameNode) || ts.isNoSubstitutionTemplateLiteral(nameNode)) {
      return nameNode.text;
    }
    return null;
  }

  function scanNavOrSidebarSubtree(node: ts.Node, sectionLabel: string) {
    if (ts.isObjectLiteralExpression(node)) {
      let itemLabel = `${sectionLabel} link`;
      for (const prop of node.properties) {
        if (ts.isPropertyAssignment(prop) && getPropertyKeyName(prop.name) === 'text') {
          if (ts.isStringLiteral(prop.initializer) || ts.isNoSubstitutionTemplateLiteral(prop.initializer)) {
            itemLabel = prop.initializer.text;
          }
        }
      }

      for (const prop of node.properties) {
        if (ts.isPropertyAssignment(prop) && getPropertyKeyName(prop.name) === 'link') {
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
      const propName = getPropertyKeyName(node.name);
      if (propName === 'nav' || propName === 'sidebar') {
        scanNavOrSidebarSubtree(node.initializer, propName);
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
  mermaidBlocks: ExtractedMermaidBlock[] = []
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
          headingSlugCache
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

        const totalLines = getFileLineCount(resolvedTarget, lineCountCache);
        if (!isValidLineRange(startLine, endLine, totalLines)) {
          errors.push({
            sourceFile: relSource,
            line: lineNum,
            linkText: chosenCandidate.rawPath,
            targetPath: `${chosenCandidate.rawPath} ${citationText}`,
            resolvedPath: `${relResolved} ${citationText} (file has ${totalLines} lines)`,
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

export async function checkDocLinks(
  rootDir: string = ROOT_DIR
): Promise<{ passed: boolean; errors: LinkError[]; count: number }> {
  const mdFiles = findMarkdownFiles(rootDir);
  const errors: LinkError[] = [];
  const lineCountCache = new Map<string, number>();
  const headingSlugCache = new Map<string, Set<string>>();
  const mermaidBlocks: ExtractedMermaidBlock[] = [];

  for (const file of mdFiles) {
    checkLinksInFile(
      file,
      errors,
      rootDir,
      lineCountCache,
      headingSlugCache,
      mermaidBlocks
    );
  }

  checkVitePressConfigLinks(rootDir, errors, lineCountCache, headingSlugCache);
  await validateMermaidBlocks(mermaidBlocks, errors);

  return { passed: errors.length === 0, errors, count: mdFiles.length };
}

async function main() {
  const { passed, errors, count } = await checkDocLinks();

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
