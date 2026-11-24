import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { isMap, isPair, isScalar, isSeq, LineCounter, parseDocument } from 'yaml';

interface Violation {
  filePath: string;
  lineNumber: number;
  lineContent: string;
  actionRef: string;
  reason: string;
}

interface PinnedActionOccurrence {
  filePath: string;
  lineNumber: number;
  lineContent: string;
  actionRef: string;
  owner: string;
  repo: string;
  sha: string;
}

interface VerifyUpstreamOptions {
  apiBaseUrl?: string;
  token?: string;
  timeoutMs?: number;
}

const WORKFLOWS_DIR = path.join(process.cwd(), '.github', 'workflows');
const COMMIT_SHA_REGEX = /^[a-fA-F0-9]{40}$/;
const VERSION_COMMENT_REGEX = /^v\d+(?:\.\d+)*(?:-[0-9A-Za-z.-]+)?(?:\s.*)?$/;
const DEFAULT_GITHUB_API_BASE_URL = 'https://api.github.com';
const DEFAULT_UPSTREAM_TIMEOUT_MS = 15000;

function getNodeLineNumber(node: unknown, lineCounter: LineCounter): number {
  if (
    node &&
    typeof node === 'object' &&
    'range' in node &&
    Array.isArray((node as { range?: unknown }).range) &&
    typeof (node as { range: [number] }).range[0] === 'number'
  ) {
    return lineCounter.linePos((node as { range: [number] }).range[0]).line;
  }
  return 1;
}

function getScalarString(node: unknown): string | null {
  if (isScalar(node) && typeof node.value === 'string') {
    return node.value;
  }
  return null;
}

function workflowTriggersOnPullRequest(onNode: unknown): boolean {
  if (isScalar(onNode)) {
    return onNode.value === 'pull_request';
  }
  if (isSeq(onNode)) {
    return onNode.items.some(
      (item) => isScalar(item) && item.value === 'pull_request'
    );
  }
  if (isMap(onNode)) {
    return onNode.items.some(
      (pair) => isPair(pair) && isScalar(pair.key) && pair.key.value === 'pull_request'
    );
  }
  return false;
}

