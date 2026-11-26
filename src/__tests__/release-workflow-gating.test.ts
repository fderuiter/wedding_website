/**
 * @jest-environment node
 */
import { execFileSync, spawn, spawnSync } from 'child_process';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { parseDocument } from 'yaml';

const WORKFLOWS_DIR = path.join(process.cwd(), '.github', 'workflows');

function readWorkflow(fileName: string): string {
  return fs.readFileSync(path.join(WORKFLOWS_DIR, fileName), 'utf8');
}

function extractTopLevelSection(yaml: string, sectionKey: string): string {
  const lines = yaml.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.startsWith(`${sectionKey}:`));
  if (startIndex === -1) {
    return '';
  }

  const sectionLines: string[] = [lines[startIndex]];
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || line.startsWith(' ') || line.trim().startsWith('#')) {
      sectionLines.push(line);
    } else {
      break;
    }
  }
  return sectionLines.join('\n');
}

function extractJobSection(yaml: string, jobId: string): string {
  const lines = yaml.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line === `  ${jobId}:`);
  if (startIndex === -1) {
    return '';
  }

  const sectionLines: string[] = [lines[startIndex]];
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || line.startsWith('    ') || line.trim().startsWith('#')) {
      sectionLines.push(line);
    } else {
      break;
    }
  }
  return sectionLines.join('\n');
}

interface ParsedWorkflowJob {
  needs?: string | string[];
  if?: string;
  'runs-on'?: string;
  'timeout-minutes'?: number;
  concurrency?: { group?: string; 'cancel-in-progress'?: boolean | string; queue?: string };
  permissions?: Record<string, string>;
}

function parseWorkflowJobs(yaml: string): Record<string, ParsedWorkflowJob> {
  const parsed = parseDocument(yaml, { version: '1.2', strict: true }).toJS() as {
    jobs?: Record<string, ParsedWorkflowJob>;
  };
  return parsed.jobs ?? {};
}

function extractRunBlocks(yaml: string): string[] {
  const lines = yaml.split(/\r?\n/);
  const blocks: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const inlineMatch = line.match(/^(\s*)run:\s*(.*)$/);
    if (!inlineMatch) {
      continue;
    }

    const indent = inlineMatch[1].length;
    const rest = inlineMatch[2].trim();

    if (rest === '|' || rest === '>-' || rest === '>') {
      const blockLines: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j];
        if (nextLine.trim() === '') {
          blockLines.push(nextLine);
          continue;
        }
        const nextIndent = nextLine.match(/^(\s*)/)?.[1].length ?? 0;
        if (nextIndent > indent) {
          blockLines.push(nextLine);
          i = j;
        } else {
          break;
        }
      }
      blocks.push(blockLines.join('\n'));
    } else {
      blocks.push(rest);
    }
  }

  return blocks;
}

