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

export const HISTORICAL_BASELINE_MIGRATION_PATHS: ReadonlySet<string> = Object.freeze(
  new Set([
    'prisma/migrations/20250419032914_init/migration.sql',
    'prisma/migrations/20250419033000_merge_guest_contributor/migration.sql',
    'prisma/migrations/20250715000000_normalize_snapshot_entity_types/migration.sql',
    'prisma/migrations/20260811000000_optional_party_member_photo/migration.sql',
    'prisma/migrations/20260811000100_add_countdown_calendar_settings/migration.sql',
    'prisma/migrations/20260930000000_neutral_partner_names/migration.sql',
    'prisma/migrations/20261007000000_add_invitation_code_extra_fields/migration.sql',
    'prisma/migrations/20261007000000_add_seating_table/migration.sql',
    'prisma/migrations/20261007000000_attraction_hotel_block_fields/migration.sql',
    'prisma/migrations/20261007000100_add_theme_preset/migration.sql',
    'prisma/migrations/20261007000200_add_thank_you_note_tracking/migration.sql',
    'prisma/migrations/20261007000200_add_wedding_party_side/migration.sql',
    'prisma/migrations/20261007000300_add_layout_tokens/migration.sql',
    'prisma/migrations/20261016000000_add_cash_fund_fields/migration.sql',
    'prisma/migrations/20261016000000_add_contributor_message/migration.sql',
    'prisma/migrations/20261016000000_add_guest_postal_address/migration.sql',
    'prisma/migrations/20261016000000_add_plus_one_name_fields/migration.sql',
    'prisma/migrations/20261016000000_add_theme_tokens/migration.sql',
    'prisma/migrations/20261016000100_add_brand_tokens/migration.sql',
    'prisma/migrations/20261016000100_add_snapshot_version_created_at_index/migration.sql',
    'prisma/migrations/20261019000000_add_household_party_tags/migration.sql',
    'prisma/migrations/20261019000000_add_sub_event_access_matrix/migration.sql',
    'prisma/migrations/20261020000000_add_brand_media_tokens/migration.sql',
    'prisma/migrations/20261020000000_add_contact_email/migration.sql',
    'prisma/migrations/20261021000000_add_most_wanted_and_display_order/migration.sql',
    'prisma/migrations/20261023000000_add_broadcast_messaging/migration.sql',
    'prisma/migrations/20261023000000_add_is_sample/migration.sql',
    'prisma/migrations/20261027000000_add_broadcast_scheduled_for/migration.sql',
    'prisma/migrations/20261027000000_add_fee_coverage/migration.sql',
    'prisma/migrations/20261116000000_add_stripe_transaction_fields/migration.sql',
    'prisma/migrations/20261116010000_add_composite_and_fk_indexes/migration.sql',
    'prisma/migrations/20261119000000_add_photo_album_url/migration.sql',
    'prisma/migrations/20261119000000_add_rsvp_deadline_and_lock/migration.sql',
    'prisma/migrations/20261120000000_add_contributor_email_timestamps/migration.sql',
    'prisma/migrations/20261120000000_unique_stripe_payment_intent_id/migration.sql',
    'prisma/migrations/20261120010000_add_appconfig_modules/migration.sql',
    'prisma/migrations/20261120020000_add_rsvp_meals_and_questions_jsonb/migration.sql',
    'prisma/migrations/20261121000000_add_registry_shipping_and_order_tracking/migration.sql',
    'prisma/migrations/20261122000000_add_contributor_lifecycle_and_refunds/migration.sql',
    'prisma/migrations/20261122010000_add_content_node_type_created_at_index/migration.sql',
    'prisma/migrations/20261122010000_reconcile_schema_migration_drift/migration.sql',
    'prisma/migrations/20261123000000_add_auth_lockout/migration.sql',
    'prisma/migrations/20261123000000_add_contributor_address_and_email_sent_at/migration.sql',
    'prisma/migrations/20261123000000_add_guest_photo_qr_and_auto_approve/migration.sql',
    'prisma/migrations/20261123000000_reconcile_schema_drift_and_registry_media_contract/migration.sql',
    'prisma/migrations/20261123010000_add_appconfig_setup_completed/migration.sql',
    'prisma/migrations/20261123020000_add_plus_one_seat_numbers/migration.sql',
    'prisma/migrations/20261124000000_add_registry_access_tiers_and_hold_limits/migration.sql',
    'prisma/migrations/20261125000000_add_household_members_and_member_rsvps/migration.sql',
  ])
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

function matchesMigrationPathSet(filePath: string, pathSet: ReadonlySet<string>): boolean {
  const normalizedInput = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (pathSet.has(normalizedInput)) {
    return true;
  }

  if (path.isAbsolute(filePath)) {
    const relToCwd = path.relative(process.cwd(), filePath).replace(/\\/g, '/');
    if (pathSet.has(relToCwd)) {
      return true;
    }
  }

  return false;
}

function isGrandfatheredFileWideBypass(content: string, filePath: string): boolean {
  if (!matchesMigrationPathSet(filePath, GRANDFATHERED_FILE_WIDE_BYPASS_PATHS)) {
    return false;
  }

  const firstLine = content.split(/\r?\n/, 1)[0] ?? '';
  return VALID_LINE_ONE_BYPASS_REGEX.test(firstLine);
}

function isHistoricalBaselineMigration(filePath: string): boolean {
  return matchesMigrationPathSet(filePath, HISTORICAL_BASELINE_MIGRATION_PATHS);
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

function isSymbol(tok: CodeToken | undefined, expectedValue: string): boolean {
  return tok !== undefined && tok.type === 'symbol' && tok.value === expectedValue;
}

function isAdjacentSymbolPair(
  tokens: CodeToken[],
  idx: number,
  firstChar: string,
  secondChar: string
): boolean {
  const a = tokens[idx];
  const b = tokens[idx + 1];
  return (
    isSymbol(a, firstChar) &&
    isSymbol(b, secondChar) &&
    a !== undefined &&
    b !== undefined &&
    a.endOffset === b.startOffset
  );
}

/**
 * Consumes a PostgreSQL `format()` placeholder (`%[position][flags][width]type`,
 * where `type` is `s`, `I`, or `L`), returning the index past the placeholder
 * or `-1` when `tokens[idx]` does not start a valid format placeholder.
 */
function consumeFormatPlaceholder(tokens: CodeToken[], idx: number): number {
  const pct = tokens[idx];
  if (!isSymbol(pct, '%')) {
    return -1;
  }

  let cur = idx + 1;
  let prevEnd = pct.endOffset;

  // Optional positional argument prefix before `-` or `*` (e.g. `%1$-10I` or `%1$*2$I`)
  const posTok = tokens[cur];
  if (
    posTok?.type === 'word' &&
    posTok.startOffset === prevEnd &&
    /^\d+\$$/.test(posTok.value)
  ) {
    prevEnd = posTok.endOffset;
    cur++;
  }

  // Optional `-` left-align flag
  if (isSymbol(tokens[cur], '-') && tokens[cur].startOffset === prevEnd) {
    prevEnd = tokens[cur].endOffset;
    cur++;
  }

  // Optional `*` dynamic width specifier (e.g. `%*I` or `%*2$I`)
  if (isSymbol(tokens[cur], '*') && tokens[cur].startOffset === prevEnd) {
    prevEnd = tokens[cur].endOffset;
    cur++;
  }

  const specTok = tokens[cur];
  if (
    specTok?.type === 'word' &&
    specTok.startOffset === prevEnd &&
    /^(?:\d+\$)?(?:\d+)?[sIL]$/i.test(specTok.value)
  ) {
    return cur + 1;
  }

  return -1;
}

function consumeIdentifierOrPlaceholder(
  tokens: CodeToken[],
  idx: number
): { normalized: string | null; nextIdx: number } | null {
  const tok = tokens[idx];
  if (!tok) {
    return null;
  }

  if (tok.type === 'word') {
    return { normalized: tok.value.toLowerCase(), nextIdx: idx + 1 };
  }

  if (tok.type === 'ident') {
    return {
      normalized: tok.value.slice(1, -1).replace(/""/g, '"'),
      nextIdx: idx + 1,
    };
  }

  const afterPlaceholder = consumeFormatPlaceholder(tokens, idx);
  if (afterPlaceholder !== -1) {
    return { normalized: null, nextIdx: afterPlaceholder };
  }

  return null;
}

function parseQualifiedName(
  tokens: CodeToken[],
  startIdx: number
): { normalized: string | null; nextIdx: number } | null {
  const firstPart = consumeIdentifierOrPlaceholder(tokens, startIdx);
  if (!firstPart) {
    return null;
  }

  const parts: Array<string | null> = [firstPart.normalized];
  let idx = firstPart.nextIdx;

  while (isSymbol(tokens[idx], '.')) {
    const nextPart = consumeIdentifierOrPlaceholder(tokens, idx + 1);
    if (!nextPart) {
      break;
    }
    parts.push(nextPart.normalized);
    idx = nextPart.nextIdx;
  }

  if (parts.some((p) => p === null)) {
    return { normalized: null, nextIdx: idx };
  }

  const concreteParts = parts as string[];
  if (concreteParts.length === 1) {
    return { normalized: concreteParts[0], nextIdx: idx };
  }

  const schema = concreteParts[concreteParts.length - 2];
  const objectName = concreteParts[concreteParts.length - 1];
  return {
    normalized: schema === 'public' ? objectName : `${schema}.${objectName}`,
    nextIdx: idx,
  };
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
      isSymbol(tokens[idx], '<') &&
      isSymbol(tokens[idx + 1], '<') &&
      isNameToken(tokens[idx + 2]) &&
      isSymbol(tokens[idx + 3], '>') &&
      isSymbol(tokens[idx + 4], '>')
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

    // PL/pgSQL searched or simple CASE header: CASE [<expr>] WHEN <cond> THEN <stmt>
    if (isKeyword(tokens[idx], 'CASE')) {
      const whenIdx = findMatchingKeywordIndex(tokens, idx + 1, 'WHEN');
      if (whenIdx !== -1) {
        const thenIdx = findMatchingKeywordIndex(tokens, whenIdx + 1, 'THEN');
        if (thenIdx !== -1 && thenIdx + 1 < tokens.length) {
          idx = thenIdx + 1;
          continue;
        }
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

interface MigrationFileState {
  isHistoricalBaseline: boolean;
  createdTables: Set<string>;
  createdNewTableIndexes: Set<string>;
}

function hasTopLevelKeywordSequence(tokens: CodeToken[], startIndex: number, sequence: string[]): boolean {
  let parenDepth = 0;
  for (let i = startIndex; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type === 'lparen') {
      parenDepth++;
    } else if (tok.type === 'rparen') {
      parenDepth = Math.max(0, parenDepth - 1);
    } else if (parenDepth === 0 && isKeyword(tok, sequence[0])) {
      let matched = true;
      for (let offset = 1; offset < sequence.length; offset++) {
        if (!isKeyword(tokens[i + offset], sequence[offset])) {
          matched = false;
          break;
        }
      }
      if (matched) {
        return true;
      }
    }
  }
  return false;
}

function findTopLevelKeywordIndex(tokens: CodeToken[], startIndex: number, keyword: string): number {
  let parenDepth = 0;
  for (let i = startIndex; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type === 'lparen') {
      parenDepth++;
    } else if (tok.type === 'rparen') {
      parenDepth = Math.max(0, parenDepth - 1);
    } else if (parenDepth === 0 && isKeyword(tok, keyword)) {
      return i;
    }
  }
  return -1;
}

function detectTableConstraintViolation(
  clause: CodeToken[],
  constraintStartIdx: number,
  tableName: string | null,
  fileState: MigrationFileState
): string | null {
  let idx = constraintStartIdx;
  if (isKeyword(clause[idx], 'CONSTRAINT')) {
    const afterName = consumeIdentifierOrPlaceholder(clause, idx + 1);
    if (!afterName) {
      return null;
    }
    idx = afterName.nextIdx;
  }

  const isNewlyCreatedTable = tableName !== null && fileState.createdTables.has(tableName);

  // CHECK (...) [NO INHERIT] [NOT VALID]
  if (isKeyword(clause[idx], 'CHECK')) {
    if (hasTopLevelKeywordSequence(clause, idx + 1, ['NOT', 'VALID'])) {
      return null;
    }
    if (isNewlyCreatedTable || fileState.isHistoricalBaseline) {
      return null;
    }
    return 'ADD CHECK';
  }

  // FOREIGN KEY (...) REFERENCES <ref_table> ... [NOT VALID]
  if (isKeyword(clause[idx], 'FOREIGN') && isKeyword(clause[idx + 1], 'KEY')) {
    if (hasTopLevelKeywordSequence(clause, idx + 2, ['NOT', 'VALID'])) {
      return null;
    }
    if (fileState.isHistoricalBaseline) {
      return null;
    }
    const refKeywordIdx = findTopLevelKeywordIndex(clause, idx + 2, 'REFERENCES');
    const refTarget = refKeywordIdx !== -1 ? parseQualifiedName(clause, refKeywordIdx + 1) : null;
    const isRefNewlyCreated =
      refTarget?.normalized !== null &&
      refTarget?.normalized !== undefined &&
      fileState.createdTables.has(refTarget.normalized);

    if (isNewlyCreatedTable && isRefNewlyCreated) {
      return null;
    }
    return 'ADD FOREIGN KEY';
  }

  // UNIQUE [NULLS [NOT] DISTINCT] (...) | UNIQUE USING INDEX <index_name>
  if (isKeyword(clause[idx], 'UNIQUE')) {
    if (hasTopLevelKeywordSequence(clause, idx + 1, ['USING', 'INDEX'])) {
      return null;
    }
    if (isNewlyCreatedTable || fileState.isHistoricalBaseline) {
      return null;
    }
    return 'ADD UNIQUE';
  }

  // PRIMARY KEY (...) | PRIMARY KEY USING INDEX <index_name>
  if (isKeyword(clause[idx], 'PRIMARY') && isKeyword(clause[idx + 1], 'KEY')) {
    if (isNewlyCreatedTable || fileState.isHistoricalBaseline) {
      return null;
    }
    return 'ADD PRIMARY KEY';
  }

  // EXCLUDE [USING method] (...)
  if (isKeyword(clause[idx], 'EXCLUDE')) {
    if (isNewlyCreatedTable || fileState.isHistoricalBaseline) {
      return null;
    }
    return 'ADD EXCLUDE';
  }

  return null;
}

function detectAlterTableClauseKeyword(
  clause: CodeToken[],
  tableName: string | null,
  fileState: MigrationFileState
): string | null {
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
        consumeFormatPlaceholder(clause, 1) !== -1 ||
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
    if (!isKeyword(clause[1], 'CONSTRAINT')) {
      const colIdent = consumeIdentifierOrPlaceholder(clause, 1);
      if (colIdent && isKeyword(clause[colIdent.nextIdx], 'TO')) {
        return 'RENAME COLUMN';
      }
    }
    return null;
  }

  // ADD <table_constraint> | ADD [COLUMN] [IF NOT EXISTS] <col> <type> ...
  if (isKeyword(clause[0], 'ADD')) {
    let idx = 1;
    const next = clause[idx];
    if (next && next.type === 'word' && TABLE_CONSTRAINT_KEYWORDS.has(next.upper)) {
      return detectTableConstraintViolation(clause, idx, tableName, fileState);
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

    const colName = consumeIdentifierOrPlaceholder(clause, idx);
    if (!colName) {
      return null;
    }
    idx = colName.nextIdx;

    if (idx >= clause.length) {
      return null;
    }

    const typeToken = clause[idx];
    const isSerialType = typeToken.type === 'word' && SERIAL_PSEUDO_TYPES.has(typeToken.upper);
    const isNewlyCreatedTable = tableName !== null && fileState.createdTables.has(tableName);

    let parenDepth = 0;
    let hasNotNull = false;
    let hasDefault = false;
    let hasGenerated = false;
    let hasGeneratedAlways = false;
    let hasPrimaryKey = false;
    let hasInlineUnique = false;
    let hasInlineCheck = false;
    let inlineReferencesIdx = -1;
    let hasNotValid = false;

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

      if (tok.upper === 'PRIMARY' && isKeyword(clause[k + 1], 'KEY')) {
        hasPrimaryKey = true;
      } else if (
        tok.upper === 'NOT' &&
        isKeyword(clause[k + 1], 'NULL') &&
        !isKeyword(clause[k - 1], 'IS')
      ) {
        hasNotNull = true;
      } else if (tok.upper === 'NOT' && isKeyword(clause[k + 1], 'VALID')) {
        hasNotValid = true;
      } else if (tok.upper === 'DEFAULT') {
        if (k + 1 < clause.length && !isKeyword(clause[k + 1], 'NULL')) {
          hasDefault = true;
        }
      } else if (tok.upper === 'GENERATED') {
        hasGenerated = true;
        if (isKeyword(clause[k + 1], 'ALWAYS')) {
          hasGeneratedAlways = true;
        }
      } else if (tok.upper === 'UNIQUE') {
        hasInlineUnique = true;
      } else if (tok.upper === 'CHECK') {
        hasInlineCheck = true;
      } else if (tok.upper === 'REFERENCES' && inlineReferencesIdx === -1) {
        inlineReferencesIdx = k;
      }
    }

    if (hasPrimaryKey) {
      return 'ADD COLUMN PRIMARY KEY';
    }
    if (hasGeneratedAlways) {
      return 'ADD GENERATED ALWAYS';
    }
    if (hasNotNull && !hasDefault && !hasGenerated && !isSerialType) {
      return 'ADD COLUMN NOT NULL';
    }
    if (hasInlineUnique && !isNewlyCreatedTable && !fileState.isHistoricalBaseline) {
      return 'ADD UNIQUE';
    }
    if (inlineReferencesIdx !== -1 && !hasNotValid && !fileState.isHistoricalBaseline) {
      const refTarget = parseQualifiedName(clause, inlineReferencesIdx + 1);
      const isRefNewlyCreated =
        refTarget?.normalized !== null &&
        refTarget?.normalized !== undefined &&
        fileState.createdTables.has(refTarget.normalized);
      if (!(isNewlyCreatedTable && isRefNewlyCreated)) {
        return 'ADD FOREIGN KEY';
      }
    }
    if (hasInlineCheck && !hasNotValid && !isNewlyCreatedTable && !fileState.isHistoricalBaseline) {
      return 'ADD CHECK';
    }

    return null;
  }

  // ALTER [COLUMN] <col> SET NOT NULL | [SET DATA] TYPE <new_type> | DROP DEFAULT | ADD/SET GENERATED ALWAYS
  if (isKeyword(clause[0], 'ALTER')) {
    let idx = 1;
    if (isKeyword(clause[idx], 'CONSTRAINT')) {
      return null;
    }
    if (isKeyword(clause[idx], 'COLUMN')) {
      idx++;
    }
    const colName = consumeIdentifierOrPlaceholder(clause, idx);
    if (!colName) {
      return null;
    }
    idx = colName.nextIdx;

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

    if (isKeyword(clause[idx], 'DROP') && isKeyword(clause[idx + 1], 'DEFAULT')) {
      return fileState.isHistoricalBaseline ? null : 'DROP DEFAULT';
    }

    if (
      (isKeyword(clause[idx], 'ADD') || isKeyword(clause[idx], 'SET')) &&
      isKeyword(clause[idx + 1], 'GENERATED') &&
      isKeyword(clause[idx + 2], 'ALWAYS')
    ) {
      return 'ADD GENERATED ALWAYS';
    }

    return null;
  }

  return null;
}

function parseAlterTableTarget(
  tokens: CodeToken[]
): { tableName: string | null; clausesStart: number } | null {
  let idx = 2; // after ALTER TABLE
  if (isKeyword(tokens[idx], 'IF') && isKeyword(tokens[idx + 1], 'EXISTS')) {
    idx += 2;
  }
  if (isKeyword(tokens[idx], 'ONLY')) {
    idx++;
  }
  const parsedTable = parseQualifiedName(tokens, idx);
  if (!parsedTable) {
    return null;
  }
  idx = parsedTable.nextIdx;

  // Optional inheritance `*`
  if (isSymbol(tokens[idx], '*')) {
    idx++;
  }

  return idx < tokens.length ? { tableName: parsedTable.normalized, clausesStart: idx } : null;
}

function hasTopLevelRenameTo(tokens: CodeToken[]): boolean {
  return hasTopLevelKeywordSequence(tokens, 0, ['RENAME', 'TO']);
}

function hasTopLevelRenameValue(tokens: CodeToken[]): boolean {
  return hasTopLevelKeywordSequence(tokens, 0, ['RENAME', 'VALUE']);
}

function parseCreateTableName(tokens: CodeToken[]): string | null {
  if (!isKeyword(tokens[0], 'CREATE')) {
    return null;
  }
  let idx = 1;
  if (isKeyword(tokens[idx], 'GLOBAL') || isKeyword(tokens[idx], 'LOCAL')) {
    idx++;
  }
  if (
    isKeyword(tokens[idx], 'TEMP') ||
    isKeyword(tokens[idx], 'TEMPORARY') ||
    isKeyword(tokens[idx], 'UNLOGGED')
  ) {
    idx++;
  }
  if (!isKeyword(tokens[idx], 'TABLE')) {
    return null;
  }
  idx++;
  if (
    isKeyword(tokens[idx], 'IF') &&
    isKeyword(tokens[idx + 1], 'NOT') &&
    isKeyword(tokens[idx + 2], 'EXISTS')
  ) {
    idx += 3;
  }

  const parsed = parseQualifiedName(tokens, idx);
  return parsed?.normalized ?? null;
}

function parseCreateIndexStatement(
  tokens: CodeToken[],
  startIdx: number = 0
): {
  hasConcurrently: boolean;
  indexName: string | null;
  tableName: string | null;
  line: number;
} | null {
  if (!isKeyword(tokens[startIdx], 'CREATE')) {
    return null;
  }
  let idx = startIdx + 1;
  if (isKeyword(tokens[idx], 'UNIQUE')) {
    idx++;
  }
  if (!isKeyword(tokens[idx], 'INDEX')) {
    return null;
  }
  const createLine = tokens[startIdx].line;
  idx++;

  let hasConcurrently = false;
  if (isKeyword(tokens[idx], 'CONCURRENTLY')) {
    hasConcurrently = true;
    idx++;
  }

  if (
    isKeyword(tokens[idx], 'IF') &&
    isKeyword(tokens[idx + 1], 'NOT') &&
    isKeyword(tokens[idx + 2], 'EXISTS')
  ) {
    idx += 3;
  }

  let indexName: string | null = null;
  if (!isKeyword(tokens[idx], 'ON')) {
    const parsedIndex = parseQualifiedName(tokens, idx);
    if (parsedIndex) {
      indexName = parsedIndex.normalized;
      idx = parsedIndex.nextIdx;
    }
  }

  const onIdx = findTopLevelKeywordIndex(tokens, idx, 'ON');
  if (onIdx === -1) {
    return { hasConcurrently, indexName, tableName: null, line: createLine };
  }

  let tableIdx = onIdx + 1;
  if (isKeyword(tokens[tableIdx], 'ONLY')) {
    tableIdx++;
  }

  const parsedTable = parseQualifiedName(tokens, tableIdx);
  return {
    hasConcurrently,
    indexName,
    tableName: parsedTable?.normalized ?? null,
    line: createLine,
  };
}

function parseDropIndexStatement(
  tokens: CodeToken[],
  startIdx: number = 0
): {
  hasConcurrently: boolean;
  hasMultipleTargets: boolean;
  singleIndexName: string | null;
  line: number;
} | null {
  if (!isKeyword(tokens[startIdx], 'DROP') || !isKeyword(tokens[startIdx + 1], 'INDEX')) {
    return null;
  }
  const dropLine = tokens[startIdx].line;
  let idx = startIdx + 2;
  let hasConcurrently = false;
  if (isKeyword(tokens[idx], 'CONCURRENTLY')) {
    hasConcurrently = true;
    idx++;
  }

  if (isKeyword(tokens[idx], 'IF') && isKeyword(tokens[idx + 1], 'EXISTS')) {
    idx += 2;
  }

  const firstTarget = parseQualifiedName(tokens, idx);
  let hasMultipleTargets = false;
  let parenDepth = 0;
  for (let k = idx; k < tokens.length; k++) {
    if (tokens[k].type === 'lparen') {
      parenDepth++;
    } else if (tokens[k].type === 'rparen') {
      parenDepth = Math.max(0, parenDepth - 1);
    } else if (parenDepth === 0 && tokens[k].type === 'comma') {
      hasMultipleTargets = true;
      break;
    }
  }

  return {
    hasConcurrently,
    hasMultipleTargets,
    singleIndexName: !hasMultipleTargets && firstTarget ? firstTarget.normalized : null,
    line: dropLine,
  };
}

function findConcurrentOperationLine(tokens: CodeToken[]): {
  line: number;
  invalidMultiTargetDrop: boolean;
} | null {
  const createIdx = parseCreateIndexStatement(tokens, 0);
  if (createIdx?.hasConcurrently) {
    return { line: createIdx.line, invalidMultiTargetDrop: false };
  }

  const dropIdx = parseDropIndexStatement(tokens, 0);
  if (dropIdx?.hasConcurrently) {
    return { line: dropIdx.line, invalidMultiTargetDrop: dropIdx.hasMultipleTargets };
  }

  if (isKeyword(tokens[0], 'REINDEX') && findTopLevelKeywordIndex(tokens, 1, 'CONCURRENTLY') !== -1) {
    return { line: tokens[0].line, invalidMultiTargetDrop: false };
  }

  // Handle un-semicolon-terminated `BEGIN CREATE INDEX CONCURRENTLY ...` or `BEGIN DROP INDEX CONCURRENTLY ...`
  if (isKeyword(tokens[0], 'BEGIN')) {
    let idx = 1;
    while (
      idx < tokens.length &&
      (isKeyword(tokens[idx], 'TRANSACTION') ||
        isKeyword(tokens[idx], 'WORK') ||
        isKeyword(tokens[idx], 'ISOLATION') ||
        isKeyword(tokens[idx], 'LEVEL') ||
        isKeyword(tokens[idx], 'READ') ||
        isKeyword(tokens[idx], 'WRITE') ||
        isKeyword(tokens[idx], 'ONLY') ||
        isKeyword(tokens[idx], 'DEFERRABLE') ||
        isKeyword(tokens[idx], 'NOT') ||
        isKeyword(tokens[idx], 'SERIALIZABLE') ||
        isKeyword(tokens[idx], 'REPEATABLE') ||
        isKeyword(tokens[idx], 'COMMITTED') ||
        isKeyword(tokens[idx], 'UNCOMMITTED') ||
        tokens[idx].type === 'comma')
    ) {
      idx++;
    }
    const afterBeginCreate = parseCreateIndexStatement(tokens, idx);
    if (afterBeginCreate?.hasConcurrently) {
      return { line: afterBeginCreate.line, invalidMultiTargetDrop: false };
    }
    const afterBeginDrop = parseDropIndexStatement(tokens, idx);
    if (afterBeginDrop?.hasConcurrently) {
      return { line: afterBeginDrop.line, invalidMultiTargetDrop: true };
    }
  }

  return null;
}

function findDeleteFromTokenLine(tokens: CodeToken[]): number | null {
  if (isKeyword(tokens[0], 'DELETE') && isKeyword(tokens[1], 'FROM')) {
    return tokens[0].line;
  }

  // Handle CTE-prefixed `WITH ... DELETE FROM ...` and data-modifying CTEs `WITH d AS (DELETE FROM ...)`
  if (isKeyword(tokens[0], 'WITH')) {
    let parenDepth = 0;
    for (let i = 1; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok.type === 'lparen') {
        parenDepth++;
        if (parenDepth === 1 && isKeyword(tokens[i + 1], 'DELETE') && isKeyword(tokens[i + 2], 'FROM')) {
          return tokens[i + 1].line;
        }
      } else if (tok.type === 'rparen') {
        parenDepth = Math.max(0, parenDepth - 1);
      } else if (parenDepth === 0 && isKeyword(tok, 'DELETE') && isKeyword(tokens[i + 1], 'FROM')) {
        return tok.line;
      }
    }
  }

  return null;
}

function extractDoBodies(tokens: CodeToken[]): Array<{ content: string; line: number }> {
  const bodies: Array<{ content: string; line: number }> = [];
  let i = 1;
  while (i < tokens.length) {
    if (isKeyword(tokens[i], 'LANGUAGE')) {
      i += 2;
      continue;
    }
    const tok = tokens[i];
    if (tok.type === 'dollar_string') {
      bodies.push({ content: tok.innerContent, line: tok.line });
      i++;
      continue;
    }
    if (tok.type === 'string') {
      let combined = tok.innerContent;
      const startLine = tok.line;
      i++;
      while (i < tokens.length && tokens[i].type === 'string') {
        combined += (tokens[i] as Extract<CodeToken, { type: 'string' }>).innerContent;
        i++;
      }
      bodies.push({ content: combined, line: startLine });
      continue;
    }
    i++;
  }
  return bodies;
}

function isCreateRoutineStatement(tokens: CodeToken[]): boolean {
  if (!isKeyword(tokens[0], 'CREATE')) {
    return false;
  }
  if (isKeyword(tokens[1], 'FUNCTION') || isKeyword(tokens[1], 'PROCEDURE')) {
    return true;
  }
  return (
    isKeyword(tokens[1], 'OR') &&
    isKeyword(tokens[2], 'REPLACE') &&
    (isKeyword(tokens[3], 'FUNCTION') || isKeyword(tokens[3], 'PROCEDURE'))
  );
}

function extractRoutineBodies(
  rawSql: string,
  tokens: CodeToken[],
  stmtEndOffset: number
): Array<{ content: string; line: number }> {
  const bodies: Array<{ content: string; line: number }> = [];
  let parenDepth = 0;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type === 'lparen') {
      parenDepth++;
      continue;
    }
    if (tok.type === 'rparen') {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (parenDepth > 0) {
      continue;
    }

    // Standard `AS $$...$$` or `AS '...'` body
    if (isKeyword(tok, 'AS')) {
      const next = tokens[i + 1];
      if (next?.type === 'dollar_string') {
        bodies.push({ content: next.innerContent, line: next.line });
        i++;
        continue;
      }
      if (next?.type === 'string') {
        let combined = next.innerContent;
        const startLine = next.line;
        let k = i + 2;
        while (k < tokens.length && tokens[k].type === 'string') {
          combined += (tokens[k] as Extract<CodeToken, { type: 'string' }>).innerContent;
          k++;
        }
        bodies.push({ content: combined, line: startLine });
        i = k - 1;
        continue;
      }
    }

    // SQL-standard `BEGIN ATOMIC <first_stmt>;`
    if (isKeyword(tok, 'BEGIN') && isKeyword(tokens[i + 1], 'ATOMIC') && tokens[i + 2]) {
      const atomicStmtStart = tokens[i + 2];
      bodies.push({
        content: rawSql.slice(atomicStmtStart.startOffset, stmtEndOffset),
        line: atomicStmtStart.line,
      });
      break;
    }
  }

  return bodies;
}

