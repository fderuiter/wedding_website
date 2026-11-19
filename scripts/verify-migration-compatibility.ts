import fs from 'fs';
import path from 'path';

export interface MigrationViolation {
  file: string;
  line: number;
  keyword: string;
  snippet: string;
}

export interface VerificationResult {
  valid: boolean;
  totalFiles: number;
  violations: MigrationViolation[];
  errors: string[];
}

const GRANDFATHERED_FILE_WIDE_BYPASS_PATHS: ReadonlySet<string> = Object.freeze(
  new Set(['prisma/migrations/20250419033000_merge_guest_contributor/migration.sql'])
);

const VALID_BYPASS_COMMENT_BODY_REGEX = /^\s*allow-destructive\s*:\s*\S/i;
const VALID_LINE_ONE_BYPASS_REGEX = /^\s*--\s*allow-destructive\s*:\s*\S/i;
const DOLLAR_QUOTE_TAG_REGEX = /^\$(?:[A-Za-z_\x80-\xff][A-Za-z0-9_$\x80-\xff]*)?\$/;

const TABLE_CONSTRAINT_KEYWORDS: ReadonlySet<string> = new Set([
  'CONSTRAINT',
  'PRIMARY',
  'UNIQUE',
  'FOREIGN',
  'EXCLUDE',
  'CHECK',
]);

const NON_COLUMN_DROP_KEYWORDS: ReadonlySet<string> = new Set([
  'CONSTRAINT',
  'NOT',
  'DEFAULT',
  'IDENTITY',
  'EXPRESSION',
]);

const SERIAL_PSEUDO_TYPES: ReadonlySet<string> = new Set([
  'SERIAL',
  'SMALLSERIAL',
  'BIGSERIAL',
  'SERIAL2',
  'SERIAL4',
  'SERIAL8',
]);

type SqlToken =
  | {
    type: 'word';
    value: string;
    upper: string;
    line: number;
    endLine: number;
    startOffset: number;
    endOffset: number;
  }
  | {
    type: 'ident';
    value: string;
    line: number;
    endLine: number;
    startOffset: number;
    endOffset: number;
  }
  | {
    type: 'string';
    value: string;
    innerContent: string;
    line: number;
    endLine: number;
    startOffset: number;
    endOffset: number;
  }
  | {
    type: 'dollar_string';
    tag: string;
    innerContent: string;
    line: number;
    endLine: number;
    startOffset: number;
    endOffset: number;
  }
  | {
    type: 'line_comment';
    body: string;
    isBypass: boolean;
    line: number;
    endLine: number;
    startOffset: number;
    endOffset: number;
  }
  | {
    type: 'semicolon' | 'comma' | 'lparen' | 'rparen' | 'symbol';
    value: string;
    line: number;
    endLine: number;
    startOffset: number;
    endOffset: number;
  };

type CodeToken = Exclude<SqlToken, { type: 'line_comment' }>;

interface ParsedStatement {
  tokens: CodeToken[];
  bypassed: boolean;
  endOffset: number;
}

function isWordChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    (code >= 48 && code <= 57) ||
    code === 95 || // _
    code === 36 || // $
    code >= 128
  );
}

function isGrandfatheredFileWideBypass(content: string, filePath: string): boolean {
  const normalizedInput = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  let matchesPath = GRANDFATHERED_FILE_WIDE_BYPASS_PATHS.has(normalizedInput);

  if (!matchesPath && path.isAbsolute(filePath)) {
    const relToCwd = path.relative(process.cwd(), filePath).replace(/\\/g, '/');
    matchesPath = GRANDFATHERED_FILE_WIDE_BYPASS_PATHS.has(relToCwd);
  }

  if (!matchesPath) {
    return false;
  }

  const firstLine = content.split(/\r?\n/, 1)[0] ?? '';
  return VALID_LINE_ONE_BYPASS_REGEX.test(firstLine);
}

function formatSnippet(rawSql: string, startOffset: number, endOffset: number): string {
  return rawSql
    .slice(startOffset, endOffset)
    .replace(/\s*\r?\n\s*/g, ' ')
    .trim();
}

/**
 * Tokenizes PostgreSQL SQL into tokens while tracking 1-based line numbers across
 * single-quoted strings, C-escape strings, double-quoted identifiers, dollar-quoted
 * bodies, single-line comments, and nested block comments.
 */
