import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isMap, isPair, isScalar, isSeq, LineCounter, parseDocument } from 'yaml';
import {
  conditionExcludesTrigger,
  extractLocalWorkflowCallTarget,
  getUntrustedWorkflowTriggers,
  permissionsHaveWriteScope,
  UntrustedTriggerInfo,
} from './action-pins/condition-parser';
import {
  findMapPair,
  getConditionString,
  getNodeLineNumber,
  getScalarString,
  PinnedActionOccurrence,
  VerifyUpstreamOptions,
  Violation,
} from './action-pins/types';
import { verifyUpstreamPins } from './action-pins/upstream-verifier';
import { validateUsesPair } from './action-pins/uses-validator';

const WORKFLOWS_DIR = path.join(process.cwd(), '.github', 'workflows');

const REMEDIATION_STEPS = [
  'All workflow files in .github/workflows/ must be valid YAML 1.2 with zero\n   parser errors or unresolved tag warnings (quote conditionals starting with "!").',
  'All third-party GitHub Actions and reusable workflows must be pinned to full\n   40-character commit SHAs reachable from an upstream tag or branch.',
  'Every third-party uses: directive must include an inline "# v..." version comment:\n   uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
  'Local workflow references (starting with ./) do not require commit SHAs.',
  'Every non-cancelling concurrency block must set "queue: max" to queue pending runs in FIFO order.',
  'Every job invoking actions/deploy-pages must set concurrency: { group: github-pages, cancel-in-progress: false, queue: max }.',
  'Every runs-on job must declare an integer "timeout-minutes" between 1 and 60 (reusable workflow caller jobs with uses: and no runs-on are exempt), and any step "timeout-minutes" must be an integer strictly less than its enclosing job "timeout-minutes".',
  'Step "run" scripts must bind GitHub Actions expressions via "env:" instead of interpolating "${{ ... }}" directly.',
  'Jobs triggered directly or via local workflow_call by untrusted events (pull_request, pull_request_target, workflow_run) must not execute actions/checkout, npm, or repository scripts while holding write permissions.',
  'Reusable workflow callers must pass minimal explicit secret maps instead of "secrets: inherit", and workflow_call.secrets must omit unused secret declarations.',
  'Every "docker login" command and "docker/login-action" step must isolate credentials to a temporary DOCKER_CONFIG directory (mktemp -d) and delete it before later steps run.',
  'publish-artifact.yml must isolate BuildKit GHA cache scopes under "release-*" and validate cache tar archives before extraction; webhook curl calls must never follow redirects (--location / -L).',
];

function escapeRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectScalarStrings(node: unknown, out: string[] = []): string[] {
  if (isScalar(node)) {
    const str = getScalarString(node);
    if (str !== null) {
      out.push(str);
    }
    return out;
  }
  if (isSeq(node)) {
    for (const item of node.items) {
      collectScalarStrings(item, out);
    }
    return out;
  }
  if (isMap(node)) {
    for (const pair of node.items) {
      if (isPair(pair)) {
        collectScalarStrings(pair.key, out);
        collectScalarStrings(pair.value, out);
      }
    }
  }
  return out;
}

function getScopedDockerConfigBinding(envNode: unknown): string | null {
  if (!isMap(envNode) || !envNode.has('DOCKER_CONFIG')) {
    return null;
  }
  const val = getScalarString(envNode.get('DOCKER_CONFIG', true))?.trim() ?? '';
  if (!val || /^~\/\.docker\b|^\$HOME\/\.docker\b|^\$\{HOME\}\/\.docker\b/.test(val)) {
    return null;
  }
  return val;
}

