import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { isMap, isPair, isScalar, isSeq, LineCounter, Pair, parseDocument } from 'yaml';

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
  versionTag: string;
}

interface VerifyUpstreamOptions {
  apiBaseUrl?: string;
  gitBaseUrl?: string;
  token?: string;
  timeoutMs?: number;
}

type TriState = 'true' | 'false' | 'unknown';

const WORKFLOWS_DIR = path.join(process.cwd(), '.github', 'workflows');
const COMMIT_SHA_REGEX = /^[a-fA-F0-9]{40}$/;
const VERSION_COMMENT_REGEX = /^v\d+(?:\.\d+)*(?:-[0-9A-Za-z.-]+)?(?:\s.*)?$/;
const DEFAULT_GITHUB_API_BASE_URL = 'https://api.github.com';
const DEFAULT_GITHUB_GIT_BASE_URL = 'https://github.com';
const DEFAULT_UPSTREAM_TIMEOUT_MS = 15000;
const MAX_TAG_PEEL_DEPTH = 5;
const UNTRUSTED_WORKFLOW_TRIGGERS = new Set([
  'pull_request',
  'pull_request_target',
  'workflow_run',
]);

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

function findMapPair(mapNode: unknown, keyName: string): Pair | undefined {
  if (!isMap(mapNode)) {
    return undefined;
  }
  for (const item of mapNode.items) {
    if (isPair(item) && isScalar(item.key) && item.key.value === keyName) {
      return item;
    }
  }
  return undefined;
}

function getUntrustedWorkflowTriggers(onNode: unknown): string[] {
  if (isScalar(onNode)) {
    return typeof onNode.value === 'string' && UNTRUSTED_WORKFLOW_TRIGGERS.has(onNode.value)
      ? [onNode.value]
      : [];
  }
  if (isSeq(onNode)) {
    const triggers: string[] = [];
    for (const item of onNode.items) {
      if (
        isScalar(item) &&
        typeof item.value === 'string' &&
        UNTRUSTED_WORKFLOW_TRIGGERS.has(item.value) &&
        !triggers.includes(item.value)
      ) {
        triggers.push(item.value);
      }
    }
    return triggers;
  }
  if (isMap(onNode)) {
    const triggers: string[] = [];
    for (const pair of onNode.items) {
      if (
        isPair(pair) &&
        isScalar(pair.key) &&
        typeof pair.key.value === 'string' &&
        UNTRUSTED_WORKFLOW_TRIGGERS.has(pair.key.value) &&
        !triggers.includes(pair.key.value)
      ) {
        triggers.push(pair.key.value);
      }
    }
    return triggers;
  }
  return [];
}

interface ConditionToken {
  type: 'lparen' | 'rparen' | 'not' | 'and' | 'or' | 'atom';
  value: string;
}

function unwrapIfExpression(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  if (!trimmed.includes('${{')) {
    return trimmed;
  }
  if (!trimmed.startsWith('${{') || !trimmed.endsWith('}}')) {
    return null;
  }
  const inner = trimmed.slice(3, -2).trim();
  // Reject multiple `${{ ... }}` interpolations concatenated within a single string
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '\'' && !inDouble) {
      if (inSingle && inner[i + 1] === '\'') {
        i++;
        continue;
      }
      inSingle = !inSingle;
    } else if (inDouble && ch === '\\') {
      i++;
      continue;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (!inSingle && !inDouble) {
      if (inner.startsWith('}}', i) || inner.startsWith('${{', i)) {
        return null;
      }
    }
  }
  return inner || null;
}

