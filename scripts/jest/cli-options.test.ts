/** @jest-environment node */

import { spawnSync } from 'node:child_process';
import {
  hasCoverageDisableFlag,
  isTargetedJestRun,
  resolveIsCoverageRun,
  shouldEnforceGlobalCoverageThreshold,
} from './cli-options.mjs';

describe('scripts/jest/cli-options.mjs & jest.config.mjs coverageThreshold scoping', () => {
  it('distinguishes unfiltered runs (including value-consuming non-target flags) from targeted CLI invocations', () => {
    const unfilteredArgs: string[][] = [
      [],
      ['--coverage'],
      ['--coverage', '--maxWorkers=2'],
      ['--coverage', '--maxWorkers', '2'],
      ['--coverage', '-w', '50%', '--bail', '1'],
      ['--coverage', '--bail', '--ci'],
      ['--coverage', '--coverageReporters', 'json', 'lcov'],
      ['--coverage', '--config', 'jest.config.mjs', '--seed', '42'],
      ['--coverage', '--'],
    ];

    for (const args of unfilteredArgs) {
      expect({ args, targeted: isTargetedJestRun(args) }).toEqual({ args, targeted: false });
    }

    const targetedArgs: string[][] = [
      ['--coverage', 'src/utils/__tests__/ApiError.test.ts'],
      ['--coverage', '--', 'src/utils/__tests__/ApiError.test.ts'],
      ['--coverage', '--testPathPatterns', 'ApiError'],
      ['--coverage', '--testPathPatterns=ApiError'],
      ['--coverage', '--testPathPattern', 'ApiError'],
      ['--coverage', '--selectProjects', 'unit-node'],
      ['--coverage', '--selectProjects=unit-jsdom'],
      ['--coverage', '--ignoreProjects', 'db-serial'],
      ['--coverage', '--onlyChanged'],
      ['--coverage', '-o'],
      ['--coverage', '--onlyFailures'],
      ['--coverage', '-f'],
      ['--coverage', '--findRelatedTests', 'src/utils/ApiError.ts'],
      ['--coverage', '--collectCoverageOnlyFrom=src/utils/ApiError.ts'],
      ['--coverage', '--shard=1/2'],
      ['--coverage', '--shard', '1/2'],
      ['--coverage', '-t', 'formats errors'],
      ['--coverage', '--runTestsByPath', 'src/utils/__tests__/ApiError.test.ts'],
      ['--coverage', '--watch'],
      ['--coverage', '--coverageReporters', 'json', 'src/utils/__tests__/ApiError.test.ts'],
    ];

    for (const args of targetedArgs) {
      expect({ args, targeted: isTargetedJestRun(args) }).toEqual({ args, targeted: true });
    }
  });

  it('honors coverage enable and disable precedence across CLI flags and environment variables', () => {
    expect(hasCoverageDisableFlag(['--coverage'])).toBe(false);
    expect(hasCoverageDisableFlag(['--coverage=false'])).toBe(true);
    expect(hasCoverageDisableFlag(['--collectCoverage=false'])).toBe(true);
    expect(hasCoverageDisableFlag(['--no-coverage'])).toBe(true);

    expect(
      resolveIsCoverageRun({
        args: [],
        env: { NODE_ENV: 'test', npm_lifecycle_event: 'test' },
      })
    ).toBe(false);
    expect(
      resolveIsCoverageRun({
        args: [],
        env: { NODE_ENV: 'test', npm_lifecycle_event: 'test:cov' },
      })
    ).toBe(true);
    expect(
      resolveIsCoverageRun({
        args: ['--coverage=false'],
        env: { NODE_ENV: 'test', npm_lifecycle_event: 'test:cov', COLLECT_COVERAGE: 'true' },
      })
    ).toBe(false);

    expect(
      shouldEnforceGlobalCoverageThreshold({
        args: ['--coverage', '--maxWorkers', '2'],
        env: { NODE_ENV: 'test', npm_lifecycle_event: 'test:cov' },
      })
    ).toBe(true);
    expect(
      shouldEnforceGlobalCoverageThreshold({
        args: [],
        env: { NODE_ENV: 'test', npm_lifecycle_event: 'test' },
      })
    ).toBe(false);
    expect(
      shouldEnforceGlobalCoverageThreshold({
        args: ['--coverage', 'src/utils/__tests__/ApiError.test.ts'],
        env: { NODE_ENV: 'test', npm_lifecycle_event: 'test:cov' },
      })
    ).toBe(false);
  });

  it('applies coverageThreshold.global in jest.config.mjs on unfiltered coverage runs and omits it on targeted runs', () => {
    const probeScript = `
      import defaultCfgPromise from './jest.config.mjs';
      const cfg = await defaultCfgPromise;
      process.stdout.write('\\n__JEST_THRESHOLD_PROBE__:' + JSON.stringify(cfg.coverageThreshold ?? null));
    `;

    const runConfigProbe = (cliArgs: string[]) => {
      const res = spawnSync(
        process.execPath,
        ['--input-type=module', '-e', probeScript, '--', ...cliArgs],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          env: { ...process.env, npm_lifecycle_event: 'test:cov' },
        }
      );
      expect(res.status).toBe(0);
      const jsonPart = res.stdout.split('__JEST_THRESHOLD_PROBE__:')[1] ?? 'null';
      return JSON.parse(jsonPart) as unknown;
    };

    expect(runConfigProbe(['--coverage'])).toEqual({
      global: {
        branches: 68,
        functions: 0,
        lines: 80,
        statements: 0,
      },
    });
    expect(runConfigProbe(['--coverage', 'src/utils/__tests__/ApiError.test.ts'])).toBeNull();
    expect(runConfigProbe(['--coverage', '--selectProjects', 'unit-node'])).toBeNull();
  });
});
