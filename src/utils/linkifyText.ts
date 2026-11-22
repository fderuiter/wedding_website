import { sanitizeUrl } from './validation';

export type SafeLinkToken =
  | { type: 'text'; value: string }
  | { type: 'link'; label: string; href: string; isExternal: boolean };

const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const SCRIPT_OR_STYLE_BLOCK_RE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;
const HTML_ANCHOR_RE = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
const RAW_HTML_TAG_RE = /<\/?[a-zA-Z][^>]*>/g;
const UNSAFE_SCHEME_PREFIX_RE = /^(?:javascript|data|vbscript)\s*:/i;
const BARE_EMAIL_EXACT_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

/**
 * Combined tokenizer matching:
 * 1. Markdown links: `[label](target)`
 * 2. Unsafe raw URI tokens (`javascript:...`, `data:...`, `vbscript:...`) so they can be stripped cleanly
 * 3. Explicit safe schemes: `https://...`, `http://...`, `mailto:...`, `tel:...`
 * 4. Bare email addresses: `name@domain.tld`
 * 5. Formatted US/international phone numbers (10-15 digits, e.g. `+1 (555) 234-5678` or `555-234-5678`)
 * 6. Internal relative paths or section anchors (`/registry`, `/things-to-do`, `#accommodations`, etc.)
 */
const LINK_CANDIDATE_RE = new RegExp(
  [
    // Group 1 (label), Group 2 (target): Markdown link [label](target)
    '\\[([^\\]\\n]{1,200})\\]\\(([^)\\s]{1,2000})\\)',
    // Group 3: Unsafe inline scheme token to strip
    '\\b(?:javascript|data|vbscript):[^\\s<>]*',
    // Group 4: Explicit http(s), mailto, or tel URI
    '(?:https?:\\/\\/|mailto:|tel:)[^\\s<>]+',
    // Group 5: Bare email address
    '\\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}\\b',
    // Group 6: Formatted phone number (+1 (555) 234-5678, (555) 234-5678, 555-234-5678)
    '(?:\\+\\d{1,3}[\\s.-]?)?(?:\\(\\d{3}\\)|\\b\\d{3})[\\s.-]\\d{3}[\\s.-]\\d{4}\\b',
    // Group 7 (prefix), Group 8 (internal path or hash anchor)
    '(^|[\\s(])((?:\\/[a-zA-Z0-9][a-zA-Z0-9\\-/_?#=&]*)|(?:#[a-zA-Z][a-zA-Z0-9\\-_]*))',
  ].join('|'),
  'g'
);

function stripRawHtml(input: string): string {
  if (!input) return '';
  // Convert safe-looking <a href="...">label</a> into markdown [label](href) before stripping remaining HTML tags,
  // while discarding unsafe hrefs so raw HTML tags never survive into the output.
  const convertedAnchors = input
    .replace(CONTROL_CHARS_RE, '')
    .replace(SCRIPT_OR_STYLE_BLOCK_RE, '')
    .replace(HTML_ANCHOR_RE, (_full, dqHref, sqHref, bareHref, innerHtml) => {
      const rawHref = String(dqHref ?? sqHref ?? bareHref ?? '').trim();
      const cleanLabel = String(innerHtml ?? '')
        .replace(RAW_HTML_TAG_RE, '')
        .replace(/[<>[\]]/g, '')
        .trim();
      const safeHref = resolveCandidateHref(rawHref);
      if (!safeHref) {
        return cleanLabel;
      }
      return cleanLabel ? `[${cleanLabel}](${safeHref})` : safeHref;
    });

  return convertedAnchors.replace(RAW_HTML_TAG_RE, '').replace(/[<>]/g, '');
}

function splitTrailingPunctuation(raw: string): { core: string; trailing: string } {
  let core = raw;
  let trailing = '';

  while (core.length > 0) {
    const lastChar = core[core.length - 1];
    if (lastChar === '.' || lastChar === ',' || lastChar === ';' || lastChar === ':' || lastChar === '!' || lastChar === '?') {
      trailing = lastChar + trailing;
      core = core.slice(0, -1);
      continue;
    }
    if (lastChar === ')') {
      const openCount = (core.match(/\(/g) || []).length;
      const closeCount = (core.match(/\)/g) || []).length;
      if (closeCount > openCount) {
        trailing = ')' + trailing;
        core = core.slice(0, -1);
        continue;
      }
    }
    break;
  }

  return { core, trailing };
}