function conditionExcludesPullRequest(ifValue: string | null): boolean {
  if (!ifValue) return false;
  const normalized = ifValue.replace(/\s+/g, ' ').trim();
  if (
    /github\.event_name\s*!=\s*['"]pull_request['"]/.test(normalized) ||
    /['"]pull_request['"]\s*!=\s*github\.event_name/.test(normalized)
  ) {
    return true;
  }

  const eqMatches = [
    ...normalized.matchAll(/github\.event_name\s*==\s*['"]([^'"]+)['"]/g),
    ...normalized.matchAll(/['"]([^'"]+)['"]\s*==\s*github\.event_name/g),
  ];
  if (eqMatches.length > 0) {
    return eqMatches.every((m) => m[1] !== 'pull_request');
  }

  return false;
}

function permissionsHaveWriteScope(permissionsNode: unknown): boolean {
  if (isScalar(permissionsNode)) {
    return permissionsNode.value === 'write-all';
  }
  if (isMap(permissionsNode)) {
    return permissionsNode.items.some(
      (pair) =>
        isPair(pair) &&
        isScalar(pair.value) &&
        typeof pair.value.value === 'string' &&
        pair.value.value.trim() === 'write'
    );
  }
  return false;
}

function concurrencyAlwaysCancelsInProgress(concurrencyNode: unknown): boolean {
  if (!isMap(concurrencyNode)) {
    return false;
  }
  const cancelNode: unknown = concurrencyNode.get('cancel-in-progress', true);
  if (!isScalar(cancelNode)) {
    return false;
  }
  if (cancelNode.value === true) {
    return true;
  }
  if (typeof cancelNode.value === 'string') {
    const trimmed = cancelNode.value.trim();
    return trimmed === 'true' || /^\$\{\{\s*true\s*\}\}$/.test(trimmed);
  }
  return false;
}

function hasGithubPagesFifoConcurrency(concurrencyNode: unknown): boolean {
  if (!isMap(concurrencyNode)) {
    return false;
  }
  const groupVal = getScalarString(concurrencyNode.get('group', true))?.trim();
  const cancelNode: unknown = concurrencyNode.get('cancel-in-progress', true);
  const queueVal = getScalarString(concurrencyNode.get('queue', true))?.trim();
  return (
    groupVal === 'github-pages' &&
    isScalar(cancelNode) &&
    cancelNode.value === false &&
    queueVal === 'max'
  );
}

function evaluateAstPolicies(
  doc: ReturnType<typeof parseDocument>,
  lineCounter: LineCounter,
  lines: string[],
  relPath: string,
  fileName: string,
  violations: Violation[]
): void {
  if (!isMap(doc.contents)) {
    return;
  }

  const addAstViolation = (
    node: unknown,
    actionRef: string,
    reason: string
  ): void => {
    const lineNumber = getNodeLineNumber(node, lineCounter);
    violations.push({
      filePath: relPath,
      lineNumber,
      lineContent: (lines[lineNumber - 1] ?? '').trim(),
      actionRef,
      reason,
    });
  };

  const checkConcurrencyFifoQueue = (
    concurrencyNode: unknown,
    scopeRef: string
  ): void => {
    if (concurrencyNode === undefined || concurrencyNode === null) {
      return;
    }
    if (concurrencyAlwaysCancelsInProgress(concurrencyNode)) {
      return;
    }
    const queueNode: unknown = isMap(concurrencyNode)
      ? concurrencyNode.get('queue', true)
      : undefined;
    const queueVal = getScalarString(queueNode)?.trim();
    if (queueVal !== 'max') {
      addAstViolation(
        queueNode ?? concurrencyNode,
        scopeRef,
        `Non-cancelling ${scopeRef} block must set "queue: max" to queue pending runs in FIFO order without evicting commits.`
      );
    }
  };

  const onNode: unknown = doc.contents.get('on', true);
  const hasPullRequestTrigger = workflowTriggersOnPullRequest(onNode);
  const topPermissionsNode: unknown = doc.contents.get('permissions', true);
  const topConcurrencyNode: unknown = doc.contents.get('concurrency', true);

  checkConcurrencyFifoQueue(topConcurrencyNode, 'concurrency');

  // Rule: rollback_environment must not appear under workflow_dispatch.inputs outside rollback.yml
  if (fileName !== 'rollback.yml' && isMap(onNode)) {
    const dispatchNode: unknown = onNode.get('workflow_dispatch', true);
    if (isMap(dispatchNode)) {
      const inputsNode: unknown = dispatchNode.get('inputs', true);
      if (isMap(inputsNode)) {
        for (const pair of inputsNode.items) {
          if (
            isPair(pair) &&
            isScalar(pair.key) &&
            pair.key.value === 'rollback_environment'
          ) {
            addAstViolation(
              pair.key,
              'workflow_dispatch.inputs.rollback_environment',
              '"rollback_environment" must not be exposed on workflow_dispatch inputs; restrict rollback environment overrides to workflow_call or rollback.yml.'
            );
          }
        }
      }
    }
  }

  const jobsNode: unknown = doc.contents.get('jobs', true);
  if (!isMap(jobsNode)) {
    return;
  }

  for (const jobPair of jobsNode.items) {
    if (!isPair(jobPair) || !isScalar(jobPair.key) || !isMap(jobPair.value)) {
      continue;
    }
    const jobId = String(jobPair.key.value);
    const jobMap = jobPair.value;
    const jobIf = getScalarString(jobMap.get('if', true));
    const jobExcludesPr = conditionExcludesPullRequest(jobIf);

    const jobPermissionsNode: unknown = jobMap.has('permissions')
      ? jobMap.get('permissions', true)
      : topPermissionsNode;
    const jobHasWritePermissions = permissionsHaveWriteScope(jobPermissionsNode);

    const jobConcurrencyNode: unknown = jobMap.get('concurrency', true);
    checkConcurrencyFifoQueue(jobConcurrencyNode, `jobs.${jobId}.concurrency`);
    const effectiveJobConcurrency: unknown = jobMap.has('concurrency')
      ? jobConcurrencyNode
      : topConcurrencyNode;

    // Rule: jobs.<id>.environment referencing rollback_environment outside rollback.yml must guard on workflow_call
    if (fileName !== 'rollback.yml' && jobMap.has('environment')) {
      const envNode: unknown = jobMap.get('environment', true);
      const envExpr = isScalar(envNode)
        ? getScalarString(envNode)
        : isMap(envNode)
          ? getScalarString(envNode.get('name', true))
          : null;
      if (
        envExpr &&
        envExpr.includes('rollback_environment') &&
        !/github\.event_name\s*==\s*['"]workflow_call['"]/.test(envExpr)
      ) {
        addAstViolation(
          envNode,
          `jobs.${jobId}.environment`,
          `Job "${jobId}" environment references rollback_environment without guarding on "github.event_name == 'workflow_call'".`
        );
      }
    }

    const stepsNode: unknown = jobMap.get('steps', true);
    if (!isSeq(stepsNode)) {
      continue;
    }

    for (const stepNode of stepsNode.items) {
      if (!isMap(stepNode)) {
        continue;
      }

      const usesNode: unknown = stepNode.get('uses', true);
      const usesRaw = getScalarString(usesNode)?.trim() ?? '';
      const stepIf = getScalarString(stepNode.get('if', true));
      const stepExcludesPr = jobExcludesPr || conditionExcludesPullRequest(stepIf);
      const withNode: unknown = stepNode.get('with', true);
      const runNode: unknown = stepNode.get('run', true);
      const runScript = getScalarString(runNode);

      // Rule 1: Every actions/checkout step must set with.persist-credentials: false
      if (
        usesRaw === 'actions/checkout' ||
        usesRaw.startsWith('actions/checkout@')
      ) {
        const persistCredsNode: unknown = isMap(withNode)
          ? withNode.get('persist-credentials', true)
          : undefined;
        const hasPersistFalse =
          isScalar(persistCredsNode) && persistCredsNode.value === false;
        if (!hasPersistFalse) {
          addAstViolation(
            usesNode ?? stepNode,
            usesRaw,
            'actions/checkout must set "with.persist-credentials: false" to avoid persisting GITHUB_TOKEN in .git/config.'
          );
        }
      }

      // Rule 2a: crazy-max/ghaction-github-runtime must be guarded against pull_request
      if (
        hasPullRequestTrigger &&
        (usesRaw === 'crazy-max/ghaction-github-runtime' ||
          usesRaw.startsWith('crazy-max/ghaction-github-runtime@')) &&
        !stepExcludesPr
      ) {
        addAstViolation(
          usesNode ?? stepNode,
          usesRaw,
          'crazy-max/ghaction-github-runtime must be guarded with "if: github.event_name != \'pull_request\'" in pull_request workflows.'
        );
      }

      // Rule 2b: Jobs running npm ci / npm install on pull_request must not hold write permissions
      if (
        hasPullRequestTrigger &&
        !stepExcludesPr &&
        jobHasWritePermissions &&
        runScript &&
        /\bnpm\s+(?:ci|install|i)\b/.test(runScript)
      ) {
        addAstViolation(
          runNode ?? stepNode,
          `jobs.${jobId}.permissions`,
          `Job "${jobId}" executes npm install/ci on pull_request while holding write permissions; drop write scopes before running package scripts.`
        );
      }

      // Rule 3: Every actions/deploy-pages step must execute inside github-pages FIFO concurrency
      if (
        usesRaw === 'actions/deploy-pages' ||
        usesRaw.startsWith('actions/deploy-pages@')
      ) {
        if (!hasGithubPagesFifoConcurrency(effectiveJobConcurrency)) {
          addAstViolation(
            usesNode ?? stepNode,
            usesRaw,
            `Job "${jobId}" uses actions/deploy-pages without "github-pages" FIFO concurrency (group: github-pages, cancel-in-progress: false, queue: max).`
          );
        }
      }

      // Rule 4: Release cache isolation & safe tar extraction in publish-artifact.yml
      if (fileName === 'publish-artifact.yml') {
        if (
          usesRaw === 'actions/cache' ||
          usesRaw.startsWith('actions/cache@')
        ) {
          const keyVal = isMap(withNode)
            ? getScalarString(withNode.get('key', true))?.trim() ?? ''
            : '';
          if (!keyVal.startsWith('release-')) {
            addAstViolation(
              usesNode ?? stepNode,
              usesRaw,
              'actions/cache in publish-artifact.yml must use a "release-" namespaced cache key.'
            );
          }
          if (isMap(withNode) && withNode.has('restore-keys')) {
            addAstViolation(
              withNode.get('restore-keys', true) ?? usesNode ?? stepNode,
              usesRaw,
              'actions/cache in publish-artifact.yml must omit prefix "restore-keys" to enforce exact hash-locked cache hits.'
            );
          }
        }

        if (
          runScript &&
          /\btar\b[^\n]*(?:\s-[a-zA-Z]*x[a-zA-Z]*\b|\s--extract\b)/.test(runScript) &&
          (!runScript.includes('--no-same-owner') ||
            !runScript.includes('--no-same-permissions'))
        ) {
          addAstViolation(
            runNode ?? stepNode,
            `jobs.${jobId}.tar`,
            'tar archive extraction in publish-artifact.yml must pass "--no-same-owner --no-same-permissions".'
          );
        }
      }
    }
  }
}

function checkWorkflowFile(
  filePath: string,
  violations: Violation[],
  pinnedOccurrences: PinnedActionOccurrence[],
  baseDir: string = process.cwd()
): void {
  const relPath = path.relative(baseDir, filePath).replace(/\\/g, '/');
  const fileName = path.basename(filePath);
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);

  const lineCounter = new LineCounter();
  const doc = parseDocument(content, {
    version: '1.2',
    strict: true,
    lineCounter,
  });
  for (const err of doc.errors) {
    const lineNumber = err.linePos?.[0]?.line ?? 1;
    const summary = err.message.split(/\r?\n/)[0].trim();
    violations.push({
      filePath: relPath,
      lineNumber,
      lineContent: (lines[lineNumber - 1] ?? '').trim(),
      actionRef: err.code,
      reason: `YAML 1.2 parse error (${err.code}): ${summary}`,
    });
  }

  for (const warn of doc.warnings) {
    const lineNumber = warn.linePos?.[0]?.line ?? 1;
    const summary = warn.message.split(/\r?\n/)[0].trim();
    violations.push({
      filePath: relPath,
      lineNumber,
      lineContent: (lines[lineNumber - 1] ?? '').trim(),
      actionRef: warn.code,
      reason: `YAML 1.2 warning (${warn.code}): ${summary}`,
    });
  }

  if (doc.errors.length === 0) {
    evaluateAstPolicies(doc, lineCounter, lines, relPath, fileName, violations);
  }

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) {
      return; // Skip full-line comments
    }

    // Match lines containing a `uses:` directive
    const usesMatch = line.match(/(?:^|\s|-)\s*uses:\s*([^\r\n]+)/);
    if (!usesMatch) {
      return;
    }

    const rawValue = usesMatch[1].trim();
    // Separate inline comments starting with '#'
    const hashIdx = rawValue.indexOf('#');
    const rawTarget = hashIdx === -1 ? rawValue : rawValue.slice(0, hashIdx);
    const inlineComment = hashIdx === -1 ? '' : rawValue.slice(hashIdx + 1).trim();
    const actionTarget = rawTarget.trim().replace(/^['"]|['"]$/g, '');

    // Skip local path references (e.g., ./.github/workflows/publish-artifact.yml)
    if (actionTarget.startsWith('.')) {
      return;
    }

    const lastAtIdx = actionTarget.lastIndexOf('@');
    if (lastAtIdx === -1) {
      violations.push({
        filePath: relPath,
        lineNumber: index + 1,
        lineContent: line.trim(),
        actionRef: actionTarget,
        reason: 'Missing "@<commit-sha>" reference specifier.',
      });
      return;
    }

    const actionPath = actionTarget.substring(0, lastAtIdx);
    const ref = actionTarget.substring(lastAtIdx + 1);
    let hasLineViolation = false;

    const repoSegments = actionPath.split('/').filter(Boolean);
    if (repoSegments.length < 2) {
      violations.push({
        filePath: relPath,
        lineNumber: index + 1,
        lineContent: line.trim(),
        actionRef: actionTarget,
        reason: `Action target "${actionPath}" must specify "<owner>/<repo>".`,
      });
      hasLineViolation = true;
    }

    if (!COMMIT_SHA_REGEX.test(ref)) {
      violations.push({
        filePath: relPath,
        lineNumber: index + 1,
        lineContent: line.trim(),
        actionRef: actionTarget,
        reason: `Action tag "${ref}" is not a 40-character commit SHA.`,
      });
      hasLineViolation = true;
    }

    if (!inlineComment || !VERSION_COMMENT_REGEX.test(inlineComment)) {
      violations.push({
        filePath: relPath,
        lineNumber: index + 1,
        lineContent: line.trim(),
        actionRef: actionTarget,
        reason: 'Missing inline "# v..." version comment (e.g., "# v4.2.2").',
      });
      hasLineViolation = true;
    }

    if (!hasLineViolation && repoSegments.length >= 2) {
      pinnedOccurrences.push({
        filePath: relPath,
        lineNumber: index + 1,
        lineContent: line.trim(),
        actionRef: actionTarget,
        owner: repoSegments[0],
        repo: repoSegments[1],
        sha: ref.toLowerCase(),
      });
    }
  });
}

function collectActionPins(workflowsDir: string = WORKFLOWS_DIR): {
  workflowFiles: string[];
  violations: Violation[];
  pinnedOccurrences: PinnedActionOccurrence[];
} {
  const files = fs.readdirSync(workflowsDir).sort();
  const workflowFiles = files.filter(
    (f) => f.endsWith('.yml') || f.endsWith('.yaml')
  );

  const baseDir = path.resolve(workflowsDir, '..', '..');
  const violations: Violation[] = [];
  const pinnedOccurrences: PinnedActionOccurrence[] = [];

  for (const file of workflowFiles) {
    checkWorkflowFile(
      path.join(workflowsDir, file),
      violations,
      pinnedOccurrences,
      baseDir
    );
  }

  return { workflowFiles, violations, pinnedOccurrences };
}

export function checkActionPins(workflowsDir: string = WORKFLOWS_DIR): {
  workflowFiles: string[];
  violations: Violation[];
} {
  const { workflowFiles, violations } = collectActionPins(workflowsDir);
  return { workflowFiles, violations };
}

function verifyCommitViaGitSmartHttp(
  owner: string,
  repo: string,
  sha: string,
  timeoutMs: number
): string | null {
  const tempGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-action-pins-git-'));
  try {
    const initRes = spawnSync('git', ['init', '--bare', '--quiet'], {
      cwd: tempGitDir,
      encoding: 'utf8',
      timeout: timeoutMs,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    if (initRes.status !== 0) {
      return `Upstream git fallback failed to initialize repository: ${(initRes.stderr || '').trim()}`;
    }

    const remoteUrl = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}.git`;
    const fetchRes = spawnSync(
      'git',
      ['fetch', '--depth=1', '--filter=blob:none', '--no-tags', '--quiet', remoteUrl, sha],
      {
        cwd: tempGitDir,
        encoding: 'utf8',
        timeout: timeoutMs,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      }
    );
    if (fetchRes.status !== 0) {
      const stderr = (fetchRes.stderr || '').trim();
      if (/not our ref|couldn't find remote ref|Repository not found/i.test(stderr)) {
        return `Upstream commit "${sha}" does not exist in "${owner}/${repo}".`;
      }
      return `Failed to verify upstream commit "${sha}" in "${owner}/${repo}": ${stderr || 'git fetch failed'}`;
    }

    const revParseRes = spawnSync('git', ['rev-parse', '--verify', `${sha}^{commit}`], {
      cwd: tempGitDir,
      encoding: 'utf8',
      timeout: timeoutMs,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    if (revParseRes.status !== 0 || revParseRes.stdout.trim().toLowerCase() !== sha) {
      return `Upstream commit "${sha}" does not exist in "${owner}/${repo}".`;
    }

    return null;
  } finally {
    fs.rmSync(tempGitDir, { recursive: true, force: true });
  }
}

export async function verifyUpstreamActionPins(
  workflowsDir: string = WORKFLOWS_DIR,
  options: VerifyUpstreamOptions = {}
): Promise<{
  workflowFiles: string[];
  violations: Violation[];
  verifiedPins: number;
}> {
  const { workflowFiles, violations, pinnedOccurrences } = collectActionPins(workflowsDir);
  const apiBaseUrl = (
    options.apiBaseUrl ??
    process.env.GITHUB_API_URL ??
    DEFAULT_GITHUB_API_BASE_URL
  ).replace(/\/+$/, '');
  const token = (
    options.token ??
    process.env.GITHUB_TOKEN ??
    process.env.GH_TOKEN ??
    ''
  ).trim();
  const timeoutMs = options.timeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS;

  const groupedByPin = new Map<string, PinnedActionOccurrence[]>();
  for (const occurrence of pinnedOccurrences) {
    const key = `${occurrence.owner}/${occurrence.repo}@${occurrence.sha}`;
    const existing = groupedByPin.get(key);
    if (existing) {
      existing.push(occurrence);
    } else {
      groupedByPin.set(key, [occurrence]);
    }
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'wedding-website-check-action-pins',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  for (const [, occurrences] of groupedByPin.entries()) {
    const { owner, repo, sha } = occurrences[0];
    const commitUrl = `${apiBaseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(sha)}`;

    let failureReason: string | null = null;
    try {
      const response = await fetch(commitUrl, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (response.status === 404 || response.status === 422) {
        failureReason = `Upstream commit "${sha}" does not exist in "${owner}/${repo}" (HTTP ${response.status}).`;
      } else if (
        (response.status === 403 || response.status === 429) &&
        !token &&
        apiBaseUrl === DEFAULT_GITHUB_API_BASE_URL
      ) {
        failureReason = verifyCommitViaGitSmartHttp(owner, repo, sha, timeoutMs);
      } else if (!response.ok) {
        failureReason = `Failed to verify upstream commit "${sha}" in "${owner}/${repo}" (HTTP ${response.status} ${response.statusText}).`;
      } else {
        const body = (await response.json()) as { sha?: string };
        if (typeof body.sha === 'string' && body.sha.toLowerCase() !== sha) {
          failureReason = `Upstream commit lookup for "${owner}/${repo}@${sha}" resolved to mismatched SHA "${body.sha}".`;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failureReason = `Upstream commit check failed for "${owner}/${repo}@${sha}": ${message}`;
    }

    if (failureReason) {
      for (const occurrence of occurrences) {
        violations.push({
          filePath: occurrence.filePath,
          lineNumber: occurrence.lineNumber,
          lineContent: occurrence.lineContent,
          actionRef: occurrence.actionRef,
          reason: failureReason,
        });
      }
    }
  }

  return {
    workflowFiles,
    violations,
    verifiedPins: groupedByPin.size,
  };
}

function reportViolationsAndExit(violations: Violation[]): never {
  console.error(
    `\n❌ Found ${violations.length} workflow YAML or action pin violation(s):\n`
  );
  violations.forEach((v, idx) => {
    console.error(`  [${idx + 1}] ${v.filePath}:${v.lineNumber}`);
    console.error(`      Line: "${v.lineContent}"`);
    console.error(`      Reason: ${v.reason}\n`);
  });

  console.error(`
================================================================================
ACTIONABLE REMEDIATION:
--------------------------------------------------------------------------------
1. All workflow files in .github/workflows/ must be valid YAML 1.2 with zero
   parser errors or unresolved tag warnings (quote conditionals starting with "!").
2. All third-party GitHub Actions must be pinned to full 40-character commit SHAs
   that exist in the upstream GitHub repository.
3. Every third-party uses: line must include an inline "# v..." version comment:
   uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
4. Local workflow references (starting with ./ or ./.github/) do not require commit SHAs.
5. Every non-cancelling concurrency block must set "queue: max" to queue pending runs in FIFO order.
6. Every job invoking actions/deploy-pages must set concurrency: { group: github-pages, cancel-in-progress: false, queue: max }.
================================================================================
`);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const unknownArgs = args.filter((arg) => arg !== '--verify-upstream');
  if (unknownArgs.length > 0) {
    console.error(`❌ Unknown option(s): ${unknownArgs.join(', ')}`);
    process.exit(1);
  }

  const verifyUpstream = args.includes('--verify-upstream');
  console.log(
    verifyUpstream
      ? '🔍 Checking GitHub Actions workflow YAML 1.2 syntax, version comments, and upstream action pin SHAs...'
      : '🔍 Checking GitHub Actions workflow YAML 1.2 syntax, action pin SHAs, and version comments...'
  );

  if (!fs.existsSync(WORKFLOWS_DIR)) {
    console.error(`❌ Workflows directory not found at: ${WORKFLOWS_DIR}`);
    process.exit(1);
  }

  if (verifyUpstream) {
    const { workflowFiles, violations, verifiedPins } = await verifyUpstreamActionPins(
      WORKFLOWS_DIR
    );
    if (violations.length > 0) {
      reportViolationsAndExit(violations);
    }
    console.log(
      `✅ Workflow YAML 1.2 and upstream action pin validation passed! All ${workflowFiles.length} workflow file(s) parse cleanly and ${verifiedPins} unique action pin SHA(s) resolved upstream.`
    );
    process.exit(0);
  }

  const { workflowFiles, violations } = checkActionPins(WORKFLOWS_DIR);
  if (violations.length > 0) {
    reportViolationsAndExit(violations);
  }

  console.log(
    `✅ Workflow YAML 1.2 and action pin validation passed! All ${workflowFiles.length} workflow file(s) parse cleanly and pin third-party actions to 40-character commit SHAs with version comments.`
  );
  process.exit(0);
}

const isDirectExecution =
  typeof process.argv[1] === 'string' &&
  (path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url)) ||
    process.argv[1].endsWith('check-action-pins.ts') ||
    process.argv[1].endsWith('check-action-pins.js'));

if (isDirectExecution) {
  void main();
}