function tokenizeSql(sql: string, baseLine: number = 1): SqlToken[] {
  const tokens: SqlToken[] = [];
  const len = sql.length;
  let i = 0;
  let line = baseLine;

  while (i < len) {
    const ch = sql[i];

    // Whitespace
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      if (ch === '\n') {
        line++;
      }
      i++;
      continue;
    }

    // Single-line comment: -- ...
    if (ch === '-' && sql[i + 1] === '-') {
      const startOffset = i;
      const startLine = line;
      i += 2;
      const bodyStart = i;
      while (i < len && sql[i] !== '\n') {
        i++;
      }
      const rawBody = sql.slice(bodyStart, i).replace(/\r$/, '');
      tokens.push({
        type: 'line_comment',
        body: rawBody,
        isBypass: VALID_BYPASS_COMMENT_BODY_REGEX.test(rawBody),
        line: startLine,
        endLine: line,
        startOffset,
        endOffset: i,
      });
      continue;
    }

    // Block comment: /* ... */ (supports PostgreSQL nested block comments)
    if (ch === '/' && sql[i + 1] === '*') {
      i += 2;
      let depth = 1;
      while (i < len && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          depth--;
          i += 2;
        } else {
          if (sql[i] === '\n') {
            line++;
          }
          i++;
        }
      }
      continue;
    }

    // PostgreSQL C-escape string literal: E'...' or e'...'
    if (
      (ch === 'E' || ch === 'e') &&
      sql[i + 1] === '\'' &&
      (i === 0 || !isWordChar(sql[i - 1]))
    ) {
      const startOffset = i;
      const startLine = line;
      i += 2;
      let inner = '';
      while (i < len) {
        const c = sql[i];
        if (c === '\\') {
          if (i + 1 < len) {
            if (sql[i + 1] === '\n') {
              line++;
            }
            inner += sql[i + 1];
            i += 2;
          } else {
            i++;
          }
        } else if (c === '\'') {
          if (sql[i + 1] === '\'') {
            inner += '\'';
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          if (c === '\n') {
            line++;
          }
          inner += c;
          i++;
        }
      }
      tokens.push({
        type: 'string',
        value: sql.slice(startOffset, i),
        innerContent: inner,
        line: startLine,
        endLine: line,
        startOffset,
        endOffset: i,
      });
      continue;
    }

    // Standard single-quoted string literal: '...'
    if (ch === '\'') {
      const startOffset = i;
      const startLine = line;
      i++;
      let inner = '';
      while (i < len) {
        const c = sql[i];
        if (c === '\'') {
          if (sql[i + 1] === '\'') {
            inner += '\'';
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          if (c === '\n') {
            line++;
          }
          inner += c;
          i++;
        }
      }
      tokens.push({
        type: 'string',
        value: sql.slice(startOffset, i),
        innerContent: inner,
        line: startLine,
        endLine: line,
        startOffset,
        endOffset: i,
      });
      continue;
    }

    // Double-quoted identifier: "..."
    if (ch === '"') {
      const startOffset = i;
      const startLine = line;
      i++;
      while (i < len) {
        const c = sql[i];
        if (c === '"') {
          if (sql[i + 1] === '"') {
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          if (c === '\n') {
            line++;
          }
          i++;
        }
      }
      tokens.push({
        type: 'ident',
        value: sql.slice(startOffset, i),
        line: startLine,
        endLine: line,
        startOffset,
        endOffset: i,
      });
      continue;
    }

    // Dollar-quoted string literal: $$...$$ or $tag$...$tag$
    if (ch === '$') {
      const tagMatch = DOLLAR_QUOTE_TAG_REGEX.exec(sql.slice(i));
      if (tagMatch) {
        const tag = tagMatch[0];
        const startOffset = i;
        const startLine = line;
        i += tag.length;
        const bodyStart = i;
        let bodyEnd = len;

        while (i < len) {
          if (sql[i] === '$' && sql.startsWith(tag, i)) {
            bodyEnd = i;
            i += tag.length;
            break;
          }
          if (sql[i] === '\n') {
            line++;
          }
          i++;
        }

        tokens.push({
          type: 'dollar_string',
          tag,
          innerContent: sql.slice(bodyStart, bodyEnd),
          line: startLine,
          endLine: line,
          startOffset,
          endOffset: i,
        });
        continue;
      }
    }

    // Punctuation
    if (ch === ';') {
      tokens.push({
        type: 'semicolon',
        value: ';',
        line,
        endLine: line,
        startOffset: i,
        endOffset: i + 1,
      });
      i++;
      continue;
    }

    if (ch === ',') {
      tokens.push({
        type: 'comma',
        value: ',',
        line,
        endLine: line,
        startOffset: i,
        endOffset: i + 1,
      });
      i++;
      continue;
    }

    if (ch === '(') {
      tokens.push({
        type: 'lparen',
        value: '(',
        line,
        endLine: line,
        startOffset: i,
        endOffset: i + 1,
      });
      i++;
      continue;
    }

    if (ch === ')') {
      tokens.push({
        type: 'rparen',
        value: ')',
        line,
        endLine: line,
        startOffset: i,
        endOffset: i + 1,
      });
      i++;
      continue;
    }

    // Unquoted words / keywords / numeric tokens
    if (isWordChar(ch)) {
      const startOffset = i;
      const startLine = line;
      i++;
      while (i < len && isWordChar(sql[i])) {
        i++;
      }
      const rawWord = sql.slice(startOffset, i);
      tokens.push({
        type: 'word',
        value: rawWord,
        upper: rawWord.toUpperCase(),
        line: startLine,
        endLine: line,
        startOffset,
        endOffset: i,
      });
      continue;
    }

    // Other symbols / operators
    tokens.push({
      type: 'symbol',
      value: ch,
      line,
      endLine: line,
      startOffset: i,
      endOffset: i + 1,
    });
    i++;
  }

  return tokens;
}

/**
 * Splits a token stream into semicolon-delimited statements while scoping
 * `-- allow-destructive: <reason>` annotations strictly to a single statement.
 */
function splitStatements(tokens: SqlToken[]): ParsedStatement[] {
  const statements: ParsedStatement[] = [];
  let currentTokens: CodeToken[] = [];
  let pendingBypass = false;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];

    if (tok.type === 'line_comment') {
      if (tok.isBypass) {
        pendingBypass = true;
      }
      continue;
    }

    if (tok.type === 'semicolon') {
      // Attach an immediate trailing comment on the exact same line as `;`
      let trailingBypass = false;
      const nextTok = tokens[i + 1];
      if (nextTok && nextTok.type === 'line_comment' && nextTok.line === tok.line) {
        if (nextTok.isBypass) {
          trailingBypass = true;
        }
        i++;
      }

      if (currentTokens.length > 0) {
        statements.push({
          tokens: currentTokens,
          bypassed: pendingBypass || trailingBypass,
          endOffset: tok.endOffset,
        });
      }

      currentTokens = [];
      pendingBypass = false;
      continue;
    }

    currentTokens.push(tok);
  }

  if (currentTokens.length > 0) {
    statements.push({
      tokens: currentTokens,
      bypassed: pendingBypass,
      endOffset: currentTokens[currentTokens.length - 1].endOffset,
    });
  }

  return statements;
}

