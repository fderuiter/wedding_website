import { isMap, isPair, isScalar, isSeq } from 'yaml';

type TriState = 'true' | 'false' | 'unknown';

interface ConditionToken {
  type: 'lparen' | 'rparen' | 'not' | 'and' | 'or' | 'atom';
  value: string;
}

const UNTRUSTED_WORKFLOW_TRIGGERS = new Set([
  'pull_request',
  'pull_request_target',
  'workflow_run',
]);

export interface UntrustedTriggerInfo {
  trigger: string;
  viaWorkflowCall: boolean;
  callerChain?: string;
}

export interface ConditionEvalOptions {
  viaWorkflowCall?: boolean;
}

export function extractLocalWorkflowCallTarget(usesValue: string): string | null {
  const trimmed = usesValue.trim();
  const match = trimmed.match(/^\.\/\.github\/workflows\/([^/\s@]+\.ya?ml)$/);
  return match ? match[1] : null;
}

export function getUntrustedWorkflowTriggers(onNode: unknown): string[] {
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
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch === '\'' && !inDouble) {
      if (inSingle && inner[i + 1] === '\'') {
        i += 1;
        continue;
      }
      inSingle = !inSingle;
    } else if (inDouble && ch === '\\') {
      i += 1;
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
    i += 1; // consume opening quote
    while (i < expr.length) {
      const ch = expr[i];
      if (quote === '\'' && ch === '\'') {
        if (expr[i + 1] === '\'') {
          i += 2;
          continue;
        }
        i += 1;
        return expr.slice(start, i);
      }
      if (quote === '"') {
        if (ch === '\\') {
          i += 2;
          continue;
        }
        if (ch === '"') {
          i += 1;
          return expr.slice(start, i);
        }
      }
      i += 1;
    }
    return null;
  };

  while (i < expr.length) {
    while (i < expr.length && /\s/.test(expr[i])) {
      i += 1;
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
      i += 1;
      continue;
    }
    if (expr[i] === ')') {
      tokens.push({ type: 'rparen', value: ')' });
      i += 1;
      continue;
    }
    if (expr[i] === '!' && expr[i + 1] !== '=') {
      tokens.push({ type: 'not', value: '!' });
      i += 1;
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
        callParenDepth += 1;
        atom += ch;
        i += 1;
        continue;
      }
      if (ch === ')') {
        callParenDepth -= 1;
        atom += ch;
        i += 1;
        continue;
      }
      atom += ch;
      i += 1;
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

function evaluateAtomForTrigger(
  atom: string,
  trigger: string,
  viaWorkflowCall: boolean
): TriState {
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
      if (viaWorkflowCall && compared === 'workflow_call') {
        return 'unknown';
      }
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
      if (viaWorkflowCall && compared === 'workflow_call') {
        return 'unknown';
      }
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

export function conditionExcludesTrigger(
  ifValue: string | null,
  trigger: string,
  options: ConditionEvalOptions = {}
): boolean {
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

  const viaWorkflowCall = options.viaWorkflowCall === true;
  let pos = 0;

  const parseOr = (): TriState | null => {
    let left = parseAnd();
    if (left === null) {
      return null;
    }
    while (pos < tokens.length && tokens[pos].type === 'or') {
      pos += 1;
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
      pos += 1;
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
      pos += 1;
      const inner = parseUnary();
      if (inner === null) {
        return null;
      }
      if (inner === 'true') return 'false';
      if (inner === 'false') return 'true';
      return 'unknown';
    }
    if (tokens[pos].type === 'lparen') {
      pos += 1;
      const inner = parseOr();
      if (inner === null || pos >= tokens.length || tokens[pos].type !== 'rparen') {
        return null;
      }
      pos += 1;
      return inner;
    }
    if (tokens[pos].type === 'atom') {
      const atomVal = tokens[pos].value;
      pos += 1;
      return evaluateAtomForTrigger(atomVal, trigger, viaWorkflowCall);
    }
    return null;
  };

  const outcome = parseOr();
  if (outcome === null || pos !== tokens.length) {
    return false;
  }
  return outcome === 'false';
}

export function permissionsHaveWriteScope(permissionsNode: unknown): boolean {
  if (permissionsNode === undefined || permissionsNode === null) {
    return true;
  }
  if (isScalar(permissionsNode)) {
    if (
      typeof permissionsNode.value === 'string' &&
      permissionsNode.value.trim() === 'read-all'
    ) {
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