function subsequentStepCleansDockerConfig(
  stepsItems: unknown[],
  fromIdx: number
): boolean {
  for (let idx = fromIdx + 1; idx < stepsItems.length; idx += 1) {
    const candidate = stepsItems[idx];
    if (!isMap(candidate)) {
      continue;
    }
    const candidateIf = getConditionString(candidate.get('if', true)) ?? '';
    const candidateRun = getScalarString(candidate.get('run', true)) ?? '';
    if (
      /\balways\s*\(\s*\)/.test(candidateIf) &&
      /\brm\s+-rf\b/.test(candidateRun) &&
      (/DOCKER_CONFIG/.test(candidateRun) ||
        Boolean(getScopedDockerConfigBinding(candidate.get('env', true))) ||
        (isMap(candidate.get('env', true)) &&
          collectScalarStrings(candidate.get('env', true)).some((s) =>
            /docker-config|DOCKER_CONFIG/i.test(s)
          )))
    ) {
      return true;
    }
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
  violations: Violation[],
  pinnedOccurrences: PinnedActionOccurrence[],
  propagatedTriggers: UntrustedTriggerInfo[] = []
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
  const directTriggers = getUntrustedWorkflowTriggers(onNode);
  const triggerInfos: UntrustedTriggerInfo[] = directTriggers.map((trigger) => ({
    trigger,
    viaWorkflowCall: false,
  }));
  for (const prop of propagatedTriggers) {
    if (!triggerInfos.some((existing) => existing.trigger === prop.trigger)) {
      triggerInfos.push(prop);
    }
  }
  const hasUntrustedTrigger = triggerInfos.length > 0;
  const untrustedTriggerLabel = triggerInfos
    .map((info) =>
      info.viaWorkflowCall && info.callerChain
        ? `${info.trigger} (via workflow_call from ${info.callerChain})`
        : info.trigger
    )
    .join('/');
  const topPermissionsNode: unknown = doc.contents.get('permissions', true);
  const topConcurrencyNode: unknown = doc.contents.get('concurrency', true);

  checkConcurrencyFifoQueue(topConcurrencyNode, 'concurrency');

  // Rule: workflow_call.secrets must not declare unused secrets
  const jobsNode: unknown = doc.contents.get('jobs', true);
  if (isMap(onNode)) {
    const workflowCallNode: unknown = onNode.get('workflow_call', true);
    if (isMap(workflowCallNode)) {
      const secretsDeclNode: unknown = workflowCallNode.get('secrets', true);
      if (isMap(secretsDeclNode)) {
        const jobsScalarStrings = collectScalarStrings(jobsNode);
        for (const pair of secretsDeclNode.items) {
          if (isPair(pair) && isScalar(pair.key) && typeof pair.key.value === 'string') {
            const secretName = pair.key.value.trim();
            if (!secretName) {
              continue;
            }
            const secretRefPattern = new RegExp(
              `\\bsecrets\\.${escapeRegExp(secretName)}\\b|\\bsecrets\\[\\s*['"]${escapeRegExp(secretName)}['"]\\s*\\]`
            );
            const isReferencedInJobs = jobsScalarStrings.some((str) =>
              secretRefPattern.test(str)
            );
            if (!isReferencedInJobs) {
              addAstViolation(
                pair.key,
                `on.workflow_call.secrets.${secretName}`,
                `Reusable workflow secret "${secretName}" is declared under workflow_call.secrets in ${fileName} but never referenced in jobs.`
              );
            }
          }
        }
      }
    }
  }

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

  if (!isMap(jobsNode)) {
    return;
  }

  for (const jobPair of jobsNode.items) {
    if (!isPair(jobPair) || !isScalar(jobPair.key) || !isMap(jobPair.value)) {
      continue;
    }
    const jobId = String(jobPair.key.value);
    const jobMap = jobPair.value;

    const jobUsesPair = findMapPair(jobMap, 'uses');
    if (jobUsesPair) {
      validateUsesPair(
        jobUsesPair,
        `jobs.${jobId}.uses`,
        lineCounter,
        lines,
        relPath,
        violations,
        pinnedOccurrences
      );
    }

    const jobSecretsPair = findMapPair(jobMap, 'secrets');
    if (jobSecretsPair) {
      const secretsScalar = getScalarString(jobSecretsPair.value)?.trim();
      if (secretsScalar === 'inherit') {
        addAstViolation(
          jobSecretsPair.value ?? jobSecretsPair.key,
          `jobs.${jobId}.secrets`,
          `Job "${jobId}" uses "secrets: inherit"; pass only minimal explicit secrets required by the called reusable workflow.`
        );
      }
    }

    const jobEnvNode: unknown = jobMap.get('env', true);

    const jobIf = getConditionString(jobMap.get('if', true));
    const jobPermissionsNode: unknown = jobMap.has('permissions')
      ? jobMap.get('permissions', true)
      : topPermissionsNode;
    const jobHasWritePermissions = permissionsHaveWriteScope(jobPermissionsNode);

    const jobConcurrencyNode: unknown = jobMap.get('concurrency', true);
    checkConcurrencyFifoQueue(jobConcurrencyNode, `jobs.${jobId}.concurrency`);
    const effectiveJobConcurrency: unknown = jobMap.has('concurrency')
      ? jobConcurrencyNode
      : topConcurrencyNode;

    // Rule: Every runs-on job must declare an integer timeout-minutes between 1 and 60
    let validJobTimeoutMinutes: number | null = null;
    if (jobMap.has('runs-on')) {
      const timeoutPair = findMapPair(jobMap, 'timeout-minutes');
      if (!timeoutPair) {
        addAstViolation(
          jobPair.key,
          `jobs.${jobId}.timeout-minutes`,
          `Job "${jobId}" with runs-on must set an explicit integer "timeout-minutes" between 1 and 60 to prevent 6-hour hung runner locks.`
        );
      } else {
        const timeoutNode: unknown = timeoutPair.value;
        if (
          isScalar(timeoutNode) &&
          typeof timeoutNode.value === 'number' &&
          Number.isInteger(timeoutNode.value) &&
          timeoutNode.value >= 1 &&
          timeoutNode.value <= 60
        ) {
          validJobTimeoutMinutes = timeoutNode.value;
        } else {
          const formattedActual = isScalar(timeoutNode)
            ? JSON.stringify(timeoutNode.value)
            : 'non-scalar value';
          addAstViolation(
            timeoutPair.key ?? timeoutNode ?? jobPair.key,
            `jobs.${jobId}.timeout-minutes`,
            `Job "${jobId}" must set "timeout-minutes" to an integer between 1 and 60 (got ${formattedActual}).`
          );
        }
      }
    }

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

    for (let stepIdx = 0; stepIdx < stepsNode.items.length; stepIdx += 1) {
      const stepNode: unknown = stepsNode.items[stepIdx];
      if (!isMap(stepNode)) {
        continue;
      }

      const stepTimeoutPair = findMapPair(stepNode, 'timeout-minutes');
      if (stepTimeoutPair) {
        const stepTimeoutNode: unknown = stepTimeoutPair.value;
        if (
          isScalar(stepTimeoutNode) &&
          typeof stepTimeoutNode.value === 'number' &&
          Number.isInteger(stepTimeoutNode.value) &&
          stepTimeoutNode.value >= 1 &&
          stepTimeoutNode.value <= 60
        ) {
          if (
            validJobTimeoutMinutes !== null &&
            stepTimeoutNode.value >= validJobTimeoutMinutes
          ) {
            addAstViolation(
              stepTimeoutPair.key ?? stepTimeoutNode ?? stepNode,
              `jobs.${jobId}.steps[${stepIdx}].timeout-minutes`,
              `Step ${stepIdx + 1} in job "${jobId}" sets "timeout-minutes: ${stepTimeoutNode.value}", which must be strictly less than enclosing job "timeout-minutes: ${validJobTimeoutMinutes}".`
            );
          }
        } else {
          const formattedStepTimeout = isScalar(stepTimeoutNode)
            ? JSON.stringify(stepTimeoutNode.value)
            : 'non-scalar value';
          addAstViolation(
            stepTimeoutPair.key ?? stepTimeoutNode ?? stepNode,
            `jobs.${jobId}.steps[${stepIdx}].timeout-minutes`,
            `Step ${stepIdx + 1} in job "${jobId}" must set "timeout-minutes" to an integer between 1 and 60 (got ${formattedStepTimeout}).`
          );
        }
      }

      const stepUsesPair = findMapPair(stepNode, 'uses');
      const usesNode: unknown = stepUsesPair?.value;
      const usesRaw = stepUsesPair
        ? validateUsesPair(
          stepUsesPair,
          `jobs.${jobId}.steps[${stepIdx}].uses`,
          lineCounter,
          lines,
          relPath,
          violations,
          pinnedOccurrences
        )
        : '';

      const stepIf = getConditionString(stepNode.get('if', true));
      const stepExcludesAllUntrustedTriggers =
        hasUntrustedTrigger &&
        triggerInfos.every(
          (info) =>
            conditionExcludesTrigger(jobIf, info.trigger, {
              viaWorkflowCall: info.viaWorkflowCall,
            }) ||
            conditionExcludesTrigger(stepIf, info.trigger, {
              viaWorkflowCall: info.viaWorkflowCall,
            })
        );
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

      // Rule 2a: crazy-max/ghaction-github-runtime must be guarded against untrusted triggers
      if (
        hasUntrustedTrigger &&
        (usesRaw === 'crazy-max/ghaction-github-runtime' ||
          usesRaw.startsWith('crazy-max/ghaction-github-runtime@')) &&
        !stepExcludesAllUntrustedTriggers
      ) {
        const guardHint = triggerInfos
          .map((info) => `github.event_name != '${info.trigger}'`)
          .join(' && ');
        addAstViolation(
          usesNode ?? stepNode,
          usesRaw,
          `crazy-max/ghaction-github-runtime must be guarded with "if: ${guardHint}" in ${untrustedTriggerLabel} workflows.`
        );
      }

      // Rule 2b: Jobs running actions/checkout, npm, or repository scripts on untrusted triggers must not hold write permissions
      if (
        hasUntrustedTrigger &&
        !stepExcludesAllUntrustedTriggers &&
        jobHasWritePermissions &&
        (usesRaw === 'actions/checkout' || usesRaw.startsWith('actions/checkout@'))
      ) {
        addAstViolation(
          usesNode ?? stepNode,
          `jobs.${jobId}.permissions`,
          `Job "${jobId}" executes actions/checkout on ${untrustedTriggerLabel} while holding write permissions; isolate repository checkouts to read-only jobs and move write operations to a checkout-free job.`
        );
      }

      if (
        hasUntrustedTrigger &&
        !stepExcludesAllUntrustedTriggers &&
        jobHasWritePermissions &&
        runScript &&
        /\bnpm\s+(?:ci|install|i)\b/.test(runScript)
      ) {
        addAstViolation(
          runNode ?? stepNode,
          `jobs.${jobId}.permissions`,
          `Job "${jobId}" executes npm install/ci on ${untrustedTriggerLabel} while holding write permissions; drop write scopes before running package scripts.`
        );
      } else if (
        hasUntrustedTrigger &&
        !stepExcludesAllUntrustedTriggers &&
        jobHasWritePermissions &&
        runScript &&
        (/\bnpm\s+(?:run|exec|test|t)\b/.test(runScript) ||
          /(?:^|[\s;&|()])(?:\.\/)?scripts\/[A-Za-z0-9_./-]+/.test(runScript))
      ) {
        addAstViolation(
          runNode ?? stepNode,
          `jobs.${jobId}.permissions`,
          `Job "${jobId}" executes npm or repository scripts on ${untrustedTriggerLabel} while holding write permissions; move workspace script execution to a read-only preflight job.`
        );
      }

      // Rule 2c: steps[].run must never interpolate ${{ ... }} expressions directly into shell scripts
      if (runScript && /\$\{\{/.test(runScript)) {
        addAstViolation(
          runNode ?? stepNode,
          `jobs.${jobId}.steps[${stepIdx}].run`,
          `Job "${jobId}" interpolates "\${{ ... }}" directly inside a step "run" script; bind GitHub Actions expressions via "env:" instead.`
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

      // Rule 4: Release cache isolation, safe tar extraction, scoped DOCKER_CONFIG registry logins, and non-redirecting webhook curl checks
      const stepEnvNode: unknown = stepNode.get('env', true);
      const effectiveStepDockerConfig =
        getScopedDockerConfigBinding(stepEnvNode) ??
        getScopedDockerConfigBinding(jobEnvNode);

      if (
        usesRaw === 'docker/login-action' ||
        usesRaw.startsWith('docker/login-action@')
      ) {
        if (
          !effectiveStepDockerConfig ||
          !subsequentStepCleansDockerConfig(stepsNode.items, stepIdx)
        ) {
          addAstViolation(
            usesNode ?? stepNode,
            usesRaw,
            `Job "${jobId}" uses docker/login-action without binding a temporary "DOCKER_CONFIG" directory and deleting it in a subsequent "if: always()" cleanup step.`
          );
        }
      }

      if (runScript && /\bdocker\s+login\b/.test(runScript)) {
        const inlineScopedAndCleaned =
          /\bmktemp\s+-d\b/.test(runScript) &&
          /\bDOCKER_CONFIG=/.test(runScript) &&
          /\btrap\b[^\n]*\brm\s+-rf\b/.test(runScript);
        const envScopedAndCleaned =
          Boolean(effectiveStepDockerConfig) &&
          subsequentStepCleansDockerConfig(stepsNode.items, stepIdx);
        if (!inlineScopedAndCleaned && !envScopedAndCleaned) {
          addAstViolation(
            runNode ?? stepNode,
            `jobs.${jobId}.steps[${stepIdx}].docker-login`,
            `Job "${jobId}" runs "docker login" without scoping credentials to a temporary "DOCKER_CONFIG" directory and deleting it on step exit.`
          );
        }
      }
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
          usesRaw === 'docker/build-push-action' ||
          usesRaw.startsWith('docker/build-push-action@')
        ) {
          for (const cacheField of ['cache-from', 'cache-to'] as const) {
            const cacheFieldNode: unknown = isMap(withNode)
              ? withNode.get(cacheField, true)
              : undefined;
            const cacheVal = getScalarString(cacheFieldNode)?.trim() ?? '';
            if (cacheVal) {
              const cacheEntries = cacheVal
                .split(/\r?\n/)
                .map((entry) => entry.trim())
                .filter(Boolean);
              const hasSharedGhaScope = cacheEntries.some(
                (entry) =>
                  /\btype=gha\b/.test(entry) &&
                  !/\bscope=release-[^\s,]+/.test(entry)
              );
              if (hasSharedGhaScope) {
                addAstViolation(
                  cacheFieldNode ?? usesNode ?? stepNode,
                  usesRaw,
                  `docker/build-push-action "${cacheField}" in publish-artifact.yml must isolate BuildKit GitHub Actions caches under a "scope=release-..." cache scope.`
                );
              }
            }
          }
        }

        if (isMap(stepEnvNode) && stepEnvNode.has('GHA_CACHE_SCOPE')) {
          const ghaScopeNode: unknown = stepEnvNode.get('GHA_CACHE_SCOPE', true);
          const ghaScopeVal = getScalarString(ghaScopeNode)?.trim() ?? '';
          if (!ghaScopeVal.startsWith('release-')) {
            addAstViolation(
              ghaScopeNode ?? stepEnvNode ?? stepNode,
              `jobs.${jobId}.steps[${stepIdx}].env.GHA_CACHE_SCOPE`,
              'GHA_CACHE_SCOPE in publish-artifact.yml must use a "release-" namespaced cache scope.'
            );
          }
        }
      }

      if (
        runScript &&
        /\btar\b[^\n]*(?:\s-[a-zA-Z]*x[a-zA-Z]*\b|\s--extract\b)/.test(runScript)
      ) {
        if (
          !runScript.includes('--no-same-owner') ||
          !runScript.includes('--no-same-permissions')
        ) {
          addAstViolation(
            runNode ?? stepNode,
            `jobs.${jobId}.tar`,
            `tar archive extraction in ${fileName} must pass "--no-same-owner --no-same-permissions".`
          );
        } else if (
          (runScript.includes('mounts.tar') ||
            runScript.includes('/ctx/deps.tar') ||
            runScript.includes('/ctx/next.tar')) &&
          !runScript.includes('validate_cache_archive')
        ) {
          addAstViolation(
            runNode ?? stepNode,
            `jobs.${jobId}.tar`,
            `BuildKit cache archive extraction in ${fileName} must run "validate_cache_archive" before extracting tar archives.`
          );
        }
      }

      if (runScript && /\bcurl\b/.test(runScript)) {
        const flattenedRun = runScript.replace(/\\\r?\n/g, ' ');
        const stepEnvHasWebhook =
          isMap(stepEnvNode) &&
          stepEnvNode.items.some(
            (pair) =>
              isPair(pair) &&
              isScalar(pair.key) &&
              /webhook/i.test(String(pair.key.value))
          );
        const stepReferencesWebhook =
          stepEnvHasWebhook ||
          /DEPLOY_WEBHOOK_URL|WEBHOOK_URL|X-Hub-Signature|X-Deploy-Signature/i.test(
            flattenedRun
          );
        for (const statement of flattenedRun.split(/\r?\n|;|&&|\|\|/)) {
          if (!/\bcurl\b/.test(statement)) {
            continue;
          }
          const hasLongLocation = /(?:^|\s)--location(?:-trusted)?(?:\s|$)/.test(
            statement
          );
          const hasShortLocation = /(?:^|\s)-[a-zA-Z]*L[a-zA-Z]*(?:\s|$)/.test(
            statement
          );
          const statementTargetsWebhook =
            /WEBHOOK|X-Hub-Signature|X-Deploy-Signature/i.test(statement) ||
            (stepReferencesWebhook && !/\bAPI_BASE\b|api\.github\.com/i.test(statement));
          if (hasLongLocation || (hasShortLocation && statementTargetsWebhook)) {
            addAstViolation(
              runNode ?? stepNode,
              `jobs.${jobId}.steps[${stepIdx}].curl`,
              `Job "${jobId}" invokes curl with "--location" / "-L" redirect following; signed webhook requests must fail on redirects without following them.`
            );
            break;
          }
        }
      }
    }
  }
}

interface ParsedWorkflowRecord {
  fileName: string;
  filePath: string;
  relPath: string;
  lines: string[];
  lineCounter: LineCounter;
  doc: ReturnType<typeof parseDocument>;
  directTriggers: Set<string>;
  propagatedTriggers: Map<string, string>;
}

interface LocalWorkflowCallEdge {
  callerFile: string;
  targetFile: string;
  callerJobIf: string | null;
}

function parseWorkflowRecord(
  filePath: string,
  baseDir: string = process.cwd()
): ParsedWorkflowRecord {
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

  const onNode: unknown = isMap(doc.contents) ? doc.contents.get('on', true) : undefined;
  const directTriggers = new Set<string>(getUntrustedWorkflowTriggers(onNode));

  return {
    fileName,
    filePath,
    relPath,
    lines,
    lineCounter,
    doc,
    directTriggers,
    propagatedTriggers: new Map<string, string>(),
  };
}

function extractLocalCallEdges(record: ParsedWorkflowRecord): LocalWorkflowCallEdge[] {
  if (!isMap(record.doc.contents)) {
    return [];
  }
  const jobsNode: unknown = record.doc.contents.get('jobs', true);
  if (!isMap(jobsNode)) {
    return [];
  }
  const edges: LocalWorkflowCallEdge[] = [];
  for (const jobPair of jobsNode.items) {
    if (!isPair(jobPair) || !isScalar(jobPair.key) || !isMap(jobPair.value)) {
      continue;
    }
    const jobMap = jobPair.value;
    const jobUsesPair = findMapPair(jobMap, 'uses');
    if (!jobUsesPair) {
      continue;
    }
    const usesVal = getScalarString(jobUsesPair.value);
    if (!usesVal) {
      continue;
    }
    const targetFile = extractLocalWorkflowCallTarget(usesVal);
    if (!targetFile) {
      continue;
    }
    const callerJobIf = getConditionString(jobMap.get('if', true));
    edges.push({
      callerFile: record.fileName,
      targetFile,
      callerJobIf,
    });
  }
  return edges;
}

function propagateUntrustedTriggersAcrossWorkflows(
  records: ParsedWorkflowRecord[]
): void {
  const recordByFile = new Map<string, ParsedWorkflowRecord>();
  for (const record of records) {
    recordByFile.set(record.fileName, record);
  }
  const edges = records.flatMap((record) => extractLocalCallEdges(record));
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      const caller = recordByFile.get(edge.callerFile);
      const callee = recordByFile.get(edge.targetFile);
      if (!caller || !callee) {
        continue;
      }
      const activeCallerTriggers = new Set<string>([
        ...caller.directTriggers,
        ...caller.propagatedTriggers.keys(),
      ]);
      for (const trigger of activeCallerTriggers) {
        const callerViaWorkflowCall = !caller.directTriggers.has(trigger);
        if (
          conditionExcludesTrigger(edge.callerJobIf, trigger, {
            viaWorkflowCall: callerViaWorkflowCall,
          })
        ) {
          continue;
        }
        if (
          !callee.directTriggers.has(trigger) &&
          !callee.propagatedTriggers.has(trigger)
        ) {
          const chainPrefix = caller.directTriggers.has(trigger)
            ? caller.fileName
            : `${caller.propagatedTriggers.get(trigger)} -> ${caller.fileName}`;
          callee.propagatedTriggers.set(trigger, chainPrefix);
          changed = true;
        }
      }
    }
  }
}

function evaluateWorkflowRecord(
  record: ParsedWorkflowRecord,
  violations: Violation[],
  pinnedOccurrences: PinnedActionOccurrence[]
): void {
  for (const err of record.doc.errors) {
    const lineNumber = err.linePos?.[0]?.line ?? 1;
    const summary = err.message.split(/\r?\n/)[0].trim();
    violations.push({
      filePath: record.relPath,
      lineNumber,
      lineContent: (record.lines[lineNumber - 1] ?? '').trim(),
      actionRef: err.code,
      reason: `YAML 1.2 parse error (${err.code}): ${summary}`,
    });
  }

  for (const warn of record.doc.warnings) {
    const lineNumber = warn.linePos?.[0]?.line ?? 1;
    const summary = warn.message.split(/\r?\n/)[0].trim();
    violations.push({
      filePath: record.relPath,
      lineNumber,
      lineContent: (record.lines[lineNumber - 1] ?? '').trim(),
      actionRef: warn.code,
      reason: `YAML 1.2 warning (${warn.code}): ${summary}`,
    });
  }

  const propagatedList: UntrustedTriggerInfo[] = Array.from(
    record.propagatedTriggers.entries()
  ).map(([trigger, callerChain]) => ({
    trigger,
    viaWorkflowCall: true,
    callerChain,
  }));

  evaluateAstPolicies(
    record.doc,
    record.lineCounter,
    record.lines,
    record.relPath,
    record.fileName,
    violations,
    pinnedOccurrences,
    propagatedList
  );
}

function resolveScopedWorkflowPaths(
  targetFiles: string[],
  cwd: string = process.cwd()
): string[] {
  const seen = new Set<string>();
  const resolved: string[] = [];
  for (const rawFile of targetFiles) {
    const absPath = path.resolve(cwd, rawFile);
    if (seen.has(absPath)) {
      continue;
    }
    seen.add(absPath);
    try {
      if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
        resolved.push(absPath);
      }
    } catch {
      // Ignore deleted or unreadable workflow paths
    }
  }
  return resolved.sort();
}

