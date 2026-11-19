import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT_DIR = process.cwd();

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

export function stripInlineMarkdown(raw: string): string {
  let s = raw;
  // Unwrap inline code spans while preserving inner text
  let out = '';
  let idx = 0;
  while (idx < s.length) {
    if (s[idx] === '`') {
      const { tickLen, closeEnd } = findInlineCodeEnd(s, idx);
      if (closeEnd !== null) {
        out += s.slice(idx + tickLen, closeEnd - tickLen);
        idx = closeEnd;
        continue;
      }
      out += s.slice(idx, idx + tickLen);
      idx += tickLen;
      continue;
    }
    out += s[idx];
    idx++;
  }
  s = out;

  // Unwrap links/images iteratively (handles nested brackets)
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

  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/(\*\*|__)(.*?)\1/g, '$2');
  s = s.replace(/(\*|_)(?=\S)(.+?)(?<=\S)\1/g, '$2');
  s = s.replace(/~~(.*?)~~/g, '$1');
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!|])/g, '$1');
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

export function extractMarkdownHeadings(content: string): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  const vpCounts = new Map<string, number>();
  const ghCounts = new Map<string, number>();

  const lines = content.split(/\r?\n/);
  let inFrontmatter = false;
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;
  let inHtmlComment = false;

  lines.forEach((rawLine, index) => {
    if (index === 0 && rawLine.trim() === '---') {
      inFrontmatter = true;
      return;
    }
    if (inFrontmatter) {
      if (rawLine.trim() === '---' || rawLine.trim() === '...') {
        inFrontmatter = false;
      }
      return;
    }

    const fenceMatch = rawLine.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      const rest = fenceMatch[2];
      const ch = marker[0];
      const len = marker.length;
      if (!inFence) {
        if (!(ch === '`' && rest.includes('`'))) {
          inFence = true;
          fenceChar = ch;
          fenceLen = len;
          return;
        }
      } else if (ch === fenceChar && len >= fenceLen && /^\s*$/.test(rest)) {
        inFence = false;
        fenceChar = '';
        fenceLen = 0;
        return;
      }
    }

    if (inFence) {
      return;
    }

    let line = rawLine;
    if (inHtmlComment) {
      const endIdx = line.indexOf('-->');
      if (endIdx === -1) {
        return;
      }
      line = line.slice(endIdx + 3);
      inHtmlComment = false;
    }
    while (line.includes('<!--')) {
      const startIdx = line.indexOf('<!--');
      const endIdx = line.indexOf('-->', startIdx + 4);
      if (endIdx === -1) {
        line = line.slice(0, startIdx);
        inHtmlComment = true;
        break;
      }
      line = line.slice(0, startIdx) + line.slice(endIdx + 3);
    }

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
      line: index + 1,
      level,
      rawText: headingRaw,
      githubSlug,
      vitepressSlug,
    });
  });

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

