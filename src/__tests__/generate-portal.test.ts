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
import {
  createApiExplorerSandbox,
  DEMO_SHOWCASE_STORAGE_KEY,
  evaluateExternalTargetOrigin,
  normalizeTargetServerUrl,
  STATIC_DEMO_STORAGE_KEY,
} from '../../docs-portal/.vitepress/theme/apiExplorerSandbox';

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
    expect(configContent).toContain("{ text: 'Live Demo', link: '/demo/', target: '_self' }");
    expect(configContent).toContain(
      "{ text: 'Storybook', link: '/storybook/', target: '_blank', rel: 'noopener noreferrer' }"
    );
    expect(configContent).toContain("{ text: 'Development', link: '/development/developer-setup' }");
    expect(configContent).toContain('ignoreDeadLinks: [/^\\/demo(?:\\/|$)/, /^\\/storybook(?:\\/|$)/]');
    expect(configContent).toContain("env: 'dotenv'");
    expect(configContent).toContain("caddy: 'nginx'");
    expect(configContent).toContain("cron: 'shellscript'");
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

  it('verifies docs-portal/index.md contains Developer Onboarding feature card and full-page showcase links', () => {
    const indexPath = path.join(rootDir, 'docs-portal/index.md');
    const indexContent = fs.readFileSync(indexPath, 'utf8');

    expect(indexContent).toContain('title: Developer Onboarding');
    expect(indexContent).toContain('link: /development/developer-setup');
    expect(indexContent).toMatch(/link:\s*\/demo\/\s*\n\s*target:\s*_self/);
    expect(indexContent).toMatch(
      /text:\s*Storybook\s*\n\s*link:\s*\/storybook\/\s*\n\s*target:\s*_blank\s*\n\s*rel:\s*noopener noreferrer/
    );
    expect(indexContent).toMatch(
      /title:\s*Storybook Showcase[\s\S]*?link:\s*\/storybook\/\s*\n\s*target:\s*_blank\s*\n\s*rel:\s*noopener noreferrer/
    );
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

  describe('API Explorer dark-mode accessibility and zero-backend browser sandbox', () => {
    function relativeLuminance(hex: string): number {
      const normalized = hex.replace('#', '');
      const r = parseInt(normalized.slice(0, 2), 16) / 255;
      const g = parseInt(normalized.slice(2, 4), 16) / 255;
      const b = parseInt(normalized.slice(4, 6), 16) / 255;
      const toLinear = (c: number) =>
        c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
    }

    function contrastRatio(fgHex: string, bgHex: string): number {
      const l1 = relativeLuminance(fgHex);
      const l2 = relativeLuminance(bgHex);
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    }

    function extractRuleColors(css: string, selector: string): { bg: string; fg: string } {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
      if (!match) {
        throw new Error(`Missing CSS selector: ${selector}`);
      }
      const block = match[1];
      const bgMatch = block.match(/background-color:\s*(#[0-9a-fA-F]{6})/);
      const fgMatch = block.match(/(?:^|;|\s)color:\s*(#[0-9a-fA-F]{6})/);
      if (!bgMatch || !fgMatch) {
        throw new Error(`Missing explicit hex colors on selector: ${selector}`);
      }
      return { bg: bgMatch[1], fg: fgMatch[1] };
    }

    it('styles all dark-mode HTTP method badges and execute button at >= 4.5:1 WCAG 2.2 AA contrast without invert filters', () => {
      const customCssPath = path.join(rootDir, 'docs-portal/.vitepress/theme/custom.css');
      const css = fs.readFileSync(customCssPath, 'utf8');

      expect(css).not.toMatch(/invert\s*\(/i);
      expect(css).toContain('.dark #swagger-ui-container .swagger-ui .model-box');
      expect(css).toContain('.dark #swagger-ui-container .swagger-ui .prop-type');

      const selectors = [
        '.dark #swagger-ui-container .swagger-ui .opblock.opblock-get .opblock-summary-method',
        '.dark #swagger-ui-container .swagger-ui .opblock.opblock-post .opblock-summary-method',
        '.dark #swagger-ui-container .swagger-ui .opblock.opblock-put .opblock-summary-method',
        '.dark #swagger-ui-container .swagger-ui .opblock.opblock-delete .opblock-summary-method',
        '.dark #swagger-ui-container .swagger-ui .opblock.opblock-patch .opblock-summary-method',
        '.dark #swagger-ui-container .swagger-ui .opblock.opblock-head .opblock-summary-method',
        '.dark #swagger-ui-container .swagger-ui .opblock.opblock-options .opblock-summary-method',
        '.dark #swagger-ui-container .swagger-ui .opblock.opblock-deprecated .opblock-summary-method',
        '.dark #swagger-ui-container .swagger-ui .btn.execute',
        '.dark #swagger-ui-container .swagger-ui .btn.cancel',
      ];

      for (const selector of selectors) {
        const { fg, bg } = extractRuleColors(css, selector);
        expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
      }
    });

    it('defaults ApiExplorer.vue to the browser sandbox with persona switching while retaining external server URL mode and cross-origin guidance', () => {
      const explorerPath = path.join(
        rootDir,
        'docs-portal/.vitepress/theme/components/ApiExplorer.vue'
      );
      const vue = fs.readFileSync(explorerPath, 'utf8');

      expect(vue).toContain("ref<ExplorerMode>('sandbox')");
      expect(vue).toContain("description: 'In-browser demo sandbox (zero backend)'");
      expect(vue).toContain("description: 'Configured target deployment'");
      expect(vue).toContain('supportedSubmitMethods: isSubmitEnabled ? SUBMIT_METHODS : []');
      expect(vue).toContain('SameSite=Lax');
      expect(vue).toContain('OPTIONS');
    });

    it('executes public, guest, admin, and setup flows in the browser sandbox, syncs localStorage state with the showcase demo, and validates external URLs', async () => {
      window.localStorage.clear();
      delete window.__STATIC_DEMO_INSTALLED__;

      const sandbox = createApiExplorerSandbox();
      try {
        // Default guest persona seeds sample household session and synchronizes both storage keys
        const initial = sandbox.getSnapshot();
        expect(initial.persona).toBe('guest');
        expect(initial.guestSession?.invitationCode).toBe('SMITH2026');
        expect(window.localStorage.getItem(DEMO_SHOWCASE_STORAGE_KEY)).toBeTruthy();

        // Public & guest routes succeed; admin routes reject with 401 while in guest persona
        const publicItemsRes = await sandbox.executeFetch('/api/registry/items');
        expect(publicItemsRes.status).toBe(200);
        const guestSessionRes = await sandbox.executeFetch('/api/guest/session');
        expect(guestSessionRes.status).toBe(200);
        expect(await guestSessionRes.json()).toMatchObject({
          status: 'invitation',
          isVerified: true,
          invitationCode: 'SMITH2026',
        });
        const sharedPasscodeRes = await sandbox.executeFetch(
          '/api/registry/validate-code?code=WEDDING2026'
        );
        expect(sharedPasscodeRes.status).toBe(200);
        expect(await sharedPasscodeRes.json()).toMatchObject({
          valid: false,
          reason: 'shared_passcode',
        });
        const guestAddrRes = await sandbox.executeFetch('/api/guest/address');
        expect(guestAddrRes.status).toBe(200);
        const switchHouseholdRes = await sandbox.executeFetch('/api/guest/session', {
          method: 'DELETE',
        });
        expect(switchHouseholdRes.status).toBe(200);
        expect(await switchHouseholdRes.json()).toMatchObject({
          status: 'none',
          isVerified: false,
          invitationCode: null,
        });
        expect(sandbox.getSnapshot().guestSession).toBeNull();
        sandbox.setPersona('guest');
        const blockedAdminRes = await sandbox.executeFetch('/api/admin/seating-tables');
        expect(blockedAdminRes.status).toBe(401);

        // Extended staticDemo public route (/api/health) also works through the bridge
        const healthRes = await sandbox.executeFetch('/api/health');
        expect(healthRes.status).toBe(200);
        expect(window.localStorage.getItem(STATIC_DEMO_STORAGE_KEY)).toBeTruthy();

        // Switching to admin unlocks /api/admin/* operations and mutates persisted sample state
        const adminSnap = sandbox.setPersona('admin');
        expect(adminSnap.isAdminSession).toBe(true);
        const adminTablesRes = await sandbox.executeFetch('/api/admin/seating-tables');
        expect(adminTablesRes.status).toBe(200);
        const createItemRes = await sandbox.executeFetch('/api/registry/items', {
          method: 'POST',
          body: JSON.stringify({ name: 'Sandbox Gift', price: 95 }),
        });
        expect(createItemRes.status).toBe(201);

        // Switching to setup requires password before unlocking setup mutations
        const setupSnap = sandbox.setPersona('setup');
        expect(setupSnap.persona).toBe('setup');
        expect(setupSnap.isAdminSession).toBe(false);
        const setupGet = await (await sandbox.executeFetch('/api/admin/setup')).json();
        expect(setupGet.requiresSetup).toBe(true);
        expect((await sandbox.executeFetch('/api/admin/setup', { method: 'POST', body: '{}' })).status).toBe(401);
        expect(
          (
            await sandbox.executeFetch('/api/admin/setup', {
              method: 'POST',
              body: JSON.stringify({ password: 'demo-password' }),
            })
          ).status
        ).toBe(200);
        expect(sandbox.getSnapshot().isAdminSession).toBe(true);

        // Reset restores clean guest persona, default household session, and removes custom items
        const resetSnap = sandbox.resetState();
        expect(resetSnap.persona).toBe('guest');
        expect(resetSnap.guestSession?.invitationCode).toBe('SMITH2026');
        const afterResetItems = await (await sandbox.executeFetch('/api/registry/items')).json();
        expect(
          afterResetItems.items.some((item: { name: string }) => item.name === 'Sandbox Gift')
        ).toBe(false);

        // External URL validation & cross-origin assessment
        expect(normalizeTargetServerUrl('').ok).toBe(false);
        expect(normalizeTargetServerUrl('ftp://example.com').ok).toBe(false);
        expect(normalizeTargetServerUrl('http://localhost:3000/')).toEqual({
          ok: true,
          url: 'http://localhost:3000',
        });
        expect(
          evaluateExternalTargetOrigin('http://localhost:3000', 'https://fderuiter.github.io')
            .isCrossOrigin
        ).toBe(true);
        expect(
          evaluateExternalTargetOrigin('http://localhost:3000', 'http://localhost:3000')
            .isCrossOrigin
        ).toBe(false);
      } finally {
        sandbox.destroy();
        delete window.__STATIC_DEMO_INSTALLED__;
        window.localStorage.clear();
      }
    });
  });
});
