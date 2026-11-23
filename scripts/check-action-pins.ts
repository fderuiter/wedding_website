import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseDocument } from 'yaml';

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

function checkWorkflowFile(
  filePath: string,
  violations: Violation[],
  pinnedOccurrences: PinnedActionOccurrence[],
  baseDir: string = process.cwd()
): void {
  const relPath = path.relative(baseDir, filePath).replace(/\\/g, '/');
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);

  const doc = parseDocument(content, { version: '1.2', strict: true });
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