function stripOuterParensAndTypecast(tokens: CodeToken[]): CodeToken[] {
  let slice = tokens;
  let changed = true;

  while (changed && slice.length > 0) {
    changed = false;

    // Strip trailing PostgreSQL `::typename` cast at parenDepth 0 (e.g. `'...'::text`)
    let parenDepth = 0;
    let castPos = -1;
    for (let i = 0; i < slice.length - 1; i++) {
      if (slice[i].type === 'lparen') {
        parenDepth++;
      } else if (slice[i].type === 'rparen') {
        parenDepth = Math.max(0, parenDepth - 1);
      } else if (parenDepth === 0 && isAdjacentSymbolPair(slice, i, ':', ':')) {
        castPos = i;
        break;
      }
    }
    if (castPos > 0) {
      slice = slice.slice(0, castPos);
      changed = true;
    }

    // Strip outer wrapping `(...)` if matching
    if (slice.length >= 2 && slice[0].type === 'lparen' && slice[slice.length - 1].type === 'rparen') {
      let depth = 0;
      let wrapsAll = true;
      for (let i = 0; i < slice.length - 1; i++) {
        if (slice[i].type === 'lparen') {
          depth++;
        } else if (slice[i].type === 'rparen') {
          depth--;
          if (depth === 0) {
            wrapsAll = false;
            break;
          }
        }
      }
      if (wrapsAll && depth === 1) {
        slice = slice.slice(1, -1);
        changed = true;
      }
    }
  }

  return slice;
}