function isKeyword(tok: CodeToken | undefined, expectedUpper: string): boolean {
  return tok !== undefined && tok.type === 'word' && tok.upper === expectedUpper;
}

function isNameToken(tok: CodeToken | undefined): boolean {
  return tok !== undefined && (tok.type === 'word' || tok.type === 'ident');
}

function findMatchingKeywordIndex(
  tokens: CodeToken[],
  startIndex: number,
  targetKeyword: string
): number {
  let parenDepth = 0;
  let caseDepth = 0;

  for (let i = startIndex; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type === 'lparen') {
      parenDepth++;
    } else if (tok.type === 'rparen') {
      parenDepth = Math.max(0, parenDepth - 1);
    } else if (parenDepth === 0 && tok.type === 'word') {
      if (tok.upper === 'CASE') {
        caseDepth++;
      } else if (tok.upper === 'END' && caseDepth > 0) {
        caseDepth--;
      } else if (caseDepth === 0 && tok.upper === targetKeyword) {
        return i;
      }
    }
  }

  return -1;
}

/**
 * Peels PL/pgSQL compound control-flow headers (`<<label>>`, `BEGIN`, `IF ... THEN`,
 * `ELSIF ... THEN`, `ELSE`, `LOOP`, `WHILE/FOR/FOREACH ... LOOP`, `EXCEPTION WHEN ... THEN`)
 * from the front of an inner statement inside a `DO` block so the underlying SQL statement
 * starts cleanly with its own keyword and line number.
 */