function tokenizeCondition(expr: string): ConditionToken[] | null {
  const tokens: ConditionToken[] = [];
  let i = 0;

  const readQuoted = (quote: '\'' | '"'): string | null => {
    const start = i;
    i++; // consume opening quote
    while (i < expr.length) {
      const ch = expr[i];
      if (quote === '\'' && ch === '\'') {
        if (expr[i + 1] === '\'') {
          i += 2;
          continue;
        }
        i++;
        return expr.slice(start, i);
      }
      if (quote === '"') {
        if (ch === '\\') {
          i += 2;
          continue;
        }
        if (ch === '"') {
          i++;
          return expr.slice(start, i);
        }
      }
      i++;
    }
    return null;
  };

  while (i < expr.length) {
    while (i < expr.length && /\s/.test(expr[i])) {
      i++;
    }
    if (i >= expr.length) {
      break;
    }

    if (expr.startsWith('&&', i)) {
      tokens.push({ type: 'and', value: '&&' });
      i += 2;
      continue;
    }
    if (expr.startsWith('||', i)) {
      tokens.push({ type: 'or', value: '||' });
      i += 2;
      continue;
    }
    if (expr[i] === '(') {
      tokens.push({ type: 'lparen', value: '(' });
      i++;
      continue;
    }
    if (expr[i] === ')') {
      tokens.push({ type: 'rparen', value: ')' });
      i++;
      continue;
    }
    if (expr[i] === '!' && expr[i + 1] !== '=') {
      tokens.push({ type: 'not', value: '!' });
      i++;
      continue;
    }

    // Read an atomic clause (such as `github.event_name != 'pull_request'`, `always()`, `cancelled()`)
    // stopping at top-level `&&`, `||`, or `)` while respecting nested function-call parentheses and quotes.
    let atom = '';
    let callParenDepth = 0;
    while (i < expr.length) {
      const ch = expr[i];
      if (ch === '\'' || ch === '"') {
        const quoted = readQuoted(ch);
        if (quoted === null) {
          return null;
        }
        atom += quoted;
        continue;
      }
      if (callParenDepth === 0) {
        if (expr.startsWith('&&', i) || expr.startsWith('||', i) || ch === ')') {
          break;
        }
      }
      if (ch === '(') {
        callParenDepth++;
        atom += ch;
        i++;
        continue;
      }
      if (ch === ')') {
        callParenDepth--;
        atom += ch;
        i++;
        continue;
      }
      atom += ch;
      i++;
    }

    if (callParenDepth !== 0) {
      return null;
    }
    const normalizedAtom = atom.replace(/\s+/g, ' ').trim();
    if (!normalizedAtom) {
      return null;
    }
    tokens.push({ type: 'atom', value: normalizedAtom });
  }

  return tokens;
}

function unquoteLiteral(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('\'') && trimmed.endsWith('\'')) {
    return trimmed.slice(1, -1).replace(/''/g, '\'');
  }
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\(.)/g, '$1');
  }
  return null;
}

function evaluateAtomForTrigger(atom: string, trigger: string): TriState {
  const trimmed = atom.trim();
  const triggerLower = trigger.toLowerCase();

  if (trimmed === 'false') {
    return 'false';
  }
  if (trimmed === 'true' || /^always\s*\(\s*\)$/.test(trimmed)) {
    return 'true';
  }

  const lhsMatch = trimmed.match(
    /^github\.event_name\s*(==|!=)\s*('(?:''|[^'])*'|"(?:\\.|[^"])*")$/
  );
  if (lhsMatch) {
    const op = lhsMatch[1];
    const compared = unquoteLiteral(lhsMatch[2])?.toLowerCase();
    if (compared !== undefined) {
      const isEqual = compared === triggerLower;
      return op === '=='
        ? isEqual
          ? 'true'
          : 'false'
        : isEqual
          ? 'false'
          : 'true';
    }
  }

  const rhsMatch = trimmed.match(
    /^('(?:''|[^'])*'|"(?:\\.|[^"])*")\s*(==|!=)\s*github\.event_name$/
  );
  if (rhsMatch) {
    const compared = unquoteLiteral(rhsMatch[1])?.toLowerCase();
    const op = rhsMatch[2];
    if (compared !== undefined) {
      const isEqual = compared === triggerLower;
      return op === '=='
        ? isEqual
          ? 'true'
          : 'false'
        : isEqual
          ? 'false'
          : 'true';
    }
  }

  return 'unknown';
}

