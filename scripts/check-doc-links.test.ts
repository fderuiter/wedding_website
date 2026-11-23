import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import {
  checkDocLinks,
  checkLinksInFile,
  checkVitePressConfigLinks,
  ExtractedMermaidBlock,
  extractMarkdownHeadings,
  FenceTransitionResult,
  findInlineCodeEnd,
  findMarkdownFiles,
  FrontmatterScanMode,
  githubSlugify,
  HtmlCommentScanMode,
  IntraFileAnchorMode,
  LinkError,
  LinkTargetValidationOptions,
  MarkdownFenceState,
  MarkdownHeading,
  MarkdownScanOptions,
  ParsedMarkdownLink,
  PortalRouteMode,
  QueryTargetMode,
  resolveVitePressHeadingSlug,
  safeDecodeURIComponent,
  scanLinksAndCodeInLine,
  scanMarkdownDocument,
  ScannedMermaidBlock,
  stepMarkdownFence,
  stripHtmlTags,
  stripInlineMarkdown,
  transformNonFencedMarkdownLines,
  validateLinkTarget,
  vitepressSlugify,
} from './check-doc-links';
import { escapeVueMustache, rewriteMarkdownLinks } from './generate-portal';

describe('check-doc-links', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-doc-links-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('verifies all 35 authored Markdown files in the repository with zero errors', async () => {
    const result = await checkDocLinks(process.cwd());
    expect(result.errors).toEqual([]);
    expect(result.passed).toBe(true);
    expect(result.count).toBe(35);
  });

  it('excludes .git by exact segment without excluding .github/, and includes only authored docs-portal pages', () => {
    const write = (rel: string, body = '# Title\n') => {
      const full = path.join(tempDir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, body, 'utf8');
    };

    write('README.md');
    write('.git/HEAD.md');
    write('.github/CONTRIBUTING.md');
    write('.github/ISSUE_TEMPLATE/bug.md');
    write('docs-portal/index.md');
    write('docs-portal/api/index.md');
    write('docs-portal/.vitepress/cache/cached.md');
    write('docs-portal/development/agents.md');
    write('docs-portal/deployment/deployment.md');
    write('node_modules/pkg/README.md');
    write('test-results/a11y-summary.md');

    const found = findMarkdownFiles(tempDir)
      .map(f => path.relative(tempDir, f).replace(/\\/g, '/'))
      .sort();

    expect(found).toEqual([
      '.github/CONTRIBUTING.md',
      '.github/ISSUE_TEMPLATE/bug.md',
      'README.md',
      'docs-portal/api/index.md',
      'docs-portal/index.md',
    ]);
  });

  it('skips fenced code blocks and inline backticks while parsing nested brackets', () => {
    fs.mkdirSync(path.join(tempDir, 'src/app/api/admin/[entity]'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'src/app/api/admin/[entity]/route.ts'),
      'line1\nline2\nline3\n',
      'utf8'
    );

    const mdPath = path.join(tempDir, 'GUIDE.md');
    fs.writeFileSync(
      mdPath,
      [
        '# Guide',
        '',
        'Valid nested bracket link: [src/app/api/admin/[entity]/route.ts](./src/app/api/admin/[entity]/route.ts#L1-L3)',
        'Inline backtick ignored: `[broken](./does-not-exist.md)`',
        '```markdown',
        '[broken-in-fence](./also-missing.md#bad-anchor)',
        '```',
        '~~~md',
        '[broken-in-tilde-fence](./tilde-missing.md)',
        '~~~',
      ].join('\n'),
      'utf8'
    );

    const { links }: { links: ParsedMarkdownLink[] } = scanLinksAndCodeInLine(
      'See [src/app/api/admin/[entity]/route.ts](./route.ts) and `[skip](bad.md)`',
      1
    );
    expect(links).toHaveLength(1);
    expect(links[0].linkText).toBe('src/app/api/admin/[entity]/route.ts');
    expect(findInlineCodeEnd('`code` rest', 0).closeEnd).toBe(6);
    expect(safeDecodeURIComponent('%5Bentity%5D')).toBe('[entity]');
    expect(stripInlineMarkdown('1. **`AGENTS.md`** & [Guide](./g.md)')).toBe(
      '1. AGENTS.md & Guide'
    );
    expect(stripHtmlTags('Press <kbd>Esc</kbd> to close')).toBe(
      'Press Esc to close'
    );
    expect(stripInlineMarkdown('Heading <script')).toBe('Heading');
    expect(stripInlineMarkdown('Heading <<x>script>')).toBe('Heading');
    expect(stripInlineMarkdown('Heading <scr<script>ipt>alert(1)</script>')).toBe(
      'Heading alert(1)'
    );
    expect(stripInlineMarkdown('Heading <a title=">"><script')).toBe('Heading');
    expect(stripInlineMarkdown('Heading **<**script>')).toBe('Heading');
    expect(
      vitepressSlugify(stripInlineMarkdown('Generic `Array<string>` Helper'))
    ).toBe('generic-array-string-helper');

    const errors: LinkError[] = [];
    checkLinksInFile(mdPath, errors, tempDir);
    expect(errors).toEqual([]);
  });

  it('validates intra-file and cross-file #anchor fragments against heading slugs', async () => {
    const targetPath = path.join(tempDir, 'DEPLOYMENT.md');
    fs.writeFileSync(
      targetPath,
      [
        '# Deployment',
        '',
        '## 🏗️ Architecture & Responsibilities',
        '',
        '### 🔄 Staging Promotion & Approval Workflow',
      ].join('\n'),
      'utf8'
    );

    const headings: MarkdownHeading[] = extractMarkdownHeadings(
      fs.readFileSync(targetPath, 'utf8')
    );
    expect(headings[1].githubSlug).toBe('-architecture--responsibilities');
    expect(headings[1].vitepressSlug).toBe('🏗️-architecture-responsibilities');
    expect(githubSlugify('Setup & Installation')).toBe('setup--installation');
    expect(vitepressSlugify('Setup & Installation')).toBe('setup-installation');
    expect(
      resolveVitePressHeadingSlug(targetPath, '-architecture--responsibilities')
    ).toBe('🏗️-architecture-responsibilities');

    const sourcePath = path.join(tempDir, 'recipe.md');
    fs.writeFileSync(
      sourcePath,
      [
        '# Recipe',
        '',
        '- [Valid Intra](#recipe)',
        '- [Valid Cross GH](./DEPLOYMENT.md#-architecture--responsibilities)',
        '- [Valid Cross VP](./DEPLOYMENT.md#🔄-staging-promotion-approval-workflow)',
        '- [Broken Intra](#missing-section)',
        '- [Broken Cross](./DEPLOYMENT.md#continuous-delivery-pipeline-architecture)',
      ].join('\n'),
      'utf8'
    );

    const res = await checkDocLinks(tempDir);
    expect(res.passed).toBe(false);
    expect(res.errors).toHaveLength(2);
    expect(res.errors[0].targetPath).toBe('#missing-section');
    expect(res.errors[1].targetPath).toBe(
      './DEPLOYMENT.md#continuous-delivery-pipeline-architecture'
    );
  });

  it('validates #L<start>-L<end> fragments and parenthetical (L<start>-L<end>) citations against file line counts', async () => {
    fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'src/sample.ts'),
      ['const a = 1;', 'const b = 2;', 'const c = 3;', 'export { a, b, c };', ''].join('\n'),
      'utf8'
    );

    fs.writeFileSync(
      path.join(tempDir, 'DOC.md'),
      [
        '# Line Citations',
        '',
        '- Valid relative range: [sample](./src/sample.ts#L1-L4)',
        '- Valid repo URL range: [repo](https://github.com/fderuiter/wedding_website/blob/HEAD/src/sample.ts#L2-L4)',
        '- Valid prose citation: Defined in `src/sample.ts` (L1–L4).',
        '- Out of range #L: [badRange](./src/sample.ts#L2-L10)',
        '- Reversed #L: [reversed](./src/sample.ts#L4-L2)',
        '- Out of range prose: Managed in `src/sample.ts` (L3–L9).',
        '- Missing prose file: Managed in `src/missing.ts` (L1–L2).',
      ].join('\n'),
      'utf8'
    );

    const res = await checkDocLinks(tempDir);
    expect(res.passed).toBe(false);
    expect(res.errors.map(e => e.targetPath)).toEqual([
      './src/sample.ts#L2-L10',
      './src/sample.ts#L4-L2',
      'src/sample.ts (L3–L9)',
      'src/missing.ts (L1–L2)',
    ]);
  });

  it('validates frontmatter link fields in docs-portal/index.md and rejects dead routes or anchors', async () => {
    fs.mkdirSync(path.join(tempDir, 'docs-portal/api'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'ARCHITECTURE.md'), '# Architecture\n', 'utf8');
    fs.writeFileSync(
      path.join(tempDir, 'README.md'),
      '# Project\n\n## Setup & Installation\n',
      'utf8'
    );
    fs.writeFileSync(path.join(tempDir, 'docs-portal/api/index.md'), '# API\n', 'utf8');

    fs.writeFileSync(
      path.join(tempDir, 'docs-portal/index.md'),
      [
        '---',
        'layout: home',
        'hero:',
        '  actions:',
        '    - theme: brand',
        '      text: Explore Architecture',
        '      link: /architecture/architecture',
        '    - theme: alt',
        '      text: API Explorer',
        '      link: /api/',
        'features:',
        '  - title: Valid Anchor',
        '    link: /development/readme#setup-installation',
        '  - title: Dead Feature Route',
        '    link: /guides/does-not-exist',
        '  - title: Dead Feature Anchor',
        '    link: /development/readme#nonexistent-heading',
        '---',
      ].join('\n'),
      'utf8'
    );

    const res = await checkDocLinks(tempDir);
    expect(res.passed).toBe(false);
    expect(res.errors).toEqual([
      expect.objectContaining({
        sourceFile: 'docs-portal/index.md',
        line: 15,
        linkText: 'Dead Feature Route',
        targetPath: '/guides/does-not-exist',
      }),
      expect.objectContaining({
        sourceFile: 'docs-portal/index.md',
        line: 17,
        linkText: 'Dead Feature Anchor',
        targetPath: '/development/readme#nonexistent-heading',
      }),
    ]);
  });

  it('validates VitePress nav and sidebar routes in docs-portal/.vitepress/config.mts', async () => {
    fs.mkdirSync(path.join(tempDir, 'docs-portal/.vitepress'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'docs-portal/api'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'ARCHITECTURE.md'), '# Architecture\n', 'utf8');
    fs.writeFileSync(path.join(tempDir, 'CHANGELOG.md'), '# Changelog\n', 'utf8');
    fs.writeFileSync(path.join(tempDir, 'docs-portal/api/index.md'), '# API\n', 'utf8');

    fs.writeFileSync(
      path.join(tempDir, 'docs-portal/.vitepress/config.mts'),
      [
        "import { defineConfig } from 'vitepress';",
        'export default defineConfig({',
        '  themeConfig: {',
        '    nav: [',
        "      { text: 'Architecture', link: '/architecture/architecture' },",
        "      { text: 'Broken Nav', link: '/missing/nav-target' },",
        '    ],',
        '    sidebar: [',
        '      {',
        "        text: 'Guides',",
        '        items: [',
        "          { text: 'Changelog', link: '/guides/changelog' },",
        "          { text: 'API', link: '/api/' },",
        "          { text: 'Dead Sidebar', link: '/guides/dead-sidebar' },",
        '        ],',
        '      },',
        '    ],',
        '  },',
        '});',
      ].join('\n'),
      'utf8'
    );

    const directErrors: LinkError[] = [];
    checkVitePressConfigLinks(tempDir, directErrors);
    expect(directErrors).toHaveLength(2);

    const res = await checkDocLinks(tempDir);
    expect(res.passed).toBe(false);
    expect(res.errors).toEqual([
      expect.objectContaining({
        sourceFile: 'docs-portal/.vitepress/config.mts',
        line: 6,
        linkText: 'Broken Nav',
        targetPath: '/missing/nav-target',
      }),
      expect.objectContaining({
        sourceFile: 'docs-portal/.vitepress/config.mts',
        line: 14,
        linkText: 'Dead Sidebar',
        targetPath: '/guides/dead-sidebar',
      }),
    ]);
  });

  it('validates fenced Mermaid blocks offline and fails via CLI on invalid Mermaid syntax', async () => {
    const mdPath = path.join(tempDir, 'ARCH.md');
    fs.writeFileSync(
      mdPath,
      [
        '# Architecture Diagrams',
        '',
        '```mermaid',
        'flowchart LR',
        '    App["src/app"] --> node_id["id"]',
        '    App --> node__lb_id_rb_["[id]"]',
        '```',
        '',
        '```mermaid',
        'graph TD',
        '    subgraph Server (Node.js / Container Runtime)',
        '        B[Next.js]',
        '    end',
        '```',
      ].join('\n'),
      'utf8'
    );

    const res = await checkDocLinks(tempDir);
    expect(res.passed).toBe(false);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toEqual(
      expect.objectContaining({
        sourceFile: 'ARCH.md',
        line: 11,
        linkText: 'mermaid diagram',
        targetPath: '```mermaid',
      })
    );

    const cliScript = path.resolve(process.cwd(), 'scripts/check-doc-links.ts');
    const tsxBin = path.resolve(process.cwd(), 'node_modules/.bin/tsx');
    const proc = spawnSync(tsxBin, [cliScript], {
      cwd: tempDir,
      encoding: 'utf8',
    });
    expect(proc.status).toBe(1);
    expect(proc.stderr).toContain('ARCH.md:11');
  });

  it('exits with status 1 via CLI when broken links, anchors, or line ranges exist', () => {
    const cliScript = path.resolve(process.cwd(), 'scripts/check-doc-links.ts');
    const tsxBin = path.resolve(process.cwd(), 'node_modules/.bin/tsx');

    fs.writeFileSync(
      path.join(tempDir, 'BROKEN.md'),
      '# Title\n\n[Missing](./nope.md)\n[BadAnchor](#nope)\n',
      'utf8'
    );

    const proc = spawnSync(tsxBin, [cliScript], {
      cwd: tempDir,
      encoding: 'utf8',
    });

    expect(proc.status).toBe(1);
    expect(proc.stderr).toContain('Dead documentation link(s) detected');
  });

  it('verifies #L and (L...) slice contents against cited symbols, constants, and login/route blocks', async () => {
    fs.mkdirSync(path.join(tempDir, 'src/hooks'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'src/middleware.ts'),
      [
        'export async function middleware(req: Request) {',
        '  if (req.url.includes("/admin")) {',
        "    return Response.redirect('https://example.com/admin/login');",
        '  }',
        '  if (!req.headers.get("cookie")) {',
        "    return Response.redirect('https://example.com/guest/login');",
        '  }',
        '  return null;',
        '}',
      ].join('\n'),
      'utf8'
    );
    fs.writeFileSync(
      path.join(tempDir, 'src/hooks/useRegistry.ts'),
      [
        'export const REGISTRY_INITIAL_VISIBLE_ITEMS = 12;',
        'export async function loadCatalog() {',
        "  return fetch('/api/registry/items?page=1&limit=500');",
        '}',
        'export async function resolveTargetItem(id: string) {',
        '  return fetch(`/api/registry/items/${id}`);',
        '}',
      ].join('\n'),
      'utf8'
    );

    fs.writeFileSync(
      path.join(tempDir, 'SLICE_CHECKS.md'),
      [
        '# Slice Content Checks',
        '',
        '- Valid guest gate: [src/middleware.ts](./src/middleware.ts#L5-L7) enforces guest login redirects.',
        '- Valid deep link: `resolveTargetItem` in [src/hooks/useRegistry.ts](./src/hooks/useRegistry.ts#L5-L7) fetches `GET /api/registry/items/[id]`.',
        '- Valid paired slices with prose echoes: Reads `loadCatalog()` via `resolveTargetItem` ([`src/hooks/useRegistry.ts`](./src/hooks/useRegistry.ts#L2-L4) (L2-L4) and [`src/hooks/useRegistry.ts`](./src/hooks/useRegistry.ts#L5-L7) (L5-L7)).',
        '- Swapped login block: [src/middleware.ts](./src/middleware.ts#L2-L4) enforces guest passcode login redirects.',
        '- Missing constant in slice: Renders `REGISTRY_LOAD_MORE_INCREMENT = 8` items ([src/hooks/useRegistry.ts](./src/hooks/useRegistry.ts#L1-L4)).',
        '- Drifted route slice: Deep link fetches `GET /api/registry/items/[id]` ([src/hooks/useRegistry.ts](./src/hooks/useRegistry.ts#L2-L4)).',
        '- Drifted link-label symbol: [`resolveTargetItem`](./src/hooks/useRegistry.ts#L1-L3).',
        '- Drifted prose slice: `resolveTargetItem` in `src/hooks/useRegistry.ts` (L1-L3).',
      ].join('\n'),
      'utf8'
    );

    const res = await checkDocLinks(tempDir);
    expect(res.passed).toBe(false);
    expect(res.errors).toEqual([
      expect.objectContaining({
        sourceFile: 'SLICE_CHECKS.md',
        line: 6,
        targetPath: './src/middleware.ts#L2-L4',
        resolvedPath: expect.stringContaining('"/admin/login" redirect block'),
      }),
      expect.objectContaining({
        sourceFile: 'SLICE_CHECKS.md',
        line: 7,
        targetPath: './src/hooks/useRegistry.ts#L1-L4',
        resolvedPath: expect.stringContaining('REGISTRY_LOAD_MORE_INCREMENT'),
      }),
      expect.objectContaining({
        sourceFile: 'SLICE_CHECKS.md',
        line: 8,
        targetPath: './src/hooks/useRegistry.ts#L2-L4',
        resolvedPath: expect.stringContaining('/api/registry/items/'),
      }),
      expect.objectContaining({
        sourceFile: 'SLICE_CHECKS.md',
        line: 9,
        targetPath: './src/hooks/useRegistry.ts#L1-L3',
        resolvedPath: expect.stringContaining('resolveTargetItem'),
      }),
      expect.objectContaining({
        sourceFile: 'SLICE_CHECKS.md',
        line: 10,
        targetPath: 'src/hooks/useRegistry.ts (L1-L3)',
        resolvedPath: expect.stringContaining('resolveTargetItem'),
      }),
    ]);
  });

  it('validates fenced code block language tags against Shiki bundledLanguages and VitePress languageAlias', async () => {
    fs.mkdirSync(path.join(tempDir, 'docs-portal/.vitepress'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'docs-portal/.vitepress/config.mts'),
      [
        "import { defineConfig } from 'vitepress';",
        'export default defineConfig({',
        '  markdown: {',
        '    languageAlias: {',
        "      cron: 'shellscript',",
        "      badalias: 'not-a-shiki-grammar',",
        '    },',
        '  },',
        '});',
      ].join('\n'),
      'utf8'
    );

    fs.writeFileSync(
      path.join(tempDir, 'FENCES.md'),
      [
        '# Fence Languages',
        '',
        '```ts',
        'const x: number = 1;',
        '```',
        '',
        '```cron',
        '* * * * * curl -fsS http://127.0.0.1:3000/api/cron/broadcasts',
        '```',
        '',
        '```',
        'plain text block',
        '```',
        '',
        '```unknownfencelang',
        'unsupported grammar',
        '```',
      ].join('\n'),
      'utf8'
    );

    const res = await checkDocLinks(tempDir);
    expect(res.passed).toBe(false);
    expect(res.errors).toEqual([
      expect.objectContaining({
        sourceFile: 'FENCES.md',
        line: 15,
        linkText: 'code fence "unknownfencelang"',
        targetPath: '```unknownfencelang',
        resolvedPath: 'Unsupported Shiki fence language "unknownfencelang"',
      }),
      expect.objectContaining({
        sourceFile: 'docs-portal/.vitepress/config.mts',
        line: 6,
        linkText: 'languageAlias.badalias',
        targetPath: 'not-a-shiki-grammar',
        resolvedPath: 'Unsupported Shiki target grammar "not-a-shiki-grammar"',
      }),
    ]);
  });

  it('enforces explicit queryTargetMode, portalRouteMode, and intraFileAnchorMode flags in validateLinkTarget', async () => {
    fs.mkdirSync(path.join(tempDir, 'docs-portal/.vitepress'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'ARCHITECTURE.md'),
      '# System Architecture\n\n## Runtime Layers\n',
      'utf8'
    );
    const configAbs = path.join(tempDir, 'docs-portal/.vitepress/config.mts');
    fs.writeFileSync(
      configAbs,
      [
        "import { defineConfig } from 'vitepress';",
        'export default defineConfig({',
        '  themeConfig: {',
        "    nav: [{ text: 'Query Nav', link: '?tab=1' }, { text: 'Hash Nav', link: '#L1' }],",
        '  },',
        '});',
      ].join('\n'),
      'utf8'
    );

    const portalDocAbs = path.join(tempDir, 'docs-portal/index.md');
    fs.writeFileSync(
      portalDocAbs,
      [
        '---',
        'hero:',
        '  actions:',
        '    - text: Frontmatter Query',
        '      link: "?tab=1"',
        '---',
        '# Portal Home',
        '',
        '- [Skipped Body Query](?tab=1)',
        '- [Skipped Body Query With Hash](?tab=1#runtime-layers)',
        '- [Root Portal Fallback](/architecture/architecture#runtime-layers)',
        '- [Relative Portal Miss](architecture/architecture)',
      ].join('\n'),
      'utf8'
    );

    const skipQueryMode: QueryTargetMode = 'skip';
    const errorQueryMode: QueryTargetMode = 'error';
    const fallbackPortalMode: PortalRouteMode = 'root-fallback';
    const alwaysPortalMode: PortalRouteMode = 'always';
    const nonePortalMode: PortalRouteMode = 'none';
    const directAnchorMode: IntraFileAnchorMode = 'direct';
    const mdOnlyAnchorMode: IntraFileAnchorMode = 'markdown-only';

    const makeOpts = (
      queryTargetMode: QueryTargetMode,
      portalRouteMode: PortalRouteMode,
      intraFileAnchorMode: IntraFileAnchorMode
    ): LinkTargetValidationOptions => ({
      queryTargetMode,
      portalRouteMode,
      intraFileAnchorMode,
    });

    const querySkipErrors: LinkError[] = [];
    validateLinkTarget(
      '?tab=1',
      portalDocAbs,
      'docs-portal/index.md',
      9,
      'Query',
      makeOpts(skipQueryMode, fallbackPortalMode, directAnchorMode),
      querySkipErrors,
      tempDir
    );
    expect(querySkipErrors).toEqual([]);

    const queryErrErrors: LinkError[] = [];
    validateLinkTarget(
      '?tab=1',
      portalDocAbs,
      'docs-portal/index.md',
      5,
      'Query',
      makeOpts(errorQueryMode, alwaysPortalMode, mdOnlyAnchorMode),
      queryErrErrors,
      tempDir
    );
    expect(queryErrErrors).toEqual([
      {
        sourceFile: 'docs-portal/index.md',
        line: 5,
        linkText: 'Query',
        targetPath: '?tab=1',
        resolvedPath: 'docs-portal/index.md',
      },
    ]);

    // Portal route modes: 'always' resolves relative routes, 'root-fallback' only falls back on '/', 'none' checks filesystem only
    const alwaysErrors: LinkError[] = [];
    validateLinkTarget(
      'architecture/architecture#runtime-layers',
      portalDocAbs,
      'docs-portal/index.md',
      12,
      'Rel Portal',
      makeOpts(errorQueryMode, alwaysPortalMode, mdOnlyAnchorMode),
      alwaysErrors,
      tempDir
    );
    expect(alwaysErrors).toEqual([]);

    const noneErrors: LinkError[] = [];
    validateLinkTarget(
      '/architecture/architecture',
      portalDocAbs,
      'docs-portal/index.md',
      11,
      'Root Non-Portal',
      makeOpts(skipQueryMode, nonePortalMode, directAnchorMode),
      noneErrors,
      tempDir
    );
    expect(noneErrors).toHaveLength(1);
    expect(noneErrors[0].resolvedPath).toBe('architecture/architecture');

    // Intra-file anchor modes on non-Markdown source (.mts)
    const directMtsErrors: LinkError[] = [];
    validateLinkTarget(
      '#L1-L3',
      configAbs,
      'docs-portal/.vitepress/config.mts',
      4,
      'Line Anchor',
      makeOpts(errorQueryMode, alwaysPortalMode, directAnchorMode),
      directMtsErrors,
      tempDir
    );
    expect(directMtsErrors).toEqual([]);

    const mdOnlyMtsErrors: LinkError[] = [];
    validateLinkTarget(
      '#L1-L3',
      configAbs,
      'docs-portal/.vitepress/config.mts',
      4,
      'Line Anchor',
      makeOpts(errorQueryMode, alwaysPortalMode, mdOnlyAnchorMode),
      mdOnlyMtsErrors,
      tempDir
    );
    expect(mdOnlyMtsErrors).toHaveLength(1);

    // End-to-end checkDocLinks across portal body, frontmatter, and config.mts
    const res = await checkDocLinks(tempDir);
    expect(res.passed).toBe(false);
    expect(res.errors).toEqual([
      expect.objectContaining({
        sourceFile: 'docs-portal/index.md',
        line: 5,
        linkText: 'Frontmatter Query',
        targetPath: '?tab=1',
      }),
      expect.objectContaining({
        sourceFile: 'docs-portal/index.md',
        line: 12,
        linkText: 'Relative Portal Miss',
        targetPath: 'architecture/architecture',
        resolvedPath: 'docs-portal/architecture/architecture',
      }),
      expect.objectContaining({
        sourceFile: 'docs-portal/.vitepress/config.mts',
        line: 4,
        linkText: 'Query Nav',
        targetPath: '?tab=1',
      }),
      expect.objectContaining({
        sourceFile: 'docs-portal/.vitepress/config.mts',
        line: 4,
        linkText: 'Hash Nav',
        targetPath: '#L1',
      }),
    ]);
  });

  it('handles stripped vs padded HTML comments, CRLF transforms, and unclosed Mermaid blocks in shared scanners', async () => {
    const fenceState: MarkdownFenceState = { inFence: false, fenceChar: '', fenceLen: 0 };
    const inlineTickResult: FenceTransitionResult = stepMarkdownFence('```not-a-fence`tick```', fenceState);
    expect(inlineTickResult).toEqual({ kind: 'outside' });
    expect(stepMarkdownFence('```ts', fenceState)).toEqual({ kind: 'open', infoString: 'ts' });
    expect(stepMarkdownFence('~~~', fenceState)).toEqual({ kind: 'inside' });
    expect(stepMarkdownFence('````  ', fenceState)).toEqual({ kind: 'close' });

    const stripMode: HtmlCommentScanMode = 'strip';
    const padMode: HtmlCommentScanMode = 'pad';
    const collectFm: FrontmatterScanMode = 'collect';

    const commentDoc = [
      '---',
      'title: Scanner Test',
      '---',
      '<!-- ## Hidden Heading -->',
      '<!-- prefix --> ## Visible Heading',
      '<!-- multi',
      '## Still Commented',
      'end --> `src/sample.ts` (L1-L9)',
      '```mermaid',
      'graph TD',
      '    subgraph Bad (Unclosed Fence With Unquoted Parens)',
      '        A[Node]',
    ].join('\n');

    const headings = extractMarkdownHeadings(commentDoc);
    expect(headings.map(h => h.rawText)).toEqual(['Visible Heading']);

    const strippedLines: string[] = [];
    const strippedOptions: MarkdownScanOptions = {
      frontmatterMode: 'skip',
      htmlCommentMode: stripMode,
    };
    scanMarkdownDocument(commentDoc, line => strippedLines.push(line), strippedOptions);
    expect(strippedLines).toContain(' ## Visible Heading');
    expect(strippedLines).toContain(' `src/sample.ts` (L1-L9)');

    const paddedLines: string[] = [];
    const capturedFm: string[] = [];
    const capturedMermaid: ScannedMermaidBlock[] = [];
    scanMarkdownDocument(
      commentDoc,
      line => paddedLines.push(line),
      {
        frontmatterMode: collectFm,
        htmlCommentMode: padMode,
        onFrontmatter: lines => capturedFm.push(...lines),
        onMermaidBlock: block => capturedMermaid.push(block),
      }
    );
    expect(capturedFm).toEqual(['title: Scanner Test']);
    // Line 6 ('<!-- multi') emits '' at index 2; line 8 ('end --> ...') replaces 7-char 'end -->' with 7 spaces at index 3
    expect(paddedLines[2]).toBe('');
    expect(paddedLines[3]).toBe('        `src/sample.ts` (L1-L9)');
    expect(capturedMermaid).toEqual([
      {
        fenceStartLine: 9,
        code: [
          'graph TD',
          '    subgraph Bad (Unclosed Fence With Unquoted Parens)',
          '        A[Node]',
        ].join('\n'),
      },
    ]);

    // Verify checkLinksInFile + checkDocLinks preserve column alignment after padded HTML comments and catch unclosed Mermaid blocks
    fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'src/sample.ts'), 'line1\nline2\nline3\n', 'utf8');
    const mdAbs = path.join(tempDir, 'UNCLOSED.md');
    fs.writeFileSync(mdAbs, commentDoc, 'utf8');

    const fileErrors: LinkError[] = [];
    const extractedBlocks: ExtractedMermaidBlock[] = [];
    checkLinksInFile(mdAbs, fileErrors, tempDir, new Map(), new Map(), extractedBlocks);
    expect(fileErrors).toEqual([
      expect.objectContaining({
        sourceFile: 'UNCLOSED.md',
        line: 8,
        targetPath: 'src/sample.ts (L1-L9)',
      }),
    ]);
    expect(extractedBlocks).toHaveLength(1);
    expect(extractedBlocks[0].fenceStartLine).toBe(9);

    const fullRes = await checkDocLinks(tempDir);
    expect(fullRes.passed).toBe(false);
    expect(fullRes.errors).toEqual([
      expect.objectContaining({
        sourceFile: 'UNCLOSED.md',
        line: 8,
        targetPath: 'src/sample.ts (L1-L9)',
      }),
      expect.objectContaining({
        sourceFile: 'UNCLOSED.md',
        line: 11,
        linkText: 'mermaid diagram',
        targetPath: '```mermaid',
      }),
    ]);

    // Verify transformNonFencedMarkdownLines preserves mixed CRLF/LF endings and leaves HTML comments untouched
    const crlfInput =
      '<!-- [keep](src/sample.ts) {{ a }} -->\r\n```ts\r\n{{ insideFence }}\r\n```\nTail {{ b }}';
    const transformed = transformNonFencedMarkdownLines(
      crlfInput,
      (line, n) => `${n}:${line}`
    );
    expect(transformed).toBe(
      '1:<!-- [keep](src/sample.ts) {{ a }} -->\r\n```ts\r\n{{ insideFence }}\r\n```\n5:Tail {{ b }}'
    );

    const portalRewritten = escapeVueMustache(rewriteMarkdownLinks(crlfInput, 'UNCLOSED.md', tempDir));
    expect(portalRewritten).toBe(
      '<!-- [keep](https://github.com/fderuiter/wedding_website/blob/main/src/sample.ts) &#123;&#123; a &#125;&#125; -->\r\n```ts\r\n{{ insideFence }}\r\n```\nTail &#123;&#123; b &#125;&#125;'
    );
  });

  it('allows /demo/ and /storybook/ in VitePress config and portal frontmatter while rejecting broken routes and fragments', () => {
    const portalDir = path.join(tempDir, 'docs-portal', '.vitepress');
    fs.mkdirSync(portalDir, { recursive: true });
    fs.writeFileSync(
      path.join(portalDir, 'config.mts'),
      [
        "import { defineConfig } from 'vitepress';",
        'export default defineConfig({',
        '  themeConfig: {',
        '    nav: [',
        "      { text: 'Live Demo', link: '/demo/', target: '_self' },",
        "      { text: 'Storybook', link: '/storybook/', target: '_self' },",
        "      { text: 'Broken Route', link: '/nonexistent-doc-route/' },",
        "      { text: 'Demo Anchor', link: '/demo/#invalid-anchor' }",
        '    ]',
        '  }',
        '});',
      ].join('\n'),
      'utf8'
    );

    const configErrors: LinkError[] = [];
    checkVitePressConfigLinks(tempDir, configErrors);
    expect(configErrors).toEqual([
      expect.objectContaining({
        sourceFile: 'docs-portal/.vitepress/config.mts',
        linkText: 'Broken Route',
        targetPath: '/nonexistent-doc-route/',
      }),
      expect.objectContaining({
        sourceFile: 'docs-portal/.vitepress/config.mts',
        linkText: 'Demo Anchor',
        targetPath: '/demo/#invalid-anchor',
      }),
    ]);

    const indexAbs = path.join(tempDir, 'docs-portal', 'index.md');
    fs.writeFileSync(
      indexAbs,
      [
        '---',
        'layout: home',
        'hero:',
        '  actions:',
        '    - text: Live Demo',
        '      link: /demo/',
        '      target: _self',
        '    - text: Storybook',
        '      link: /storybook/',
        '      target: _self',
        '    - text: Missing Guide',
        '      link: /guides/missing-page',
        '---',
      ].join('\n'),
      'utf8'
    );

    const fmErrors: LinkError[] = [];
    checkLinksInFile(indexAbs, fmErrors, tempDir);
    expect(fmErrors).toEqual([
      expect.objectContaining({
        sourceFile: 'docs-portal/index.md',
        linkText: 'Missing Guide',
        targetPath: '/guides/missing-page',
      }),
    ]);
  });
});