export function checkLinksInFile(
  filePath: string,
  errors: LinkError[],
  rootDir: string = ROOT_DIR,
  lineCountCache: Map<string, number> = new Map(),
  headingSlugCache: Map<string, Set<string>> = new Map()
) {
  const relSource = path.relative(rootDir, filePath).replace(/\\/g, '/');
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return;
  }

  const lines = content.split(/\r?\n/);
  const fileDir = path.dirname(filePath);

  let inFrontmatter = false;
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;
  let inHtmlComment = false;
  let paragraphCandidates: FileCandidate[] = [];

  lines.forEach((rawLine, index) => {
    const lineNum = index + 1;

    if (index === 0 && rawLine.trim() === '---') {
      inFrontmatter = true;
      return;
    }
    if (inFrontmatter) {
      if (rawLine.trim() === '---' || rawLine.trim() === '...') {
        inFrontmatter = false;
      }
      return;
    }

    const fenceMatch = rawLine.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      const rest = fenceMatch[2];
      const ch = marker[0];
      const len = marker.length;
      if (!inFence) {
        if (!(ch === '`' && rest.includes('`'))) {
          inFence = true;
          fenceChar = ch;
          fenceLen = len;
          paragraphCandidates = [];
          return;
        }
      } else if (ch === fenceChar && len >= fenceLen && /^\s*$/.test(rest)) {
        inFence = false;
        fenceChar = '';
        fenceLen = 0;
        paragraphCandidates = [];
        return;
      }
    }

    if (inFence) {
      return;
    }

    let lineText = rawLine;
    if (inHtmlComment) {
      const endIdx = lineText.indexOf('-->');
      if (endIdx === -1) {
        return;
      }
      lineText = ' '.repeat(endIdx + 3) + lineText.slice(endIdx + 3);
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
        lineText.slice(0, startIdx) +
        ' '.repeat(endIdx + 3 - startIdx) +
        lineText.slice(endIdx + 3);
    }

    if (!lineText.trim() || /^\s{0,3}#{1,6}\s+/.test(lineText)) {
      paragraphCandidates = [];
    }

    const { links, codeSpans } = scanLinksAndCodeInLine(lineText, lineNum);

    for (const link of links) {
      const rawTarget = link.rawTarget;
      if (!rawTarget) {
        errors.push({
          sourceFile: relSource,
          line: lineNum,
          linkText: link.linkText,
          targetPath: rawTarget,
          resolvedPath: relSource,
        });
        continue;
      }

      if (rawTarget.startsWith('mailto:') || rawTarget.startsWith('tel:')) {
        continue;
      }

      // Intra-file anchor (#anchor or #L<start>-L<end>)
      if (rawTarget.startsWith('#')) {
        const fragment = rawTarget.slice(1);
        if (
          !fragment ||
          !validateFragmentOnFile(filePath, fragment, lineCountCache, headingSlugCache)
        ) {
          errors.push({
            sourceFile: relSource,
            line: lineNum,
            linkText: link.linkText,
            targetPath: rawTarget,
            resolvedPath: `${relSource}${rawTarget}`,
          });
        }
        continue;
      }

      // Repository GitHub URL (blob / tree) — validated strictly offline against local repo
      const repoMatch = rawTarget.match(REPO_GITHUB_URL_RE);
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
            linkText: link.linkText,
            targetPath: rawTarget,
            resolvedPath: relResolved,
          });
          continue;
        }

        const stat = fs.statSync(resolvedRepoPath);
        if (refKind === 'tree') {
          if (!stat.isDirectory() || LINE_FRAGMENT_RE.test(fragment)) {
            errors.push({
              sourceFile: relSource,
              line: lineNum,
              linkText: link.linkText,
              targetPath: rawTarget,
              resolvedPath: `${relResolved}${fragment ? '#' + fragment : ''}`,
            });
          }
          continue;
        }

        if (!stat.isFile()) {
          errors.push({
            sourceFile: relSource,
            line: lineNum,
            linkText: link.linkText,
            targetPath: rawTarget,
            resolvedPath: relResolved,
          });
          continue;
        }

        if (
          fragment &&
          !validateFragmentOnFile(
            resolvedRepoPath,
            fragment,
            lineCountCache,
            headingSlugCache
          )
        ) {
          errors.push({
            sourceFile: relSource,
            line: lineNum,
            linkText: link.linkText,
            targetPath: rawTarget,
            resolvedPath: `${relResolved}#${fragment}`,
          });
        }
        continue;
      }

      // Skip external third-party URLs (strictly offline)
      if (rawTarget.startsWith('http://') || rawTarget.startsWith('https://')) {
        continue;
      }

      const hashIdx = rawTarget.indexOf('#');
      const beforeHash = hashIdx === -1 ? rawTarget : rawTarget.slice(0, hashIdx);
      const fragment = hashIdx === -1 ? '' : rawTarget.slice(hashIdx + 1);
      const cleanTarget = safeDecodeURIComponent(beforeHash.split('?')[0]);

      if (!cleanTarget) {
        continue;
      }

      const resolvedPath = cleanTarget.startsWith('/')
        ? path.resolve(rootDir, cleanTarget.slice(1))
        : path.resolve(fileDir, cleanTarget);
      const relResolved = path.relative(rootDir, resolvedPath).replace(/\\/g, '/');

      if (!fs.existsSync(resolvedPath)) {
        errors.push({
          sourceFile: relSource,
          line: lineNum,
          linkText: link.linkText,
          targetPath: rawTarget,
          resolvedPath: relResolved,
        });
        continue;
      }

      if (fragment) {
        const stat = fs.statSync(resolvedPath);
        if (
          !stat.isFile() ||
          !validateFragmentOnFile(resolvedPath, fragment, lineCountCache, headingSlugCache)
        ) {
          errors.push({
            sourceFile: relSource,
            line: lineNum,
            linkText: link.linkText,
            targetPath: rawTarget,
            resolvedPath: `${relResolved}#${fragment}`,
          });
        }
      }
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
  });
}

export function checkDocLinks(
  rootDir: string = ROOT_DIR
): { passed: boolean; errors: LinkError[]; count: number } {
  const mdFiles = findMarkdownFiles(rootDir);
  const errors: LinkError[] = [];
  const lineCountCache = new Map<string, number>();
  const headingSlugCache = new Map<string, Set<string>>();

  for (const file of mdFiles) {
    checkLinksInFile(file, errors, rootDir, lineCountCache, headingSlugCache);
  }

  return { passed: errors.length === 0, errors, count: mdFiles.length };
}

function main() {
  const { passed, errors, count } = checkDocLinks();

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
1. Fix or remove broken relative file links, #anchor slugs, or #L / (L...) line
   citations in repository Markdown documents.
2. Ensure target file paths, headings, and line ranges exist relative to the
   Markdown file or repository root.
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
  main();
}
