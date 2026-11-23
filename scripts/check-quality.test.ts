import fs from 'fs';
import os from 'os';
import path from 'path';
import { main, steps } from './check-quality';

describe('check-quality', () => {
  let tempDir: string;
  let mockExit: jest.SpyInstance;
  let mockConsoleLog: jest.SpyInstance;
  let mockConsoleError: jest.SpyInstance;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-quality-test-'));
    mockExit = jest.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
      throw new Error(`process.exit: ${code}`);
    });
    mockConsoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
    mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    mockExit.mockRestore();
    mockConsoleLog.mockRestore();
    mockConsoleError.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('orders Build Static Storybook Showcase immediately after docs:build and before npm run test:cov', () => {
    const runbooksIdx = steps.findIndex((s) => s.command === 'npx tsx scripts/verify-deployment-runbooks.ts');
    const setupGuidesIdx = steps.findIndex((s) => s.command === 'npm run check:setup-guides');
    const docsIdx = steps.findIndex((s) => s.command === 'npm run docs:build');
    const storybookIdx = steps.findIndex((s) => s.command === 'npm run build-storybook');
    const testIdx = steps.findIndex((s) => s.command === 'npm run test:cov');

    expect(runbooksIdx).toBeGreaterThanOrEqual(0);
    expect(runbooksIdx).toBeLessThan(docsIdx);
    expect(setupGuidesIdx).toBeGreaterThanOrEqual(0);
    expect(setupGuidesIdx).toBeLessThan(docsIdx);
    expect(docsIdx).toBeGreaterThanOrEqual(0);
    expect(storybookIdx).toBe(docsIdx + 1);
    expect(testIdx).toBe(storybookIdx + 1);
    expect(steps[storybookIdx].remediation).toContain('npm run build-storybook');

    const docSyncStep = steps.find((s) => s.name === 'Verify Documentation Synchronization');
    expect(docSyncStep).toBeDefined();
    expect(docSyncStep?.remediation).toContain('FEATURE_MODULES.md');
  });

  it('prints remediation text, deletes partial storybook-static output, and exits 1 when build-storybook fails', () => {
    const partialStaticDir = path.join(tempDir, 'storybook-static');
    fs.mkdirSync(partialStaticDir, { recursive: true });
    fs.writeFileSync(path.join(partialStaticDir, 'iframe.html'), '<html>partial</html>');

    const executedCommands: string[] = [];

    expect(() => {
      main({
        cwd: tempDir,
        execCommand: (command) => {
          executedCommands.push(command);
          if (command === 'npm run build-storybook') {
            throw new Error('Webpack compilation failed');
          }
        },
      });
    }).toThrow('process.exit: 1');

    expect(fs.existsSync(partialStaticDir)).toBe(false);
    expect(executedCommands).toContain('npm run docs:build');
    expect(executedCommands).toContain('npm run build-storybook');
    expect(executedCommands).not.toContain('npm run test:cov');

    const errorOutput = mockConsoleError.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(errorOutput).toContain('Build Static Storybook Showcase FAILED!');
    expect(errorOutput).toContain('ACTIONABLE REMEDIATION:');
    expect(errorOutput).toContain('Storybook static showcase compilation failed.');
  });

  it('exits 0 when all quality check steps succeed', () => {
    expect(() => {
      main({
        cwd: tempDir,
        execCommand: () => {
          // All commands pass
        },
      });
    }).toThrow('process.exit: 0');
  });

  it('configures parallel storybook-build job in .github/workflows/ci.yml and Webpack fsCache in .storybook/main.ts', () => {
    const repoRoot = process.cwd();
    const ciWorkflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
    const storybookMain = fs.readFileSync(path.join(repoRoot, '.storybook', 'main.ts'), 'utf8');

    expect(ciWorkflow).toContain('  storybook-build:\n    needs: verify');
    expect(ciWorkflow).toContain('node_modules/.cache/webpack');
    expect(ciWorkflow).toContain('node_modules/.cache/storybook');
    expect(ciWorkflow).toContain('run: npm run build-storybook');
    expect(storybookMain).toContain('fsCache: true');
  });
});