function stripPlpgsqlHeaders(tokens: CodeToken[]): CodeToken[] {
  let idx = 0;

  while (idx < tokens.length) {
    // Optional <<label>>
    if (
      tokens[idx]?.type === 'symbol' &&
      tokens[idx].value === '<' &&
      tokens[idx + 1]?.type === 'symbol' &&
      tokens[idx + 1].value === '<' &&
      isNameToken(tokens[idx + 2]) &&
      tokens[idx + 3]?.type === 'symbol' &&
      tokens[idx + 3].value === '>' &&
      tokens[idx + 4]?.type === 'symbol' &&
      tokens[idx + 4].value === '>'
    ) {
      idx += 5;
      continue;
    }

    // Empty DECLARE followed directly by BEGIN
    if (isKeyword(tokens[idx], 'DECLARE') && isKeyword(tokens[idx + 1], 'BEGIN')) {
      idx += 2;
      continue;
    }

    // PL/pgSQL BEGIN block opener (has subsequent statement tokens before `;`)
    if (isKeyword(tokens[idx], 'BEGIN') && idx + 1 < tokens.length) {
      const next = tokens[idx + 1];
      if (!isKeyword(next, 'TRANSACTION') && !isKeyword(next, 'WORK') && !isKeyword(next, 'ISOLATION')) {
        idx++;
        continue;
      }
    }

    // IF ... THEN / ELSIF ... THEN / ELSEIF ... THEN
    if (
      isKeyword(tokens[idx], 'IF') ||
      isKeyword(tokens[idx], 'ELSIF') ||
      isKeyword(tokens[idx], 'ELSEIF')
    ) {
      const thenIdx = findMatchingKeywordIndex(tokens, idx + 1, 'THEN');
      if (thenIdx !== -1 && thenIdx + 1 < tokens.length) {
        idx = thenIdx + 1;
        continue;
      }
    }

    // ELSE branch opener
    if (isKeyword(tokens[idx], 'ELSE') && idx + 1 < tokens.length) {
      idx++;
      continue;
    }

    // Unconditional LOOP opener
    if (isKeyword(tokens[idx], 'LOOP') && idx + 1 < tokens.length) {
      idx++;
      continue;
    }

    // WHILE / FOR / FOREACH ... LOOP
    if (
      isKeyword(tokens[idx], 'WHILE') ||
      isKeyword(tokens[idx], 'FOR') ||
      isKeyword(tokens[idx], 'FOREACH')
    ) {
      const loopIdx = findMatchingKeywordIndex(tokens, idx + 1, 'LOOP');
      if (loopIdx !== -1 && loopIdx + 1 < tokens.length) {
        idx = loopIdx + 1;
        continue;
      }
    }

    // EXCEPTION [WHEN ... THEN]
    if (isKeyword(tokens[idx], 'EXCEPTION') && idx + 1 < tokens.length) {
      idx++;
      continue;
    }

    if (isKeyword(tokens[idx], 'WHEN')) {
      const thenIdx = findMatchingKeywordIndex(tokens, idx + 1, 'THEN');
      if (thenIdx !== -1 && thenIdx + 1 < tokens.length) {
        idx = thenIdx + 1;
        continue;
      }
    }

    break;
  }

  return idx === 0 ? tokens : tokens.slice(idx);
}

function splitTopLevelClauses(tokens: CodeToken[]): CodeToken[][] {
  const clauses: CodeToken[][] = [];
  let current: CodeToken[] = [];
  let parenDepth = 0;

  for (const tok of tokens) {
    if (tok.type === 'lparen') {
      parenDepth++;
      current.push(tok);
    } else if (tok.type === 'rparen') {
      parenDepth = Math.max(0, parenDepth - 1);
      current.push(tok);
    } else if (tok.type === 'comma' && parenDepth === 0) {
      if (current.length > 0) {
        clauses.push(current);
        current = [];
      }
    } else {
      current.push(tok);
    }
  }

  if (current.length > 0) {
    clauses.push(current);
  }

  return clauses;
}

