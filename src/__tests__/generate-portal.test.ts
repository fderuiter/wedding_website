import fs from 'fs';
import path from 'path';
import { ARCHITECTURAL_DOCS, DocMapping, stagePortalDocs } from '../../scripts/generate-portal';

describe('Portal Documentation Generator & Development Section', () => {
  const rootDir = process.cwd();

  beforeAll(() => {
    stagePortalDocs();
  });

  afterAll(() => {
    fs.rmSync(path.join(rootDir, 'docs-portal/development'), { recursive: true, force: true });
  });

  it('includes Development category documents in ARCHITECTURAL_DOCS', () => {
    const devDocs = ARCHITECTURAL_DOCS.filter(doc => doc.category === 'Development');
    expect(devDocs).toHaveLength(3);

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

  it('verifies VitePress navigation bar contains Development section', () => {
    const configPath = path.join(rootDir, 'docs-portal/.vitepress/config.mts');
    const configContent = fs.readFileSync(configPath, 'utf8');

    expect(configContent).toContain("{ text: 'Development', link: '/development/developer-setup' }");
  });

  it('verifies VitePress sidebar contains Development group with all three runbooks', () => {
    const configPath = path.join(rootDir, 'docs-portal/.vitepress/config.mts');
    const configContent = fs.readFileSync(configPath, 'utf8');

    expect(configContent).toContain("text: 'Development'");
    expect(configContent).toContain("{ text: 'Local Environment Setup', link: '/development/developer-setup' }");
    expect(configContent).toContain("{ text: 'Testing Strategy', link: '/development/testing' }");
    expect(configContent).toContain("{ text: 'Contribution Guidelines', link: '/development/contributing' }");
  });

  it('verifies docs-portal/index.md contains Developer Onboarding feature card', () => {
    const indexPath = path.join(rootDir, 'docs-portal/index.md');
    const indexContent = fs.readFileSync(indexPath, 'utf8');

    expect(indexContent).toContain('title: Developer Onboarding');
    expect(indexContent).toContain('link: /development/developer-setup');
  });

  it('verifies staged development documents exist after portal staging', () => {
    const stagedSetup = path.join(rootDir, 'docs-portal/development/developer-setup.md');
    const stagedTesting = path.join(rootDir, 'docs-portal/development/testing.md');
    const stagedContributing = path.join(rootDir, 'docs-portal/development/contributing.md');

    expect(fs.existsSync(stagedSetup)).toBe(true);
    expect(fs.existsSync(stagedTesting)).toBe(true);
    expect(fs.existsSync(stagedContributing)).toBe(true);
  });
});
