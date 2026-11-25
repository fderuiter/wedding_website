import { isScalar, LineCounter, Pair } from 'yaml';
import {
  COMMIT_SHA_REGEX,
  getNodeLineNumber,
  PinnedActionOccurrence,
  VERSION_COMMENT_REGEX,
  Violation,
} from './types';

export function validateUsesPair(
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
