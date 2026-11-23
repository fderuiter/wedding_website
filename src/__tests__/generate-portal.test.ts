import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import {
  ARCHITECTURAL_DOCS,
  cleanStagedPortalDocs,
  DocMapping,
  escapeVueMustache,
  generatePortal,
  type GeneratePortalOptions,
  prependGeneratedPortalComment,
  prependPortalFrontmatterTitle,
  rewriteMarkdownLinks,
  stagePortalDoc,
  watchPortalDocs,
} from '../../scripts/generate-portal';

describe('Portal Documentation Generator & Development Section', () => {
  const rootDir = process.cwd();

  beforeAll(() => {
    execSync('npx tsx scripts/generate-portal.ts --stage-only', { cwd: rootDir, stdio: 'ignore' });
  });

  it('exposes generatePortal function and supports stageOnly without regenerating pre-built docs', async () => {
    expect(typeof generatePortal).toBe('function');

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-stage-only-root-'));
    const tmpPortal = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-stage-only-dest-'));
    try {
      fs.writeFileSync(path.join(tmpRoot, 'ARCHITECTURE.md'), '# Prebuilt Architecture\n', 'utf8');
      fs.writeFileSync(path.join(tmpRoot, 'FEATURE_MODULES.md'), '# Prebuilt Modules\n', 'utf8');
      fs.mkdirSync(path.join(tmpRoot, 'public'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpRoot, 'public/openapi.json'),
        '{"openapi":"3.1.0"}\n',
        'utf8'
      );

      const opts: GeneratePortalOptions = {
        stageOnly: true,
        rootDir: tmpRoot,
        portalDir: tmpPortal,
        docs: [
          {
            src: 'ARCHITECTURE.md',
            dest: 'architecture/architecture.md',
            category: 'Architecture',
            title: 'System Architecture',
          },
        ],
      };

      await generatePortal(opts);

      expect(fs.readFileSync(path.join(tmpRoot, 'ARCHITECTURE.md'), 'utf8')).toBe(
        '# Prebuilt Architecture\n'
      );
      expect(
        fs.readFileSync(path.join(tmpPortal, 'architecture/architecture.md'), 'utf8')
      ).toContain('# Prebuilt Architecture');
      expect(fs.readFileSync(path.join(tmpPortal, 'public/openapi.json'), 'utf8')).toBe(
        '{"openapi":"3.1.0"}\n'
      );
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      fs.rmSync(tmpPortal, { recursive: true, force: true });
    }
  });

  it('includes Development and Guides category documents including README.md, AGENTS.md, and CHANGELOG.md in ARCHITECTURAL_DOCS', () => {
    const devDocs = ARCHITECTURAL_DOCS.filter(doc => doc.category === 'Development');
    expect(devDocs).toHaveLength(5);

    const readmeDoc = devDocs.find(d => d.src === 'README.md');
    expect(readmeDoc).toBeDefined();
    expect(readmeDoc?.dest).toBe('development/readme.md');
    expect(readmeDoc?.title).toBe('Project Overview');

    const setupDoc = devDocs.find(d => d.src === 'docs/developer-setup.md');
    expect(setupDoc).toBeDefined();
    expect(setupDoc?.dest).toBe('development/developer-setup.md');
    expect(setupDoc?.title).toBe('Local Environment Setup');

    const testingDoc = devDocs.find(d => d.src === '.github/TESTING.md');
    expect(testingDoc).toBeDefined();
    expect(testingDoc?.dest).toBe('development/testing.md');
    expect(testingDoc?.title).toBe('Testing Strategy');

    const contributingDoc = devDocs.find(d => d.src === '.github/CONTRIBUTING.md');
    expect(contributingDoc).toBeDefined();
    expect(contributingDoc?.dest).toBe('development/contributing.md');
    expect(contributingDoc?.title).toBe('Contribution Guidelines');

    const agentsDoc = devDocs.find(d => d.src === 'AGENTS.md');
    expect(agentsDoc).toBeDefined();
    expect(agentsDoc?.dest).toBe('development/agents.md');
    expect(agentsDoc?.title).toBe('Agent & Contributor Guidelines');

    const guideDocs = ARCHITECTURAL_DOCS.filter(doc => doc.category === 'Guides');
    expect(guideDocs).toHaveLength(3);

    const changelogDoc = guideDocs.find(d => d.src === 'CHANGELOG.md');
    expect(changelogDoc).toBeDefined();
    expect(changelogDoc?.dest).toBe('guides/changelog.md');
    expect(changelogDoc?.title).toBe('Changelog');
  });

  it('ensures all source files in ARCHITECTURAL_DOCS exist in repository', () => {
    for (const doc of ARCHITECTURAL_DOCS) {
      const srcPath = path.join(rootDir, doc.src);
      expect(fs.existsSync(srcPath)).toBe(true);
    }
  });

  it('validates DocMapping category typing accepts Development', () => {
    const sampleMapping: DocMapping = {
      src: 'docs/developer-setup.md',
      dest: 'development/developer-setup.md',
      category: 'Development',
      title: 'Local Environment Setup',
    };
    expect(sampleMapping.category).toBe('Development');
  });

  it('verifies VitePress navigation bar and config hardenings', () => {
    const configPath = path.join(rootDir, 'docs-portal/.vitepress/config.mts');
    const configContent = fs.readFileSync(configPath, 'utf8');

    expect(configContent).toContain('base: normalizeBasePath(process.env.VITEPRESS_BASE)');
    expect(configContent).toContain("{ text: 'Development', link: '/development/developer-setup' }");
    expect(configContent).toContain('ignoreDeadLinks: false');
    expect(configContent).toContain("env: 'dotenv'");
    expect(configContent).toContain("caddy: 'nginx'");
    expect(configContent).toContain("attrSet('v-pre', '')");
  });

  it('verifies VitePress sidebar contains Development and Guides groups with README.md and CHANGELOG.md', () => {
    const configPath = path.join(rootDir, 'docs-portal/.vitepress/config.mts');
    const configContent = fs.readFileSync(configPath, 'utf8');

    expect(configContent).toContain("text: 'Development'");
    expect(configContent).toContain("{ text: 'Project Overview', link: '/development/readme' }");
    expect(configContent).toContain("{ text: 'Local Environment Setup', link: '/development/developer-setup' }");
    expect(configContent).toContain("{ text: 'Testing Strategy', link: '/development/testing' }");
    expect(configContent).toContain("{ text: 'Contribution Guidelines', link: '/development/contributing' }");
    expect(configContent).toContain("{ text: 'Agent & Contributor Guidelines', link: '/development/agents' }");
    expect(configContent).toContain("{ text: 'Changelog', link: '/guides/changelog' }");
  });

  it('verifies docs-portal/index.md contains Developer Onboarding feature card', () => {
    const indexPath = path.join(rootDir, 'docs-portal/index.md');
    const indexContent = fs.readFileSync(indexPath, 'utf8');

    expect(indexContent).toContain('title: Developer Onboarding');
    expect(indexContent).toContain('link: /development/developer-setup');
  });

  it('verifies staged documents exist and route AGENTS.md, README.md, and CHANGELOG.md internally', () => {
    const stagedReadme = path.join(rootDir, 'docs-portal/development/readme.md');
    const stagedSetup = path.join(rootDir, 'docs-portal/development/developer-setup.md');
    const stagedTesting = path.join(rootDir, 'docs-portal/development/testing.md');
    const stagedContributing = path.join(rootDir, 'docs-portal/development/contributing.md');
    const stagedAgents = path.join(rootDir, 'docs-portal/development/agents.md');
    const stagedUpgrading = path.join(rootDir, 'docs-portal/guides/upgrading.md');
    const stagedChangelog = path.join(rootDir, 'docs-portal/guides/changelog.md');

    expect(fs.existsSync(stagedReadme)).toBe(true);
    expect(fs.existsSync(stagedSetup)).toBe(true);
    expect(fs.existsSync(stagedTesting)).toBe(true);
    expect(fs.existsSync(stagedContributing)).toBe(true);
    expect(fs.existsSync(stagedAgents)).toBe(true);
    expect(fs.existsSync(stagedUpgrading)).toBe(true);
    expect(fs.existsSync(stagedChangelog)).toBe(true);

    const readmeContent = fs.readFileSync(stagedReadme, 'utf8');
    expect(readmeContent).toMatch(
      /^---\ntitle: Project Overview\n---\n<!-- AUTO-GENERATED FILE: Staged from README\.md by scripts\/generate-portal\.ts\./
    );
    expect(readmeContent).not.toContain('NOTE CURRENTLY UNDER MAINTAINANCE');
    expect(readmeContent).toContain('# Wedding Website & Custom Registry');

    const contributingContent = fs.readFileSync(stagedContributing, 'utf8');
    expect(contributingContent).toMatch(
      /^---\ntitle: Contribution Guidelines\n---\n<!-- AUTO-GENERATED FILE: Staged from \.github\/CONTRIBUTING\.md by scripts\/generate-portal\.ts\./
    );
    expect(contributingContent).toContain('[AGENTS.md](/development/agents)');
    expect(contributingContent).toContain('[README.md](/development/readme#setup-installation)');
    expect(fs.readFileSync(stagedTesting, 'utf8')).toContain('[AGENTS.md](/development/agents)');

    const upgradingContent = fs.readFileSync(stagedUpgrading, 'utf8');
    expect(upgradingContent).toContain('[`CHANGELOG.md`](/guides/changelog)');
  });

  it('prepends generated-file comment header and re-stages edited Markdown files via watchPortalDocs', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-watch-root-'));
    const tmpPortal = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-watch-dest-'));
    const testDoc: DocMapping = {
      src: 'docs/guide.md',
      dest: 'guides/guide.md',
      category: 'Guides',
      title: 'Live Guide',
    };

    let watcherHandle: { close: () => void } | undefined;
    try {
      const srcAbs = path.join(tmpRoot, testDoc.src);
      const destAbs = path.join(tmpPortal, testDoc.dest);
      fs.mkdirSync(path.dirname(srcAbs), { recursive: true });
      fs.writeFileSync(srcAbs, '# Initial Title\n\nInitial body.\n', 'utf8');

      expect(stagePortalDoc(testDoc, tmpRoot, tmpPortal)).toBe(true);
      const initialStaged = fs.readFileSync(destAbs, 'utf8');
      expect(initialStaged).toBe(
        prependGeneratedPortalComment(
          prependPortalFrontmatterTitle('# Initial Title\n\nInitial body.\n', testDoc.title),
          testDoc.src
        )
      );

      const restagedPromise = new Promise<DocMapping>((resolve) => {
        watcherHandle = watchPortalDocs({
          rootDir: tmpRoot,
          portalDir: tmpPortal,
          docs: [testDoc],
          debounceMs: 25,
          onStage: (doc) => resolve(doc),
        });
      });

      await new Promise((resolve) => setTimeout(resolve, 40));
      fs.writeFileSync(srcAbs, '# Updated Live Title\n\nUpdated prose {{ expr }}.\n', 'utf8');

      const restagedDoc = await restagedPromise;
      expect(restagedDoc.src).toBe(testDoc.src);

      const updatedStaged = fs.readFileSync(destAbs, 'utf8');
      expect(updatedStaged).toContain(
        '<!-- AUTO-GENERATED FILE: Staged from docs/guide.md by scripts/generate-portal.ts. Edit the source file instead. -->'
      );
      expect(updatedStaged).toContain('# Updated Live Title');
      expect(updatedStaged).toContain('&#123;&#123; expr &#125;&#125;');
    } finally {
      watcherHandle?.close();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      fs.rmSync(tmpPortal, { recursive: true, force: true });
    }
  });

  it('cleans orphaned staged Markdown files while preserving authored portal files', () => {
    const tmpPortal = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-clean-'));
    try {
      fs.mkdirSync(path.join(tmpPortal, '.vitepress'), { recursive: true });
      fs.mkdirSync(path.join(tmpPortal, 'api'), { recursive: true });
      fs.mkdirSync(path.join(tmpPortal, 'public'), { recursive: true });
      fs.mkdirSync(path.join(tmpPortal, 'development'), { recursive: true });
      fs.mkdirSync(path.join(tmpPortal, 'legacy-section/nested'), { recursive: true });

      fs.writeFileSync(path.join(tmpPortal, 'index.md'), '# Home\n', 'utf8');
      fs.writeFileSync(path.join(tmpPortal, 'api/index.md'), '# API\n', 'utf8');
      fs.writeFileSync(path.join(tmpPortal, 'postcss.config.mjs'), 'export default {};\n', 'utf8');
      fs.writeFileSync(path.join(tmpPortal, '.vitepress/cached.md'), '# Cached\n', 'utf8');
      fs.writeFileSync(path.join(tmpPortal, 'development/orphan.md'), '# Orphan\n', 'utf8');
      fs.writeFileSync(path.join(tmpPortal, 'legacy-section/nested/stale.md'), '# Stale\n', 'utf8');
      fs.writeFileSync(path.join(tmpPortal, 'stray.md'), '# Stray\n', 'utf8');

      const removed = cleanStagedPortalDocs(tmpPortal);
      expect(removed).toBe(3);

      expect(fs.existsSync(path.join(tmpPortal, 'index.md'))).toBe(true);
      expect(fs.existsSync(path.join(tmpPortal, 'api/index.md'))).toBe(true);
      expect(fs.existsSync(path.join(tmpPortal, 'postcss.config.mjs'))).toBe(true);
      expect(fs.existsSync(path.join(tmpPortal, '.vitepress/cached.md'))).toBe(true);
      expect(fs.existsSync(path.join(tmpPortal, 'development/orphan.md'))).toBe(false);
      expect(fs.existsSync(path.join(tmpPortal, 'legacy-section'))).toBe(false);
      expect(fs.existsSync(path.join(tmpPortal, 'stray.md'))).toBe(false);
    } finally {
      fs.rmSync(tmpPortal, { recursive: true, force: true });
    }
  });

  describe('rewriteMarkdownLinks', () => {
    it('supports nested brackets, preserves query strings, and uses tree/main for directories', () => {
      const md = [
        'Route: [src/app/api/admin/[entity]/route.ts](src/app/api/admin/[entity]/route.ts?plain=1#L7-L143)',
        'Dir: [src/features/](src/features?tab=1)',
        'Doc with query: [Setup](docs/developer-setup.md?from=readme)',
        'Inline code ignored: `[not-rewritten](AGENTS.md)`',
        '```md',
        '[fenced-not-rewritten](AGENTS.md)',
        '```',
      ].join('\n');

      const result = rewriteMarkdownLinks(md, 'README.md', rootDir);
      expect(result).toContain(
        '[src/app/api/admin/[entity]/route.ts](https://github.com/fderuiter/wedding_website/blob/main/src/app/api/admin/[entity]/route.ts?plain=1#L7-L143)'
      );
      expect(result).toContain(
        '[src/features/](https://github.com/fderuiter/wedding_website/tree/main/src/features?tab=1)'
      );
      expect(result).toContain('[Setup](/development/developer-setup?from=readme)');
      expect(result).toContain('`[not-rewritten](AGENTS.md)`');
      expect(result).toContain('[fenced-not-rewritten](AGENTS.md)');
    });

    it('maps cross-file #hash fragments on staged docs to VitePress heading slugs', () => {
      const md = [
        '[Arch](../../DEPLOYMENT.md#-architecture--responsibilities)',
        '[Promo](../../DEPLOYMENT.md#-staging-promotion--approval-workflow)',
      ].join('\n');

      const result = rewriteMarkdownLinks(md, 'docs/deployment/gcp-cloud-run.md', rootDir);
      expect(result).toContain('[Arch](/deployment/deployment#🏗️-architecture-responsibilities)');
      expect(result).toContain('[Promo](/deployment/deployment#🔄-staging-promotion-approval-workflow)');
    });

    it('leaves unmapped missing paths untouched in isolated directories', () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-rewrite-'));
      try {
        fs.writeFileSync(path.join(tmp, 'doc.md'), '## Setup & Installation\n');
        const out = rewriteMarkdownLinks('[Missing](./nonexistent.ts) and [Self](#setup--installation)', 'doc.md', tmp);
        expect(out).toBe('[Missing](./nonexistent.ts) and [Self](#setup-installation)');
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  });

  describe('escapeVueMustache', () => {
    it('escapes prose {{ }} while skipping fenced code blocks and inline backticks', () => {
      const md = [
        'Prose {{ vueExpr }} should be escaped.',
        'Inline `environment: ${{ inputs.environment || \'production\' }}` stays intact.',
        'Double backticks `` ${{ inputs.rollback_environment || inputs.environment || \'production\' }} `` stay intact.',
        '```yaml',
        'env: ${{ github.sha }}',
        '```',
        '~~~yaml',
        'tag: ${{ inputs.tag }}',
        '~~~',
      ].join('\n');

      const escaped = escapeVueMustache(md);
      expect(escaped).toContain('Prose &#123;&#123; vueExpr &#125;&#125; should be escaped.');
      expect(escaped).toContain('`environment: ${{ inputs.environment || \'production\' }}`');
      expect(escaped).toContain('`` ${{ inputs.rollback_environment || inputs.environment || \'production\' }} ``');
      expect(escaped).toContain('env: ${{ github.sha }}');
      expect(escaped).toContain('tag: ${{ inputs.tag }}');
    });
  });

  describe('prependPortalFrontmatterTitle', () => {
    it('prepends YAML frontmatter title when Markdown lacks frontmatter and quotes YAML-sensitive titles', () => {
      expect(prependPortalFrontmatterTitle('# Heading\n', 'Project Overview')).toBe(
        '---\ntitle: Project Overview\n---\n# Heading\n'
      );
      expect(prependPortalFrontmatterTitle('# Agents\n', 'Agent & Contributor Guidelines')).toBe(
        '---\ntitle: "Agent & Contributor Guidelines"\n---\n# Agents\n'
      );
    });

    it('preserves existing YAML frontmatter untouched', () => {
      const existing = '---\ntitle: Custom Authored Title\nlayout: doc\n---\n\n# Body\n';
      expect(prependPortalFrontmatterTitle(existing, 'Overridden Title')).toBe(existing);
    });
  });

  describe('API Explorer dark-mode accessibility and static server gating', () => {
    it('replaces CSS invert filters with explicit WCAG AA dark-mode Swagger UI rules in custom.css', () => {
      const customCssPath = path.join(rootDir, 'docs-portal/.vitepress/theme/custom.css');
      const css = fs.readFileSync(customCssPath, 'utf8');

      expect(css).not.toMatch(/invert\s*\(/i);
      expect(css).toContain('.dark #swagger-ui-container .swagger-ui .model-box');
      expect(css).toContain('.dark #swagger-ui-container .swagger-ui .prop-type');
    });

    it('gates interactive Try it out requests in ApiExplorer.vue until a valid target server URL is configured', () => {
      const explorerPath = path.join(
        rootDir,
        'docs-portal/.vitepress/theme/components/ApiExplorer.vue'
      );
      const vue = fs.readFileSync(explorerPath, 'utf8');

      expect(vue).toContain('supportedSubmitMethods: isLiveEnabled ? SUBMIT_METHODS : []');
      expect(vue).toContain('servers: []');
      expect(vue).toContain("description: 'Configured target deployment'");
    });
  });
});
