import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  cleanupStaticExportOutDir,
  isSerialHeavyStep,
  main,
  prePushSteps,
  resolveQualitySteps,
  runQualityChecks,
  staticSteps,
  steps,
  type Step,
} from './check-quality';

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

  it('orders Build Static Storybook Showcase and Build Static HTML Showcase after docs:build and before npm run test:cov', () => {
    const runbooksIdx = steps.findIndex((s) => s.command === 'npx tsx scripts/verify-deployment-runbooks.ts');
    const setupGuidesIdx = steps.findIndex((s) => s.command === 'npm run check:setup-guides');
    const docsIdx = steps.findIndex((s) => s.command === 'npm run docs:build');
    const storybookIdx = steps.findIndex((s) => s.command === 'npm run build-storybook');
    const exportIdx = steps.findIndex((s) => s.command === 'npm run build:export');
    const testIdx = steps.findIndex((s) => s.command === 'npm run test:cov');

    expect(runbooksIdx).toBeGreaterThanOrEqual(0);
    expect(runbooksIdx).toBeLessThan(docsIdx);
    expect(setupGuidesIdx).toBeGreaterThanOrEqual(0);
    expect(setupGuidesIdx).toBeLessThan(docsIdx);
    expect(docsIdx).toBeGreaterThanOrEqual(0);
    expect(storybookIdx).toBe(docsIdx + 1);
    expect(exportIdx).toBe(storybookIdx + 1);
    expect(testIdx).toBe(exportIdx + 1);
    expect(steps[storybookIdx].remediation).toContain('npm run build-storybook');
    expect(steps[exportIdx].remediation).toContain('npm run build:export');

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

  it('prints remediation text, deletes partial out directory, and exits 1 when build:export fails', () => {
    const partialOutDir = path.join(tempDir, 'out');
    fs.mkdirSync(partialOutDir, { recursive: true });
    fs.writeFileSync(path.join(partialOutDir, 'index.html'), '<html>partial export</html>');

    const executedCommands: string[] = [];

    expect(() => {
      main({
        cwd: tempDir,
        execCommand: (command) => {
          executedCommands.push(command);
          if (command === 'npm run build:export') {
            throw new Error('Static export failed');
          }
        },
      });
    }).toThrow('process.exit: 1');

    expect(fs.existsSync(partialOutDir)).toBe(false);
    expect(executedCommands).toContain('npm run build-storybook');
    expect(executedCommands).toContain('npm run build:export');
    expect(executedCommands).not.toContain('npm run test:cov');

    const errorOutput = mockConsoleError.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(errorOutput).toContain('Build Static HTML Showcase FAILED!');
    expect(errorOutput).toContain('ACTIONABLE REMEDIATION:');
    expect(errorOutput).toContain('Static HTML showcase export failed.');

    // Direct helper invocation stays safe when out/ is already absent
    cleanupStaticExportOutDir(tempDir);
    expect(fs.existsSync(partialOutDir)).toBe(false);
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
    expect(storybookMain).toContain("'@storybook/addon-docs'");
    expect(storybookMain).toContain('onlyRemoveTypeImports: false');
    expect(storybookMain).toContain('NEXT_PUBLIC_BASE_PATH');
    expect(storybookMain).toContain('../public/fonts');
    expect(storybookMain).toContain('../public/mockServiceWorker.js');
    expect(storybookMain).not.toContain("staticDirs: ['../public']");

    const workerScript = fs.readFileSync(path.join(repoRoot, 'public', 'mockServiceWorker.js'), 'utf8');
    const installedMswPkg = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'node_modules', 'msw', 'package.json'), 'utf8'),
    ) as { version: string };
    expect(workerScript).toContain(`const PACKAGE_VERSION = '${installedMswPkg.version}'`);

    expect(ciWorkflow).toContain('  static-export-build:\n    needs: verify');
    expect(ciWorkflow).toContain('path: .next-export/cache');
    expect(ciWorkflow).toContain('npm run build:export');
    expect(ciWorkflow).toContain('out/index.html');
  });

  it('shares staticSteps (including check:standalone) across check:static, steps, and .github/workflows/ci.yml', () => {
    const repoRoot = process.cwd();
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const ciWorkflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');

    expect(staticSteps.some((s) => s.script === 'check:standalone' || s.command === 'npm run check:standalone')).toBe(
      true
    );
    expect(steps.slice(0, staticSteps.length)).toEqual(staticSteps);
    expect(resolveQualitySteps({ staticOnly: true })).toEqual(staticSteps);
    expect(
      resolveQualitySteps({ staticOnly: true, skipDocSync: true }).some(
        (s) => s.script === 'check:doc-sync'
      )
    ).toBe(false);
    expect(
      resolveQualitySteps({ staticOnly: true, skipActionPins: true }).some(
        (s) => s.script === 'check:action-pins'
      )
    ).toBe(false);
    expect(
      resolveQualitySteps({ staticOnly: true, skipDocSync: true, skipActionPins: true }).some(
        (s) => s.script === 'check:doc-sync' || s.script === 'check:action-pins'
      )
    ).toBe(false);

    expect(pkg.scripts['check:static']).toBe('npx tsx scripts/check-quality.ts --static');
    expect(ciWorkflow).toContain('run: npm run check:static -- --skip-doc-sync --skip-action-pins');
    expect(ciWorkflow).toContain('run: npm run check:action-pins -- --verify-upstream');
    expect(ciWorkflow).toContain('run: npm run check:standalone -- --standalone-only');
  });

  it('includes check:audit in full quality steps before docs:build while keeping staticSteps offline', () => {
    const repoRoot = process.cwd();
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const ciWorkflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');

    expect(staticSteps.some((s) => s.script === 'check:audit' || s.command === 'npm run check:audit')).toBe(
      false
    );

    const auditIdx = steps.findIndex((s) => s.script === 'check:audit' && s.command === 'npm run check:audit');
    const docsIdx = steps.findIndex((s) => s.command === 'npm run docs:build');
    expect(auditIdx).toBeGreaterThanOrEqual(staticSteps.length);
    expect(auditIdx).toBeLessThan(docsIdx);
    expect(steps[auditIdx].remediation).toContain('npm run check:audit');

    expect(pkg.scripts['check:audit']).toBe(
      'npm audit --audit-level=moderate && npm --prefix docker/prisma-cli audit --audit-level=moderate'
    );
    expect(ciWorkflow.match(/run: npm run check:audit/g)?.length).toBe(1);
  });

  it('defines prePushSteps aligned with CI verify checks using --static-only for check:standalone and excluding heavy builds', () => {
    const repoRoot = process.cwd();
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const prePushHook = fs.readFileSync(path.join(repoRoot, '.githooks', 'pre-push'), 'utf8');

    expect(pkg.scripts['check:pre-push']).toBe('npx tsx scripts/check-quality.ts --pre-push');
    expect(prePushHook).toContain('check:pre-push');
    expect(resolveQualitySteps({ prePush: true })).toEqual(prePushSteps);

    const standaloneStep = prePushSteps.find((s) => s.script === 'check:standalone');
    expect(standaloneStep?.command).toBe('npm run check:standalone -- --static-only');

    expect(prePushSteps.map((s) => s.script ?? s.command)).toEqual(
      expect.arrayContaining(['typecheck', 'lint', 'lint:unused', 'check:audit', 'check:doc-sync'])
    );

    for (const heavyCmd of ['npm run docs:build', 'npm run build-storybook', 'npm run build:export', 'npm run test:cov']) {
      expect(prePushSteps.some((s) => s.command === heavyCmd)).toBe(false);
    }
  });

  it('runs read-only steps via a bounded worker pool and runs heavy build/test steps serially afterward', async () => {
    const customSteps: Step[] = [
      { name: 'Static A', script: 'check:env-docs', command: 'check-a' },
      { name: 'Static B', script: 'check:links', command: 'check-b' },
      { name: 'Static C', script: 'typecheck', command: 'check-c' },
      { name: 'Static D', script: 'lint', command: 'check-d' },
      { name: 'Static E', script: 'lint:unused', command: 'check-e' },
      { name: 'Build Docs', command: 'npm run docs:build' },
      { name: 'Build Storybook', command: 'npm run build-storybook' },
      { name: 'Build Export', command: 'npm run build:export' },
      { name: 'Unit Tests', command: 'npm run test:cov' },
    ];

    expect(customSteps.slice(0, 5).every((s) => !isSerialHeavyStep(s))).toBe(true);
    expect(customSteps.slice(5).every((s) => isSerialHeavyStep(s))).toBe(true);

    let activeParallel = 0;
    let maxParallelObserved = 0;
    let activeSerial = 0;
    let maxSerialObserved = 0;
    const completedParallel: string[] = [];
    const serialStartOrder: string[] = [];

    await expect(
      runQualityChecks({
        cwd: tempDir,
        stepsToRun: customSteps,
        concurrency: 2,
        execAsyncCommand: async (command) => {
          const isSerial = command.startsWith('npm run ');
          if (!isSerial) {
            activeParallel++;
            maxParallelObserved = Math.max(maxParallelObserved, activeParallel);
            await new Promise((resolve) => setTimeout(resolve, 25));
            activeParallel--;
            completedParallel.push(command);
          } else {
            expect(completedParallel).toHaveLength(5);
            activeSerial++;
            maxSerialObserved = Math.max(maxSerialObserved, activeSerial);
            serialStartOrder.push(command);
            await new Promise((resolve) => setTimeout(resolve, 10));
            activeSerial--;
          }
        },
      })
    ).rejects.toThrow('process.exit: 0');

    expect(maxParallelObserved).toBe(2);
    expect(completedParallel.sort()).toEqual(['check-a', 'check-b', 'check-c', 'check-d', 'check-e']);
    expect(maxSerialObserved).toBe(1);
    expect(serialStartOrder).toEqual([
      'npm run docs:build',
      'npm run build-storybook',
      'npm run build:export',
      'npm run test:cov',
    ]);
  });

  it('cancels in-flight tasks, skips queued tasks, and prints remediation when a parallel check fails', async () => {
    const customSteps: Step[] = [
      { name: 'Slow Check', command: 'slow-check' },
      {
        name: 'Failing Check',
        command: 'failing-check',
        remediation: 'Fix failing-check contract drift.',
      },
      { name: 'Queued Check', command: 'queued-check' },
      { name: 'Build Docs', command: 'npm run docs:build' },
    ];

    const started: string[] = [];
    let slowCheckAborted = false;

    await expect(
      runQualityChecks({
        cwd: tempDir,
        stepsToRun: customSteps,
        concurrency: 2,
        execAsyncCommand: (command, _cwd, signal) =>
          new Promise((resolve, reject) => {
            started.push(command);
            if (command === 'slow-check') {
              const timer = setTimeout(() => resolve({ stdout: 'slow finished' }), 5000);
              signal.addEventListener(
                'abort',
                () => {
                  slowCheckAborted = true;
                  clearTimeout(timer);
                  reject(new Error('Aborted'));
                },
                { once: true }
              );
              return;
            }
            if (command === 'failing-check') {
              setTimeout(() => {
                reject(
                  Object.assign(new Error('Check failed'), {
                    stderr: 'Contract mismatch in failing-check',
                  })
                );
              }, 15);
              return;
            }
            resolve();
          }),
      })
    ).rejects.toThrow('process.exit: 1');

    expect(slowCheckAborted).toBe(true);
    expect(started).toEqual(['slow-check', 'failing-check']);
    expect(started).not.toContain('queued-check');
    expect(started).not.toContain('npm run docs:build');

    const errorOutput = mockConsoleError.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(errorOutput).toContain('Contract mismatch in failing-check');
    expect(errorOutput).toContain('Failing Check FAILED!');
    expect(errorOutput).toContain('Fix failing-check contract drift.');
  });
});