function splitByTopLevelConcat(tokens: CodeToken[]): CodeToken[][] | null {
  const parts: CodeToken[][] = [];
  let current: CodeToken[] = [];
  let parenDepth = 0;
  let sawConcat = false;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type === 'lparen') {
      parenDepth++;
      current.push(tok);
    } else if (tok.type === 'rparen') {
      parenDepth = Math.max(0, parenDepth - 1);
      current.push(tok);
    } else if (parenDepth === 0 && isAdjacentSymbolPair(tokens, i, '|', '|')) {
      sawConcat = true;
      parts.push(current);
      current = [];
      i++; // skip second `|`
    } else {
      current.push(tok);
    }
  }

  if (!sawConcat) {
    return null;
  }
  parts.push(current);
  return parts;
}

function extractExecuteExprTokens(tokens: CodeToken[]): CodeToken[] {
  let parenDepth = 0;
  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type === 'lparen') {
      parenDepth++;
    } else if (tok.type === 'rparen') {
      parenDepth = Math.max(0, parenDepth - 1);
    } else if (parenDepth === 0 && (isKeyword(tok, 'INTO') || isKeyword(tok, 'USING'))) {
      return tokens.slice(1, i);
    }
  }
  return tokens.slice(1);
}

function parseFunctionCallArgs(
  tokens: CodeToken[],
  expectedFuncUpper: string
): CodeToken[][] | null {
  let fnIdx = 0;
  if (
    isKeyword(tokens[0], 'PG_CATALOG') &&
    isSymbol(tokens[1], '.') &&
    isKeyword(tokens[2], expectedFuncUpper)
  ) {
    fnIdx = 2;
  } else if (!isKeyword(tokens[0], expectedFuncUpper)) {
    return null;
  }

  if (tokens[fnIdx + 1]?.type !== 'lparen' || tokens[tokens.length - 1]?.type !== 'rparen') {
    return null;
  }

  let depth = 0;
  for (let i = fnIdx + 1; i < tokens.length - 1; i++) {
    if (tokens[i].type === 'lparen') {
      depth++;
    } else if (tokens[i].type === 'rparen') {
      depth--;
      if (depth === 0) {
        return null;
      }
    }
  }

  return splitTopLevelClauses(tokens.slice(fnIdx + 2, -1));
}