function findReachableCalleeFiles(
  seedFiles: Iterable<string>,
  records: ParsedWorkflowRecord[]
): Set<string> {
  const edges = records.flatMap((record) => extractLocalCallEdges(record));
  const reachable = new Set<string>();
  const queue = Array.from(seedFiles);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of edges) {
      if (edge.callerFile === current && !reachable.has(edge.targetFile)) {
        reachable.add(edge.targetFile);
        queue.push(edge.targetFile);
      }
    }
  }
  return reachable;
}

function collectActionPins(
  workflowsDir: string = WORKFLOWS_DIR,
  targetFiles?: string[]
): {
  workflowFiles: string[];
  violations: Violation[];
  pinnedOccurrences: PinnedActionOccurrence[];
} {
  const baseDir = path.resolve(workflowsDir, '..', '..');
  const violations: Violation[] = [];
  const pinnedOccurrences: PinnedActionOccurrence[] = [];

  if (targetFiles && targetFiles.length > 0) {
    const resolvedPaths = resolveScopedWorkflowPaths(targetFiles, baseDir);
    const workflowFiles = resolvedPaths.map((absPath) =>
      path.relative(workflowsDir, absPath).replace(/\\/g, '/')
    );
    if (resolvedPaths.length === 0) {
      return { workflowFiles, violations, pinnedOccurrences };
    }

    const scopedAbsSet = new Set(resolvedPaths.map((p) => path.resolve(p)));
    const scopedRecords = resolvedPaths.map((absPath) =>
      parseWorkflowRecord(absPath, baseDir)
    );
    const peerRecords: ParsedWorkflowRecord[] = [];
    if (fs.existsSync(workflowsDir)) {
      for (const entry of fs.readdirSync(workflowsDir).sort()) {
        if (!entry.endsWith('.yml') && !entry.endsWith('.yaml')) {
          continue;
        }
        const peerAbsPath = path.resolve(workflowsDir, entry);
        if (scopedAbsSet.has(peerAbsPath)) {
          continue;
        }
        try {
          if (fs.statSync(peerAbsPath).isFile()) {
            const peer = parseWorkflowRecord(peerAbsPath, baseDir);
            if (peer.doc.errors.length === 0 && peer.doc.warnings.length === 0) {
              peerRecords.push(peer);
            }
          }
        } catch {
          // Ignore unreadable peer workflow files during scoped checks
        }
      }
    }

    const allRecords = [...scopedRecords, ...peerRecords];
    propagateUntrustedTriggersAcrossWorkflows(allRecords);

    for (const record of scopedRecords) {
      evaluateWorkflowRecord(record, violations, pinnedOccurrences);
    }

    const reachableCallees = findReachableCalleeFiles(
      scopedRecords.map((r) => r.fileName),
      allRecords
    );
    for (const peer of peerRecords) {
      if (reachableCallees.has(peer.fileName) && peer.propagatedTriggers.size > 0) {
        evaluateWorkflowRecord(peer, violations, []);
      }
    }

    return { workflowFiles, violations, pinnedOccurrences };
  }

  const files = fs.readdirSync(workflowsDir).sort();
  const workflowFiles = files.filter(
    (f) => f.endsWith('.yml') || f.endsWith('.yaml')
  );

  const records = workflowFiles.map((file) =>
    parseWorkflowRecord(path.join(workflowsDir, file), baseDir)
  );
  propagateUntrustedTriggersAcrossWorkflows(records);

  for (const record of records) {
    evaluateWorkflowRecord(record, violations, pinnedOccurrences);
  }

  return { workflowFiles, violations, pinnedOccurrences };
}

