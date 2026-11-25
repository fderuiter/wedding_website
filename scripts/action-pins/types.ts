import { isMap, isPair, isScalar, LineCounter, Pair } from 'yaml';

export interface Violation {
  filePath: string;
  lineNumber: number;
  lineContent: string;
  actionRef: string;
  reason: string;
}

export interface PinnedActionOccurrence {
  filePath: string;
  lineNumber: number;
  lineContent: string;
  actionRef: string;
  owner: string;
  repo: string;
  sha: string;
  versionTag: string;
}

export interface VerifyUpstreamOptions {
  apiBaseUrl?: string;
  gitBaseUrl?: string;
  token?: string;
  timeoutMs?: number;
}

export const COMMIT_SHA_REGEX = /^[a-fA-F0-9]{40}$/;
export const VERSION_COMMENT_REGEX = /^v\d+(?:\.\d+)*(?:-[0-9A-Za-z.-]+)?(?:\s.*)?$/;

export function getNodeLineNumber(node: unknown, lineCounter: LineCounter): number {
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

export function getScalarString(node: unknown): string | null {
  if (isScalar(node) && typeof node.value === 'string') {
    return node.value;
  }
  return null;
}

export function getConditionString(node: unknown): string | null {
  if (isScalar(node)) {
    if (typeof node.value === 'string') {
      return node.value;
    }
    if (typeof node.value === 'boolean') {
      return String(node.value);
    }
  }
  return null;
}

export function findMapPair(mapNode: unknown, keyName: string): Pair | undefined {
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