function evaluateStaticExecuteExpr(tokens: CodeToken[]): { sql: string; line: number } | null {
  const cleaned = stripOuterParensAndTypecast(tokens);
  if (cleaned.length === 0) {
    return null;
  }

  const concatParts = splitByTopLevelConcat(cleaned);
  if (concatParts) {
    let joined = '';
    const startLine = cleaned[0].line;
    for (const part of concatParts) {
      if (part.length === 0) {
        return null;
      }
      const evaluated = evaluateStaticExecuteExpr(part);
      if (!evaluated) {
        return null;
      }
      joined += evaluated.sql;
    }
    return { sql: joined, line: startLine };
  }

  if (cleaned.every((t) => t.type === 'string' || t.type === 'dollar_string')) {
    const joined = cleaned
      .map((t) => (t as Extract<CodeToken, { type: 'string' | 'dollar_string' }>).innerContent)
      .join('');
    return { sql: joined, line: cleaned[0].line };
  }

  const formatArgs = parseFunctionCallArgs(cleaned, 'FORMAT');
  if (formatArgs && formatArgs.length >= 1) {
    return evaluateStaticExecuteExpr(formatArgs[0]);
  }

  const concatArgs = parseFunctionCallArgs(cleaned, 'CONCAT');
  if (concatArgs && concatArgs.length >= 1) {
    let joined = '';
    for (const arg of concatArgs) {
      const evaluated = evaluateStaticExecuteExpr(arg);
      if (!evaluated) {
        return null;
      }
      joined += evaluated.sql;
    }
    return { sql: joined, line: cleaned[0].line };
  }

  if (parseFunctionCallArgs(cleaned, 'QUOTE_IDENT')) {
    return { sql: '%I', line: cleaned[0].line };
  }

  if (
    parseFunctionCallArgs(cleaned, 'QUOTE_LITERAL') ||
    parseFunctionCallArgs(cleaned, 'QUOTE_NULLABLE')
  ) {
    return { sql: "''", line: cleaned[0].line };
  }

  return null;
}