export function checkActionPins(
  workflowsDir: string = WORKFLOWS_DIR,
  targetFiles?: string[]
): {
  workflowFiles: string[];
  violations: Violation[];
} {
  const { workflowFiles, violations } = collectActionPins(workflowsDir, targetFiles);
  return { workflowFiles, violations };
}

export async function verifyUpstreamActionPins(
  workflowsDir: string = WORKFLOWS_DIR,
  options: VerifyUpstreamOptions = {},
  targetFiles?: string[]
): Promise<{
  workflowFiles: string[];
  violations: Violation[];
  verifiedPins: number;
}> {
  const { workflowFiles, violations, pinnedOccurrences } = collectActionPins(
    workflowsDir,
    targetFiles
  );
  const verifiedPins = await verifyUpstreamPins(pinnedOccurrences, violations, options);

  return {
    workflowFiles,
    violations,
    verifiedPins,
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

  const formattedRemediation = REMEDIATION_STEPS.map(
    (step, idx) => `${idx + 1}. ${step}`
  ).join('\n');

  console.error(`
================================================================================
ACTIONABLE REMEDIATION:
--------------------------------------------------------------------------------
${formattedRemediation}
================================================================================
`);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const unknownArgs = args.filter(
    (arg) => arg !== '--verify-upstream' && !/\.ya?ml$/i.test(arg)
  );
  if (unknownArgs.length > 0) {
    console.error(`❌ Unknown option(s): ${unknownArgs.join(', ')}`);
    process.exit(1);
  }

  const fileArgs = args.filter((arg) => /\.ya?ml$/i.test(arg));
  const verifyUpstream = args.includes('--verify-upstream');
  console.log(
    verifyUpstream
      ? '🔍 Checking GitHub Actions workflow YAML 1.2 syntax, version comments, and upstream action pin SHAs...'
      : '🔍 Checking GitHub Actions workflow YAML 1.2 syntax, action pin SHAs, and version comments...'
  );

  if (fileArgs.length === 0 && !fs.existsSync(WORKFLOWS_DIR)) {
    console.error(`❌ Workflows directory not found at: ${WORKFLOWS_DIR}`);
    process.exit(1);
  }

  const scopedFiles = fileArgs.length > 0 ? fileArgs : undefined;

  if (verifyUpstream) {
    const { workflowFiles, violations, verifiedPins } = await verifyUpstreamActionPins(
      WORKFLOWS_DIR,
      {},
      scopedFiles
    );
    if (violations.length > 0) {
      reportViolationsAndExit(violations);
    }
    console.log(
      `✅ Workflow YAML 1.2 and upstream action pin validation passed! All ${workflowFiles.length} workflow file(s) parse cleanly and ${verifiedPins} unique action pin SHA(s) resolved upstream.`
    );
    process.exit(0);
  }

  const { workflowFiles, violations } = checkActionPins(WORKFLOWS_DIR, scopedFiles);
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