function conditionExcludesTrigger(ifValue: string | null, trigger: string): boolean {
  if (!ifValue) {
    return false;
  }
  const expr = unwrapIfExpression(ifValue);
  if (!expr) {
    return false;
  }
  const tokens = tokenizeCondition(expr);
  if (!tokens || tokens.length === 0) {
    return false;
  }

  let pos = 0;

  const parseOr = (): TriState | null => {
    let left = parseAnd();
    if (left === null) {
      return null;
    }
    while (pos < tokens.length && tokens[pos].type === 'or') {
      pos++;
      const right = parseAnd();
      if (right === null) {
        return null;
      }
      if (left === 'true' || right === 'true') {
        left = 'true';
      } else if (left === 'false' && right === 'false') {
        left = 'false';
      } else {
        left = 'unknown';
      }
    }
    return left;
  };

  const parseAnd = (): TriState | null => {
    let left = parseUnary();
    if (left === null) {
      return null;
    }
    while (pos < tokens.length && tokens[pos].type === 'and') {
      pos++;
      const right = parseUnary();
      if (right === null) {
        return null;
      }
      if (left === 'false' || right === 'false') {
        left = 'false';
      } else if (left === 'true' && right === 'true') {
        left = 'true';
      } else {
        left = 'unknown';
      }
    }
    return left;
  };

  const parseUnary = (): TriState | null => {
    if (pos >= tokens.length) {
      return null;
    }
    if (tokens[pos].type === 'not') {
      pos++;
      const inner = parseUnary();
      if (inner === null) {
        return null;
      }
      if (inner === 'true') return 'false';
      if (inner === 'false') return 'true';
      return 'unknown';
    }
    if (tokens[pos].type === 'lparen') {
      pos++;
      const inner = parseOr();
      if (inner === null || pos >= tokens.length || tokens[pos].type !== 'rparen') {
        return null;
      }
      pos++;
      return inner;
    }
    if (tokens[pos].type === 'atom') {
      const atomVal = tokens[pos].value;
      pos++;
      return evaluateAtomForTrigger(atomVal, trigger);
    }
    return null;
  };

  const outcome = parseOr();
  if (outcome === null || pos !== tokens.length) {
    return false;
  }
  return outcome === 'false';
}

