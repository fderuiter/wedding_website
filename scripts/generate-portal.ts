import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  ARCHITECTURAL_DOCS,
  checkDocLinks,
  type DocMapping,
  findInlineCodeEnd,
  MarkdownHeading,
  resolveVitePressHeadingSlug,
  safeDecodeURIComponent,
  scanLinksAndCodeInLine,
  transformNonFencedMarkdownLines,
} from './check-doc-links';
import {
  generateApiRoutesSection,
  generateConfigTable,
  generateRoutesDiagram,
  updateArchitectureMd,
  updateFeatureModulesMd,
  generateOpenApiSpec,
} from './generate-docs';

export { ARCHITECTURAL_DOCS, type DocMapping };

const scriptDir = typeof __dirname !== 'undefined'
  ? __dirname
  : path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(scriptDir, '..');
const PORTAL_DIR = path.join(ROOT_DIR, 'docs-portal');

const PRESERVED_PORTAL_ENTRIES = new Set([
  '.vitepress',
  'api',
  'public',
  'index.md',
  'postcss.config.mjs',
]);

const DOC_LOOKUP = new Map<string, DocMapping>();
for (const doc of ARCHITECTURAL_DOCS) {
  DOC_LOOKUP.set(doc.src.replace(/\\/g, '/'), doc);
}

const headingsCache = new Map<string, MarkdownHeading[]>();

export function rewriteMarkdownLinks(
  content: string,
  srcRelPath: string,
  rootDir: string = ROOT_DIR
): string {
  const srcFileAbs = path.join(rootDir, srcRelPath);
  const srcDir = path.dirname(srcFileAbs);

  return transformNonFencedMarkdownLines(content, (line, lineNumber) => {
    const { links } = scanLinksAndCodeInLine(line, lineNumber);
    if (links.length === 0) {
      return line;
    }

    let rebuilt = '';
    let cursor = 0;

    for (const link of links) {
      rebuilt += line.slice(cursor, link.startIndex);
      const fullMatch = line.slice(link.startIndex, link.endIndex);
      const text = link.linkText;
      const trimmedTarget = link.rawTarget.trim();

      if (
        trimmedTarget.startsWith('http://') ||
        trimmedTarget.startsWith('https://') ||
        trimmedTarget.startsWith('mailto:') ||
        trimmedTarget.startsWith('tel:')
      ) {
        rebuilt += fullMatch;
        cursor = link.endIndex;
        continue;
      }

      if (trimmedTarget.startsWith('#')) {
        const intraHash = trimmedTarget.slice(1);
        if (intraHash && fs.existsSync(srcFileAbs)) {
          const mappedIntra = resolveVitePressHeadingSlug(
            srcFileAbs,
            intraHash,
            headingsCache
          );
          rebuilt += `[${text}](#${mappedIntra})`;
        } else {
          rebuilt += fullMatch;
        }
        cursor = link.endIndex;
        continue;
      }

      const hashIndex = trimmedTarget.indexOf('#');
      const beforeHash =
        hashIndex === -1 ? trimmedTarget : trimmedTarget.slice(0, hashIndex);
      const hash = hashIndex === -1 ? '' : trimmedTarget.slice(hashIndex + 1);

      const queryIndex = beforeHash.indexOf('?');
      const rawPathPart =
        queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex);
      const queryPart = queryIndex === -1 ? '' : beforeHash.slice(queryIndex);

      if (!rawPathPart) {
        rebuilt += fullMatch;
        cursor = link.endIndex;
        continue;
      }

      const decodedPathPart = safeDecodeURIComponent(rawPathPart);
      const resolvedFile = decodedPathPart.startsWith('/')
        ? path.resolve(rootDir, decodedPathPart.slice(1))
        : path.resolve(srcDir, decodedPathPart);
      const resolvedRel = path
        .relative(rootDir, resolvedFile)
        .replace(/\\/g, '/')
        .replace(/\/+$/, '');

      if (DOC_LOOKUP.has(resolvedRel)) {
        const targetDoc = DOC_LOOKUP.get(resolvedRel)!;
        const vitepressRoute = '/' + targetDoc.dest.replace(/\.md$/, '');
        const mappedHash = hash
          ? resolveVitePressHeadingSlug(resolvedFile, hash, headingsCache)
          : '';
        const newTarget = `${vitepressRoute}${queryPart}${mappedHash ? '#' + mappedHash : ''}`;
        rebuilt += `[${text}](${newTarget})`;
        cursor = link.endIndex;
        continue;
      }

      if (fs.existsSync(resolvedFile)) {
        const isDir = fs.statSync(resolvedFile).isDirectory();
        const refKind = isDir ? 'tree' : 'blob';
        const githubUrl = `https://github.com/fderuiter/wedding_website/${refKind}/main/${resolvedRel}${queryPart}${hash ? '#' + hash : ''}`;
        rebuilt += `[${text}](${githubUrl})`;
        cursor = link.endIndex;
        continue;
      }

      rebuilt += fullMatch;
      cursor = link.endIndex;
    }

    rebuilt += line.slice(cursor);
    return rebuilt;
  });
}

