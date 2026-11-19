import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkDocLinks } from './check-doc-links';
import {
  generateApiRoutesSection,
  generateConfigTable,
  generateRoutesDiagram,
  updateArchitectureMd,
  generateOpenApiSpec,
} from './generate-docs';

const scriptDir = typeof __dirname !== 'undefined'
  ? __dirname
  : path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(scriptDir, '..');
const PORTAL_DIR = path.join(ROOT_DIR, 'docs-portal');

export interface DocMapping {
  src: string;
  dest: string;
  category: 'Architecture' | 'Deployment' | 'Features' | 'Security' | 'Guides' | 'Development';
  title: string;
}

export const ARCHITECTURAL_DOCS: DocMapping[] = [
  // Development
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
];

const DOC_LOOKUP = new Map<string, DocMapping>();
for (const doc of ARCHITECTURAL_DOCS) {
  DOC_LOOKUP.set(doc.src.replace(/\\/g, '/'), doc);
}

function rewriteMarkdownLinks(content: string, srcRelPath: string): string {
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const srcDir = path.dirname(path.join(ROOT_DIR, srcRelPath));

  return content.replace(linkRegex, (fullMatch, text, rawTarget) => {
    const trimmedTarget = rawTarget.trim();

    // Skip external links, mailto, tel, anchor-only links
    if (
      trimmedTarget.startsWith('http://') ||
      trimmedTarget.startsWith('https://') ||
      trimmedTarget.startsWith('mailto:') ||
      trimmedTarget.startsWith('tel:') ||
      trimmedTarget.startsWith('#')
    ) {
      return fullMatch;
    }

    const [cleanTarget, hash] = trimmedTarget.split('#');
    const [pathPart] = (cleanTarget || '').split('?');

    if (!pathPart) {
      return fullMatch;
    }

    const resolvedFile = path.resolve(srcDir, pathPart);
    const resolvedRel = path.relative(ROOT_DIR, resolvedFile).replace(/\\/g, '/');

    // If it points to one of our mapped architectural/portal documents
    if (DOC_LOOKUP.has(resolvedRel)) {
      const targetDoc = DOC_LOOKUP.get(resolvedRel)!;
      const vitepressRoute = '/' + targetDoc.dest.replace(/\.md$/, '');
      const newTarget = `${vitepressRoute}${hash ? '#' + hash : ''}`;
      return `[${text}](${newTarget})`;
    }

    // If it points to a repository code or workflow file, link to GitHub repo
    if (fs.existsSync(resolvedFile)) {
      const githubUrl = `https://github.com/fderuiter/wedding_website/blob/main/${resolvedRel}${hash ? '#' + hash : ''}`;
      return `[${text}](${githubUrl})`;
    }

    return fullMatch;
  });
}

function escapeVueMustache(content: string): string {
  const parts = content.split(/(```[\s\S]*?```)/g);
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = parts[i]
      .replace(/\{\{/g, '&#123;&#123;')
      .replace(/\}\}/g, '&#125;&#125;');
  }
  return parts.join('');
}

export async function generatePortal() {
  console.log('--- Step 1: Validating documentation cross-links ---');
  const linkCheckResult = checkDocLinks();
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

  // Update ARCHITECTURE.md and OpenAPI specification
  updateArchitectureMd();
  await generateOpenApiSpec();

  console.log(`\n--- Step 3: Staging ${ARCHITECTURAL_DOCS.length} architectural specifications into docs-portal ---`);
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
