import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  COMMIT_SHA_REGEX,
  PinnedActionOccurrence,
  VerifyUpstreamOptions,
  Violation,
} from './types';

const DEFAULT_GITHUB_API_BASE_URL = 'https://api.github.com';
const DEFAULT_GITHUB_GIT_BASE_URL = 'https://github.com';
const DEFAULT_UPSTREAM_TIMEOUT_MS = 15000;
const MAX_TAG_PEEL_DEPTH = 5;

interface BranchEntry {
  name: string;
  sha: string;
}

interface UpstreamApiCache {
  tagCommits: Map<string, string | null>;
  defaultBranches: Map<string, string | null>;
  repoBranches: Map<string, BranchEntry[] | null>;
}

function verifyCommitViaGitSmartHttp(
  owner: string,
  repo: string,
  sha: string,
  versionTag: string,
  timeoutMs: number,
  gitBaseUrl: string = DEFAULT_GITHUB_GIT_BASE_URL
): string | null {
  const tempGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-action-pins-git-'));
  const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  const normalizedGitBase = gitBaseUrl.replace(/\/+$/, '');
  const remoteUrl = `${normalizedGitBase}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}.git`;

  try {
    const initRes = spawnSync('git', ['init', '--bare', '--quiet'], {
      cwd: tempGitDir,
      encoding: 'utf8',
      timeout: timeoutMs,
      env: gitEnv,
    });
    if (initRes.status !== 0) {
      return `Upstream git fallback failed to initialize repository: ${(initRes.stderr || '').trim()}`;
    }

    const lsRemoteRes = spawnSync(
      'git',
      ['ls-remote', remoteUrl, 'refs/heads/*', 'refs/tags/*'],
      {
        cwd: tempGitDir,
        encoding: 'utf8',
        timeout: timeoutMs,
        env: gitEnv,
      }
    );
    if (lsRemoteRes.status !== 0) {
      const stderr = (lsRemoteRes.stderr || '').trim();
      if (/Repository not found|does not appear to be a git repository/i.test(stderr)) {
        return `Upstream repository "${owner}/${repo}" does not exist or is unreachable.`;
      }
      return `Failed to query upstream refs for "${owner}/${repo}": ${stderr || 'git ls-remote failed'}`;
    }

    const headCommits = new Set<string>();
    const rawTags = new Map<string, string>();
    const peeledTags = new Map<string, string>();

    for (const line of lsRemoteRes.stdout.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const tabIdx = trimmed.indexOf('\t');
      if (tabIdx === -1) continue;
      const refSha = trimmed.slice(0, tabIdx).trim().toLowerCase();
      const refName = trimmed.slice(tabIdx + 1).trim();
      if (!COMMIT_SHA_REGEX.test(refSha)) continue;

      if (refName.startsWith('refs/heads/')) {
        headCommits.add(refSha);
      } else if (refName.startsWith('refs/tags/')) {
        if (refName.endsWith('^{}')) {
          peeledTags.set(refName.slice(0, -3), refSha);
        } else {
          rawTags.set(refName, refSha);
        }
      }
    }

    // Resolve tag commit SHAs, preferring peeled annotated tag targets (`^{}`) over tag object SHAs.
    const tagCommits = new Map<string, string>();
    for (const [tagRef, rawSha] of rawTags.entries()) {
      tagCommits.set(tagRef, peeledTags.get(tagRef) ?? rawSha);
    }
    for (const [tagRef, peeledSha] of peeledTags.entries()) {
      tagCommits.set(tagRef, peeledSha);
    }

    const expectedTagRef = `refs/tags/${versionTag}`;
    if (tagCommits.get(expectedTagRef) === sha || headCommits.has(sha)) {
      return null;
    }
    for (const tagCommitSha of tagCommits.values()) {
      if (tagCommitSha === sha) {
        return null;
      }
    }

    // Commit is not at the exact tip of a head or tag; fetch upstream heads and tags only
    // (never fetching `<sha>` directly, which would admit unmerged fork commits).
    const remoteAddRes = spawnSync('git', ['remote', 'add', 'origin', remoteUrl], {
      cwd: tempGitDir,
      encoding: 'utf8',
      timeout: timeoutMs,
      env: gitEnv,
    });
    if (remoteAddRes.status !== 0) {
      return `Upstream git fallback failed to configure origin: ${(remoteAddRes.stderr || '').trim()}`;
    }

    const fetchRes = spawnSync(
      'git',
      [
        'fetch',
        '--filter=blob:none',
        '--no-tags',
        '--quiet',
        'origin',
        '+refs/heads/*:refs/remotes/origin/*',
        '+refs/tags/*:refs/tags/*',
      ],
      {
        cwd: tempGitDir,
        encoding: 'utf8',
        timeout: timeoutMs,
        env: gitEnv,
      }
    );
    if (fetchRes.status !== 0) {
      const stderr = (fetchRes.stderr || '').trim();
      return `Failed to fetch upstream branches and tags in "${owner}/${repo}": ${stderr || 'git fetch failed'}`;
    }

    const revParseRes = spawnSync('git', ['rev-parse', '--verify', `${sha}^{commit}`], {
      cwd: tempGitDir,
      encoding: 'utf8',
      timeout: timeoutMs,
      env: gitEnv,
    });
    if (revParseRes.status !== 0 || revParseRes.stdout.trim().toLowerCase() !== sha) {
      return `Upstream commit "${sha}" is not reachable from tag "${versionTag}" or any branch/tag in "${owner}/${repo}" (nonexistent or unmerged fork commit).`;
    }

    const containsRes = spawnSync(
      'git',
      [
        'for-each-ref',
        '--contains',
        sha,
        '--format=%(refname)',
        'refs/remotes/origin',
        'refs/tags',
      ],
      {
        cwd: tempGitDir,
        encoding: 'utf8',
        timeout: timeoutMs,
        env: gitEnv,
      }
    );
    if (containsRes.status !== 0 || !containsRes.stdout.trim()) {
      return `Upstream commit "${sha}" is not reachable from tag "${versionTag}" or any branch/tag in "${owner}/${repo}" (unmerged fork commit).`;
    }

    return null;
  } finally {
    fs.rmSync(tempGitDir, { recursive: true, force: true });
  }
}