export function escapeVueMustache(content: string): string {
  return transformNonFencedMarkdownLines(content, line => {
    let out = '';
    let i = 0;
    while (i < line.length) {
      if (line[i] === '`') {
        const { tickLen, closeEnd } = findInlineCodeEnd(line, i);
        if (closeEnd !== null) {
          out += line.slice(i, closeEnd);
          i = closeEnd;
          continue;
        }
        out += line.slice(i, i + tickLen);
        i += tickLen;
        continue;
      }

      if (line[i] === '{' && line[i + 1] === '{') {
        out += '&#123;&#123;';
        i += 2;
        continue;
      }

      if (line[i] === '}' && line[i + 1] === '}') {
        out += '&#125;&#125;';
        i += 2;
        continue;
      }

      out += line[i];
      i++;
    }

    return out;
  });
}

export function cleanStagedPortalDocs(portalDir: string = PORTAL_DIR): number {
  if (!fs.existsSync(portalDir)) {
    return 0;
  }

  let removedCount = 0;

  function cleanSubdir(dirPath: string) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        cleanSubdir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        fs.unlinkSync(fullPath);
        removedCount++;
      }
    }
    if (fs.readdirSync(dirPath).length === 0) {
      fs.rmdirSync(dirPath);
    }
  }

  const topEntries = fs.readdirSync(portalDir, { withFileTypes: true });
  for (const entry of topEntries) {
    if (PRESERVED_PORTAL_ENTRIES.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(portalDir, entry.name);
    if (entry.isDirectory()) {
      cleanSubdir(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      fs.unlinkSync(fullPath);
      removedCount++;
    }
  }

  return removedCount;
}

export async function generatePortal(options: GeneratePortalOptions = {}) {
  const rootDir = options.rootDir ?? ROOT_DIR;
  const portalDir = options.portalDir ?? PORTAL_DIR;
  console.log('--- Step 1: Validating documentation cross-links ---');
  const linkCheckResult = await checkDocLinks(rootDir);
  if (!linkCheckResult.passed) {
    console.error(`❌ Link validation failed with ${linkCheckResult.errors.length} broken links!`);
    linkCheckResult.errors.forEach(err => {
      console.error(`  - ${err.sourceFile}:${err.line} -> ${err.targetPath}`);
    });
    process.exit(1);
  }
  console.log(`✅ Pre-compilation link check passed (${linkCheckResult.count} Markdown files verified).`);

  if (shouldSkipPortalDocSync(options, rootDir)) {
    console.log('\n--- Step 2: Reusing pre-generated architecture & OpenAPI specifications ---');
  } else {
    console.log('\n--- Step 2: Synchronizing architecture & OpenAPI specifications ---');
    const configTable = generateConfigTable();
    const routesDiagram = generateRoutesDiagram();
    const apiRoutesSection = generateApiRoutesSection();
    if (!configTable || !routesDiagram || !apiRoutesSection) {
      throw new Error('Failed to generate configuration table, route diagram, or API routes inventory');
    }
    updateArchitectureMd();
    updateFeatureModulesMd();
    await generateOpenApiSpec();
  }

  console.log(`\n--- Step 3: Staging ${(options.docs ?? ARCHITECTURAL_DOCS).length} architectural specifications into docs-portal ---`);
  const removedStale = cleanStagedPortalDocs(portalDir);
  if (removedStale > 0) {
    console.log(`🧹 Cleaned ${removedStale} previously staged Markdown file(s).`);
  }
  let stagedCount = 0;
  for (const doc of options.docs ?? ARCHITECTURAL_DOCS) {
    stagePortalDoc(doc, rootDir, portalDir, false);
    stagedCount++;
  }
  console.log(`✅ Successfully staged all ${stagedCount} architectural specifications into VitePress folders.`);

  console.log('\n--- Step 4: Staging OpenAPI schema into portal assets ---');
  stageOpenApiAsset(rootDir, portalDir, true);
  console.log('\n✅ Portal generation and staging complete!');
}

export function prependGeneratedPortalComment(content: string, srcRelPath: string): string {
  const normalizedSrc = srcRelPath.replace(/\\/g, '/');
  const comment = `<!-- AUTO-GENERATED FILE: Staged from ${normalizedSrc} by scripts/generate-portal.ts. Edit the source file instead. -->`;
  if (content.startsWith(comment)) {
    return content;
  }
  const frontmatterMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[0];
    if (content.slice(frontmatter.length).startsWith(comment)) {
      return content;
    }
    return `${frontmatter}${comment}\n\n${content.slice(frontmatter.length)}`;
  }
  return `${comment}\n\n${content}`;
}