function detectAlterTableClauseKeyword(clause: CodeToken[]): string | null {
  if (clause.length === 0) {
    return null;
  }

  // DROP COLUMN / DROP CONSTRAINT
  if (isKeyword(clause[0], 'DROP')) {
    if (isKeyword(clause[1], 'CONSTRAINT')) {
      return 'DROP CONSTRAINT';
    }
    if (isKeyword(clause[1], 'COLUMN')) {
      return 'DROP COLUMN';
    }
    if (isKeyword(clause[1], 'IF') && isKeyword(clause[2], 'EXISTS')) {
      return 'DROP COLUMN';
    }
    const second = clause[1];
    if (
      second &&
      (second.type === 'ident' ||
        (second.type === 'word' && !NON_COLUMN_DROP_KEYWORDS.has(second.upper)))
    ) {
      return 'DROP COLUMN';
    }
    return null;
  }

  // RENAME TO / RENAME COLUMN
  if (isKeyword(clause[0], 'RENAME')) {
    if (isKeyword(clause[1], 'TO')) {
      return 'RENAME TO';
    }
    if (isKeyword(clause[1], 'COLUMN')) {
      return 'RENAME COLUMN';
    }
    if (
      isNameToken(clause[1]) &&
      !isKeyword(clause[1], 'CONSTRAINT') &&
      isKeyword(clause[2], 'TO')
    ) {
      return 'RENAME COLUMN';
    }
    return null;
  }

  // ADD [COLUMN] [IF NOT EXISTS] <col> <type> ... NOT NULL (without DEFAULT)
  if (isKeyword(clause[0], 'ADD')) {
    let idx = 1;
    const next = clause[idx];
    if (next && next.type === 'word' && TABLE_CONSTRAINT_KEYWORDS.has(next.upper)) {
      return null;
    }

    if (isKeyword(clause[idx], 'COLUMN')) {
      idx++;
    }

    if (
      isKeyword(clause[idx], 'IF') &&
      isKeyword(clause[idx + 1], 'NOT') &&
      isKeyword(clause[idx + 2], 'EXISTS')
    ) {
      idx += 3;
    }

    if (!isNameToken(clause[idx])) {
      return null;
    }
    idx++; // skip column name

    if (idx >= clause.length) {
      return null;
    }

    const typeToken = clause[idx];
    const isSerialType = typeToken.type === 'word' && SERIAL_PSEUDO_TYPES.has(typeToken.upper);

    let parenDepth = 0;
    let hasNotNull = false;
    let hasDefault = false;
    let hasGenerated = false;

    for (let k = idx; k < clause.length; k++) {
      const tok = clause[k];
      if (tok.type === 'lparen') {
        parenDepth++;
        continue;
      }
      if (tok.type === 'rparen') {
        parenDepth = Math.max(0, parenDepth - 1);
        continue;
      }
      if (parenDepth > 0 || tok.type !== 'word') {
        continue;
      }

      if (
        tok.upper === 'NOT' &&
        isKeyword(clause[k + 1], 'NULL') &&
        !isKeyword(clause[k - 1], 'IS')
      ) {
        hasNotNull = true;
      } else if (tok.upper === 'DEFAULT') {
        if (k + 1 < clause.length && !isKeyword(clause[k + 1], 'NULL')) {
          hasDefault = true;
        }
      } else if (tok.upper === 'GENERATED') {
        hasGenerated = true;
      }
    }

    if (hasNotNull && !hasDefault && !hasGenerated && !isSerialType) {
      return 'ADD COLUMN NOT NULL';
    }
    return null;
  }

  // ALTER [COLUMN] <col> SET NOT NULL | [SET DATA] TYPE <new_type>
  if (isKeyword(clause[0], 'ALTER')) {
    let idx = 1;
    if (isKeyword(clause[idx], 'CONSTRAINT')) {
      return null;
    }
    if (isKeyword(clause[idx], 'COLUMN')) {
      idx++;
    }
    if (!isNameToken(clause[idx])) {
      return null;
    }
    idx++; // skip column name

    if (
      isKeyword(clause[idx], 'SET') &&
      isKeyword(clause[idx + 1], 'NOT') &&
      isKeyword(clause[idx + 2], 'NULL')
    ) {
      return 'SET NOT NULL';
    }

    if (
      isKeyword(clause[idx], 'SET') &&
      isKeyword(clause[idx + 1], 'DATA') &&
      isKeyword(clause[idx + 2], 'TYPE')
    ) {
      return 'SET DATA TYPE';
    }

    if (isKeyword(clause[idx], 'TYPE')) {
      return 'SET DATA TYPE';
    }

    return null;
  }

  return null;
}