function resolveCandidateHref(rawTarget: string): string | undefined {
  const trimmed = rawTarget.trim();
  if (!trimmed || UNSAFE_SCHEME_PREFIX_RE.test(trimmed)) {
    return undefined;
  }

  if (BARE_EMAIL_EXACT_RE.test(trimmed)) {
    return sanitizeUrl(`mailto:${trimmed}`);
  }

  if (trimmed.toLowerCase().startsWith('tel:')) {
    const rawNumber = trimmed.slice(4).trim();
    const hasPlus = rawNumber.startsWith('+');
    const digits = rawNumber.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) {
      return undefined;
    }
    return sanitizeUrl(`tel:${hasPlus ? '+' : ''}${digits}`);
  }

  if (trimmed.toLowerCase().startsWith('mailto:')) {
    const addressPart = trimmed.slice(7).split('?')[0]?.trim() || '';
    if (!BARE_EMAIL_EXACT_RE.test(addressPart)) {
      return undefined;
    }
    return sanitizeUrl(trimmed);
  }

  return sanitizeUrl(trimmed);
}

function pushText(tokens: SafeLinkToken[], value: string): void {
  if (!value) return;
  const prev = tokens[tokens.length - 1];
  if (prev && prev.type === 'text') {
    prev.value += value;
  } else {
    tokens.push({ type: 'text', value });
  }
}

/**
 * Statelessly parses plain text (with optional `[label](url)` markdown links) into safe
 * text and link tokens. Strips raw HTML tags and dangerous URI protocols (`javascript:`,
 * `data:`, `vbscript:`, `//`) and validates every rendered href via `sanitizeUrl`.
 */
export function tokenizeSafeLinks(rawText?: string | null): SafeLinkToken[] {
  if (!rawText || typeof rawText !== 'string') {
    return [];
  }

  const sanitizedInput = stripRawHtml(rawText);
  if (!sanitizedInput) {
    return [];
  }

  const tokens: SafeLinkToken[] = [];
  let lastIndex = 0;

  LINK_CANDIDATE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = LINK_CANDIDATE_RE.exec(sanitizedInput)) !== null) {
    const matchStart = match.index;
    const fullMatch = match[0];

    if (matchStart > lastIndex) {
      pushText(tokens, sanitizedInput.slice(lastIndex, matchStart));
    }

    const mdLabel = match[1];
    const mdTarget = match[2];
    const prefix = match[3];
    const internalPath = match[4];

    if (mdLabel !== undefined && mdTarget !== undefined) {
      const safeHref = resolveCandidateHref(mdTarget);
      const cleanLabel = mdLabel.trim();
      if (safeHref && cleanLabel) {
        tokens.push({
          type: 'link',
          label: cleanLabel,
          href: safeHref,
          isExternal: /^https?:\/\//i.test(safeHref),
        });
      } else if (cleanLabel) {
        pushText(tokens, cleanLabel);
      }
    } else if (UNSAFE_SCHEME_PREFIX_RE.test(fullMatch)) {
      // Strip unsafe URI scheme completely (e.g. javascript:alert(1))
    } else if (internalPath !== undefined) {
      if (prefix) {
        pushText(tokens, prefix);
      }
      const { core, trailing } = splitTrailingPunctuation(internalPath);
      const safeHref = resolveCandidateHref(core);
      if (safeHref) {
        tokens.push({
          type: 'link',
          label: core,
          href: safeHref,
          isExternal: false,
        });
      } else {
        pushText(tokens, core);
      }
      if (trailing) {
        pushText(tokens, trailing);
      }
    } else if (BARE_EMAIL_EXACT_RE.test(fullMatch)) {
      const safeHref = sanitizeUrl(`mailto:${fullMatch}`);
      if (safeHref) {
        tokens.push({
          type: 'link',
          label: fullMatch,
          href: safeHref,
          isExternal: false,
        });
      } else {
        pushText(tokens, fullMatch);
      }
    } else if (/^(?:https?:\/\/|mailto:|tel:)/i.test(fullMatch)) {
      const { core, trailing } = splitTrailingPunctuation(fullMatch);
      const safeHref = resolveCandidateHref(core);
      if (safeHref) {
        const displayLabel = core.replace(/^(?:mailto:|tel:)/i, '') || core;
        tokens.push({
          type: 'link',
          label: displayLabel,
          href: safeHref,
          isExternal: /^https?:\/\//i.test(safeHref),
        });
      } else {
        pushText(tokens, core);
      }
      if (trailing) {
        pushText(tokens, trailing);
      }
    } else {
      // Formatted bare phone number
      const trimmedPhone = fullMatch.trim();
      const digits = trimmedPhone.replace(/\D/g, '');
      const hasPlus = trimmedPhone.startsWith('+');
      const safeHref =
        digits.length >= 10 && digits.length <= 15
          ? sanitizeUrl(`tel:${hasPlus ? '+' : ''}${digits}`)
          : undefined;
      if (safeHref) {
        tokens.push({
          type: 'link',
          label: trimmedPhone,
          href: safeHref,
          isExternal: false,
        });
      } else {
        pushText(tokens, fullMatch);
      }
    }

    lastIndex = matchStart + fullMatch.length;
  }

  if (lastIndex < sanitizedInput.length) {
    pushText(tokens, sanitizedInput.slice(lastIndex));
  }

  return tokens;
}
