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
  const chunks = content.match(/[^\r\n]*(?:\r?\n|$)/g) || [];

  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;

  return chunks
    .map((chunk, idx) => {
      if (!chunk) {
        return '';
      }
      const lineMatch = chunk.match(/^([^\r\n]*)(\r?\n?)$/);
      const line = lineMatch ? lineMatch[1] : chunk;
      const eol = lineMatch ? lineMatch[2] : '';

      const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
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
            return chunk;
          }
        } else if (ch === fenceChar && len >= fenceLen && /^\s*$/.test(rest)) {
          inFence = false;
          fenceChar = '';
          fenceLen = 0;
          return chunk;
        }
      }

      if (inFence) {
        return chunk;
      }

      const { links } = scanLinksAndCodeInLine(line, idx + 1);
      if (links.length === 0) {
        return chunk;
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
      return rebuilt + eol;
    })
    .join('');
}

export function escapeVueMustache(content: string): string {
  const chunks = content.match(/[^\r\n]*(?:\r?\n|$)/g) || [];
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;

  return chunks
    .map(chunk => {
      if (!chunk) {
        return '';
      }
      const lineMatch = chunk.match(/^([^\r\n]*)(\r?\n?)$/);
      const line = lineMatch ? lineMatch[1] : chunk;
      const eol = lineMatch ? lineMatch[2] : '';

      const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
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
            return chunk;
          }
        } else if (ch === fenceChar && len >= fenceLen && /^\s*$/.test(rest)) {
          inFence = false;
          fenceChar = '';
          fenceLen = 0;
          return chunk;
        }
      }

      if (inFence) {
        return chunk;
      }

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

      return out + eol;
    })
    .join('');
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

export async function generatePortal() {
  console.log('--- Step 1: Validating documentation cross-links ---');
  const linkCheckResult = await checkDocLinks();
  if (!linkCheckResult.passed) {
    console.error(`❌ Link validation failed with ${linkCheckResult.errors.length} broken links!`);
    linkCheckResult.errors.forEach(err => {
      console.error(`  - ${err.sourceFile}:${err.line} -> ${err.targetPath}`);
    });
    process.exit(1);
  }
  console.log(`✅ Pre-compilation link check passed (${linkCheckResult.count} Markdown files verified).`);

  console.log('\n--- Step 2: Synchronizing architecture & OpenAPI specifications ---');
  // Explicitly invoke generateConfigTable, generateRoutesDiagram, and generateApiRoutesSection
  const configTable = generateConfigTable();
  const routesDiagram = generateRoutesDiagram();
  const apiRoutesSection = generateApiRoutesSection();
  if (!configTable || !routesDiagram || !apiRoutesSection) {
    throw new Error('Failed to generate configuration table, route diagram, or API routes inventory');
  }

  // Update ARCHITECTURE.md, FEATURE_MODULES.md, and OpenAPI specification
  updateArchitectureMd();
  updateFeatureModulesMd();
  await generateOpenApiSpec();

  console.log(`\n--- Step 3: Staging ${ARCHITECTURAL_DOCS.length} architectural specifications into docs-portal ---`);
  const removedStale = cleanStagedPortalDocs(PORTAL_DIR);
  if (removedStale > 0) {
    console.log(`🧹 Cleaned ${removedStale} previously staged Markdown file(s).`);
  }
  let stagedCount = 0;

  for (const doc of ARCHITECTURAL_DOCS) {
    const srcPath = path.join(ROOT_DIR, doc.src);
    const destPath = path.join(PORTAL_DIR, doc.dest);

    if (!fs.existsSync(srcPath)) {
      throw new Error(`Required architectural document missing at: ${srcPath}`);
    }

    fs.mkdirSync(path.dirname(destPath), { recursive: true });

    let content = fs.readFileSync(srcPath, 'utf8');
    content = rewriteMarkdownLinks(content, doc.src);
    content = escapeVueMustache(content);

    fs.writeFileSync(destPath, content, 'utf8');
    stagedCount++;
  }

  console.log(`✅ Successfully staged all ${stagedCount} architectural specifications into VitePress folders.`);

  console.log('\n--- Step 4: Staging OpenAPI schema into portal assets ---');
  const openApiSrc = path.join(ROOT_DIR, 'public', 'openapi.json');
  const openApiDestDir = path.join(PORTAL_DIR, 'public');
  fs.mkdirSync(openApiDestDir, { recursive: true });
  const openApiDest = path.join(openApiDestDir, 'openapi.json');

  if (fs.existsSync(openApiSrc)) {
    fs.copyFileSync(openApiSrc, openApiDest);
    console.log(`✅ Copied openapi.json to ${openApiDest}`);
  } else {
    console.warn(`⚠️ Warning: ${openApiSrc} does not exist yet.`);
  }

  console.log('\n✅ Portal generation and staging complete!');
}

const isMain = typeof process.argv[1] === 'string' &&
               path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  generatePortal().catch(err => {
    console.error('Portal generation error:', err);
    process.exit(1);
  });
}