async function verifyUpstreamAncestryViaRestApi(
  apiBaseUrl: string,
  headers: Record<string, string>,
  owner: string,
  repo: string,
  sha: string,
  versionTag: string,
  timeoutMs: number,
  canFallbackToGit: boolean,
  gitBaseUrl: string,
  cache: UpstreamApiCache
): Promise<string | null> {
  const encodedOwner = encodeURIComponent(owner);
  const encodedRepo = encodeURIComponent(repo);
  const repoCacheKey = `${owner}/${repo}`;

  const checkCompareIsAncestor = async (
    baseRefOrSha: string
  ): Promise<{ verified: boolean; error: string | null; rateLimited: boolean }> => {
    const compareUrl = `${apiBaseUrl}/repos/${encodedOwner}/${encodedRepo}/compare/${encodeURIComponent(baseRefOrSha)}...${encodeURIComponent(sha)}`;
    const compareRes = await fetch(compareUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (
      (compareRes.status === 403 || compareRes.status === 429) &&
      canFallbackToGit
    ) {
      return { verified: false, error: null, rateLimited: true };
    }
    if (compareRes.status === 404) {
      return { verified: false, error: null, rateLimited: false };
    }
    if (!compareRes.ok) {
      return {
        verified: false,
        error: `Failed to verify upstream ancestry for "${owner}/${repo}@${sha}" (HTTP ${compareRes.status} ${compareRes.statusText}).`,
        rateLimited: false,
      };
    }
    const compareBody = (await compareRes.json()) as { status?: string };
    return {
      verified:
        compareBody.status === 'identical' || compareBody.status === 'behind',
      error: null,
      rateLimited: false,
    };
  };

  // 1. Check `# v...` tag ref (peeling annotated tags when object.type === 'tag').
  if (versionTag) {
    const tagCacheKey = `${repoCacheKey}#${versionTag}`;
    let resolvedTagSha: string | null | undefined = cache.tagCommits.get(tagCacheKey);

    if (resolvedTagSha === undefined) {
      const tagRefUrl = `${apiBaseUrl}/repos/${encodedOwner}/${encodedRepo}/git/ref/tags/${encodeURIComponent(versionTag)}`;
      const tagRefRes = await fetch(tagRefUrl, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (
        (tagRefRes.status === 403 || tagRefRes.status === 429) &&
        canFallbackToGit
      ) {
        return verifyCommitViaGitSmartHttp(owner, repo, sha, versionTag, timeoutMs, gitBaseUrl);
      }

      if (tagRefRes.ok) {
        const tagRefBody = (await tagRefRes.json()) as {
          object?: { type?: string; sha?: string };
        };
        let currentType = tagRefBody.object?.type;
        let currentSha = tagRefBody.object?.sha;
        let peelDepth = 0;

        while (
          currentType === 'tag' &&
          typeof currentSha === 'string' &&
          currentSha.length > 0 &&
          peelDepth < MAX_TAG_PEEL_DEPTH
        ) {
          peelDepth += 1;
          const tagObjUrl = `${apiBaseUrl}/repos/${encodedOwner}/${encodedRepo}/git/tags/${encodeURIComponent(currentSha)}`;
          const tagObjRes = await fetch(tagObjUrl, {
            method: 'GET',
            headers,
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (
            (tagObjRes.status === 403 || tagObjRes.status === 429) &&
            canFallbackToGit
          ) {
            return verifyCommitViaGitSmartHttp(
              owner,
              repo,
              sha,
              versionTag,
              timeoutMs,
              gitBaseUrl
            );
          }
          if (!tagObjRes.ok) {
            return `Failed to peel annotated tag "${versionTag}" for "${owner}/${repo}@${sha}" (HTTP ${tagObjRes.status} ${tagObjRes.statusText}).`;
          }
          const tagObjBody = (await tagObjRes.json()) as {
            object?: { type?: string; sha?: string };
          };
          currentType = tagObjBody.object?.type;
          currentSha = tagObjBody.object?.sha;
        }

        resolvedTagSha =
          currentType === 'commit' && typeof currentSha === 'string'
            ? currentSha.toLowerCase()
            : null;
        cache.tagCommits.set(tagCacheKey, resolvedTagSha);
      } else if (tagRefRes.status === 404) {
        resolvedTagSha = null;
        cache.tagCommits.set(tagCacheKey, null);
      } else {
        return `Failed to query upstream tag "${versionTag}" for "${owner}/${repo}@${sha}" (HTTP ${tagRefRes.status} ${tagRefRes.statusText}).`;
      }
    }

    if (resolvedTagSha) {
      if (resolvedTagSha === sha) {
        return null;
      }
      const tagCompare = await checkCompareIsAncestor(resolvedTagSha);
      if (tagCompare.rateLimited) {
        return verifyCommitViaGitSmartHttp(
          owner,
          repo,
          sha,
          versionTag,
          timeoutMs,
          gitBaseUrl
        );
      }
      if (tagCompare.error) {
        return tagCompare.error;
      }
      if (tagCompare.verified) {
        return null;
      }
    }
  }

  // 2. Check upstream default branch and repository branches (`refs/heads/*`).
  const checkedBranches = new Set<string>();
  let defaultBranch = cache.defaultBranches.get(repoCacheKey);
  if (defaultBranch === undefined) {
    const repoUrl = `${apiBaseUrl}/repos/${encodedOwner}/${encodedRepo}`;
    const repoRes = await fetch(repoUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if ((repoRes.status === 403 || repoRes.status === 429) && canFallbackToGit) {
      return verifyCommitViaGitSmartHttp(owner, repo, sha, versionTag, timeoutMs, gitBaseUrl);
    }
    if (repoRes.ok) {
      const repoBody = (await repoRes.json()) as { default_branch?: string };
      defaultBranch =
        typeof repoBody.default_branch === 'string' && repoBody.default_branch.trim()
          ? repoBody.default_branch.trim()
          : null;
      cache.defaultBranches.set(repoCacheKey, defaultBranch);
    } else if (repoRes.status === 404) {
      defaultBranch = null;
      cache.defaultBranches.set(repoCacheKey, null);
    } else {
      return `Failed to query upstream repository metadata for "${owner}/${repo}" (HTTP ${repoRes.status} ${repoRes.statusText}).`;
    }
  }

  if (defaultBranch) {
    checkedBranches.add(defaultBranch);
    const defaultCompare = await checkCompareIsAncestor(defaultBranch);
    if (defaultCompare.rateLimited) {
      return verifyCommitViaGitSmartHttp(
        owner,
        repo,
        sha,
        versionTag,
        timeoutMs,
        gitBaseUrl
      );
    }
    if (defaultCompare.error) {
      return defaultCompare.error;
    }
    if (defaultCompare.verified) {
      return null;
    }
  }

  let branches = cache.repoBranches.get(repoCacheKey);
  if (branches === undefined) {
    const branchesUrl = `${apiBaseUrl}/repos/${encodedOwner}/${encodedRepo}/branches?per_page=100`;
    const branchesRes = await fetch(branchesUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (
      (branchesRes.status === 403 || branchesRes.status === 429) &&
      canFallbackToGit
    ) {
      return verifyCommitViaGitSmartHttp(owner, repo, sha, versionTag, timeoutMs, gitBaseUrl);
    }
    if (branchesRes.ok) {
      const branchesBody = (await branchesRes.json()) as Array<{
        name?: string;
        commit?: { sha?: string };
      }>;
      branches = Array.isArray(branchesBody)
        ? branchesBody.map((branch) => ({
          name: typeof branch.name === 'string' ? branch.name.trim() : '',
          sha:
            typeof branch.commit?.sha === 'string'
              ? branch.commit.sha.trim().toLowerCase()
              : '',
        }))
        : [];
      cache.repoBranches.set(repoCacheKey, branches);
    } else if (branchesRes.status === 404) {
      branches = null;
      cache.repoBranches.set(repoCacheKey, null);
    } else {
      return `Failed to query upstream branches for "${owner}/${repo}" (HTTP ${branchesRes.status} ${branchesRes.statusText}).`;
    }
  }

  if (branches) {
    for (const branch of branches) {
      if (branch.sha === sha) {
        return null;
      }
      if (!branch.name || checkedBranches.has(branch.name)) {
        continue;
      }
      checkedBranches.add(branch.name);
      const branchCompare = await checkCompareIsAncestor(branch.sha || branch.name);
      if (branchCompare.rateLimited) {
        return verifyCommitViaGitSmartHttp(
          owner,
          repo,
          sha,
          versionTag,
          timeoutMs,
          gitBaseUrl
        );
      }
      if (branchCompare.error) {
        return branchCompare.error;
      }
      if (branchCompare.verified) {
        return null;
      }
    }
  }

  return `Upstream commit "${sha}" is not reachable from tag "${versionTag}" or any branch in "${owner}/${repo}" (unmerged fork commit).`;
}

export async function verifyUpstreamPins(
  pinnedOccurrences: PinnedActionOccurrence[],
  violations: Violation[],
  options: VerifyUpstreamOptions = {}
): Promise<number> {
  const apiBaseUrl = (
    options.apiBaseUrl ??
    process.env.GITHUB_API_URL ??
    DEFAULT_GITHUB_API_BASE_URL
  ).replace(/\/+$/, '');
  const gitBaseUrl = (options.gitBaseUrl ?? DEFAULT_GITHUB_GIT_BASE_URL).replace(
    /\/+$/,
    ''
  );
  const token = (
    options.token ??
    process.env.GITHUB_TOKEN ??
    process.env.GH_TOKEN ??
    ''
  ).trim();
  const timeoutMs = options.timeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS;
  const canFallbackToGit =
    !token &&
    (apiBaseUrl === DEFAULT_GITHUB_API_BASE_URL || Boolean(options.gitBaseUrl));

  const groupedByPin = new Map<string, PinnedActionOccurrence[]>();
  for (const occurrence of pinnedOccurrences) {
    const key = `${occurrence.owner}/${occurrence.repo}@${occurrence.sha}#${occurrence.versionTag}`;
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

  const cache: UpstreamApiCache = {
    tagCommits: new Map(),
    defaultBranches: new Map(),
    repoBranches: new Map(),
  };

  for (const [, occurrences] of groupedByPin.entries()) {
    const { owner, repo, sha, versionTag } = occurrences[0];
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
      } else if ((response.status === 403 || response.status === 429) && canFallbackToGit) {
        failureReason = verifyCommitViaGitSmartHttp(
          owner,
          repo,
          sha,
          versionTag,
          timeoutMs,
          gitBaseUrl
        );
      } else if (!response.ok) {
        failureReason = `Failed to verify upstream commit "${sha}" in "${owner}/${repo}" (HTTP ${response.status} ${response.statusText}).`;
      } else {
        const body = (await response.json()) as { sha?: string };
        if (typeof body.sha === 'string' && body.sha.toLowerCase() !== sha) {
          failureReason = `Upstream commit lookup for "${owner}/${repo}@${sha}" resolved to mismatched SHA "${body.sha}".`;
        } else {
          failureReason = await verifyUpstreamAncestryViaRestApi(
            apiBaseUrl,
            headers,
            owner,
            repo,
            sha,
            versionTag,
            timeoutMs,
            canFallbackToGit,
            gitBaseUrl,
            cache
          );
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

  return groupedByPin.size;
}