function parseAlterTableClausesIndex(tokens: CodeToken[]): number {
  let idx = 2; // after ALTER TABLE
  if (isKeyword(tokens[idx], 'IF') && isKeyword(tokens[idx + 1], 'EXISTS')) {
    idx += 2;
  }
  if (isKeyword(tokens[idx], 'ONLY')) {
    idx++;
  }
  if (!isNameToken(tokens[idx])) {
    return -1;
  }
  idx++;

  // Handle schema-qualified table names (e.g. public."User" or "public"."User")
  while (
    tokens[idx]?.type === 'symbol' &&
    tokens[idx].value === '.' &&
    isNameToken(tokens[idx + 1])
  ) {
    idx += 2;
  }

  // Optional inheritance `*`
  if (tokens[idx]?.type === 'symbol' && tokens[idx].value === '*') {
    idx++;
  }

  return idx < tokens.length ? idx : -1;
}

function hasTopLevelRenameTo(tokens: CodeToken[]): boolean {
  let parenDepth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type === 'lparen') {
      parenDepth++;
    } else if (tok.type === 'rparen') {
      parenDepth = Math.max(0, parenDepth - 1);
    } else if (parenDepth === 0 && isKeyword(tok, 'RENAME') && isKeyword(tokens[i + 1], 'TO')) {
      return true;
    }
  }
  return false;
}

function inspectSqlBlock(
  sql: string,
  filePath: string,
  baseLine: number,
  inDoBlock: boolean,
  violations: MigrationViolation[]
): void {
  const tokens = tokenizeSql(sql, baseLine);
  const statements = splitStatements(tokens);

  for (const stmt of statements) {
    if (stmt.bypassed) {
      continue;
    }

    const effectiveTokens = inDoBlock ? stripPlpgsqlHeaders(stmt.tokens) : stmt.tokens;
    if (effectiveTokens.length === 0) {
      continue;
    }

    const first = effectiveTokens[0];
    const stmtSnippet = formatSnippet(sql, first.startOffset, stmt.endOffset);

    // Recursive inspection of PL/pgSQL DO blocks with dollar-quoted bodies
    if (isKeyword(first, 'DO')) {
      const dollarToken = effectiveTokens.find(
        (t): t is Extract<CodeToken, { type: 'dollar_string' }> => t.type === 'dollar_string'
      );
      if (dollarToken) {
        inspectSqlBlock(dollarToken.innerContent, filePath, dollarToken.line, true, violations);
      }
      continue;
    }

    // Dynamic SQL execution inside DO blocks (e.g. EXECUTE 'DROP TABLE ...' or EXECUTE $$...$$)
    if (inDoBlock && isKeyword(first, 'EXECUTE')) {
      for (let i = 1; i < effectiveTokens.length; i++) {
        const argTok = effectiveTokens[i];
        if (argTok.type === 'dollar_string' || argTok.type === 'string') {
          inspectSqlBlock(argTok.innerContent, filePath, argTok.line, false, violations);
          break;
        }
      }
      continue;
    }

    // DROP TABLE / DROP TYPE
    if (isKeyword(first, 'DROP')) {
      if (isKeyword(effectiveTokens[1], 'TABLE')) {
        violations.push({
          file: filePath,
          line: first.line,
          keyword: 'DROP TABLE',
          snippet: stmtSnippet,
        });
        continue;
      }
      if (isKeyword(effectiveTokens[1], 'TYPE')) {
        violations.push({
          file: filePath,
          line: first.line,
          keyword: 'DROP TYPE',
          snippet: stmtSnippet,
        });
        continue;
      }
    }

    // TRUNCATE [TABLE] ...
    if (isKeyword(first, 'TRUNCATE') && effectiveTokens[1]?.type !== 'lparen') {
      violations.push({
        file: filePath,
        line: first.line,
        keyword: 'TRUNCATE',
        snippet: stmtSnippet,
      });
      continue;
    }

    // ALTER TABLE ...
    if (isKeyword(first, 'ALTER') && isKeyword(effectiveTokens[1], 'TABLE')) {
      const clausesStart = parseAlterTableClausesIndex(effectiveTokens);
      if (clausesStart === -1) {
        continue;
      }

      const clauses = splitTopLevelClauses(effectiveTokens.slice(clausesStart));
      for (let cIdx = 0; cIdx < clauses.length; cIdx++) {
        const clause = clauses[cIdx];
        const keyword = detectAlterTableClauseKeyword(clause);
        if (keyword) {
          const isSingleClause = clauses.length === 1;
          const violationLine = isSingleClause && first.line === clause[0].line
            ? first.line
            : clause[0].line;
          const clauseEndOffset = cIdx === clauses.length - 1
            ? stmt.endOffset
            : clause[clause.length - 1].endOffset;
          const snippetStart = isSingleClause ? first.startOffset : clause[0].startOffset;

          violations.push({
            file: filePath,
            line: violationLine,
            keyword,
            snippet: formatSnippet(sql, snippetStart, clauseEndOffset),
          });
        }
      }
      continue;
    }

    // ALTER TYPE / VIEW / MATERIALIZED VIEW / SEQUENCE ... RENAME TO ...
    if (isKeyword(first, 'ALTER') && hasTopLevelRenameTo(effectiveTokens)) {
      violations.push({
        file: filePath,
        line: first.line,
        keyword: 'RENAME TO',
        snippet: stmtSnippet,
      });
    }
  }
}

