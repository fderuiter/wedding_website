import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import {
  checkDocLinks,
  checkLinksInFile,
  checkVitePressConfigLinks,
  extractMarkdownHeadings,
  findInlineCodeEnd,
  findMarkdownFiles,
  githubSlugify,
  LinkError,
  MarkdownHeading,
  ParsedMarkdownLink,
  resolveVitePressHeadingSlug,
  safeDecodeURIComponent,
  scanLinksAndCodeInLine,
  stripHtmlTags,
  stripInlineMarkdown,
  vitepressSlugify,
} from './check-doc-links';

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
});