function permissionsHaveWriteScope(permissionsNode: unknown): boolean {
  if (permissionsNode === undefined || permissionsNode === null) {
    return true;
  }
  if (isScalar(permissionsNode)) {
    if (permissionsNode.value === 'read-all') {
      return false;
    }
    return true;
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
  return true;
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

function validateUsesPair(
  usesPair: Pair,
  scopeRef: string,
  lineCounter: LineCounter,
  lines: string[],
  relPath: string,
  violations: Violation[],
  pinnedOccurrences: PinnedActionOccurrence[]
): string {
  const usesNode: unknown = usesPair.value;
  const locationNode: unknown = usesNode ?? usesPair.key;
  const lineNumber = getNodeLineNumber(locationNode, lineCounter);
  const lineContent = (lines[lineNumber - 1] ?? '').trim();

  if (usesNode === null || usesNode === undefined) {
    violations.push({
      filePath: relPath,
      lineNumber,
      lineContent,
      actionRef: scopeRef,
      reason: 'Empty "uses" directive; specify a local "./..." path or "<owner>/<repo>@<40-char-commit-sha> # v...".',
    });
    return '';
  }

  if (!isScalar(usesNode)) {
    violations.push({
      filePath: relPath,
      lineNumber,
      lineContent,
      actionRef: scopeRef,
      reason: 'Non-scalar "uses" directive; "uses" must be a string scalar.',
    });
    return '';
  }

  if (usesNode.value === null) {
    violations.push({
      filePath: relPath,
      lineNumber,
      lineContent,
      actionRef: scopeRef,
      reason: 'Empty "uses" directive; specify a local "./..." path or "<owner>/<repo>@<40-char-commit-sha> # v...".',
    });
    return '';
  }

  if (typeof usesNode.value !== 'string') {
    violations.push({
      filePath: relPath,
      lineNumber,
      lineContent,
      actionRef: scopeRef,
      reason: 'Non-scalar "uses" directive; "uses" must be a string scalar.',
    });
    return '';
  }

  const actionTarget = usesNode.value.trim();
  if (!actionTarget) {
    violations.push({
      filePath: relPath,
      lineNumber,
      lineContent,
      actionRef: scopeRef,
      reason: 'Empty "uses" directive; specify a local "./..." path or "<owner>/<repo>@<40-char-commit-sha> # v...".',
    });
    return '';
  }

  // Skip local path references (e.g., ./.github/workflows/publish-artifact.yml)
  if (actionTarget.startsWith('./')) {
    return actionTarget;
  }

  if (/\s/.test(actionTarget)) {
    violations.push({
      filePath: relPath,
      lineNumber,
      lineContent,
      actionRef: actionTarget,
      reason: `Invalid whitespace in action target "${actionTarget}".`,
    });
    return actionTarget;
  }

  const lastAtIdx = actionTarget.lastIndexOf('@');
  if (lastAtIdx === -1) {
    violations.push({
      filePath: relPath,
      lineNumber,
      lineContent,
      actionRef: actionTarget,
      reason: 'Missing "@<commit-sha>" reference specifier.',
    });
    return actionTarget;
  }

  const actionPath = actionTarget.substring(0, lastAtIdx);
  const ref = actionTarget.substring(lastAtIdx + 1);
  let hasPinViolation = false;

  const rawSegments = actionPath.split('/');
  if (
    actionPath.startsWith('.') ||
    actionPath.startsWith('docker://') ||
    rawSegments.length < 2 ||
    rawSegments.some((seg) => !seg || seg === '.' || seg === '..')
  ) {
    violations.push({
      filePath: relPath,
      lineNumber,
      lineContent,
      actionRef: actionTarget,
      reason: `Action target "${actionPath}" must specify "<owner>/<repo>".`,
    });
    hasPinViolation = true;
  }

  if (!COMMIT_SHA_REGEX.test(ref)) {
    violations.push({
      filePath: relPath,
      lineNumber,
      lineContent,
      actionRef: actionTarget,
      reason: `Action tag "${ref}" is not a 40-character commit SHA.`,
    });
    hasPinViolation = true;
  }

  const rawComment = typeof usesNode.comment === 'string' ? usesNode.comment : '';
  const inlineComment = rawComment.split(/\r?\n/)[0].trim();
  if (!inlineComment || !VERSION_COMMENT_REGEX.test(inlineComment)) {
    violations.push({
      filePath: relPath,
      lineNumber,
      lineContent,
      actionRef: actionTarget,
      reason: 'Missing inline "# v..." version comment (e.g., "# v4.2.2").',
    });
    hasPinViolation = true;
  }

  if (!hasPinViolation && rawSegments.length >= 2) {
    const versionTag = inlineComment.split(/\s+/)[0];
    pinnedOccurrences.push({
      filePath: relPath,
      lineNumber,
      lineContent,
      actionRef: actionTarget,
      owner: rawSegments[0],
      repo: rawSegments[1],
      sha: ref.toLowerCase(),
      versionTag,
    });
  }

  return actionTarget;
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

    const jobIf = getScalarString(jobMap.get('if', true));
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

    stepsNode.items.forEach((stepNode, stepIdx) => {
      if (!isMap(stepNode)) {
        return;
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

      const stepIf = getScalarString(stepNode.get('if', true));
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
          `jobs.${jobId}.run`,
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
    });
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
  gitBaseUrl: string
): Promise<string | null> {
  const encodedOwner = encodeURIComponent(owner);
  const encodedRepo = encodeURIComponent(repo);

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
        peelDepth++;
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

      if (currentType === 'commit' && typeof currentSha === 'string') {
        const resolvedTagSha = currentSha.toLowerCase();
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
    } else if (tagRefRes.status !== 404) {
      return `Failed to query upstream tag "${versionTag}" for "${owner}/${repo}@${sha}" (HTTP ${tagRefRes.status} ${tagRefRes.statusText}).`;
    }
  }

  // 2. Check upstream default branch and repository branches (`refs/heads/*`).
  const checkedBranches = new Set<string>();
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
    const defaultBranch =
      typeof repoBody.default_branch === 'string'
        ? repoBody.default_branch.trim()
        : '';
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
  } else if (repoRes.status !== 404) {
    return `Failed to query upstream repository metadata for "${owner}/${repo}" (HTTP ${repoRes.status} ${repoRes.statusText}).`;
  }

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
    if (Array.isArray(branchesBody)) {
      for (const branch of branchesBody) {
        const branchName = typeof branch.name === 'string' ? branch.name.trim() : '';
        const branchSha =
          typeof branch.commit?.sha === 'string'
            ? branch.commit.sha.trim().toLowerCase()
            : '';
        if (branchSha === sha) {
          return null;
        }
        if (!branchName || checkedBranches.has(branchName)) {
          continue;
        }
        checkedBranches.add(branchName);
        const branchCompare = await checkCompareIsAncestor(branchSha || branchName);
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
  } else if (branchesRes.status !== 404) {
    return `Failed to query upstream branches for "${owner}/${repo}" (HTTP ${branchesRes.status} ${branchesRes.statusText}).`;
  }

  return `Upstream commit "${sha}" is not reachable from tag "${versionTag}" or any branch in "${owner}/${repo}" (unmerged fork commit).`;
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
            gitBaseUrl
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
2. All third-party GitHub Actions and reusable workflows must be pinned to full
   40-character commit SHAs reachable from an upstream tag or branch.
3. Every third-party uses: directive must include an inline "# v..." version comment:
   uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
4. Local workflow references (starting with ./) do not require commit SHAs.
5. Every non-cancelling concurrency block must set "queue: max" to queue pending runs in FIFO order.
6. Every job invoking actions/deploy-pages must set concurrency: { group: github-pages, cancel-in-progress: false, queue: max }.
7. Step "run" scripts must bind GitHub Actions expressions via "env:" instead of interpolating "\${{ ... }}" directly.
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