function inspectSqlBlock(
  sql: string,
  filePath: string,
  baseLine: number,
  isPlpgsqlBody: boolean,
  inTransactionalOrNestedBlock: boolean,
  fileState: MigrationFileState,
  violations: MigrationViolation[]
): void {
  const tokens = tokenizeSql(sql, baseLine);
  const statements = splitStatements(tokens);
  const isMultiStatementOrNested = inTransactionalOrNestedBlock || statements.length > 1;
  let sawBeginTransaction = false;

  for (const stmt of statements) {
    const effectiveTokens = isPlpgsqlBody ? stripPlpgsqlHeaders(stmt.tokens) : stmt.tokens;
    if (effectiveTokens.length === 0) {
      continue;
    }

    const first = effectiveTokens[0];
    const stmtSnippet = formatSnippet(sql, first.startOffset, stmt.endOffset);

    if (!isPlpgsqlBody && isKeyword(first, 'BEGIN')) {
      sawBeginTransaction = true;
    }

    // Track newly created tables per file even if a statement carries an annotation
    const createdTableName = parseCreateTableName(effectiveTokens);
    if (createdTableName !== null) {
      fileState.createdTables.add(createdTableName);
    }

    // Enforce single-statement non-transactional execution for CONCURRENTLY index operations
    // (Prisma Migrate wraps multi-statement files in an implicit transaction -> PostgreSQL 25001)
    const concurrentOp = findConcurrentOperationLine(effectiveTokens);
    if (concurrentOp !== null) {
      if (
        isMultiStatementOrNested ||
        sawBeginTransaction ||
        concurrentOp.invalidMultiTargetDrop
      ) {
        violations.push({
          file: filePath,
          line: concurrentOp.line,
          keyword: 'CONCURRENTLY IN TRANSACTION',
          snippet: stmtSnippet,
        });
      }
      continue;
    }

    // Raw format('%s', var) statement starting with a placeholder cannot be statically verified
    if (inTransactionalOrNestedBlock && consumeFormatPlaceholder(effectiveTokens, 0) !== -1) {
      if (!stmt.bypassed) {
        violations.push({
          file: filePath,
          line: first.line,
          keyword: 'EXECUTE',
          snippet: stmtSnippet,
        });
      }
      continue;
    }

    if (stmt.bypassed) {
      continue;
    }

    // Recursive inspection of PL/pgSQL DO blocks (dollar-quoted and single-quoted bodies)
    if (isKeyword(first, 'DO')) {
      const bodies = extractDoBodies(effectiveTokens);
      for (const body of bodies) {
        inspectSqlBlock(body.content, filePath, body.line, true, true, fileState, violations);
      }
      continue;
    }

    // Recursive inspection of CREATE [OR REPLACE] FUNCTION and PROCEDURE bodies
    if (isCreateRoutineStatement(effectiveTokens)) {
      const bodies = extractRoutineBodies(sql, effectiveTokens, stmt.endOffset);
      for (const body of bodies) {
        inspectSqlBlock(body.content, filePath, body.line, true, true, fileState, violations);
      }
      continue;
    }

    // Inspect PREPARE <name> [(...)] AS <statement>
    if (isKeyword(first, 'PREPARE')) {
      const asIdx = findTopLevelKeywordIndex(effectiveTokens, 1, 'AS');
      if (asIdx !== -1 && effectiveTokens[asIdx + 1]) {
        const innerStart = effectiveTokens[asIdx + 1];
        inspectSqlBlock(
          sql.slice(innerStart.startOffset, stmt.endOffset),
          filePath,
          innerStart.line,
          false,
          true,
          fileState,
          violations
        );
      }
      continue;
    }

    // Dynamic SQL execution (`EXECUTE ...` in PL/pgSQL or top-level `EXECUTE prepared_stmt`)
    if (isKeyword(first, 'EXECUTE')) {
      if (!isPlpgsqlBody) {
        violations.push({
          file: filePath,
          line: first.line,
          keyword: 'EXECUTE',
          snippet: stmtSnippet,
        });
        continue;
      }

      const exprTokens = extractExecuteExprTokens(effectiveTokens);
      const staticEval = evaluateStaticExecuteExpr(exprTokens);
      if (!staticEval) {
        violations.push({
          file: filePath,
          line: first.line,
          keyword: 'EXECUTE',
          snippet: stmtSnippet,
        });
      } else {
        const beforeCount = violations.length;
        inspectSqlBlock(
          staticEval.sql,
          filePath,
          staticEval.line,
          false,
          true,
          fileState,
          violations
        );
        // Preserve accurate outer line number when joined literals shift single-line offsets
        for (let vIdx = beforeCount; vIdx < violations.length; vIdx++) {
          if (violations[vIdx].line < first.line) {
            violations[vIdx].line = first.line;
          }
        }
      }
      continue;
    }

    // CREATE [UNIQUE] INDEX without CONCURRENTLY
    const createIndexInfo = parseCreateIndexStatement(effectiveTokens, 0);
    if (createIndexInfo !== null && !createIndexInfo.hasConcurrently) {
      const isTargetTableNewlyCreated =
        createIndexInfo.tableName !== null &&
        fileState.createdTables.has(createIndexInfo.tableName);
      if (isTargetTableNewlyCreated) {
        if (createIndexInfo.indexName !== null) {
          fileState.createdNewTableIndexes.add(createIndexInfo.indexName);
        }
        continue;
      }
      if (!fileState.isHistoricalBaseline) {
        violations.push({
          file: filePath,
          line: first.line,
          keyword: 'CREATE INDEX',
          snippet: stmtSnippet,
        });
      }
      continue;
    }

    // DROP TABLE / TYPE / INDEX / SCHEMA / [MATERIALIZED] VIEW / TRIGGER / FUNCTION / PROCEDURE / SEQUENCE
    if (isKeyword(first, 'DROP')) {
      const dropIndexInfo = parseDropIndexStatement(effectiveTokens, 0);
      if (dropIndexInfo !== null && !dropIndexInfo.hasConcurrently) {
        const isNewlyCreatedTableIndex =
          dropIndexInfo.singleIndexName !== null &&
          fileState.createdNewTableIndexes.has(dropIndexInfo.singleIndexName);
        if (!isNewlyCreatedTableIndex) {
          violations.push({
            file: filePath,
            line: first.line,
            keyword: 'DROP INDEX',
            snippet: stmtSnippet,
          });
        }
        continue;
      }

      if (isKeyword(effectiveTokens[1], 'MATERIALIZED') && isKeyword(effectiveTokens[2], 'VIEW')) {
        violations.push({
          file: filePath,
          line: first.line,
          keyword: 'DROP MATERIALIZED VIEW',
          snippet: stmtSnippet,
        });
        continue;
      }

      const secondUpper = effectiveTokens[1]?.type === 'word' ? effectiveTokens[1].upper : null;
      if (
        secondUpper === 'TABLE' ||
        secondUpper === 'TYPE' ||
        secondUpper === 'SCHEMA' ||
        secondUpper === 'VIEW' ||
        secondUpper === 'TRIGGER' ||
        secondUpper === 'FUNCTION' ||
        secondUpper === 'PROCEDURE' ||
        secondUpper === 'SEQUENCE'
      ) {
        violations.push({
          file: filePath,
          line: first.line,
          keyword: `DROP ${secondUpper}`,
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

    // DELETE FROM ... (including CTE-prefixed DELETE FROM)
    const deleteFromLine = findDeleteFromTokenLine(effectiveTokens);
    if (deleteFromLine !== null) {
      violations.push({
        file: filePath,
        line: deleteFromLine,
        keyword: 'DELETE FROM',
        snippet: stmtSnippet,
      });
      continue;
    }

    // ALTER TABLE ...
    if (isKeyword(first, 'ALTER') && isKeyword(effectiveTokens[1], 'TABLE')) {
      const parsedTarget = parseAlterTableTarget(effectiveTokens);
      if (!parsedTarget) {
        continue;
      }

      const clauses = splitTopLevelClauses(effectiveTokens.slice(parsedTarget.clausesStart));
      for (let cIdx = 0; cIdx < clauses.length; cIdx++) {
        const clause = clauses[cIdx];
        const keyword = detectAlterTableClauseKeyword(clause, parsedTarget.tableName, fileState);
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

    // ALTER TYPE ... RENAME VALUE ... TO ...
    if (
      isKeyword(first, 'ALTER') &&
      isKeyword(effectiveTokens[1], 'TYPE') &&
      hasTopLevelRenameValue(effectiveTokens)
    ) {
      violations.push({
        file: filePath,
        line: first.line,
        keyword: 'RENAME VALUE',
        snippet: stmtSnippet,
      });
      continue;
    }

    // ALTER TYPE / VIEW / MATERIALIZED VIEW / SEQUENCE / SCHEMA / FUNCTION / PROCEDURE ... RENAME TO ...
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
  const fileState: MigrationFileState = {
    isHistoricalBaseline: isHistoricalBaselineMigration(filePath),
    createdTables: new Set<string>(),
    createdNewTableIndexes: new Set<string>(),
  };
  inspectSqlBlock(content, filePath, 1, false, false, fileState, violations);
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
 * Verifies an explicit list of SQL migration files.
 */
export function verifyMigrationFiles(sqlFiles: string[]): VerificationResult {
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

/**
 * Verifies all SQL migration files in the given directory.
 */
export function verifyMigrations(targetDir?: string): VerificationResult {
  const migrationsDir = targetDir || path.join(process.cwd(), 'prisma/migrations');
  const sqlFiles = findSqlFiles(migrationsDir);
  return verifyMigrationFiles(sqlFiles);
}

// CLI Execution Entry Point
export function main(): void {
  const cliArgs = process.argv.slice(2);
  let result: VerificationResult;
  if (cliArgs.length > 0 && cliArgs.every((arg) => arg.toLowerCase().endsWith('.sql'))) {
    const resolvedFiles = cliArgs
      .map((arg) => path.resolve(process.cwd(), arg))
      .filter((absPath) => fs.existsSync(absPath));
    result = verifyMigrationFiles(resolvedFiles);
  } else {
    const targetDir = cliArgs[0] ? path.resolve(process.cwd(), cliArgs[0]) : undefined;
    result = verifyMigrations(targetDir);
  }

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
