/** @jest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';

interface WorkflowStep {
  name?: string;
  id?: string;
  if?: string;
  uses?: string;
  run?: string;
  'timeout-minutes'?: number;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}

interface WorkflowJob {
  steps?: WorkflowStep[];
}

function parseCiWorkflowJobs(): Record<string, WorkflowJob> {
  const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'ci.yml');
  const rawYaml = fs.readFileSync(workflowPath, 'utf8');
  const parsed = parseDocument(rawYaml, { version: '1.2', strict: true }).toJS() as {
    jobs?: Record<string, WorkflowJob>;
  };
  return parsed.jobs ?? {};
}

describe('CI workflow database preflight gate & Chromium-only Playwright caching', () => {
  const jobs = parseCiWorkflowJobs();

  it('requires PostgreSQL reachability via CI_REQUIRE_DB in unit-test', () => {
    const unitTestSteps = jobs['unit-test']?.steps ?? [];
    const runTestsStep = unitTestSteps.find((step) => step.run === 'npm run test:cov');
    expect(runTestsStep).toBeDefined();
    expect(runTestsStep?.env?.CI_REQUIRE_DB).toBe('true');
  });

  it('scopes Playwright browser cache keys, OS deps, and timeout bounds strictly to Chromium across all Playwright CI jobs', () => {
    for (const jobId of ['static-export-build', 'e2e-test', 'pages-verify'] as const) {
      const steps = jobs[jobId]?.steps ?? [];

      const cacheStep = steps.find((step) => step.id === 'playwright-chromium-cache');
      expect({ jobId, hasChromiumCacheStep: Boolean(cacheStep) }).toEqual({
        jobId,
        hasChromiumCacheStep: true,
      });
      expect(steps.find((step) => step.id === 'playwright-cache')).toBeUndefined();
      expect(cacheStep?.with?.path).toBe('~/.cache/ms-playwright');
      expect(cacheStep?.with?.key).toBe(
        "${{ runner.os }}-playwright-chromium-${{ hashFiles('package-lock.json') }}"
      );
      expect(cacheStep?.with?.['restore-keys']).toBeUndefined();

      const installBrowserStep = steps.find(
        (step) => step.run === 'npx playwright install --with-deps chromium'
      );
      expect(installBrowserStep).toBeDefined();
      expect(installBrowserStep?.if).toBe(
        "steps.playwright-chromium-cache.outputs.cache-hit != 'true'"
      );
      expect(installBrowserStep?.['timeout-minutes']).toBe(5);

      const installDepsStep = steps.find(
        (step) => step.run === 'npx playwright install-deps chromium'
      );
      expect(installDepsStep).toBeDefined();
      expect(installDepsStep?.if).toBe(
        "steps.playwright-chromium-cache.outputs.cache-hit == 'true'"
      );
      expect(installDepsStep?.['timeout-minutes']).toBe(5);

      for (const step of steps) {
        if (typeof step.run === 'string') {
          expect(step.run).not.toMatch(/^\s*npx playwright install --with-deps\s*$/m);
          expect(step.run).not.toMatch(/^\s*npx playwright install-deps\s*$/m);
        }
      }
    }
  });
});
