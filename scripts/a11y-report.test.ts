import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { toHaveNoViolations } from 'jest-axe';
import {
  findJestAxeSuites,
  generateReport,
  runA11yUnit,
  runA11ySuite,
  main,
} from './a11y-report.mjs';

describe('a11y-report', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-report-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('generateReport', () => {
    it('formats passing component and route-keyed page sections with zero total violations', () => {
      const resultsDir = path.join(tempDir, 'test-results');
      fs.mkdirSync(resultsDir, { recursive: true });
      fs.writeFileSync(path.join(resultsDir, 'jest-a11y-violations.json'), '[]');
      fs.writeFileSync(
        path.join(resultsDir, 'playwright-a11y-violations.json'),
        JSON.stringify({
          '/': [],
          '/weather': [],
          '/admin/dashboard/thank-you-notes': [],
          '/admin/dashboard/seating-chart': [],
        })
      );

      const { report, totalViolations, outputPath } = generateReport({ cwd: tempDir });

      expect(totalViolations).toBe(0);
      expect(fs.existsSync(outputPath)).toBe(true);
      expect(report).toContain('## Accessibility Health Summary');
      expect(report).toContain('### Component Level (Jest)');
      expect(report).toContain('✅ No accessibility violations found in components.');
      expect(report).toContain('### Page Level (Playwright)');
      expect(report).toContain('✅ No accessibility violations found in pages.');
      expect(report).toContain('**Total Accessibility Violations:** 0');
    });

    it('aggregates and formats Jest and route-keyed Playwright violations', () => {
      const resultsDir = path.join(tempDir, 'test-results');
      fs.mkdirSync(resultsDir, { recursive: true });
      fs.writeFileSync(
        path.join(resultsDir, 'jest-a11y-violations.json'),
        JSON.stringify([
          {
            id: 'image-alt',
            description: 'Images must have alternative text',
            impact: 'critical',
          },
        ])
      );
      fs.writeFileSync(
        path.join(resultsDir, 'playwright-a11y-violations.json'),
        JSON.stringify({
          '/': [],
          '/weather': [
            {
              id: 'color-contrast',
              description: 'Elements must meet minimum color contrast ratio thresholds',
              impact: 'serious',
            },
          ],
        })
      );

      const { report, totalViolations } = generateReport({ cwd: tempDir });

      expect(totalViolations).toBe(2);
      expect(report).toContain('❌ Found 1 violations in components.');
      expect(report).toContain('- **image-alt**: Images must have alternative text (critical)');
      expect(report).toContain('❌ Found 1 violations in pages.');
      expect(report).toContain(
        '- **color-contrast** (`/weather`): Elements must meet minimum color contrast ratio thresholds (serious)'
      );
      expect(report).toContain('**Total Accessibility Violations:** 2');
    });

    it('supports legacy flat array Playwright violations and marks missing suite artifacts as incomplete', () => {
      const resultsDir = path.join(tempDir, 'test-results');
      fs.mkdirSync(resultsDir, { recursive: true });
      fs.writeFileSync(
        path.join(resultsDir, 'playwright-a11y-violations.json'),
        JSON.stringify([
          {
            id: 'button-name',
            description: 'Buttons must have discernible text',
            impact: 'critical',
          },
        ])
      );

      const { report, totalViolations, incompleteSuites } = generateReport({ cwd: tempDir });

      expect(totalViolations).toBe(1);
      expect(incompleteSuites).toEqual(['jest']);
      expect(report).toContain('### Component Level (Jest)');
      expect(report).toContain(
        '⚠️ Incomplete: Jest accessibility artifact (`test-results/jest-a11y-violations.json`) was not found.'
      );
      expect(report).toContain('### Page Level (Playwright)');
      expect(report).toContain('- **button-name**: Buttons must have discernible text (critical)');
      expect(report).toContain('**Status:** Incomplete (jest results missing)');
      expect(report).toContain('**Total Accessibility Violations:** 1');
    });

    it('marks both component and page sections as incomplete when neither artifact exists', () => {
      const { report, totalViolations, incompleteSuites } = generateReport({ cwd: tempDir });

      expect(totalViolations).toBe(0);
      expect(incompleteSuites).toEqual(['jest', 'playwright']);
      expect(report).toContain('### Component Level (Jest)');
      expect(report).toContain(
        '⚠️ Incomplete: Jest accessibility artifact (`test-results/jest-a11y-violations.json`) was not found.'
      );
      expect(report).toContain('### Page Level (Playwright)');
      expect(report).toContain(
        '⚠️ Incomplete: Playwright accessibility artifact (`test-results/playwright-a11y-violations.json`) was not found.'
      );
      expect(report).toContain('**Status:** Incomplete (jest, playwright results missing)');
      expect(report).toContain('**Total Accessibility Violations:** 0');
    });
  });

  describe('standalone CLI exit codes', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts', 'a11y-report.mjs');

    it('writes summary first and exits 0 when zero violations are recorded', () => {
      const resultsDir = path.join(tempDir, 'test-results');
      fs.mkdirSync(resultsDir, { recursive: true });
      fs.writeFileSync(path.join(resultsDir, 'jest-a11y-violations.json'), '[]');
      fs.writeFileSync(path.join(resultsDir, 'playwright-a11y-violations.json'), '{}');

      const proc = spawnSync(process.execPath, [scriptPath], {
        cwd: tempDir,
        encoding: 'utf8',
      });

      expect(proc.status).toBe(0);
      const summaryFile = path.join(resultsDir, 'a11y-summary.md');
      expect(fs.existsSync(summaryFile)).toBe(true);
      expect(fs.readFileSync(summaryFile, 'utf8')).toContain('**Total Accessibility Violations:** 0');
    });

    it('writes summary first and exits 1 when violations exceed 0', () => {
      const resultsDir = path.join(tempDir, 'test-results');
      fs.mkdirSync(resultsDir, { recursive: true });
      fs.writeFileSync(
        path.join(resultsDir, 'jest-a11y-violations.json'),
        JSON.stringify([
          {
            id: 'label',
            description: 'Form elements must have labels',
            impact: 'critical',
          },
        ])
      );

      const proc = spawnSync(process.execPath, [scriptPath], {
        cwd: tempDir,
        encoding: 'utf8',
      });

      expect(proc.status).toBe(1);
      const summaryFile = path.join(resultsDir, 'a11y-summary.md');
      expect(fs.existsSync(summaryFile)).toBe(true);
      expect(fs.readFileSync(summaryFile, 'utf8')).toContain('**Total Accessibility Violations:** 1');
    });
  });

  describe('findJestAxeSuites & runA11yUnit', () => {
    it('discovers all 56 src/ jest-axe suites in the live repository', () => {
      const suites = findJestAxeSuites(process.cwd());
      expect(suites).toHaveLength(56);
      expect(suites.every((p: string) => p.startsWith('src/') && p.endsWith('.test.tsx'))).toBe(
        true
      );
    });

    it('runs only discovered jest-axe files with --coverage=false and initializes jest-a11y-violations.json', () => {
      const customSrc = path.join(tempDir, 'src', 'components', '__tests__');
      fs.mkdirSync(customSrc, { recursive: true });
      fs.writeFileSync(
        path.join(customSrc, 'SampleButton.test.tsx'),
        'import { axe } from \'jest-axe\';\ntest(\'a11y\', () => {});\n'
      );
      fs.writeFileSync(
        path.join(customSrc, 'NonA11y.test.tsx'),
        'test(\'plain\', () => {});\n'
      );

      const resultsDir = path.join(tempDir, 'test-results');
      fs.mkdirSync(resultsDir, { recursive: true });
      fs.writeFileSync(
        path.join(resultsDir, 'jest-a11y-violations.json'),
        JSON.stringify([{ id: 'stale-violation' }])
      );

      const invoked: Array<{ cmd: string; args: string[] }> = [];
      const exitCode = runA11yUnit({
        cwd: tempDir,
        runStep: (cmd: string, args: string[]) => {
          invoked.push({ cmd, args });
          return 0;
        },
      });

      expect(exitCode).toBe(0);
      expect(invoked).toEqual([
        {
          cmd: 'npx',
          args: [
            'jest',
            '--runInBand',
            '--coverage=false',
            '--runTestsByPath',
            'src/components/__tests__/SampleButton.test.tsx',
          ],
        },
      ]);
      const recorded = JSON.parse(
        fs.readFileSync(path.join(resultsDir, 'jest-a11y-violations.json'), 'utf8')
      );
      expect(recorded).toEqual([]);
    });

    it('exits non-zero via main(--unit) when component violations are recorded', () => {
      const mockExit = jest
        .spyOn(process, 'exit')
        .mockImplementation(((code?: string | number | null | undefined) => {
          throw new Error(`process.exit:${code}`);
        }) as never);

      try {
        expect(() => {
          main(['--unit'], {
            cwd: tempDir,
            runStep: (_cmd: string, _args: string[], cwd: string) => {
              fs.writeFileSync(
                path.join(cwd, 'test-results', 'jest-a11y-violations.json'),
                JSON.stringify([{ id: 'button-name', description: 'Missing text', impact: 'critical' }])
              );
              return 1;
            },
          });
        }).toThrow('process.exit:1');
      } finally {
        mockExit.mockRestore();
      }
    });
  });

  describe('runA11ySuite orchestrator', () => {
    it('cleans stale test-results, runs targeted jest-axe pass, reseeds wedding_test, runs @a11y Playwright, writes summary, and returns 0 when clean', () => {
      const staleDir = path.join(tempDir, 'test-results');
      fs.mkdirSync(staleDir, { recursive: true });
      fs.writeFileSync(path.join(staleDir, 'stale.txt'), 'stale');

      const invoked: string[] = [];
      let capturedSeedEnv: Record<string, string | undefined> | undefined;
      const originalDbUrl = process.env.DATABASE_URL;
      delete process.env.DATABASE_URL;

      try {
        const exitCode = runA11ySuite({
          cwd: tempDir,
          runStep: (
            cmd: string,
            args: string[],
            cwd: string,
            envOverrides?: Record<string, string | undefined>
          ) => {
            const fullCmd = `${cmd} ${args.slice(0, 4).join(' ')}`;
            invoked.push(cmd === 'npx' && args[0] === 'jest' ? fullCmd : `${cmd} ${args.join(' ')}`);
            const dir = path.join(cwd, 'test-results');
            fs.mkdirSync(dir, { recursive: true });
            if (`${cmd} ${args.join(' ')}` === 'npx tsx scripts/seed.ts') {
              capturedSeedEnv = envOverrides;
            } else if (`${cmd} ${args.join(' ')}` === 'npx playwright test --grep @a11y') {
              fs.writeFileSync(
                path.join(dir, 'playwright-a11y-violations.json'),
                JSON.stringify({ '/': [] })
              );
            }
            return 0;
          },
        });

        expect(exitCode).toBe(0);
        expect(invoked).toEqual([
          'npx jest --runInBand --coverage=false --runTestsByPath',
          'npx tsx scripts/seed.ts',
          'npx playwright test --grep @a11y',
        ]);
        expect(capturedSeedEnv?.DATABASE_URL).toBe(
          'postgresql://wedding:wedding123@localhost:5432/wedding_test?schema=public'
        );
        expect(capturedSeedEnv?.ADMIN_PASSWORD).toBeDefined();
        expect(fs.existsSync(path.join(staleDir, 'stale.txt'))).toBe(false);
        expect(fs.existsSync(path.join(staleDir, 'jest-a11y-violations.json'))).toBe(true);
        expect(fs.existsSync(path.join(staleDir, 'a11y-summary.md'))).toBe(true);
      } finally {
        if (originalDbUrl === undefined) {
          delete process.env.DATABASE_URL;
        } else {
          process.env.DATABASE_URL = originalDbUrl;
        }
      }
    });

    it('propagates non-zero exit code when Jest fails while still reseeding, running Playwright, and writing summary', () => {
      const invoked: string[] = [];
      const exitCode = runA11ySuite({
        cwd: tempDir,
        runStep: (cmd: string, args: string[]) => {
          invoked.push(
            cmd === 'npx' && args[0] === 'jest'
              ? `${cmd} ${args.slice(0, 4).join(' ')}`
              : `${cmd} ${args.join(' ')}`
          );
          return cmd === 'npx' && args[0] === 'jest' ? 2 : 0;
        },
      });

      expect(exitCode).toBe(2);
      expect(invoked).toEqual([
        'npx jest --runInBand --coverage=false --runTestsByPath',
        'npx tsx scripts/seed.ts',
        'npx playwright test --grep @a11y',
      ]);
      expect(fs.existsSync(path.join(tempDir, 'test-results', 'a11y-summary.md'))).toBe(true);
    });

    it('propagates non-zero exit code when reseeding fails while still writing summary', () => {
      const invoked: string[] = [];
      const exitCode = runA11ySuite({
        cwd: tempDir,
        runStep: (cmd: string, args: string[]) => {
          const fullCmd =
            cmd === 'npx' && args[0] === 'jest'
              ? `${cmd} ${args.slice(0, 4).join(' ')}`
              : `${cmd} ${args.join(' ')}`;
          invoked.push(fullCmd);
          return fullCmd === 'npx tsx scripts/seed.ts' ? 3 : 0;
        },
      });

      expect(exitCode).toBe(3);
      expect(invoked).toEqual([
        'npx jest --runInBand --coverage=false --runTestsByPath',
        'npx tsx scripts/seed.ts',
        'npx playwright test --grep @a11y',
      ]);
      expect(fs.existsSync(path.join(tempDir, 'test-results', 'a11y-summary.md'))).toBe(true);
    });

    it('propagates non-zero exit code when Playwright fails while still writing summary', () => {
      const invoked: string[] = [];
      const exitCode = runA11ySuite({
        cwd: tempDir,
        runStep: (cmd: string, args: string[]) => {
          const fullCmd =
            cmd === 'npx' && args[0] === 'jest'
              ? `${cmd} ${args.slice(0, 4).join(' ')}`
              : `${cmd} ${args.join(' ')}`;
          invoked.push(fullCmd);
          return fullCmd === 'npx playwright test --grep @a11y' ? 1 : 0;
        },
      });

      expect(exitCode).toBe(1);
      expect(invoked).toEqual([
        'npx jest --runInBand --coverage=false --runTestsByPath',
        'npx tsx scripts/seed.ts',
        'npx playwright test --grep @a11y',
      ]);
      expect(fs.existsSync(path.join(tempDir, 'test-results', 'a11y-summary.md'))).toBe(true);
    });

    it('returns 1 via main(--run) when runners exit 0 but recorded violations exist', () => {
      const mockExit = jest
        .spyOn(process, 'exit')
        .mockImplementation(((code?: string | number | null | undefined) => {
          throw new Error(`process.exit:${code}`);
        }) as never);

      try {
        expect(() => {
          main(['--run'], {
            cwd: tempDir,
            runStep: (cmd: string, args: string[], cwd: string) => {
              if (`${cmd} ${args.join(' ')}` === 'npx playwright test --grep @a11y') {
                const dir = path.join(cwd, 'test-results');
                fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(
                  path.join(dir, 'playwright-a11y-violations.json'),
                  JSON.stringify({
                    '/weather': [
                      {
                        id: 'color-contrast',
                        description: 'Low contrast',
                        impact: 'serious',
                      },
                    ],
                  })
                );
              }
              return 0;
            },
          });
        }).toThrow('process.exit:1');
      } finally {
        mockExit.mockRestore();
      }
    });
  });

  describe('jest-axe toHaveNoViolations wrapper', () => {
    const originalReportPath = process.env.JEST_A11Y_REPORT_PATH;

    afterEach(() => {
      if (originalReportPath === undefined) {
        delete process.env.JEST_A11Y_REPORT_PATH;
      } else {
        process.env.JEST_A11Y_REPORT_PATH = originalReportPath;
      }
    });

    it('records component violations even when suites re-register expect.extend(toHaveNoViolations)', () => {
      const customReportFile = path.join(tempDir, 'jest-a11y-violations.json');
      fs.writeFileSync(customReportFile, '[]', 'utf8');
      process.env.JEST_A11Y_REPORT_PATH = customReportFile;

      // Simulate test suites calling expect.extend(toHaveNoViolations) directly
      expect.extend(toHaveNoViolations);

      const mockViolationResult = {
        violations: [
          {
            id: 'button-name',
            impact: 'critical',
            description: 'Buttons must have discernible text',
            help: 'Buttons must have discernible text',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/button-name',
            nodes: [
              {
                html: '<button></button>',
                target: ['button'],
                failureSummary: 'Fix any of the following: Element does not have inner text',
              },
            ],
          },
        ],
      };

      expect(() => {
        expect(mockViolationResult).toHaveNoViolations();
      }).toThrow();

      const recorded = JSON.parse(fs.readFileSync(customReportFile, 'utf8'));
      expect(recorded).toHaveLength(1);
      expect(recorded[0].id).toBe('button-name');
    });
  });
});