export function stagePortalDoc(
  doc: DocMapping,
  rootDir: string = ROOT_DIR,
  portalDir: string = PORTAL_DIR,
  allowMissing: boolean = false
): boolean {
  const srcPath = path.join(rootDir, doc.src);
  const destPath = path.join(portalDir, doc.dest);

  if (!fs.existsSync(srcPath)) {
    if (allowMissing) {
      return false;
    }
    throw new Error(`Required architectural document missing at: ${srcPath}`);
  }

  headingsCache.delete(srcPath);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  let content = fs.readFileSync(srcPath, 'utf8');
  content = rewriteMarkdownLinks(content, doc.src, rootDir);
  content = escapeVueMustache(content);
  content = prependGeneratedPortalComment(prependPortalFrontmatterTitle(content, doc.title), doc.src);

  if (fs.existsSync(destPath)) {
    const existing = fs.readFileSync(destPath, 'utf8');
    if (existing === content) {
      return false;
    }
  }

  fs.writeFileSync(destPath, content, 'utf8');
  return true;
}

export function prependPortalFrontmatterTitle(content: string, title: string): string {
  const trimmedTitle = title.trim();
  if (!trimmedTitle || /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.test(content)) {
    return content;
  }
  const yamlTitle = /[:#[\]{}&*!|>'"%@`]|^\s|\s$|\r|\n/.test(trimmedTitle)
    ? JSON.stringify(trimmedTitle)
    : trimmedTitle;
  return `---\ntitle: ${yamlTitle}\n---\n${content}`;
}

function stageOpenApiAsset(
  rootDir: string = ROOT_DIR,
  portalDir: string = PORTAL_DIR,
  verbose: boolean = false
): boolean {
  const openApiSrc = path.join(rootDir, 'public', 'openapi.json');
  const openApiDestDir = path.join(portalDir, 'public');
  fs.mkdirSync(openApiDestDir, { recursive: true });
  const openApiDest = path.join(openApiDestDir, 'openapi.json');

  if (!fs.existsSync(openApiSrc)) {
    if (verbose) {
      console.warn(`⚠️ Warning: ${openApiSrc} does not exist yet.`);
    }
    return false;
  }

  const nextContent = fs.readFileSync(openApiSrc, 'utf8');
  if (fs.existsSync(openApiDest) && fs.readFileSync(openApiDest, 'utf8') === nextContent) {
    if (verbose) {
      console.log(`✅ Copied openapi.json to ${openApiDest}`);
    }
    return false;
  }

  fs.writeFileSync(openApiDest, nextContent, 'utf8');
  if (verbose) {
    console.log(`✅ Copied openapi.json to ${openApiDest}`);
  }
  return true;
}

export interface GeneratePortalOptions {
  stageOnly?: boolean;
  skipDocSync?: boolean;
  rootDir?: string;
  portalDir?: string;
  docs?: readonly DocMapping[];
}

const PRE_GENERATED_PORTAL_ARTIFACTS = [
  'ARCHITECTURE.md',
  'FEATURE_MODULES.md',
  'public/openapi.json',
] as const;

function shouldSkipPortalDocSync(
  options: GeneratePortalOptions,
  rootDir: string = ROOT_DIR
): boolean {
  if (!options.stageOnly && !options.skipDocSync && process.env.SKIP_DOC_SYNC !== 'true') {
    return false;
  }
  return PRE_GENERATED_PORTAL_ARTIFACTS.every(relPath =>
    fs.existsSync(path.join(rootDir, relPath))
  );
}

export interface WatchPortalOptions {
  rootDir?: string;
  portalDir?: string;
  docs?: readonly DocMapping[];
  debounceMs?: number;
  onStage?: (_doc: DocMapping) => void;
}

export function watchPortalDocs(options: WatchPortalOptions = {}): { close: () => void } {
  const rootDir = options.rootDir ?? ROOT_DIR;
  const portalDir = options.portalDir ?? PORTAL_DIR;
  const docs = options.docs ?? ARCHITECTURAL_DOCS;
  const debounceMs = options.debounceMs ?? 60;

  const watchedFilesByDir = new Map<string, Map<string, DocMapping | 'openapi'>>();

  const registerTarget = (absFilePath: string, target: DocMapping | 'openapi') => {
    const dir = path.dirname(absFilePath);
    const base = path.basename(absFilePath);
    if (!fs.existsSync(dir)) {
      return;
    }
    let dirEntries = watchedFilesByDir.get(dir);
    if (!dirEntries) {
      dirEntries = new Map();
      watchedFilesByDir.set(dir, dirEntries);
    }
    dirEntries.set(base, target);
  };

  for (const doc of docs) {
    registerTarget(path.resolve(rootDir, doc.src), doc);
  }
  registerTarget(path.resolve(rootDir, 'public', 'openapi.json'), 'openapi');

  const watchers: fs.FSWatcher[] = [];
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let closed = false;

  const scheduleUpdate = (key: string, target: DocMapping | 'openapi') => {
    if (closed) {
      return;
    }
    const existingTimer = timers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    const timer = setTimeout(() => {
      timers.delete(key);
      if (closed) {
        return;
      }
      try {
        if (target === 'openapi') {
          if (stageOpenApiAsset(rootDir, portalDir, false)) {
            console.log('🔄 Re-staged public/openapi.json -> docs-portal/public/openapi.json');
          }
        } else if (stagePortalDoc(target, rootDir, portalDir, true)) {
          console.log(`🔄 Re-staged ${target.src} -> docs-portal/${target.dest}`);
          options.onStage?.(target);
        }
      } catch (err) {
        console.error('⚠️ Failed to re-stage edited portal file:', err);
      }
    }, debounceMs);
    timers.set(key, timer);
  };

  for (const [dirPath, targetsByBase] of watchedFilesByDir.entries()) {
    const watcher = fs.watch(dirPath, (_eventType, filename) => {
      if (closed) {
        return;
      }
      if (filename) {
        const name = String(filename);
        const matched = targetsByBase.get(name);
        if (matched) {
          scheduleUpdate(path.join(dirPath, name), matched);
        }
        return;
      }
      for (const [name, target] of targetsByBase.entries()) {
        scheduleUpdate(path.join(dirPath, name), target);
      }
    });
    watchers.push(watcher);
  }

  return {
    close() {
      closed = true;
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
      for (const watcher of watchers) {
        watcher.close();
      }
      watchers.length = 0;
    },
  };
}

function stagePortalAssetsOnly(): void {
  console.log(`--- Staging ${ARCHITECTURAL_DOCS.length} architectural specifications into docs-portal ---`);
  const removedStale = cleanStagedPortalDocs(PORTAL_DIR);
  if (removedStale > 0) {
    console.log(`🧹 Cleaned ${removedStale} previously staged Markdown file(s).`);
  }
  let stagedCount = 0;
  for (const doc of ARCHITECTURAL_DOCS) {
    stagePortalDoc(doc, ROOT_DIR, PORTAL_DIR, false);
    stagedCount++;
  }
  console.log(`✅ Successfully staged all ${stagedCount} architectural specifications into VitePress folders.`);
  stageOpenApiAsset(ROOT_DIR, PORTAL_DIR, true);
  console.log('\n✅ Portal staging complete!');
}

async function runCli(rawArgs: string[]): Promise<void> {
  const watchMode = rawArgs.includes('--watch');
  const serveMode = rawArgs.includes('--serve');
  const skipSync = rawArgs.includes('--skip-sync') || process.env.SKIP_DOC_SYNC === 'true';
  const stageOnly = rawArgs.includes('--stage-only') || rawArgs.includes('--skip-doc-sync');
  const vitepressArgs = rawArgs.filter(
    arg =>
      arg !== '--watch' &&
      arg !== '--serve' &&
      arg !== '--stage-only' &&
      arg !== '--skip-doc-sync' &&
      arg !== '--skip-sync'
  );

  if (skipSync) {
    stagePortalAssetsOnly();
  } else {
    await generatePortal({ stageOnly });
  }

  if (!watchMode && !serveMode) {
    return;
  }

  const watcher = watchPortalDocs();
  console.log(`\n👀 Watching ${ARCHITECTURAL_DOCS.length} source Markdown files for live portal staging...`);

  if (!serveMode) {
    const shutdown = () => {
      watcher.close();
      process.exit(0);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    return;
  }

  const vitepressBin = path.join(
    ROOT_DIR,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'vitepress.cmd' : 'vitepress'
  );
  const child = spawn(vitepressBin, ['dev', 'docs-portal', ...vitepressArgs], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
  });

  const forwardSignal = (signal: NodeJS.Signals) => {
    watcher.close();
    if (!child.killed) {
      child.kill(signal);
    }
  };

  process.once('SIGINT', () => forwardSignal('SIGINT'));
  process.once('SIGTERM', () => forwardSignal('SIGTERM'));

  await new Promise<void>((resolve, reject) => {
    child.on('error', err => {
      watcher.close();
      reject(err);
    });
    child.on('close', code => {
      watcher.close();
      if (code && code !== 0 && code !== 130 && code !== 143) {
        process.exitCode = code;
      }
      resolve();
    });
  });
}

const isMain = typeof process.argv[1] === 'string' &&
               path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  runCli(process.argv.slice(2)).catch(err => {
    console.error('Portal generation error:', err);
    process.exit(1);
  });
}
