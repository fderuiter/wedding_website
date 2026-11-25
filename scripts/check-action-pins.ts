import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isMap, isPair, isScalar, isSeq, LineCounter, parseDocument } from 'yaml';
import {
  conditionExcludesTrigger,
  getUntrustedWorkflowTriggers,
  permissionsHaveWriteScope,
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
];

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
  pinnedOccurrences: PinnedActionOccurrence[]
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
  const untrustedTriggers = getUntrustedWorkflowTriggers(onNode);
  const hasUntrustedTrigger = untrustedTriggers.length > 0;
  const untrustedTriggerLabel = untrustedTriggers.join('/');
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
        untrustedTriggers.every(
          (trigger) =>
            conditionExcludesTrigger(jobIf, trigger) ||
            conditionExcludesTrigger(stepIf, trigger)
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
        const guardHint = untrustedTriggers
          .map((trigger) => `github.event_name != '${trigger}'`)
          .join(' && ');
        addAstViolation(
          usesNode ?? stepNode,
          usesRaw,
          `crazy-max/ghaction-github-runtime must be guarded with "if: ${guardHint}" in ${untrustedTriggerLabel} workflows.`
        );
      }

      // Rule 2b: Jobs running npm ci / npm install on untrusted triggers must not hold write permissions
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

  evaluateAstPolicies(
    doc,
    lineCounter,
    lines,
    relPath,
    fileName,
    violations,
    pinnedOccurrences
  );
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

export async function verifyUpstreamActionPins(
  workflowsDir: string = WORKFLOWS_DIR,
  options: VerifyUpstreamOptions = {}
): Promise<{
  workflowFiles: string[];
  violations: Violation[];
  verifiedPins: number;
}> {
  const { workflowFiles, violations, pinnedOccurrences } = collectActionPins(workflowsDir);
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