describe('Release Workflow CI Gating & Artifact Deduplication', () => {
  const ciWorkflow = readWorkflow('ci.yml');
  const publishWorkflow = readWorkflow('publish-artifact.yml');
  const deployWorkflow = readWorkflow('deploy.yml');
  const deployStageWorkflow = readWorkflow('deploy-stage.yml');
  const deployProviderWorkflow = readWorkflow('deploy-provider.yml');
  const migrateWorkflow = readWorkflow('db-migrate.yml');
  const rollbackWorkflow = readWorkflow('rollback.yml');

  it('triggers ci.yml once on main pushes, pull requests, and merge_group runs without duplicate v* tag runs while restricting deploy-docs to serialized main tip pushes', () => {
    expect(ciWorkflow).toContain('name: CI');
    const onSection = extractTopLevelSection(ciWorkflow, 'on');
    expect(onSection).toContain('push:');
    expect(onSection).toContain('branches: [ main ]');
    expect(onSection).not.toContain('tags:');
    expect(onSection).not.toContain("'v*'");
    expect(onSection).toContain('pull_request:');
    expect(onSection).toContain('merge_group:');
    expect(onSection).not.toContain('release:');
    expect(onSection).not.toContain('published');

    const ciConcurrency = extractTopLevelSection(ciWorkflow, 'concurrency');
    expect(ciConcurrency).toContain('group: ${{ github.workflow }}-${{ github.ref }}');
    expect(ciConcurrency).toContain(
      "cancel-in-progress: ${{ github.event_name == 'pull_request' || github.event_name == 'merge_group' }}"
    );
    expect(ciConcurrency).toContain('queue: max');

    const storybookWorkflow = readWorkflow('storybook.yml');
    const storybookConcurrency = extractTopLevelSection(storybookWorkflow, 'concurrency');
    expect(storybookConcurrency).toContain('group: storybook');
    expect(storybookConcurrency).toContain('cancel-in-progress: false');
    expect(storybookConcurrency).toContain('queue: max');

    for (const jobId of [
      'verify:',
      'doc-drift-comment:',
      'unit-test:',
      'build:',
      'container-arm64:',
      'storybook-build:',
      'static-export-build:',
      'e2e-test:',
      'a11y-report:',
      'pages-verify:',
      'ci-complete:',
      'prepare-docs:',
      'deploy-docs:',
    ]) {
      expect(ciWorkflow).toContain(`  ${jobId}`);
    }
    expect(ciWorkflow).not.toContain('  container-e2e-smoke:');
    expect(ciWorkflow).not.toContain('wedding-website-container');

    const ciJobs = parseWorkflowJobs(ciWorkflow);
    const verifyJobBlock = extractJobSection(ciWorkflow, 'verify');
    expect(verifyJobBlock).toMatch(/permissions:\n\s+contents: read\n/);
    expect(verifyJobBlock).not.toContain('pull-requests: write');
    expect(verifyJobBlock).not.toContain('issues: write');
    expect(verifyJobBlock).toContain('run: npm run check:static -- --skip-doc-sync --skip-action-pins');
    expect(verifyJobBlock).toContain('run: npm run check:action-pins -- --verify-upstream');
    expect(verifyJobBlock).toContain('name: docs-portal-static');

    const docDriftCommentBlock = extractJobSection(ciWorkflow, 'doc-drift-comment');
    expect(docDriftCommentBlock).toContain('needs: [verify]');
    expect(docDriftCommentBlock).toContain('pull-requests: write');
    expect(docDriftCommentBlock).toContain('issues: write');
    expect(docDriftCommentBlock).not.toContain('actions/checkout');
    expect(docDriftCommentBlock).not.toContain('npm ci');
    expect(ciJobs['prepare-docs']?.needs).toEqual([
      'verify',
      'ci-complete',
      'static-export-build',
      'storybook-build',
      'pages-verify',
    ]);
    expect(ciJobs['prepare-docs']?.if).toBe(
      "github.ref == 'refs/heads/main' && github.event_name == 'push'"
    );
    expect(ciJobs['prepare-docs']?.['runs-on']).toBe('ubuntu-latest');
    expect(ciJobs['prepare-docs']?.['timeout-minutes']).toBe(20);
    expect(ciJobs['prepare-docs']?.permissions).toEqual({ contents: 'read' });

    expect(ciJobs['deploy-docs']?.needs).toEqual([
      'ci-complete',
      'prepare-docs',
    ]);
    expect(ciJobs['deploy-docs']?.if).toBe(
      "github.ref == 'refs/heads/main' && github.event_name == 'push' && needs.prepare-docs.outputs.is_latest == 'true'"
    );
    expect(ciJobs['deploy-docs']?.['runs-on']).toBe('ubuntu-latest');
    expect(ciJobs['deploy-docs']?.['timeout-minutes']).toBe(10);
    expect(ciJobs['deploy-docs']?.permissions).toEqual({
      contents: 'read',
      pages: 'write',
      'id-token': 'write',
    });
    expect(ciJobs['deploy-docs']?.concurrency).toEqual({
      group: 'github-pages',
      'cancel-in-progress': false,
      queue: 'max',
    });
    expect(ciWorkflow).not.toContain("github.event_name == 'release'");
    const prepareDocsSection = extractJobSection(ciWorkflow, 'prepare-docs');
    const deployDocsSection = extractJobSection(ciWorkflow, 'deploy-docs');
    expect(prepareDocsSection).toContain('- name: Verify Main Branch Tip Freshness');
    expect(prepareDocsSection).toContain('fetch --depth=1 --no-tags origin +refs/heads/main:refs/remotes/origin/main');
    expect(prepareDocsSection).toContain("if: steps.freshness.outputs.is_latest == 'true'");
    expect(prepareDocsSection).not.toContain('pages: write');
    expect(prepareDocsSection).not.toContain('id-token: write');
    expect(deployDocsSection).not.toContain('actions/checkout');
    expect(deployDocsSection).not.toContain('npm ');
    expect(deployDocsSection).toContain('actions/deploy-pages@');
    expect(ciWorkflow).toContain('docs-portal/.vitepress/dist/index.html');
    expect(ciWorkflow).toContain('docs-portal/.vitepress/dist/demo/index.html');
    expect(ciWorkflow).toContain('docs-portal/.vitepress/dist/storybook/index.html');
    expect(ciWorkflow).toContain('docs-portal/.vitepress/dist/.nojekyll');
    expect(ciWorkflow).toContain('GITHUB_TOKEN: ${{ github.token }}');
    expect(ciWorkflow).toContain('run: npm run check:action-pins -- --verify-upstream');
    expect(ciWorkflow).not.toContain('secrets.');

    const trivyMatches =
      ciWorkflow.match(/aquasecurity\/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25/g) ?? [];
    expect(trivyMatches).toHaveLength(2);

    const buildSection = ciWorkflow.split(/\n  container-arm64:\n/)[0]?.split(/\n  build:\n/)[1] ?? '';
    const arm64Section = ciWorkflow.split(/\n  storybook-build:\n/)[0]?.split(/\n  container-arm64:\n/)[1] ?? '';
    for (const section of [buildSection, arm64Section]) {
      expect(section).toContain('aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25');
      expect(section).toContain('image-ref: wedding-website:latest');
      expect(section).toContain("ignore-unfixed: 'true'");
      expect(section).toContain("severity: 'CRITICAL,HIGH,MEDIUM'");
      expect(section).toContain("exit-code: '1'");
    }

    for (const runtimePath of ['src/env.ts', 'src/lib/stripe.ts', 'src/lib/stripe.client.ts']) {
      const source = fs.readFileSync(path.join(process.cwd(), runtimePath), 'utf8');
      expect(source).not.toMatch(/(?:sk|rk)_(?:test|live)_[0-9a-zA-Z_]{10,}/);
    }

    const staticExportJob = extractJobSection(ciWorkflow, 'static-export-build');
    expect(staticExportJob).toContain('needs: verify');
    expect(staticExportJob).toMatch(/permissions:\n\s+contents: read/);
    expect(staticExportJob).not.toContain('services:');
    expect(staticExportJob).toContain('path: .next-export/cache');
    expect(staticExportJob).toContain('npm run build:export');
    expect(staticExportJob).toContain('npm run test:e2e:static');
    expect(staticExportJob).toContain('name: static-a11y-violations');
    expect(staticExportJob).toContain('name: playwright-static-traces');
    expect(staticExportJob).toContain('path: test-results/playwright-static/');
    expect(staticExportJob).toContain('if: failure()');
    expect(staticExportJob).toContain('name: demo-static');
    expect(staticExportJob.indexOf('npm run test:e2e:static')).toBeLessThan(
      staticExportJob.indexOf('name: demo-static')
    );

    const a11yReportSection = extractJobSection(ciWorkflow, 'a11y-report');
    expect(ciJobs['a11y-report']?.needs).toEqual(['unit-test', 'e2e-test', 'static-export-build']);
    expect(ciJobs['a11y-report']?.if).toBe('always() && !cancelled()');
    expect(ciJobs['a11y-report']?.['timeout-minutes']).toBe(5);
    expect(ciJobs['a11y-report']?.permissions).toEqual({ contents: 'read' });
    expect(a11yReportSection).toContain('name: static-a11y-violations');
    expect(a11yReportSection).toContain(
      'node scripts/a11y-report.mjs --include-static --require-complete'
    );
    expect(a11yReportSection).toContain('name: a11y-summary');
    expect(a11yReportSection).not.toContain('actions/github-script');
    expect(a11yReportSection).toContain('Verify Upstream Accessibility Suite Jobs');

    const a11yReportCommentSection = extractJobSection(ciWorkflow, 'a11y-report-comment');
    expect(ciJobs['a11y-report-comment']?.needs).toEqual(['a11y-report']);
    expect(ciJobs['a11y-report-comment']?.['timeout-minutes']).toBe(5);
    expect(ciJobs['a11y-report-comment']?.permissions).toEqual({
      contents: 'read',
      'pull-requests': 'write',
      issues: 'write',
    });
    expect(a11yReportCommentSection).not.toContain('actions/checkout');
    expect(a11yReportCommentSection).not.toContain('npm ci');
    expect(a11yReportCommentSection).toContain('name: a11y-summary');
    expect(a11yReportCommentSection).toContain('actions/github-script');

    const pagesVerifySection = extractJobSection(ciWorkflow, 'pages-verify');
    expect(pagesVerifySection).toContain('needs: [verify, static-export-build, storybook-build]');
    expect(pagesVerifySection).toContain('run: npm ci --ignore-scripts');
    expect(pagesVerifySection).toContain('name: docs-portal-static');
    expect(pagesVerifySection).toContain('name: demo-static');
    expect(pagesVerifySection).toContain('name: storybook-static');
    expect(pagesVerifySection).toContain('run: npm run pages:verify');
    expect(pagesVerifySection).toContain('name: pages-bundle');

    const ciCompleteSection = extractJobSection(ciWorkflow, 'ci-complete');
    const expectedVerificationJobs = [
      'verify',
      'unit-test',
      'build',
      'container-arm64',
      'storybook-build',
      'static-export-build',
      'e2e-test',
      'a11y-report',
      'pages-verify',
    ];
    expect(ciJobs['ci-complete']?.needs).toEqual(expectedVerificationJobs);
    expect(ciJobs['ci-complete']?.if).toBe('always() && !cancelled()');
    expect(ciJobs['ci-complete']?.['runs-on']).toBe('ubuntu-latest');
    expect(ciJobs['ci-complete']?.['timeout-minutes']).toBe(5);
    expect(ciJobs['ci-complete']?.permissions).toEqual({ contents: 'read' });
    expect(ciCompleteSection).not.toContain('actions/checkout');
    expect(ciCompleteSection).not.toContain('npm ci');
    for (const gatedJob of expectedVerificationJobs) {
      expect(ciCompleteSection).toContain(`needs.${gatedJob}.result`);
    }

    expect(prepareDocsSection).toContain(
      "if: steps.freshness.outputs.is_latest == 'true' && steps.base-check.outputs.reuse_bundle == 'true'"
    );
    expect(prepareDocsSection).toContain('name: pages-bundle');
    expect(prepareDocsSection).toContain(
      "if: steps.freshness.outputs.is_latest == 'true' && steps.base-check.outputs.reuse_bundle != 'true'"
    );
    expect(prepareDocsSection).toContain("SKIP_DOC_SYNC: 'true'");

    // e2e-test does not depend on static-export-build so static export checks never delay Playwright runs
    expect(ciWorkflow).toMatch(/  e2e-test:\n\s+needs: \[verify, build\]\n/);
  });

  it('removes standalone main branch push trigger from publish-artifact.yml while retaining v* tags, workflow_dispatch, and workflow_call', () => {
    const onSection = extractTopLevelSection(publishWorkflow, 'on');
    expect(onSection).not.toContain('branches:');
    expect(onSection).not.toMatch(/-\s*main\b/);
    expect(onSection).toContain('tags:');
    expect(onSection).toContain("- 'v*'");
    expect(onSection).toContain('workflow_dispatch:');
    expect(onSection).toContain('workflow_call:');
    expect(onSection).toContain('commit_sha:');
  });

  it('scopes top-level permissions to contents: read and restricts write/actions/deployments permissions to individual jobs', () => {
    for (const [name, content] of [
      ['publish-artifact.yml', publishWorkflow],
      ['deploy.yml', deployWorkflow],
      ['deploy-stage.yml', deployStageWorkflow],
      ['deploy-provider.yml', deployProviderWorkflow],
      ['db-migrate.yml', migrateWorkflow],
      ['rollback.yml', rollbackWorkflow],
    ] as const) {
      const topPermissions = extractTopLevelSection(content, 'permissions');
      expect({ name, topPermissions }).toEqual({
        name,
        topPermissions: expect.stringMatching(/^permissions:\s*\n\s+contents:\s*read\s*$/),
      });
    }

    const preflightJobSection = extractJobSection(publishWorkflow, 'preflight');
    const buildJobSection = extractJobSection(publishWorkflow, 'build');
    const uploadSarifJobSection = extractJobSection(publishWorkflow, 'upload-sarif');
    const publishJobSection = extractJobSection(publishWorkflow, 'publish');

    // Job preflight scopes strictly read-only permissions (contents, actions, packages, attestations) with zero write scopes
    expect(preflightJobSection).toMatch(
      /permissions:\n\s+contents: read\n\s+actions: read\n\s+packages: read\n\s+attestations: read/
    );
    expect(preflightJobSection).not.toContain(': write');
    expect(publishWorkflow.match(/actions:\s*read/g) ?? []).toHaveLength(1);

    // Job build retains strictly contents: read (dropping security-events: write), with zero registry credentials
    expect(buildJobSection).toMatch(
      /permissions:\n\s+contents: read\n\s+strategy:/
    );
    expect(buildJobSection).not.toContain('security-events: write');
    expect(buildJobSection).not.toContain('packages: write');
    expect(buildJobSection).not.toContain('id-token: write');
    expect(buildJobSection).not.toContain('attestations: write');
    expect(buildJobSection).not.toContain('docker/login-action');
    expect(buildJobSection).not.toContain('DOCKERHUB_USERNAME');
    expect(buildJobSection).not.toContain('DOCKERHUB_TOKEN');

    // Job upload-sarif is checkout-free and holds only contents: read + security-events: write
    expect(uploadSarifJobSection).toMatch(
      /permissions:\n\s+contents: read\n\s+security-events: write/
    );
    expect(uploadSarifJobSection).not.toContain('actions/checkout');
    expect(uploadSarifJobSection).not.toContain('npm ');
    expect(uploadSarifJobSection).not.toContain('scripts/');

    // Job publish is checkout-free and scopes registry write + OIDC provenance signing without security-events: write
    expect(publishJobSection).toMatch(
      /permissions:\n\s+contents: read\n\s+packages: write\n\s+id-token: write\n\s+attestations: write\n\s+outputs:/
    );
    expect(publishJobSection).not.toContain('security-events: write');
    expect(publishJobSection).not.toContain('actions/checkout');
    expect(publishJobSection).not.toContain('npm ');
    expect(publishJobSection).not.toContain('scripts/');

    // Caller deploy.yml retains union of callee-required permissions for publish-artifact workflow_call
    expect(deployWorkflow).toMatch(
      /publish-artifact:\n[\s\S]*?permissions:\n\s+contents: read\n\s+actions: read\n\s+packages: write\n\s+security-events: write\n\s+id-token: write\n\s+attestations: write/
    );

    // actions: read and deployments: write in deploy.yml and deploy-stage.yml live strictly inside individual jobs (never top-level)
    const actionsReadMatches = deployWorkflow.match(/actions:\s*read/g) ?? [];
    expect(actionsReadMatches).toHaveLength(4);
    expect(deployStageWorkflow.match(/actions:\s*read/g) ?? []).toHaveLength(2);
    expect(deployWorkflow).toMatch(
      /ci-gate:[\s\S]*?permissions:\n\s+actions: read\n\s+contents: read\n\s+packages: read\n\s+attestations: read/
    );
    const schemaJobChunk = deployWorkflow.split('  schema-compatibility:\n')[1]?.split(/\n  [a-z-]+:\n/)[0] ?? '';
    expect(schemaJobChunk).not.toContain('actions: read');
    const verifyJobChunk = deployStageWorkflow.split('  verify-deployment:\n')[1]?.split(/\n  [a-z-]+:\n/)[0] ?? '';
    expect(verifyJobChunk).not.toContain('actions: read');
    expect(deployWorkflow.match(/deployments:\s*write/g) ?? []).toHaveLength(2);
    expect(deployStageWorkflow.match(/deployments:\s*write/g) ?? []).toHaveLength(2);
    expect(deployProviderWorkflow.match(/deployments:\s*write/g) ?? []).toHaveLength(1);
    expect(rollbackWorkflow.match(/deployments:\s*write/g) ?? []).toHaveLength(1);
    expect(deployProviderWorkflow).toMatch(
      /deploy:[\s\S]*?permissions:\n\s+actions: read\n\s+contents: read\n\s+packages: read\n\s+attestations: read\n\s+deployments: write\n\s+id-token: write/
    );

    // Shared release concurrency group prevents v* tag and main runs from racing on :latest or BuildKit caches
    const publishConcurrency = extractTopLevelSection(publishWorkflow, 'concurrency');
    expect(publishConcurrency).toContain('group: publish-artifact-release');
    expect(publishConcurrency).toContain('cancel-in-progress: false');
    expect(publishConcurrency).toContain('queue: max');
    expect(publishConcurrency).not.toContain('github.ref');

    // deploy.yml omits workflow-root concurrency while deploy-stage.yml scopes FIFO concurrency per environment
    expect(extractTopLevelSection(deployWorkflow, 'concurrency')).toBe('');
    const deployStageConcurrency = extractTopLevelSection(deployStageWorkflow, 'concurrency');
    expect(deployStageConcurrency).toContain('group: deploy-env-${{ inputs.environment }}');
    expect(deployStageConcurrency).toContain('cancel-in-progress: false');
    expect(deployStageConcurrency).toContain('queue: max');
  });

  it('triggers deploy.yml via workflow_run on CI completion for main instead of push', () => {
    const onSection = extractTopLevelSection(deployWorkflow, 'on');
    expect(onSection).not.toContain('push:');
    expect(onSection).toContain('workflow_run:');
    expect(onSection).toContain('- CI');
    expect(onSection).toContain('- completed');
    expect(onSection).toContain('- main');
    expect(onSection).toContain('workflow_dispatch:');
    expect(onSection).toContain('workflow_call:');
  });

  it('gates workflow_run on conclusion == success, event == push, and head_repository.full_name == github.repository', () => {
    expect(deployWorkflow).not.toContain("github.event_name == 'push'");

    const requiredChecks = [
      "github.event_name == 'workflow_run'",
      "github.event.workflow_run.conclusion == 'success'",
      "github.event.workflow_run.event == 'push'",
      'github.event.workflow_run.head_repository.full_name == github.repository',
    ];

    for (const check of requiredChecks) {
      expect(deployWorkflow).toContain(check);
    }

    // Staging and production stage jobs recognize successful workflow_run events alongside manual inputs
    expect(deployWorkflow).toMatch(
      /staging:[\s\S]*?github\.event\.workflow_run\.conclusion == 'success'[\s\S]*?inputs\.environment == 'staging'[\s\S]*?uses:\s*\.\/\.github\/workflows\/deploy-stage\.yml/
    );
    expect(deployWorkflow).toMatch(
      /production:[\s\S]*?github\.event\.workflow_run\.conclusion == 'success'[\s\S]*?inputs\.environment == 'production'[\s\S]*?uses:\s*\.\/\.github\/workflows\/deploy-stage\.yml/
    );
  });

  it('verifies a completed successful CI run for target_sha on workflow_dispatch and workflow_call and propagates resolved target_sha', () => {
    // Preflight gate checks ci.yml runs for targetSha on manual/reusable invocations
    expect(deployWorkflow).toContain("workflow_id: 'ci.yml'");
    expect(deployWorkflow).toContain('WORKFLOW_RUN_HEAD_SHA: ${{ github.event.workflow_run.head_sha }}');
    expect(deployWorkflow).toContain('CURRENT_SHA: ${{ github.sha }}');
    expect(deployWorkflow).toContain('RELEASE_REF: ${{ inputs.release_ref }}');
    expect(deployWorkflow).toContain('INPUT_IMAGE_DIGEST: ${{ inputs.image_digest }}');

    // Resolved SHA aligned in schema-compatibility on workflow_run or non-HEAD target_sha after ancestry check and passed to workflow calls
    expect(deployWorkflow).not.toContain('ref: ${{ needs.ci-gate.outputs.target_sha }}');
    expect(deployWorkflow).toMatch(
      /schema-compatibility:[\s\S]*?fetch-depth:\s*0[\s\S]*?if:\s*github\.event_name == 'workflow_run' \|\| inputs\.image_tag != '' \|\| inputs\.release_ref != '' \|\| inputs\.image_digest != '' \|\| needs\.ci-gate\.outputs\.target_sha != github\.sha[\s\S]*?TARGET_SHA:\s*\$\{\{\s*needs\.ci-gate\.outputs\.target_sha\s*\}\}[\s\S]*?git merge-base --is-ancestor "\$TARGET_SHA" HEAD[\s\S]*?git checkout --detach "\$TARGET_SHA"/
    );
    expect(deployWorkflow).toContain('commit_sha: ${{ needs.ci-gate.outputs.target_sha }}');
    expect(
      deployWorkflow.match(/commit_sha:\s*\$\{\{\s*needs\.ci-gate\.outputs\.target_sha\s*\}\}/g) ?? []
    ).toHaveLength(3);
    expect(deployWorkflow).toMatch(
      /staging:[\s\S]*?commit_sha:\s*\$\{\{\s*needs\.ci-gate\.outputs\.target_sha\s*\}\}/
    );
    expect(deployWorkflow).toMatch(
      /production:[\s\S]*?commit_sha:\s*\$\{\{\s*needs\.ci-gate\.outputs\.target_sha\s*\}\}/
    );
    expect(
      deployStageWorkflow.match(/commit_sha:\s*\$\{\{\s*inputs\.commit_sha\s*\}\}/g) ?? []
    ).toHaveLength(3);
    expect(deployStageWorkflow).toMatch(
      /database-migration:[\s\S]*?commit_sha:\s*\$\{\{\s*inputs\.commit_sha\s*\}\}/
    );
    expect(deployStageWorkflow).toMatch(
      /deploy-provider:[\s\S]*?commit_sha:\s*\$\{\{\s*inputs\.commit_sha\s*\}\}/
    );
    expect(deployStageWorkflow).toMatch(
      /rollback:[\s\S]*?needs:\s*\[deploy-provider,\s*verify-deployment\][\s\S]*?commit_sha:\s*\$\{\{\s*inputs\.commit_sha\s*\}\}/
    );
    expect(deployWorkflow).toContain('tag_name: ${{ needs.ci-gate.outputs.target_sha }}');
    expect(deployWorkflow).not.toContain('|| github.sha');

    expect(publishWorkflow).not.toContain('ref: ${{ inputs.commit_sha }}');
    expect(publishWorkflow).toContain('fetch-depth: 0');
    expect(publishWorkflow).toContain('INPUT_COMMIT_SHA: ${{ inputs.commit_sha }}');
    expect(publishWorkflow).toContain('RESOLVED_SHA: ${{ needs.preflight.outputs.resolved_sha }}');
    expect(publishWorkflow).toContain('git checkout --detach "$RESOLVED_SHA"');
    expect(publishWorkflow).toContain('org.opencontainers.image.revision=${{ needs.preflight.outputs.revision }}');
    expect(migrateWorkflow).toContain('ref: ${{ inputs.commit_sha }}');
    expect(migrateWorkflow).toContain('INPUT_COMMIT_SHA: ${{ inputs.commit_sha }}');
    expect(migrateWorkflow).toContain('fetch-depth: 0');
    expect(deployProviderWorkflow).toContain('ref: ${{ inputs.commit_sha }}');
    expect(deployProviderWorkflow).toContain('fetch-depth: 0');
    expect(deployProviderWorkflow).toContain('CURRENT_SHA: ${{ inputs.commit_sha || github.sha }}');
    expect(rollbackWorkflow).not.toContain('ref: ${{ inputs.commit_sha }}');
    expect(rollbackWorkflow).toContain('INPUT_COMMIT_SHA: ${{ inputs.commit_sha }}');
    expect(rollbackWorkflow).toContain('git checkout "$INPUT_COMMIT_SHA" -- prisma/migrations');
    expect(rollbackWorkflow).toContain('CURRENT_SHA: ${{ inputs.commit_sha || github.sha }}');
    const redeployChunk = rollbackWorkflow.split('  redeploy:\n')[1]?.split('\n  verify:\n')[0] ?? '';
    expect(redeployChunk).toContain('uses: ./.github/workflows/deploy-provider.yml');
    expect(redeployChunk).not.toContain('commit_sha:');
  });

  it('polls active ci.yml runs in publish-artifact.yml and blocks builds and provenance signing when CI has not passed', async () => {
    expect(publishWorkflow).toMatch(/build:\n\s+name:[^\n]+\n\s+needs:\s*\[preflight\]/);
    const runBlocks = extractRunBlocks(publishWorkflow);
    const pollCiScript = runBlocks.find((block) =>
      block.includes('actions/workflows/ci.yml/runs?head_sha=')
    );
    expect(pollCiScript).toBeDefined();

    const targetSha = 'abcdef0123456789abcdef0123456789abcdef01';
    let runsResponse: Array<Record<string, unknown>> = [];
    let onRequest: (() => void) | null = null;

    const server = http.createServer((req, res) => {
      if (req.url?.startsWith('/repos/fderuiter/wedding_website/actions/workflows/ci.yml/runs')) {
        if (onRequest) {
          onRequest();
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ workflow_runs: runsResponse }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const apiBase = `http://127.0.0.1:${port}`;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-ci-gate-'));

    const execGate = (envOverrides: Record<string, string>) =>
      new Promise<{ status: number | null; stdout: string; stderr: string; summary: string }>(
        (resolve, reject) => {
          const summaryPath = path.join(tempDir, `summary-${Math.random().toString(36).slice(2)}.md`);
          fs.writeFileSync(summaryPath, '');
          const child = spawn('bash', ['-eo', 'pipefail', '-c', pollCiScript!], {
            cwd: tempDir,
            env: {
              ...process.env,
              GITHUB_API_URL: apiBase,
              GITHUB_REPOSITORY: 'fderuiter/wedding_website',
              GITHUB_STEP_SUMMARY: summaryPath,
              GH_TOKEN: 'ghs_test_token',
              RESOLVED_SHA: targetSha,
              EVENT_NAME: 'workflow_dispatch',
              CI_POLL_INTERVAL_SECONDS: '1',
              CI_POLL_TIMEOUT_SECONDS: '5',
              CI_INITIAL_GRACE_SECONDS: '0',
              ...envOverrides,
            },
          });
          let stdout = '';
          let stderr = '';
          child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
          });
          child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
          });
          child.on('error', reject);
          child.on('close', (code) => {
            resolve({
              status: code,
              stdout,
              stderr,
              summary: fs.readFileSync(summaryPath, 'utf8'),
            });
          });
        }
      );

    try {
      // 1. Fails closed immediately when no passing CI run exists
      runsResponse = [];
      const missingRes = await execGate({});
      expect(missingRes.status).not.toBe(0);
      expect(missingRes.stdout + missingRes.stderr).toContain('No completed successful ci.yml workflow run found');

      // 2. Fails closed when only fork or failed runs exist
      runsResponse = [
        {
          id: 101,
          head_sha: targetSha,
          status: 'completed',
          conclusion: 'success',
          head_repository: { full_name: 'attacker/wedding_website' },
        },
        {
          id: 102,
          head_sha: targetSha,
          status: 'completed',
          conclusion: 'failure',
          head_repository: { full_name: 'fderuiter/wedding_website' },
        },
      ];
      const failedRes = await execGate({});
      expect(failedRes.status).not.toBe(0);

      // 3. Polls active ci.yml run on tag push until completed with success
      let pollCalls = 0;
      onRequest = () => {
        pollCalls += 1;
        if (pollCalls === 1) {
          runsResponse = [
            {
              id: 205,
              head_sha: targetSha,
              status: 'in_progress',
              conclusion: null,
              head_repository: { full_name: 'fderuiter/wedding_website' },
            },
          ];
        } else {
          runsResponse = [
            {
              id: 205,
              head_sha: targetSha,
              status: 'completed',
              conclusion: 'success',
              head_repository: { full_name: 'fderuiter/wedding_website' },
            },
          ];
        }
      };
      const polledPassRes = await execGate({ EVENT_NAME: 'push' });
      expect(polledPassRes.status).toBe(0);
      expect(pollCalls).toBeGreaterThanOrEqual(2);
      expect(polledPassRes.summary).toContain('**Verified CI Run ID:** `205`');

      // 4. Polls active ci.yml run and blocks when active run finishes with failure even if an older run succeeded
      let activeFailPolls = 0;
      onRequest = () => {
        activeFailPolls += 1;
        if (activeFailPolls === 1) {
          runsResponse = [
            {
              id: 301,
              head_sha: targetSha,
              status: 'queued',
              conclusion: null,
              head_repository: { full_name: 'fderuiter/wedding_website' },
            },
            {
              id: 200,
              head_sha: targetSha,
              status: 'completed',
              conclusion: 'success',
              head_repository: { full_name: 'fderuiter/wedding_website' },
            },
          ];
        } else {
          runsResponse = [
            {
              id: 301,
              head_sha: targetSha,
              status: 'completed',
              conclusion: 'failure',
              head_repository: { full_name: 'fderuiter/wedding_website' },
            },
            {
              id: 200,
              head_sha: targetSha,
              status: 'completed',
              conclusion: 'success',
              head_repository: { full_name: 'fderuiter/wedding_website' },
            },
          ];
        }
      };
      const polledFailRes = await execGate({ EVENT_NAME: 'push' });
      expect(polledFailRes.status).not.toBe(0);
      expect(polledFailRes.stdout + polledFailRes.stderr).toContain('completed without success');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('passes event fields and inputs via env variables with zero direct ${{ ... }} interpolation in run scripts', () => {
    for (const [name, content] of [
      ['deploy.yml', deployWorkflow],
      ['deploy-stage.yml', deployStageWorkflow],
      ['publish-artifact.yml', publishWorkflow],
      ['db-migrate.yml', migrateWorkflow],
      ['deploy-provider.yml', deployProviderWorkflow],
      ['rollback.yml', rollbackWorkflow],
    ] as const) {
      const runBlocks = extractRunBlocks(content);
      expect(runBlocks.length).toBeGreaterThan(0);
      for (const block of runBlocks) {
        expect({ name, hasDirectInterpolation: /\$\{\{[\s\S]*?\}\}/.test(block) }).toEqual({
          name,
          hasDirectInterpolation: false,
        });
      }
    }
  });

  it('enforces SemVer :latest comparison across GHCR and Docker Hub while omitting :latest on manual dispatches, main builds, pre-releases, and N-1 tags', () => {
    const runBlocks = extractRunBlocks(publishWorkflow);
    const computeTagScripts = runBlocks.filter((block) => block.includes('primary_uri='));
    expect(computeTagScripts).toHaveLength(1);

    const tempOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-tag-test-'));
    const repoDir = path.join(tempOutDir, 'repo');
    const outputFile = path.join(tempOutDir, 'github_output.txt');
    const sampleSha = '0123456789abcdef0123456789abcdef01234567';

    const runComputeMeta = (script: string, envOverrides: Record<string, string>) => {
      fs.writeFileSync(outputFile, '');
      const res = spawnSync('bash', ['-eo', 'pipefail', '-c', script], {
        cwd: repoDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_OUTPUT: outputFile,
          REGISTRY: 'ghcr.io',
          GITHUB_REPOSITORY: 'fderuiter/wedding_website',
          GITHUB_SHA: sampleSha,
          EVENT_NAME: 'push',
          RAW_INPUT_TAG: '',
          INPUT_COMMIT_SHA: '',
          DOCKERHUB_USERNAME: 'fderuiter',
          DOCKERHUB_TOKEN: 'dckr_pat_test',
          ...envOverrides,
        },
      });
      expect(res.status).toBe(0);
      return fs.readFileSync(outputFile, 'utf8');
    };

    try {
      fs.mkdirSync(repoDir, { recursive: true });
      execFileSync('git', ['init', '-b', 'main'], { cwd: repoDir, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repoDir, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir, stdio: 'ignore' });
      fs.writeFileSync(path.join(repoDir, 'README.md'), 'init\n');
      execFileSync('git', ['add', 'README.md'], { cwd: repoDir, stdio: 'ignore' });
      execFileSync('git', ['commit', '-m', 'initial'], { cwd: repoDir, stdio: 'ignore' });

      for (const computeTagScript of computeTagScripts) {
        // Clear any tags from previous loop iteration
        const existingTags = execFileSync('git', ['tag', '-l'], { cwd: repoDir, encoding: 'utf8' })
          .split(/\r?\n/)
          .filter(Boolean);
        for (const t of existingTags) {
          execFileSync('git', ['tag', '-d', t], { cwd: repoDir, stdio: 'ignore' });
        }

        // 1. First stable v0.1.0 tag push publishes version, SHA, and :latest across registries
        execFileSync('git', ['tag', 'v0.1.0'], { cwd: repoDir, stdio: 'ignore' });
        const initialOutputs = runComputeMeta(computeTagScript, {
          GITHUB_REPOSITORY: 'FdeRuiter/Wedding_Website',
          GITHUB_REF: 'refs/tags/v0.1.0',
          GITHUB_REF_NAME: 'v0.1.0',
        });
        expect(initialOutputs).toContain('tag_name=v0.1.0');
        expect(initialOutputs).toContain('primary_uri=ghcr.io/fderuiter/wedding_website:v0.1.0');
        expect(initialOutputs).toContain(
          `tags=ghcr.io/fderuiter/wedding_website:v0.1.0,ghcr.io/fderuiter/wedding_website:${sampleSha},ghcr.io/fderuiter/wedding_website:latest,fderuiter/wedding-website:v0.1.0,fderuiter/wedding-website:${sampleSha},fderuiter/wedding-website:latest`
        );

        // 2. Pre-release v* tag publishes version + SHA without overwriting :latest on either registry
        execFileSync('git', ['tag', 'v0.2.0-rc.1'], { cwd: repoDir, stdio: 'ignore' });
        const preReleaseOutputs = runComputeMeta(computeTagScript, {
          GITHUB_REF: 'refs/tags/v0.2.0-rc.1',
          GITHUB_REF_NAME: 'v0.2.0-rc.1',
        });
        expect(preReleaseOutputs).toContain(
          `tags=ghcr.io/fderuiter/wedding_website:v0.2.0-rc.1,ghcr.io/fderuiter/wedding_website:${sampleSha},fderuiter/wedding-website:v0.2.0-rc.1,fderuiter/wedding-website:${sampleSha}`
        );
        expect(preReleaseOutputs).not.toContain(':latest');

        // 3. Maintenance N-1 patch tag v1.4.3 when v2.0.0 already exists omits :latest on GHCR and Docker Hub
        execFileSync('git', ['tag', 'v2.0.0'], { cwd: repoDir, stdio: 'ignore' });
        execFileSync('git', ['tag', 'v1.4.3'], { cwd: repoDir, stdio: 'ignore' });
        const maintenanceOutputs = runComputeMeta(computeTagScript, {
          GITHUB_REF: 'refs/tags/v1.4.3',
          GITHUB_REF_NAME: 'v1.4.3',
        });
        expect(maintenanceOutputs).toContain('tag_name=v1.4.3');
        expect(maintenanceOutputs).toContain(
          `tags=ghcr.io/fderuiter/wedding_website:v1.4.3,ghcr.io/fderuiter/wedding_website:${sampleSha},fderuiter/wedding-website:v1.4.3,fderuiter/wedding-website:${sampleSha}`
        );
        expect(maintenanceOutputs).not.toContain(':latest');

        // 4. Pushing v2.1.0 when v2.0.0 and pre-release v2.2.0-rc.1 exist updates :latest on GHCR and Docker Hub
        execFileSync('git', ['tag', 'v2.2.0-rc.1'], { cwd: repoDir, stdio: 'ignore' });
        execFileSync('git', ['tag', 'v2.1.0'], { cwd: repoDir, stdio: 'ignore' });
        const highestStableOutputs = runComputeMeta(computeTagScript, {
          GITHUB_REF: 'refs/tags/v2.1.0',
          GITHUB_REF_NAME: 'v2.1.0',
        });
        expect(highestStableOutputs).toContain(
          `tags=ghcr.io/fderuiter/wedding_website:v2.1.0,ghcr.io/fderuiter/wedding_website:${sampleSha},ghcr.io/fderuiter/wedding_website:latest,fderuiter/wedding-website:v2.1.0,fderuiter/wedding-website:${sampleSha},fderuiter/wedding-website:latest`
        );

        // 5. Default-branch build without version tag and manual workflow_dispatch runs never publish :latest
        const mainUntaggedOutputs = runComputeMeta(computeTagScript, {
          EVENT_NAME: 'push',
          GITHUB_REF: 'refs/heads/main',
          GITHUB_REF_NAME: 'main',
        });
        expect(mainUntaggedOutputs).toContain(
          `tags=ghcr.io/fderuiter/wedding_website:${sampleSha},fderuiter/wedding-website:${sampleSha}`
        );
        expect(mainUntaggedOutputs).not.toContain(':latest');

        const manualMainDispatchOutputs = runComputeMeta(computeTagScript, {
          EVENT_NAME: 'workflow_dispatch',
          GITHUB_REF: 'refs/heads/main',
          GITHUB_REF_NAME: 'main',
          INPUT_COMMIT_SHA: sampleSha,
        });
        expect(manualMainDispatchOutputs).toContain(
          `tags=ghcr.io/fderuiter/wedding_website:${sampleSha},fderuiter/wedding-website:${sampleSha}`
        );
        expect(manualMainDispatchOutputs).not.toContain(':latest');

        const manualTagRefDispatchOutputs = runComputeMeta(computeTagScript, {
          EVENT_NAME: 'workflow_dispatch',
          GITHUB_REF: 'refs/tags/v2.1.0',
          GITHUB_REF_NAME: 'v2.1.0',
          INPUT_COMMIT_SHA: sampleSha,
        });
        expect(manualTagRefDispatchOutputs).not.toContain(':latest');

        // 6. Feature branch dispatch and workflow_call with explicit SHA never publish :latest
        const branchOutputs = runComputeMeta(computeTagScript, {
          EVENT_NAME: 'workflow_dispatch',
          GITHUB_REF: 'refs/heads/feature/test-branch',
          GITHUB_REF_NAME: 'feature/test-branch',
        });
        expect(branchOutputs).toContain(
          `tags=ghcr.io/fderuiter/wedding_website:${sampleSha},fderuiter/wedding-website:${sampleSha}`
        );
        expect(branchOutputs).not.toContain(':latest');

        // Verify manual workflow_dispatch on main with explicit commit_sha (empty tag_name) publishes ONLY the SHA tag and never overwrites :latest
        const manualCommitShaOutputs = runComputeMeta(computeTagScript, {
          EVENT_NAME: 'workflow_dispatch',
          GITHUB_SHA: 'ffffffffffffffffffffffffffffffffffffffff',
          GITHUB_REF: 'refs/heads/main',
          GITHUB_REF_NAME: 'main',
          RAW_INPUT_TAG: '',
          INPUT_COMMIT_SHA: sampleSha,
        });
        expect(manualCommitShaOutputs).toContain(`tag_name=${sampleSha}`);
        expect(manualCommitShaOutputs).toContain(
          `tags=ghcr.io/fderuiter/wedding_website:${sampleSha},fderuiter/wedding-website:${sampleSha}`
        );
        expect(manualCommitShaOutputs).not.toContain(':latest');

        // Verify manual workflow_dispatch on main with explicit commit_sha and custom tag_name publishes custom + SHA tags and never :latest
        const manualCustomTagOutputs = runComputeMeta(computeTagScript, {
          EVENT_NAME: 'workflow_dispatch',
          GITHUB_SHA: 'ffffffffffffffffffffffffffffffffffffffff',
          GITHUB_REF: 'refs/heads/main',
          GITHUB_REF_NAME: 'main',
          RAW_INPUT_TAG: 'hotfix-20261122',
          INPUT_COMMIT_SHA: sampleSha,
        });
        expect(manualCustomTagOutputs).toContain('tag_name=hotfix-20261122');
        expect(manualCustomTagOutputs).toContain(
          `tags=ghcr.io/fderuiter/wedding_website:hotfix-20261122,ghcr.io/fderuiter/wedding_website:${sampleSha},fderuiter/wedding-website:hotfix-20261122,fderuiter/wedding-website:${sampleSha}`
        );
        expect(manualCustomTagOutputs).not.toContain(':latest');

        // Verify workflow_call with explicit commit SHA tag publishes only the SHA tag
        const shaOutputs = runComputeMeta(computeTagScript, {
          EVENT_NAME: 'workflow_call',
          GITHUB_SHA: sampleSha,
          GITHUB_REF: 'refs/heads/main',
          GITHUB_REF_NAME: 'main',
          RAW_INPUT_TAG: sampleSha,
          INPUT_COMMIT_SHA: sampleSha,
        });
        expect(shaOutputs).toContain(`tag_name=${sampleSha}`);
        expect(shaOutputs).toContain(
          `tags=ghcr.io/fderuiter/wedding_website:${sampleSha},fderuiter/wedding-website:${sampleSha}`
        );
        expect(shaOutputs).not.toContain(':latest');
      }
    } finally {
      fs.rmSync(tempOutDir, { recursive: true, force: true });
    }
  });

  it('builds, Trivy-scans, and smoke-tests native amd64 and arm64 OCI archives once without registry credentials before verifying and publishing provenance-attested multi-platform indexes', () => {
    expect(publishWorkflow).not.toContain('setup-qemu-action');
    expect(publishWorkflow).toContain('runner: ubuntu-latest');
    expect(publishWorkflow).toContain('runner: ubuntu-24.04-arm');
    expect(publishWorkflow).toContain('platform: linux/amd64');
    expect(publishWorkflow).toContain('platform: linux/arm64');
    expect(publishWorkflow).toContain('cache-from: type=gha,scope=release-app-${{ matrix.arch }}');
    expect(publishWorkflow).toContain(
      'cache-to: type=gha,scope=release-app-${{ matrix.arch }},mode=max'
    );
    expect(publishWorkflow).toContain('GHA_CACHE_SCOPE: release-app-${{ matrix.arch }}');
    expect(publishWorkflow).not.toContain('scope=app-');
    expect(publishWorkflow).toContain('actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9');
    expect(publishWorkflow).toContain('key: release-buildkit-deps-${{ matrix.arch }}-');
    expect(publishWorkflow).toContain('key: release-buildkit-next-${{ matrix.arch }}-');
    expect(publishWorkflow).not.toContain('restore-keys');
    expect(publishWorkflow).toContain('--no-same-owner --no-same-permissions');
    expect(publishWorkflow).toContain('validate_cache_archive');
    for (const mountTarget of ['/var/cache/apt', '/var/lib/apt', '/root/.npm', '/app/.next/cache']) {
      expect(publishWorkflow).toContain(`target=${mountTarget}`);
    }

    // Verify build job depends on preflight, compiles once as an OCI archive with provenance: false & sbom: false, loads wedding-website:latest, scans, smoke-tests, and uploads zstd archive without registry login
    expect(publishWorkflow.match(/uses:\s*docker\/build-push-action@/g)).toHaveLength(1);
    const buildJobSection = extractJobSection(publishWorkflow, 'build');
    const uploadSarifJobSection = extractJobSection(publishWorkflow, 'upload-sarif');
    expect(buildJobSection).toContain('needs: [preflight]');
    expect(buildJobSection).toContain("if: needs.preflight.outputs.promote_existing != 'true'");
    expect(buildJobSection.match(/uses:\s*docker\/build-push-action@/g)).toHaveLength(1);
    expect(buildJobSection).toContain('provenance: false');
    expect(buildJobSection).toContain('sbom: false');
    expect(buildJobSection).toContain('org.opencontainers.image.revision=${{ needs.preflight.outputs.revision }}');
    expect(buildJobSection).toContain(
      'manifest:org.opencontainers.image.revision=${{ needs.preflight.outputs.revision }}'
    );
    expect(buildJobSection).toContain('outputs: type=oci,dest=/tmp/oci-${{ matrix.arch }}.tar');
    expect(buildJobSection).not.toContain('push-by-digest=true');
    expect(buildJobSection).not.toContain('docker/login-action');
    expect(buildJobSection).not.toContain('github/codeql-action/upload-sarif');

    const buildArchiveIdx = buildJobSection.indexOf('outputs: type=oci,dest=/tmp/oci-${{ matrix.arch }}.tar');
    const loadDaemonIdx = buildJobSection.indexOf('skopeo copy "oci-archive:${OCI_TAR}" "docker-daemon:wedding-website:latest"');
    const trivyIdx = buildJobSection.indexOf('aquasecurity/trivy-action');
    const sarifArtifactIdx = buildJobSection.indexOf('name: trivy-sarif-${{ matrix.arch }}');
    const smokeIdx = buildJobSection.indexOf('node scripts/test-container.mjs');
    const compressIdx = buildJobSection.indexOf('zstd -T0 -f "$OCI_TAR"');
    const uploadArtifactIdx = buildJobSection.indexOf('name: oci-archive-${{ matrix.arch }}');

    expect(buildArchiveIdx).toBeGreaterThan(-1);
    expect(loadDaemonIdx).toBeGreaterThan(buildArchiveIdx);
    expect(trivyIdx).toBeGreaterThan(loadDaemonIdx);
    expect(sarifArtifactIdx).toBeGreaterThan(trivyIdx);
    expect(smokeIdx).toBeGreaterThan(sarifArtifactIdx);
    expect(compressIdx).toBeGreaterThan(smokeIdx);
    expect(uploadArtifactIdx).toBeGreaterThan(compressIdx);

    expect(buildJobSection).toContain('image-ref: wedding-website:latest');
    expect(buildJobSection).toContain("ignore-unfixed: 'true'");
    expect(buildJobSection).toContain("severity: 'CRITICAL,HIGH,MEDIUM'");
    expect(buildJobSection).toContain("exit-code: '1'");
    expect(buildJobSection).toContain("format: 'spdx-json'");
    expect(buildJobSection).toContain("output: 'sbom-${{ matrix.arch }}.spdx.json'");
    expect(buildJobSection).toContain('compression-level: 0');

    expect(uploadSarifJobSection).toContain('needs: [preflight, build]');
    expect(uploadSarifJobSection).toContain('github/codeql-action/upload-sarif');
    expect(uploadSarifJobSection).toContain("category: 'trivy-${{ matrix.arch }}'");
    expect(uploadSarifJobSection).not.toContain('actions/checkout');

    // Verify publish job step ordering: download -> verify SBOMs -> scoped DOCKER_CONFIG -> login -> skopeo inspect & copy --preserve-digests -> merge -> index SBOM -> v4.2.2 per-arch & index provenance + SPDX SBOM attestations -> DOCKER_CONFIG cleanup
    const publishJobSection = extractJobSection(publishWorkflow, 'publish');
    expect(publishJobSection).toContain('needs: [preflight, build]');
    expect(publishJobSection).toContain(
      "(needs.build.result == 'success' || (needs.preflight.outputs.promote_existing == 'true' && needs.build.result == 'skipped'))"
    );

    const downloadIdx = publishJobSection.indexOf('actions/download-artifact@');
    const verifySbomIdx = publishJobSection.indexOf('- name: Verify Per-Architecture SPDX SBOM Artifacts');
    const createScopedConfigIdx = publishJobSection.indexOf('- name: Create Scoped Registry Auth Directory');
    const ghcrLoginIdx = publishJobSection.indexOf('registry: ghcr.io');
    const skopeoInspectIdx = publishJobSection.indexOf("skopeo inspect --format '{{.Digest}}'");
    const skopeoCopyIdx = publishJobSection.indexOf('skopeo copy --preserve-digests', skopeoInspectIdx);
    const mergeIdx = publishJobSection.indexOf('docker buildx imagetools create');
    const indexSbomIdx = publishJobSection.indexOf('- name: Generate Multi-Platform Index SPDX SBOM');
    const primaryAmd64AttestIdx = publishJobSection.indexOf('- name: Attest amd64 Build Provenance');
    const primaryArm64AttestIdx = publishJobSection.indexOf('- name: Attest arm64 Build Provenance');
    const primaryAttestIdx = publishJobSection.indexOf('- name: Attest Build Provenance');
    const primaryAmd64SbomIdx = publishJobSection.indexOf('- name: Attest amd64 SPDX SBOM');
    const primaryArm64SbomIdx = publishJobSection.indexOf('- name: Attest arm64 SPDX SBOM');
    const primaryIndexSbomIdx = publishJobSection.indexOf('- name: Attest Index SPDX SBOM');
    const secondaryAttestIdx = publishJobSection.indexOf(
      '- name: Attest Docker Hub Build Provenance (optional)'
    );

    expect(downloadIdx).toBeGreaterThan(-1);
    expect(verifySbomIdx).toBeGreaterThan(downloadIdx);
    expect(createScopedConfigIdx).toBeGreaterThan(verifySbomIdx);
    expect(ghcrLoginIdx).toBeGreaterThan(createScopedConfigIdx);
    expect(skopeoInspectIdx).toBeGreaterThan(ghcrLoginIdx);
    expect(skopeoCopyIdx).toBeGreaterThan(skopeoInspectIdx);
    expect(mergeIdx).toBeGreaterThan(skopeoCopyIdx);
    expect(indexSbomIdx).toBeGreaterThan(mergeIdx);
    expect(primaryAmd64AttestIdx).toBeGreaterThan(indexSbomIdx);
    expect(primaryArm64AttestIdx).toBeGreaterThan(primaryAmd64AttestIdx);
    expect(primaryAttestIdx).toBeGreaterThan(primaryArm64AttestIdx);
    expect(primaryAmd64SbomIdx).toBeGreaterThan(primaryAttestIdx);
    expect(primaryArm64SbomIdx).toBeGreaterThan(primaryAmd64SbomIdx);
    expect(primaryIndexSbomIdx).toBeGreaterThan(primaryArm64SbomIdx);
    expect(secondaryAttestIdx).toBeGreaterThan(primaryIndexSbomIdx);

    expect(publishJobSection).not.toContain('c0744595e72338575084a4bf85ed76e1eb521ddf');
    expect(
      publishJobSection.match(
        /uses:\s*actions\/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8 # v4\.2\.2/g
      )
    ).toHaveLength(6);
    expect(
      publishJobSection.match(
        /uses:\s*actions\/attest@1e69f48acb82d1966a394da916b4c1698aa569d6 # v4\.2\.2/g
      )
    ).toHaveLength(6);
    expect(publishJobSection).toContain('subject-digest: ${{ steps.merge.outputs.amd64_digest }}');
    expect(publishJobSection).toContain('subject-digest: ${{ steps.merge.outputs.arm64_digest }}');
    expect(publishJobSection).toContain('sbom-path: /tmp/oci-handoff/sbom-amd64.spdx.json');
    expect(publishJobSection).toContain('sbom-path: /tmp/oci-handoff/sbom-arm64.spdx.json');
    expect(publishJobSection).toContain('sbom-path: /tmp/oci-handoff/sbom-index.spdx.json');
    expect(publishJobSection).toContain('subject-name: docker.io/${{ needs.preflight.outputs.dockerhub_repository }}');
    expect(publishJobSection).toContain('subject-digest: ${{ steps.merge.outputs.dockerhub_digest }}');
    expect(publishJobSection).toContain('create-storage-record: false');
    expect(publishJobSection).toContain('image_uri: ${{ needs.preflight.outputs.primary_uri }}');
    expect(publishJobSection).toContain('image_tag: ${{ needs.preflight.outputs.tag_name }}');
    expect(publishJobSection).toContain('image_digest: ${{ steps.merge.outputs.digest }}');
    const cleanupDockerIdx = publishJobSection.indexOf('- name: Clean Up Scoped Registry Auth Directory');
    const summaryIdx = publishJobSection.indexOf('- name: Summary');
    expect(cleanupDockerIdx).toBeGreaterThan(secondaryAttestIdx);
    expect(summaryIdx).toBeGreaterThan(cleanupDockerIdx);
  });

  it('isolates GHA cache_from in docker-compose.ci.yml, persists BuildKit cache mounts, skips PR mode=max writes, deduplicates amd64 Next.js and Storybook builds, and smoke-tests arm64 in CI', () => {
    const composeContent = fs.readFileSync(path.join(process.cwd(), 'docker-compose.yml'), 'utf8');
    expect(composeContent).not.toContain('type=gha');
    expect(composeContent).not.toContain('GHA_CACHE_SCOPE');

    const ciComposeContent = fs.readFileSync(path.join(process.cwd(), 'docker-compose.ci.yml'), 'utf8');
    expect(ciComposeContent.match(/type=gha,scope=\$\{GHA_CACHE_SCOPE:-app-amd64\}/g)).toHaveLength(1);
    expect(ciComposeContent).not.toContain('cache_to');
    expect(ciComposeContent).not.toContain('mode=max');

    expect(ciWorkflow).toContain('crazy-max/ghaction-github-runtime@');
    const runtimeStepGuards =
      ciWorkflow.match(
        /- name: Expose GitHub Runtime for BuildKit Cache\n\s+if:\s*github\.event_name != 'pull_request'\n\s+uses:\s*crazy-max\/ghaction-github-runtime@/g
      ) ?? [];
    expect(runtimeStepGuards).toHaveLength(2);
    expect(ciWorkflow).toContain('GHA_CACHE_SCOPE: app-amd64');
    expect(ciWorkflow).toContain('runs-on: ubuntu-24.04-arm');
    expect(ciWorkflow).toContain('GHA_CACHE_SCOPE: app-arm64');
    expect(ciWorkflow).toContain(
      "cache-to: ${{ github.event_name != 'pull_request' && 'type=gha,scope=app-amd64,mode=max' || '' }}"
    );
    expect(ciWorkflow).toContain(
      "cache-to: ${{ github.event_name != 'pull_request' && 'type=gha,scope=app-arm64,mode=max' || '' }}"
    );
    expect(ciWorkflow.match(/validate_cache_archive\(\)/g)).toHaveLength(2);
    for (const mountTarget of ['/var/cache/apt', '/var/lib/apt', '/root/.npm', '/app/.next/cache']) {
      expect(ciWorkflow).toContain(`target=${mountTarget}`);
    }
    expect(ciWorkflow).not.toContain('run: npm run build\n');
    expect(ciWorkflow).toContain('docker create wedding-website:latest');
    expect(ciWorkflow).toContain('docker cp "$CID:/app/." .next/standalone/');
    expect(ciWorkflow).not.toContain('docker tag wedding-website:latest wedding-website:latest');
    expect(ciWorkflow).not.toContain('wedding-website-image.tar.zst');
    expect(ciWorkflow).not.toContain('wedding-website-container');

    const storybookWorkflow = readWorkflow('storybook.yml');
    const storybookOnSection = extractTopLevelSection(storybookWorkflow, 'on');
    expect(storybookOnSection).toContain('workflow_dispatch:');
    expect(storybookOnSection).not.toContain('push:');
    expect(storybookOnSection).not.toMatch(/-\s*main\b/);
    expect(storybookWorkflow).toContain('actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9');
    expect(storybookWorkflow).toContain('actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9');
    expect(storybookWorkflow).toContain('name: storybook-static');
    expect(storybookWorkflow).toContain('path: storybook-static/');

    const testContainerScript = fs.readFileSync(
      path.join(process.cwd(), 'scripts', 'test-container.mjs'),
      'utf8'
    );
    expect(testContainerScript).toContain("process.arch === 'arm64' ? 'app-arm64' : 'app-amd64'");
    expect(testContainerScript).toContain(
      "runCommand('docker', ['compose', ...COMPOSE_ARGS, 'run', '--rm', 'migration']"
    );
    expect(testContainerScript).not.toMatch(/['"]run['"][^\n]*['"]--no-build['"]/);
  });

  it('re-verifies compressed OCI archive digests with skopeo inspect before pushing with skopeo copy --preserve-digests and halts before any upload on digest mismatch', () => {
    const runBlocks = extractRunBlocks(publishWorkflow);
    const verifyAndPushScript = runBlocks.find((block) =>
      block.includes('skopeo copy --preserve-digests')
    );
    expect(verifyAndPushScript).toBeDefined();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-oci-handoff-test-'));
    const binDir = path.join(tempDir, 'bin');
    const handoffDir = path.join('/tmp', 'oci-handoff');
    const digestsDir = path.join('/tmp', 'digests');
    const callsFile = path.join(tempDir, 'skopeo_calls.log');

    const amd64Digest = 'sha256:1111111111111111111111111111111111111111111111111111111111111111';
    const arm64Digest = 'sha256:2222222222222222222222222222222222222222222222222222222222222222';
    const tamperedDigest = 'sha256:9999999999999999999999999999999999999999999999999999999999999999';

    try {
      fs.mkdirSync(binDir, { recursive: true });
      fs.rmSync(handoffDir, { recursive: true, force: true });
      fs.rmSync(digestsDir, { recursive: true, force: true });
      fs.mkdirSync(handoffDir, { recursive: true });
      fs.writeFileSync(path.join(handoffDir, 'amd64.digest'), `${amd64Digest}\n`);
      fs.writeFileSync(path.join(handoffDir, 'arm64.digest'), `${arm64Digest}\n`);
      fs.writeFileSync(path.join(handoffDir, 'oci-amd64.tar.zst'), 'compressed-amd64');
      fs.writeFileSync(path.join(handoffDir, 'oci-arm64.tar.zst'), 'compressed-arm64');
      fs.writeFileSync(callsFile, '');

      const zstdShim = path.join(binDir, 'zstd');
      fs.writeFileSync(
        zstdShim,
        `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const outIdx = args.indexOf('-o');
if (args.includes('-d') && outIdx !== -1 && args[outIdx + 1]) {
  fs.writeFileSync(args[outIdx + 1], 'decompressed-oci-tar');
  process.exit(0);
}
process.exit(1);
`,
        { mode: 0o755 }
      );

      const skopeoShim = path.join(binDir, 'skopeo');
      fs.writeFileSync(
        skopeoShim,
        `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(callsFile)}, args.join(' ') + '\\n');
if (args[0] === 'inspect') {
  const target = args[args.length - 1] || '';
  if (target.includes('oci-amd64.tar')) {
    process.stdout.write('${amd64Digest}\\n');
    process.exit(0);
  }
  if (target.includes('oci-arm64.tar')) {
    process.stdout.write((process.env.TAMPER_ARM64 === 'true' ? '${tamperedDigest}' : '${arm64Digest}') + '\\n');
    process.exit(0);
  }
}
if (args[0] === 'copy') {
  process.exit(0);
}
process.exit(1);
`,
        { mode: 0o755 }
      );

      // 1. Tampered arm64 archive fails closed BEFORE any skopeo copy upload occurs (even for amd64)
      const tamperRes = spawnSync('bash', ['-eo', 'pipefail', '-c', verifyAndPushScript!], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
          IMAGE_REPOSITORY: 'ghcr.io/fderuiter/wedding_website',
          DOCKERHUB_REPOSITORY: 'fderuiter/wedding-website',
          TAMPER_ARM64: 'true',
        },
      });
      expect(tamperRes.status).not.toBe(0);
      expect(tamperRes.stdout + tamperRes.stderr).toContain('OCI archive digest mismatch');
      expect(fs.readFileSync(callsFile, 'utf8')).not.toContain('copy --preserve-digests');

      // 2. Valid amd64 + arm64 archives push via skopeo copy --preserve-digests to GHCR and docker.io/
      fs.writeFileSync(callsFile, '');
      const okRes = spawnSync('bash', ['-eo', 'pipefail', '-c', verifyAndPushScript!], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
          IMAGE_REPOSITORY: 'ghcr.io/fderuiter/wedding_website',
          DOCKERHUB_REPOSITORY: 'fderuiter/wedding-website',
        },
      });
      expect(okRes.status).toBe(0);
      const calls = fs.readFileSync(callsFile, 'utf8');
      expect(calls).toContain(
        `copy --preserve-digests oci-archive:/tmp/oci-handoff/oci-amd64.tar docker://ghcr.io/fderuiter/wedding_website@${amd64Digest}`
      );
      expect(calls).toContain(
        `copy --preserve-digests oci-archive:/tmp/oci-handoff/oci-amd64.tar docker://docker.io/fderuiter/wedding-website@${amd64Digest}`
      );
      expect(calls).toContain(
        `copy --preserve-digests oci-archive:/tmp/oci-handoff/oci-arm64.tar docker://ghcr.io/fderuiter/wedding_website@${arm64Digest}`
      );
      expect(calls).toContain(
        `copy --preserve-digests oci-archive:/tmp/oci-handoff/oci-arm64.tar docker://docker.io/fderuiter/wedding-website@${arm64Digest}`
      );
    } finally {
      fs.rmSync(handoffDir, { recursive: true, force: true });
      fs.rmSync(digestsDir, { recursive: true, force: true });
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('merges verified amd64 and arm64 digests into multi-platform OCI indexes on GHCR and Docker Hub and fails closed if either architecture manifest is missing', () => {
    const runBlocks = extractRunBlocks(publishWorkflow);
    const mergeScript = runBlocks.find((block) => block.includes('docker buildx imagetools create'));
    expect(mergeScript).toBeDefined();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-merge-test-'));
    const binDir = path.join(tempDir, 'bin');
    const digestsDir = path.join('/tmp', 'digests');
    const outputFile = path.join(tempDir, 'github_output.txt');
    const callsFile = path.join(tempDir, 'docker_calls.log');

    const amd64Digest = 'sha256:1111111111111111111111111111111111111111111111111111111111111111';
    const arm64Digest = 'sha256:2222222222222222222222222222222222222222222222222222222222222222';
    const mergedDigest = 'sha256:3333333333333333333333333333333333333333333333333333333333333333';
    const resolvedSha = '0123456789abcdef0123456789abcdef01234567';

    try {
      fs.mkdirSync(binDir, { recursive: true });
      fs.mkdirSync(digestsDir, { recursive: true });
      fs.writeFileSync(path.join(digestsDir, 'amd64.digest'), `${amd64Digest}\n`);
      fs.writeFileSync(path.join(digestsDir, 'arm64.digest'), `${arm64Digest}\n`);
      fs.writeFileSync(outputFile, '');
      fs.writeFileSync(callsFile, '');

      const dockerShim = path.join(binDir, 'docker');
      fs.writeFileSync(
        dockerShim,
        `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(callsFile)}, args.join(' ') + '\\n');
if (args[0] === 'buildx' && args[1] === 'imagetools' && args[2] === 'create') {
  process.exit(0);
}
if (args[0] === 'buildx' && args[1] === 'imagetools' && args[2] === 'inspect') {
  const targetRef = args[args.length - 1] || '';
  const isDockerHub = !targetRef.startsWith('ghcr.io/');
  if (args.includes('--raw')) {
    const omitArm =
      process.env.OMIT_ARM64 === 'true' ||
      (isDockerHub && process.env.OMIT_DOCKERHUB_ARM64 === 'true');
    const manifests = omitArm
      ? [{ platform: { os: 'linux', architecture: 'amd64' } }]
      : [
          { platform: { os: 'linux', architecture: 'amd64' } },
          { platform: { os: 'linux', architecture: 'arm64' } },
        ];
    const annotations = process.env.OMIT_REVISION === 'true'
      ? {}
      : {
          'org.opencontainers.image.revision':
            process.env.MOCK_INDEX_REVISION ||
            process.env.REVISION ||
            process.env.RESOLVED_SHA ||
            '${resolvedSha}',
        };
    process.stdout.write(JSON.stringify({ manifests, annotations }));
    process.exit(0);
  }
  process.stdout.write('${mergedDigest}');
  process.exit(0);
}
process.exit(1);
`
      );
      fs.chmodSync(dockerShim, 0o755);

      const okRes = spawnSync('bash', ['-eo', 'pipefail', '-c', mergeScript!], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
          GITHUB_OUTPUT: outputFile,
          IMAGE_REPOSITORY: 'ghcr.io/fderuiter/wedding_website',
          DOCKERHUB_REPOSITORY: 'fderuiter/wedding-website',
          PRIMARY_URI: 'ghcr.io/fderuiter/wedding_website:v0.1.0',
          TAGS: 'ghcr.io/fderuiter/wedding_website:v0.1.0,ghcr.io/fderuiter/wedding_website:latest,fderuiter/wedding-website:v0.1.0,fderuiter/wedding-website:latest',
          RESOLVED_SHA: resolvedSha,
        },
      });
      expect(okRes.status).toBe(0);
      const mergeOutputs = fs.readFileSync(outputFile, 'utf8');
      expect(mergeOutputs).toContain(`digest=${mergedDigest}`);
      expect(mergeOutputs).toContain(`dockerhub_digest=${mergedDigest}`);

      const calls = fs.readFileSync(callsFile, 'utf8');
      expect(calls).toContain(
        `buildx imagetools create --tag ghcr.io/fderuiter/wedding_website:v0.1.0 --tag ghcr.io/fderuiter/wedding_website:latest --annotation index:org.opencontainers.image.revision=${resolvedSha} ghcr.io/fderuiter/wedding_website@${amd64Digest} ghcr.io/fderuiter/wedding_website@${arm64Digest}`
      );
      expect(calls).toContain(
        `buildx imagetools create --tag fderuiter/wedding-website:v0.1.0 --tag fderuiter/wedding-website:latest --annotation index:org.opencontainers.image.revision=${resolvedSha} fderuiter/wedding-website@${amd64Digest} fderuiter/wedding-website@${arm64Digest}`
      );
      expect(calls).toContain(
        'buildx imagetools inspect --format {{.Manifest.Digest}} fderuiter/wedding-website:v0.1.0'
      );
      expect(calls).toContain('buildx imagetools inspect --raw fderuiter/wedding-website:v0.1.0');

      // Verify missing linux/arm64 manifest on Docker Hub also fails closed
      const dockerHubFailRes = spawnSync('bash', ['-eo', 'pipefail', '-c', mergeScript!], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
          GITHUB_OUTPUT: outputFile,
          IMAGE_REPOSITORY: 'ghcr.io/fderuiter/wedding_website',
          DOCKERHUB_REPOSITORY: 'fderuiter/wedding-website',
          PRIMARY_URI: 'ghcr.io/fderuiter/wedding_website:v0.1.0',
          TAGS: 'ghcr.io/fderuiter/wedding_website:v0.1.0,fderuiter/wedding-website:v0.1.0',
          RESOLVED_SHA: resolvedSha,
          OMIT_DOCKERHUB_ARM64: 'true',
        },
      });
      expect(dockerHubFailRes.status).not.toBe(0);
      expect(dockerHubFailRes.stdout + dockerHubFailRes.stderr).toContain(
        "Published multi-platform index 'fderuiter/wedding-website:v0.1.0' is missing linux/arm64 manifest"
      );

      // Verify index:org.opencontainers.image.revision annotation is stamped on GHCR and Docker Hub indexes when REVISION is set
      fs.writeFileSync(callsFile, '');
      const revisionSha = 'abcdef0123456789abcdef0123456789abcdef01';
      const revRes = spawnSync('bash', ['-eo', 'pipefail', '-c', mergeScript!], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
          GITHUB_OUTPUT: outputFile,
          IMAGE_REPOSITORY: 'ghcr.io/fderuiter/wedding_website',
          DOCKERHUB_REPOSITORY: 'fderuiter/wedding-website',
          PRIMARY_URI: `ghcr.io/fderuiter/wedding_website:${revisionSha}`,
          REVISION: revisionSha,
          TAGS: `ghcr.io/fderuiter/wedding_website:${revisionSha},fderuiter/wedding-website:${revisionSha}`,
        },
      });
      expect(revRes.status).toBe(0);
      const revCalls = fs.readFileSync(callsFile, 'utf8');
      expect(revCalls).toContain(
        `buildx imagetools create --tag ghcr.io/fderuiter/wedding_website:${revisionSha} --annotation index:org.opencontainers.image.revision=${revisionSha} ghcr.io/fderuiter/wedding_website@${amd64Digest} ghcr.io/fderuiter/wedding_website@${arm64Digest}`
      );
      expect(revCalls).toContain(
        `buildx imagetools create --tag fderuiter/wedding-website:${revisionSha} --annotation index:org.opencontainers.image.revision=${revisionSha} fderuiter/wedding-website@${amd64Digest} fderuiter/wedding-website@${arm64Digest}`
      );

      // Verify missing linux/arm64 manifest in merged index fails closed
      const failRes = spawnSync('bash', ['-eo', 'pipefail', '-c', mergeScript!], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
          GITHUB_OUTPUT: outputFile,
          IMAGE_REPOSITORY: 'ghcr.io/fderuiter/wedding_website',
          DOCKERHUB_REPOSITORY: '',
          PRIMARY_URI: 'ghcr.io/fderuiter/wedding_website:v0.1.0',
          TAGS: 'ghcr.io/fderuiter/wedding_website:v0.1.0',
          RESOLVED_SHA: resolvedSha,
          OMIT_ARM64: 'true',
        },
      });
      expect(failRes.status).not.toBe(0);

      // Verify missing org.opencontainers.image.revision annotation in merged index fails closed before attestation
      const missingRevRes = spawnSync('bash', ['-eo', 'pipefail', '-c', mergeScript!], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
          GITHUB_OUTPUT: outputFile,
          IMAGE_REPOSITORY: 'ghcr.io/fderuiter/wedding_website',
          DOCKERHUB_REPOSITORY: '',
          PRIMARY_URI: 'ghcr.io/fderuiter/wedding_website:v0.1.0',
          TAGS: 'ghcr.io/fderuiter/wedding_website:v0.1.0',
          RESOLVED_SHA: resolvedSha,
          OMIT_REVISION: 'true',
        },
      });
      expect(missingRevRes.status).not.toBe(0);
    } finally {
      fs.rmSync(digestsDir, { recursive: true, force: true });
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('resolves target_sha from release_ref or image_digest OIDC provenance and checks out the tag commit in schema-compatibility', async () => {
    const http = await import('http');
    const { spawn } = await import('child_process');
    const runBashAsync = (
      script: string,
      options: { cwd?: string; env: NodeJS.ProcessEnv }
    ): Promise<{ status: number | null; stdout: string; stderr: string }> =>
      new Promise((resolve) => {
        const child = spawn('bash', ['-eo', 'pipefail', '-c', script], {
          cwd: options.cwd,
          env: options.env,
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
          stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
          stderr += chunk.toString();
        });
        child.on('close', (code) => {
          resolve({ status: code, stdout, stderr });
        });
      });

    const runBlocks = extractRunBlocks(deployWorkflow);
    const resolveShaScript = runBlocks.find((block) => block.includes('REF_RESOLVED_SHA='));
    const alignWorkspaceScript = runBlocks.find((block) => block.includes('git checkout --detach "$TARGET_SHA"'));
    expect(resolveShaScript).toBeDefined();
    expect(alignWorkspaceScript).toBeDefined();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-release-ref-test-'));
    const binDir = path.join(tempDir, 'bin');
    const repoDir = path.join(tempDir, 'repo');
    const outputFile = path.join(tempDir, 'github_output.txt');
    fs.mkdirSync(binDir, { recursive: true });
    fs.mkdirSync(repoDir, { recursive: true });

    // Create real git repo where v0.1.0 is tagged on an earlier commit and main HEAD has a newer migration
    spawnSync('git', ['init', '-b', 'main'], { cwd: repoDir });
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repoDir });
    spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir });
    fs.mkdirSync(path.join(repoDir, 'prisma', 'migrations', '0001_v010'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'prisma', 'migrations', '0001_v010', 'migration.sql'), 'SELECT 1;');
    spawnSync('git', ['add', '.'], { cwd: repoDir });
    spawnSync('git', ['commit', '-m', 'v0.1.0 release'], { cwd: repoDir });
    const v010Sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).stdout.trim();
    spawnSync('git', ['tag', '-a', 'v0.1.0', '-m', 'Release v0.1.0'], { cwd: repoDir });

    fs.mkdirSync(path.join(repoDir, 'prisma', 'migrations', '0002_unreleased_main'), { recursive: true });
    fs.writeFileSync(
      path.join(repoDir, 'prisma', 'migrations', '0002_unreleased_main', 'migration.sql'),
      'ALTER TABLE "Guest" ADD COLUMN "futureField" TEXT;'
    );
    spawnSync('git', ['add', '.'], { cwd: repoDir });
    spawnSync('git', ['commit', '-m', 'unreleased main migration'], { cwd: repoDir });
    const mainHeadSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).stdout.trim();
    expect(v010Sha).not.toBe(mainHeadSha);

    const sampleDigest = 'sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    const otherDigest = 'sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

    const ghShim = path.join(binDir, 'gh');
    fs.writeFileSync(
      ghShim,
      `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'attestation' && args[1] === 'verify' && args.includes('--format') && args.includes('json')) {
  const uri = args[2] || '';
  if (uri.endsWith('@${sampleDigest}')) {
    process.stdout.write(JSON.stringify([
      {
        verificationResult: {
          statement: {
            predicate: {
              buildDefinition: {
                resolvedDependencies: [
                  {
                    uri: 'git+https://github.com/fderuiter/wedding_website@refs/tags/v0.1.0',
                    digest: { gitCommit: '${v010Sha}' }
                  }
                ]
              }
            }
          }
        }
      }
    ]));
    process.exit(0);
  }
  if (uri.endsWith('@${otherDigest}')) {
    process.stdout.write(JSON.stringify([
      {
        verificationResult: {
          statement: {
            predicate: {
              buildDefinition: {
                resolvedDependencies: [
                  { digest: { gitCommit: '${mainHeadSha}' } }
                ]
              }
            }
          }
        }
      }
    ]));
    process.exit(0);
  }
}
process.exit(1);
`,
      { mode: 0o755 }
    );

    const apiServer = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/repos/fderuiter/wedding_website/commits/v0.1.0') {
        res.writeHead(200);
        res.end(JSON.stringify({ sha: v010Sha }));
        return;
      }
      res.writeHead(404);
      res.end(JSON.stringify({ message: 'Not Found' }));
    });
    await new Promise<void>((resolve) => apiServer.listen(0, '127.0.0.1', () => resolve()));
    const addr = apiServer.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    try {
      // 1. Dispatching with release_ref: v0.1.0 resolves target_sha to v0.1.0's commit instead of main HEAD
      fs.writeFileSync(outputFile, '');
      const refRes = await runBashAsync(resolveShaScript!, {
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
          GITHUB_OUTPUT: outputFile,
          GITHUB_REPOSITORY: 'fderuiter/wedding_website',
          GITHUB_API_URL: `http://127.0.0.1:${port}`,
          GH_TOKEN: 'ghs_test_token',
          REPO_OWNER: 'fderuiter',
          SIGNER_WORKFLOW: 'fderuiter/wedding_website/.github/workflows/publish-artifact.yml',
          EVENT_NAME: 'workflow_dispatch',
          WORKFLOW_RUN_HEAD_SHA: '',
          CURRENT_SHA: mainHeadSha,
          RELEASE_REF: 'v0.1.0',
          IMAGE_DIGEST: '',
        },
      });
      expect(refRes.status).toBe(0);
      expect(fs.readFileSync(outputFile, 'utf8')).toContain(`target_sha=${v010Sha}`);

      // 2. Dispatching with image_digest resolves target_sha from OIDC provenance attestation JSON
      fs.writeFileSync(outputFile, '');
      const digestRes = await runBashAsync(resolveShaScript!, {
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
          GITHUB_OUTPUT: outputFile,
          GITHUB_REPOSITORY: 'fderuiter/wedding_website',
          GITHUB_API_URL: `http://127.0.0.1:${port}`,
          GH_TOKEN: 'ghs_test_token',
          REPO_OWNER: 'fderuiter',
          SIGNER_WORKFLOW: 'fderuiter/wedding_website/.github/workflows/publish-artifact.yml',
          EVENT_NAME: 'workflow_dispatch',
          WORKFLOW_RUN_HEAD_SHA: '',
          CURRENT_SHA: mainHeadSha,
          RELEASE_REF: '',
          IMAGE_DIGEST: sampleDigest,
        },
      });
      expect(digestRes.status).toBe(0);
      expect(fs.readFileSync(outputFile, 'utf8')).toContain(`target_sha=${v010Sha}`);

      // 3. Mismatched release_ref + image_digest fails closed
      const mismatchRes = await runBashAsync(resolveShaScript!, {
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
          GITHUB_OUTPUT: outputFile,
          GITHUB_REPOSITORY: 'fderuiter/wedding_website',
          GITHUB_API_URL: `http://127.0.0.1:${port}`,
          GH_TOKEN: 'ghs_test_token',
          REPO_OWNER: 'fderuiter',
          SIGNER_WORKFLOW: 'fderuiter/wedding_website/.github/workflows/publish-artifact.yml',
          EVENT_NAME: 'workflow_dispatch',
          WORKFLOW_RUN_HEAD_SHA: '',
          CURRENT_SHA: mainHeadSha,
          RELEASE_REF: 'v0.1.0',
          IMAGE_DIGEST: otherDigest,
        },
      });
      expect(mismatchRes.status).not.toBe(0);
      expect(mismatchRes.stdout + mismatchRes.stderr).toContain('Commit mismatch');

      // 4. schema-compatibility Align Workspace to Verified Commit SHA checks out v0.1.0 commit (excluding unreleased main migration)
      const alignRes = await runBashAsync(alignWorkspaceScript!, {
        cwd: repoDir,
        env: {
          ...process.env,
          EVENT_NAME: 'workflow_dispatch',
          GITHUB_REF: 'refs/heads/main',
          TARGET_SHA: v010Sha,
        },
      });
      expect(alignRes.status).toBe(0);
      const checkedOutHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).stdout.trim();
      expect(checkedOutHead).toBe(v010Sha);
      expect(fs.existsSync(path.join(repoDir, 'prisma', 'migrations', '0002_unreleased_main'))).toBe(false);
    } finally {
      await new Promise<void>((resolve) => apiServer.close(() => resolve()));
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('enforces origin/main ancestry and completed successful ci.yml run in publish-artifact.yml preflight before building', async () => {
    const parsed = parseDocument(publishWorkflow, { version: '1.2', strict: true }).toJS() as {
      jobs?: {
        preflight?: {
          steps?: Array<{ name?: string; run?: string; with?: { script?: string } }>;
        };
      };
    };
    const steps = parsed.jobs?.preflight?.steps ?? [];
    const ancestryStep = steps.find((s) => s.name === 'Verify Commit SHA & Main Branch Ancestry');
    const ciStep = steps.find((s) => s.name === 'Verify Successful CI Run for Commit');
    expect(ancestryStep?.run).toBeDefined();
    expect(ciStep?.with?.script).toBeDefined();

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-preflight-test-'));
    const bareOrigin = path.join(tempRoot, 'origin.git');
    const workRepo = path.join(tempRoot, 'work');
    const outputFile = path.join(tempRoot, 'github_output.txt');

    try {
      spawnSync('git', ['init', '--bare', bareOrigin], { stdio: 'pipe' });
      spawnSync('git', ['init', '-b', 'main', workRepo], { stdio: 'pipe' });
      spawnSync('git', ['-C', workRepo, 'config', 'user.email', 'ci@example.com'], { stdio: 'pipe' });
      spawnSync('git', ['-C', workRepo, 'config', 'user.name', 'CI Bot'], { stdio: 'pipe' });
      spawnSync('git', ['-C', workRepo, 'remote', 'add', 'origin', bareOrigin], { stdio: 'pipe' });

      fs.writeFileSync(path.join(workRepo, 'file.txt'), 'v1\n');
      spawnSync('git', ['-C', workRepo, 'add', 'file.txt'], { stdio: 'pipe' });
      spawnSync('git', ['-C', workRepo, 'commit', '-m', 'c1'], { stdio: 'pipe' });
      const ancestorSha = spawnSync('git', ['-C', workRepo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();

      fs.writeFileSync(path.join(workRepo, 'file.txt'), 'v2\n');
      spawnSync('git', ['-C', workRepo, 'add', 'file.txt'], { stdio: 'pipe' });
      spawnSync('git', ['-C', workRepo, 'commit', '-m', 'c2'], { stdio: 'pipe' });
      const mainHeadSha = spawnSync('git', ['-C', workRepo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
      spawnSync('git', ['-C', workRepo, 'push', 'origin', 'main'], { stdio: 'pipe' });

      spawnSync('git', ['-C', workRepo, 'checkout', '-b', 'feature/unmerged', ancestorSha], { stdio: 'pipe' });
      fs.writeFileSync(path.join(workRepo, 'feature.txt'), 'unmerged\n');
      spawnSync('git', ['-C', workRepo, 'add', 'feature.txt'], { stdio: 'pipe' });
      spawnSync('git', ['-C', workRepo, 'commit', '-m', 'unmerged commit'], { stdio: 'pipe' });
      const unmergedSha = spawnSync('git', ['-C', workRepo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();

      // Ancestor of origin/main succeeds
      fs.writeFileSync(outputFile, '');
      const okAncestor = spawnSync('bash', ['-eo', 'pipefail', '-c', ancestryStep!.run!], {
        cwd: workRepo,
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_OUTPUT: outputFile,
          INPUT_COMMIT_SHA: ancestorSha,
          CURRENT_SHA: mainHeadSha,
        },
      });
      expect(okAncestor.status).toBe(0);
      expect(fs.readFileSync(outputFile, 'utf8')).toContain(`resolved_sha=${ancestorSha}`);

      // Unmerged commit fails closed
      fs.writeFileSync(outputFile, '');
      const badBranch = spawnSync('bash', ['-eo', 'pipefail', '-c', ancestryStep!.run!], {
        cwd: workRepo,
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_OUTPUT: outputFile,
          INPUT_COMMIT_SHA: '',
          CURRENT_SHA: unmergedSha,
        },
      });
      expect(badBranch.status).not.toBe(0);
      expect(badBranch.stdout + badBranch.stderr).toContain('is not an ancestor of origin/main');

      // Execute github-script CI gate against simulated GitHub REST API responses
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
        ...args: string[]
      ) => (github: unknown, context: unknown, core: unknown) => Promise<void>;
      const runCiGate = new AsyncFunction('github', 'context', 'core', ciStep!.with!.script!);

      const prevTarget = process.env.TARGET_SHA;
      process.env.TARGET_SHA = mainHeadSha;
      try {
        const failedMessages: string[] = [];
        await runCiGate(
          {
            rest: { actions: { listWorkflowRuns: 'listWorkflowRuns' } },
            paginate: async () => [
              { conclusion: 'failure', head_sha: mainHeadSha, head_repository: { full_name: 'fderuiter/wedding_website' } },
            ],
          },
          { repo: { owner: 'fderuiter', repo: 'wedding_website' } },
          { setFailed: (msg: string) => failedMessages.push(msg), info: () => undefined }
        );
        expect(failedMessages).toHaveLength(1);
        expect(failedMessages[0]).toContain('No completed successful CI workflow run found');

        const okFailures: string[] = [];
        const okInfos: string[] = [];
        await runCiGate(
          {
            rest: { actions: { listWorkflowRuns: 'listWorkflowRuns' } },
            paginate: async () => [
              {
                id: 901,
                run_number: 42,
                conclusion: 'success',
                head_sha: mainHeadSha,
                head_repository: { full_name: 'fderuiter/wedding_website' },
              },
            ],
          },
          { repo: { owner: 'fderuiter', repo: 'wedding_website' } },
          { setFailed: (msg: string) => okFailures.push(msg), info: (msg: string) => okInfos.push(msg) }
        );
        expect(okFailures).toHaveLength(0);
        expect(okInfos[0]).toContain('Verified successful CI run #42');
      } finally {
        if (prevTarget === undefined) delete process.env.TARGET_SHA;
        else process.env.TARGET_SHA = prevTarget;
      }
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('pins isolated prisma-cli dependencies to package-lock.json via npm ci in Dockerfile', () => {
    const dockerfile = fs.readFileSync(path.join(process.cwd(), 'Dockerfile'), 'utf8');
    const prismaStage = dockerfile.split('# Builder stage')[0] ?? '';
    expect(prismaStage).toContain('docker/prisma-cli/package-lock.json');
    expect(prismaStage).toContain('/opt/prisma-cli/package-lock.json');
    expect(prismaStage).toMatch(/\bnpm ci\b[^\n]*--omit=dev --no-audit --no-fund/);
    expect(prismaStage).not.toContain('npm install');
  });

  it('decouples npm lifecycle hooks, shares verified PostgreSQL digest, deduplicates build checks, restores Prisma in e2e-test, and gates Pages via pages-verify', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.prebuild).toBeUndefined();
    expect(pkg.scripts?.postinstall).toBe(
      '([ "$SKIP_NEXT_TYPEGEN" = "true" ] || [ "$STATIC_EXPORT" = "true" ] || next typegen) && prisma generate && node scripts/pretest.mjs --record-install-state || node -e "process.exit(process.env.npm_config_package_lock_only === \'true\' ? 0 : 1)"'
    );
    expect(pkg.scripts?.postinstall).not.toContain('generate-docs');
    expect(pkg.scripts?.build).toBe('prisma generate && next build');

    expect(pkg.scripts?.lint).toBe(
      'eslint . --cache --cache-location .eslintcache --cache-strategy content --max-warnings 0'
    );
    expect(pkg.scripts?.['lint:fix']).toBe(
      'eslint . --cache --cache-location .eslintcache --cache-strategy content --fix --max-warnings 0'
    );

    const verifySection = ciWorkflow.split(/\n  doc-drift-comment:\n/)[0] ?? '';
    expect(verifySection).not.toContain('run: npm run prisma:generate');
    expect(verifySection).toContain('db_image: ${{ steps.resolve-db-image.outputs.db_image }}');
    expect(verifySection).toContain('uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0');
    for (const cachedVerifyFile of [
      '.eslintcache',
      'tsconfig.tsbuildinfo',
      'tsconfig.build.tsbuildinfo',
      'tsconfig.scripts.tsbuildinfo',
      'tsconfig.e2e.tsbuildinfo',
      'tsconfig.test.tsbuildinfo',
    ]) {
      expect(verifySection).toContain(cachedVerifyFile);
    }
    expect(verifySection).toContain('CACHE_HIT: ${{ steps.ts-eslint-cache.outputs.cache-hit }}');
    expect(verifySection).toContain('2000-01-01T00:00:00Z');
    const verifyRunBlocks = extractRunBlocks(verifySection);
    const parallelVerifyScript = verifyRunBlocks.find((block) => block.includes('process.env.CACHE_HIT'));
    expect(parallelVerifyScript).toBeDefined();
    const tsNormalizeSnippet = (parallelVerifyScript ?? '').split('LOG_DIR=')[0] ?? '';
    const tsTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-tsbuildinfo-mtime-'));
    try {
      const sampleBuildInfo = path.join(tsTempDir, 'tsconfig.build.tsbuildinfo');
      fs.writeFileSync(sampleBuildInfo, '{"version":"5.9.3"}\n');
      const midTime = new Date('2024-06-01T00:00:00Z');
      fs.utimesSync(sampleBuildInfo, midTime, midTime);

      const partialRes = spawnSync('bash', ['-eo', 'pipefail', '-c', tsNormalizeSnippet], {
        cwd: tsTempDir,
        encoding: 'utf8',
        env: { ...process.env, CACHE_HIT: 'false' },
      });
      expect(partialRes.status).toBe(0);
      expect(fs.statSync(sampleBuildInfo).mtime.toISOString()).toBe('2000-01-01T00:00:00.000Z');

      const beforeExactMs = Date.now() - 2000;
      const exactRes = spawnSync('bash', ['-eo', 'pipefail', '-c', tsNormalizeSnippet], {
        cwd: tsTempDir,
        encoding: 'utf8',
        env: { ...process.env, CACHE_HIT: 'true' },
      });
      expect(exactRes.status).toBe(0);
      expect(fs.statSync(sampleBuildInfo).mtimeMs).toBeGreaterThanOrEqual(beforeExactMs);
    } finally {
      fs.rmSync(tsTempDir, { recursive: true, force: true });
    }
    expect(verifySection).toContain('npx tsx scripts/generate-docs.ts --skip-openapi');
    expect(verifySection).toContain("SKIP_DOC_SYNC: 'true'");
    expect(verifySection).toContain('name: docs-portal-static');

    const unitTestSection = (ciWorkflow.split(/\n  unit-test:\n/)[1] ?? '').split(/\n  build:\n/)[0] ?? '';
    expect(unitTestSection).toContain('image: ${{ needs.verify.outputs.db_image }}');
    expect(unitTestSection).toContain("SKIP_NEXT_TYPEGEN: 'true'");
    expect(unitTestSection).toContain('uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0');
    expect(unitTestSection).toContain('path: node_modules/.cache/jest');
    const unitNpmCiIdx = unitTestSection.indexOf('run: npm ci');
    const unitJestCacheIdx = unitTestSection.indexOf('path: node_modules/.cache/jest');
    const unitRunTestsIdx = unitTestSection.indexOf('run: npm run test:cov');
    expect(unitNpmCiIdx).toBeGreaterThan(-1);
    expect(unitJestCacheIdx).toBeGreaterThan(unitNpmCiIdx);
    expect(unitRunTestsIdx).toBeGreaterThan(unitJestCacheIdx);

    const buildSection = (ciWorkflow.split(/\n  build:\n/)[1] ?? '').split(/\n  container-arm64:\n/)[0] ?? '';
    expect(buildSection).toContain("SKIP_NEXT_TYPEGEN: 'true'");
    expect(buildSection).not.toContain('npm run check:audit');
    expect(buildSection).not.toContain('npm run build:export');
    expect(buildSection).not.toContain('wedding-website-container');
    const checkStandaloneIdx = buildSection.indexOf('run: npm run check:standalone -- --standalone-only');
    const testStandaloneIdx = buildSection.indexOf('run: npm run test:standalone');
    const testContainerIdx = buildSection.indexOf('run: npm run test:container -- --container-migration');
    const uploadNextArtifactIdx = buildSection.indexOf('name: next-build-artifact');
    expect(checkStandaloneIdx).toBeGreaterThan(-1);
    expect(testStandaloneIdx).toBeGreaterThan(checkStandaloneIdx);
    expect(testContainerIdx).toBeGreaterThan(testStandaloneIdx);
    expect(uploadNextArtifactIdx).toBeGreaterThan(testContainerIdx);
    expect(buildSection.slice(uploadNextArtifactIdx)).toContain('node_modules/.prisma');
    expect(buildSection.slice(uploadNextArtifactIdx)).toContain('node_modules/@prisma');

    const storybookCiSection =
      (ciWorkflow.split(/\n  storybook-build:\n/)[1] ?? '').split(/\n  static-export-build:\n/)[0] ?? '';
    expect(storybookCiSection).toContain('run: npm ci --ignore-scripts');

    const storybookWorkflow = readWorkflow('storybook.yml');
    expect(storybookWorkflow).toContain('run: npm ci --ignore-scripts');

    const e2eSection = extractJobSection(ciWorkflow, 'e2e-test');
    expect(e2eSection).toContain('needs: [verify, build]');
    expect(e2eSection).toContain('run: npm ci --ignore-scripts');
    expect(e2eSection).toContain('name: next-build-artifact');
    expect(e2eSection).toContain('test -d node_modules/.prisma/client');
    expect(e2eSection).toContain('test -d node_modules/@prisma/client');
    expect(e2eSection).toContain('image: ${{ needs.verify.outputs.db_image }}');
    expect(e2eSection).toContain('run: npx playwright test');
    expect(e2eSection).toContain('name: playwright-traces');
    expect(e2eSection).toContain('path: test-results/playwright/');
    expect(e2eSection).toContain('if: failure()');

    const playwrightConfigRaw = fs.readFileSync(path.join(process.cwd(), 'playwright.config.ts'), 'utf8');
    const playwrightStaticConfigRaw = fs.readFileSync(
      path.join(process.cwd(), 'playwright.static.config.ts'),
      'utf8'
    );
    expect(playwrightConfigRaw).toContain("trace: 'retain-on-failure'");
    expect(playwrightStaticConfigRaw).toContain("outputDir: 'test-results/playwright-static'");
    expect(playwrightStaticConfigRaw).toContain("trace: 'retain-on-failure'");
    expect(playwrightConfigRaw).toMatch(
      /process\.argv\.some\(\(arg\)\s*=>\s*arg\.includes\('pages-showcase\.spec\.ts'\)\s*\)/
    );
    expect(playwrightConfigRaw).toContain("['**/pages-showcase.spec.ts']");
    expect(pkg.scripts?.['pages:verify']).toContain('e2e/pages-showcase.spec.ts');
  });

  it('validates BuildKit tar cache archive members and synthesizes multi-platform SPDX 2.3 index SBOMs in publish-artifact.yml', () => {
    const runBlocks = extractRunBlocks(publishWorkflow);
    const hydrateScript = runBlocks.find((block) => block.includes('validate_cache_archive'));
    const verifySbomScript = runBlocks.find(
      (block) =>
        block.includes('SBOM_FILE="/tmp/oci-handoff/sbom-${required_arch}.spdx.json"') &&
        !block.includes('sbom-index.spdx.json')
    );
    const indexSbomScript = runBlocks.find((block) =>
      block.includes('/tmp/oci-handoff/sbom-index.spdx.json')
    );

    expect(hydrateScript).toBeDefined();
    expect(verifySbomScript).toBeDefined();
    expect(indexSbomScript).toBeDefined();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-sbom-cache-test-'));
    const binDir = path.join(tempDir, 'bin');
    const mountCacheDir = path.join(tempDir, 'mounts');
    const handoffDir = path.join('/tmp', 'oci-handoff');

    try {
      fs.mkdirSync(binDir, { recursive: true });
      fs.mkdirSync(path.join(mountCacheDir, 'deps'), { recursive: true });
      fs.mkdirSync(path.join(mountCacheDir, 'next'), { recursive: true });

      // Mock docker shim so Hydrate BuildKit Cache Mounts completes without running buildx daemon
      fs.writeFileSync(
        path.join(binDir, 'docker'),
        '#!/usr/bin/env bash\ncat >/dev/null\nexit 0\n',
        { mode: 0o755 }
      );

      // 1. Rejects cache tar archive containing unexpected paths outside BuildKit cache directories
      const badStage = path.join(tempDir, 'bad-stage');
      fs.mkdirSync(path.join(badStage, 'etc'), { recursive: true });
      fs.writeFileSync(path.join(badStage, 'etc', 'passwd'), 'bad');
      execFileSync('tar', ['-cf', path.join(mountCacheDir, 'deps', 'mounts.tar'), '-C', badStage, 'etc']);

      const badArchiveRes = spawnSync('bash', ['-eo', 'pipefail', '-c', hydrateScript!], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
          TARGET_PLATFORM: 'linux/amd64',
          MOUNT_CACHE_DIR: mountCacheDir,
        },
      });
      expect(badArchiveRes.status).not.toBe(0);
      expect(badArchiveRes.stdout + badArchiveRes.stderr).toContain('contains unexpected path');

      // 2. Rejects cache tar archive containing symlinks
      const symlinkStage = path.join(tempDir, 'symlink-stage');
      fs.mkdirSync(path.join(symlinkStage, 'root', '.npm'), { recursive: true });
      fs.symlinkSync('/etc/shadow', path.join(symlinkStage, 'root', '.npm', 'escape'));
      execFileSync('tar', ['-cf', path.join(mountCacheDir, 'deps', 'mounts.tar'), '-C', symlinkStage, 'root']);

      const symlinkRes = spawnSync('bash', ['-eo', 'pipefail', '-c', hydrateScript!], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
          TARGET_PLATFORM: 'linux/amd64',
          MOUNT_CACHE_DIR: mountCacheDir,
        },
      });
      expect(symlinkRes.status).not.toBe(0);
      expect(symlinkRes.stdout + symlinkRes.stderr).toContain('contains disallowed link or device entries');

      // 3. Accepts valid BuildKit cache directory entries
      const goodStage = path.join(tempDir, 'good-stage');
      fs.mkdirSync(path.join(goodStage, 'root', '.npm'), { recursive: true });
      fs.writeFileSync(path.join(goodStage, 'root', '.npm', 'index.json'), '{}');
      execFileSync('tar', ['-cf', path.join(mountCacheDir, 'deps', 'mounts.tar'), '-C', goodStage, 'root/.npm']);

      const goodArchiveRes = spawnSync('bash', ['-eo', 'pipefail', '-c', hydrateScript!], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
          TARGET_PLATFORM: 'linux/amd64',
          MOUNT_CACHE_DIR: mountCacheDir,
        },
      });
      expect(goodArchiveRes.status).toBe(0);

      // 4. Verifies per-architecture SPDX SBOMs and synthesizes merged index SPDX 2.3 SBOM
      fs.rmSync(handoffDir, { recursive: true, force: true });
      fs.mkdirSync(handoffDir, { recursive: true });

      const missingSbomRes = spawnSync('bash', ['-eo', 'pipefail', '-c', verifySbomScript!], {
        encoding: 'utf8',
      });
      expect(missingSbomRes.status).not.toBe(0);

      fs.writeFileSync(
        path.join(handoffDir, 'sbom-amd64.spdx.json'),
        JSON.stringify({
          spdxVersion: 'SPDX-2.3',
          SPDXID: 'SPDXRef-DOCUMENT',
          packages: [{ name: 'next', SPDXID: 'SPDXRef-Pkg-next', versionInfo: '16.0.0' }],
          relationships: [
            {
              spdxElementId: 'SPDXRef-DOCUMENT',
              relationshipType: 'DESCRIBES',
              relatedSpdxElement: 'SPDXRef-Pkg-next',
            },
          ],
        })
      );
      fs.writeFileSync(
        path.join(handoffDir, 'sbom-arm64.spdx.json'),
        JSON.stringify({
          spdxVersion: 'SPDX-2.3',
          SPDXID: 'SPDXRef-DOCUMENT',
          packages: [{ name: 'prisma', SPDXID: 'SPDXRef-Pkg-prisma', versionInfo: '7.0.0' }],
          relationships: [
            {
              spdxElementId: 'SPDXRef-DOCUMENT',
              relationshipType: 'DESCRIBES',
              relatedSpdxElement: 'SPDXRef-Pkg-prisma',
            },
          ],
        })
      );

      const okSbomRes = spawnSync('bash', ['-eo', 'pipefail', '-c', verifySbomScript!], {
        encoding: 'utf8',
      });
      expect(okSbomRes.status).toBe(0);

      const amd64Digest = 'sha256:1111111111111111111111111111111111111111111111111111111111111111';
      const arm64Digest = 'sha256:2222222222222222222222222222222222222222222222222222222222222222';
      const indexDigest = 'sha256:3333333333333333333333333333333333333333333333333333333333333333';
      const revision = '0123456789abcdef0123456789abcdef01234567';

      const synthRes = spawnSync('bash', ['-eo', 'pipefail', '-c', indexSbomScript!], {
        encoding: 'utf8',
        env: {
          ...process.env,
          IMAGE_REPOSITORY: 'ghcr.io/fderuiter/wedding_website',
          AMD64_DIGEST: amd64Digest,
          ARM64_DIGEST: arm64Digest,
          INDEX_DIGEST: indexDigest,
          REVISION: revision,
          RESOLVED_SHA: revision,
        },
      });
      expect(synthRes.status).toBe(0);

      const indexSbom = JSON.parse(
        fs.readFileSync(path.join(handoffDir, 'sbom-index.spdx.json'), 'utf8')
      ) as {
        spdxVersion: string;
        packages: Array<{ SPDXID: string; checksums?: Array<{ checksumValue: string }> }>;
        relationships: Array<{ spdxElementId: string; relationshipType: string; relatedSpdxElement: string }>;
      };
      expect(indexSbom.spdxVersion).toBe('SPDX-2.3');
      expect(indexSbom.packages.map((p) => p.SPDXID)).toEqual(
        expect.arrayContaining([
          'SPDXRef-Index',
          'SPDXRef-Root-amd64',
          'SPDXRef-Root-arm64',
          'SPDXRef-amd64-Pkg-next',
          'SPDXRef-arm64-Pkg-prisma',
        ])
      );
      expect(indexSbom.relationships).toEqual(
        expect.arrayContaining([
          {
            spdxElementId: 'SPDXRef-Root-amd64',
            relationshipType: 'VARIANT_OF',
            relatedSpdxElement: 'SPDXRef-Index',
          },
          {
            spdxElementId: 'SPDXRef-Root-arm64',
            relationshipType: 'VARIANT_OF',
            relatedSpdxElement: 'SPDXRef-Index',
          },
        ])
      );
    } finally {
      fs.rmSync(handoffDir, { recursive: true, force: true });
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('executes ci-complete and a11y-report upstream result gates and fails closed whenever any required job does not succeed', () => {
    const runBlocks = extractRunBlocks(ciWorkflow);
    const a11yUpstreamScript = runBlocks.find((block) =>
      block.includes('Upstream accessibility suite job(s) did not succeed:')
    );
    const ciCompleteScript = runBlocks.find((block) =>
      block.includes('All 9 CI verification jobs succeeded.')
    );

    expect(a11yUpstreamScript).toBeDefined();
    expect(ciCompleteScript).toBeDefined();

    const baseA11yEnv: Record<string, string> = {
      UNIT_TEST_RESULT: 'success',
      E2E_TEST_RESULT: 'success',
      STATIC_EXPORT_BUILD_RESULT: 'success',
    };
    const passA11y = spawnSync('bash', ['-eo', 'pipefail', '-c', a11yUpstreamScript!], {
      encoding: 'utf8',
      env: { ...process.env, ...baseA11yEnv },
    });
    expect(passA11y.status).toBe(0);

    for (const [envKey, jobName] of [
      ['UNIT_TEST_RESULT', 'unit-test'],
      ['E2E_TEST_RESULT', 'e2e-test'],
      ['STATIC_EXPORT_BUILD_RESULT', 'static-export-build'],
    ] as const) {
      const failA11y = spawnSync('bash', ['-eo', 'pipefail', '-c', a11yUpstreamScript!], {
        encoding: 'utf8',
        env: { ...process.env, ...baseA11yEnv, [envKey]: 'failure' },
      });
      expect(failA11y.status).toBe(1);
      expect(failA11y.stdout + failA11y.stderr).toContain(`${jobName} (failure)`);
    }

    const baseCiEnv: Record<string, string> = {
      VERIFY_RESULT: 'success',
      UNIT_TEST_RESULT: 'success',
      BUILD_RESULT: 'success',
      CONTAINER_ARM64_RESULT: 'success',
      STORYBOOK_BUILD_RESULT: 'success',
      STATIC_EXPORT_BUILD_RESULT: 'success',
      E2E_TEST_RESULT: 'success',
      A11Y_REPORT_RESULT: 'success',
      PAGES_VERIFY_RESULT: 'success',
    };
    const passCi = spawnSync('bash', ['-eo', 'pipefail', '-c', ciCompleteScript!], {
      encoding: 'utf8',
      env: { ...process.env, ...baseCiEnv },
    });
    expect(passCi.status).toBe(0);
    expect(passCi.stdout).toContain('All 9 CI verification jobs succeeded.');

    for (const [envKey, jobName] of [
      ['VERIFY_RESULT', 'verify'],
      ['UNIT_TEST_RESULT', 'unit-test'],
      ['BUILD_RESULT', 'build'],
      ['CONTAINER_ARM64_RESULT', 'container-arm64'],
      ['STORYBOOK_BUILD_RESULT', 'storybook-build'],
      ['STATIC_EXPORT_BUILD_RESULT', 'static-export-build'],
      ['E2E_TEST_RESULT', 'e2e-test'],
      ['A11Y_REPORT_RESULT', 'a11y-report'],
      ['PAGES_VERIFY_RESULT', 'pages-verify'],
    ] as const) {
      const failCi = spawnSync('bash', ['-eo', 'pipefail', '-c', ciCompleteScript!], {
        encoding: 'utf8',
        env: { ...process.env, ...baseCiEnv, [envKey]: 'skipped' },
      });
      expect(failCi.status).toBe(1);
      expect(failCi.stdout + failCi.stderr).toContain(`${jobName} (skipped)`);
    }
  });

  it('isolates trusted default-branch execution before commit_sha checkout in deploy-provider.yml preflight to prevent cache poisoning', () => {
    const preflightSection =
      deployProviderWorkflow.split('\n  preflight:\n')[1]?.split('\n  deploy:\n')[0] ?? '';
    expect(preflightSection).not.toBe('');

    const defaultCheckoutIdx = preflightSection.indexOf('id: checkout-default');
    const resolveStepIdx = preflightSection.indexOf('- name: Resolve Artifact Image URI');
    const lintMigrationsIdx = preflightSection.indexOf('id: lint-migrations');
    const shaCheckoutIdx = preflightSection.indexOf('- id: checkout\n');
    const gitAncestorsIdx = preflightSection.indexOf('id: git-ancestors');

    expect(defaultCheckoutIdx).toBeGreaterThan(-1);
    expect(resolveStepIdx).toBeGreaterThan(defaultCheckoutIdx);
    expect(lintMigrationsIdx).toBeGreaterThan(resolveStepIdx);
    expect(shaCheckoutIdx).toBeGreaterThan(lintMigrationsIdx);
    expect(gitAncestorsIdx).toBeGreaterThan(shaCheckoutIdx);

    const defaultCheckoutBlock = preflightSection.slice(defaultCheckoutIdx, resolveStepIdx);
    expect(defaultCheckoutBlock).not.toContain('ref:');
    expect(defaultCheckoutBlock).toContain('persist-credentials: false');

    const postShaCheckoutSection = preflightSection.slice(shaCheckoutIdx);
    expect(postShaCheckoutSection).toContain('ref: ${{ inputs.commit_sha }}');
    expect(postShaCheckoutSection).toContain('path: target-commit');
    expect(postShaCheckoutSection).toContain("steps.lint-migrations.outcome == 'success'");
    expect(postShaCheckoutSection).toContain('git -C target-commit rev-list');
    expect(postShaCheckoutSection).toContain('rm -rf target-commit');
    expect(postShaCheckoutSection).not.toMatch(/\b(?:npm|pnpm|yarn|npx|tsx)\s+/);
    expect(postShaCheckoutSection).not.toContain('./scripts/');

    const publishBuildSection =
      publishWorkflow.split('\n  build:\n')[1]?.split('\n  upload-sarif:\n')[0] ?? '';
    expect(publishBuildSection).toContain('id: checkout-default');
    expect(publishBuildSection).not.toMatch(/^\s+ref:/m);
    expect(publishBuildSection).toContain('Restore Trusted Default-Branch Runner Scripts');

    const rollbackPreflightSection =
      rollbackWorkflow.split('\n  preflight:\n')[1]?.split('\n  redeploy:\n')[0] ?? '';
    expect(rollbackPreflightSection).not.toMatch(/^\s+ref:/m);
    expect(rollbackPreflightSection).toContain('git checkout "$INPUT_COMMIT_SHA" -- prisma/migrations');
  });

  it('declares explicit least-privilege permissions at workflow root and every job across all workflows without unsafe script interpolation', () => {
    const workflowsDir = path.join(path.resolve(__dirname, '../..'), '.github', 'workflows');
    const workflowFiles = fs
      .readdirSync(workflowsDir)
      .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      .sort();

    expect(workflowFiles.length).toBeGreaterThanOrEqual(8);

    for (const file of workflowFiles) {
      const raw = fs.readFileSync(path.join(workflowsDir, file), 'utf8');
      const doc = parseDocument(raw, { version: '1.2', strict: true });
      expect(doc.errors).toEqual([]);
      const parsed = doc.toJS() as {
        permissions?: Record<string, string>;
        jobs?: Record<
          string,
          {
            'runs-on'?: unknown;
            permissions?: Record<string, string>;
            steps?: Array<{ run?: string; with?: { script?: string } }>;
          }
        >;
      };

      expect(parsed.permissions).toEqual({ contents: 'read' });

      for (const [jobId, job] of Object.entries(parsed.jobs ?? {})) {
        expect({
          file,
          jobId,
          hasPermissions:
            job.permissions !== undefined && Object.keys(job.permissions).length > 0,
        }).toEqual({ file, jobId, hasPermissions: true });
        for (const step of job.steps ?? []) {
          if (typeof step.run === 'string') {
            expect(step.run).not.toMatch(/\$\{\{/);
          }
          if (typeof step.with?.script === 'string') {
            expect(step.with.script).not.toMatch(/\$\{\{/);
          }
        }
      }
    }
  });
});