/**
 * Verifies a single SQL string content for destructive operations.
 */
export function verifyMigrationContent(content: string, filePath: string = 'migration.sql'): MigrationViolation[] {
  if (isGrandfatheredFileWideBypass(content, filePath)) {
    return [];
  }

  const violations: MigrationViolation[] = [];
  inspectSqlBlock(content, filePath, 1, false, violations);
  return violations;
}

/**
 * Finds all SQL files in a directory recursively.
 */
export function findSqlFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findSqlFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.sql')) {
      results.push(fullPath);
    }
  }

  return results.sort();
}

/**
 * Verifies all SQL migration files in the given directory.
 */
export function verifyMigrations(targetDir?: string): VerificationResult {
  const migrationsDir = targetDir || path.join(process.cwd(), 'prisma/migrations');
  const sqlFiles = findSqlFiles(migrationsDir);

  const allViolations: MigrationViolation[] = [];
  const errors: string[] = [];

  for (const file of sqlFiles) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const relativePath = path.relative(process.cwd(), file);
      const violations = verifyMigrationContent(content, relativePath);
      allViolations.push(...violations);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to read or parse file ${file}: ${errorMessage}`);
    }
  }

  for (const violation of allViolations) {
    errors.push(
      `Destructive DDL [${violation.keyword}] in ${violation.file}:${violation.line}: "${violation.snippet}"`
    );
  }

  return {
    valid: errors.length === 0,
    totalFiles: sqlFiles.length,
    violations: allViolations,
    errors,
  };
}

// CLI Execution Entry Point
export function main(): void {
  const targetDir = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : undefined;
  const result = verifyMigrations(targetDir);

  if (!result.valid) {
    console.error('\n❌ Migration Compatibility Check Failed!');
    console.error(`Found ${result.violations.length} destructive DDL or non-backwards-compatible operation(s) without bypass annotations:\n`);

    for (const v of result.violations) {
      console.error(`  - ${v.file}:${v.line} -> [${v.keyword}] ${v.snippet}`);
    }

    console.error('\n💡 Destructive changes and NOT NULL column additions without defaults break zero-downtime deployments and N-1 rollback safety. Follow the expand-and-contract strategy.');
    console.error('If this breaking change is intentional, add \'-- allow-destructive: <reason>\' above or on the statement.\n');

    process.exit(1);
  } else {
    console.log(`\n✅ Migration compatibility check passed. (${result.totalFiles} SQL files scanned)\n`);
    process.exit(0);
  }
}

// Run main if invoked directly
const isDirectCall =
  process.argv[1] &&
  (process.argv[1].endsWith('verify-migration-compatibility.ts') ||
    process.argv[1].endsWith('verify-migration-compatibility.js'));

if (isDirectCall) {
  main();
}
