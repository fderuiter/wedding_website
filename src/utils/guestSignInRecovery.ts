import { z } from 'zod';

export const RECOVERY_CONFIRMATION_MESSAGE =
  "If your details match an invited household with saved contact information, we've sent a personal one-click sign-in link.";

export const HOUSEHOLD_RECOVERY_COOLDOWN_MS = 10 * 60 * 1000;
const MAX_COOLDOWN_ENTRIES = 5_000;

const ALLOWED_SMTP_PORTS = new Set([25, 465, 587, 2525]);

const HONORIFIC_AND_CONNECTOR_TOKENS = new Set([
  '&',
  '+',
  'and',
  'the',
  'family',
  'household',
  'mr',
  'mrs',
  'ms',
  'mx',
  'miss',
  'dr',
  'prof',
  'rev',
]);

export interface OutboundMessagingConfigLike {
  emailProvider?: string | null;
  smtpHost?: string | null;
  smtpPort?: number | string | null;
  smtpUser?: string | null;
  smtpPass?: string | null;
  hasSmtpPass?: boolean | null;
  resendApiKey?: string | null;
  hasResendApiKey?: boolean | null;
  sendgridApiKey?: string | null;
  hasSendgridApiKey?: boolean | null;
  smsProvider?: string | null;
  twilioAccountSid?: string | null;
  twilioAuthToken?: string | null;
  hasTwilioAuthToken?: boolean | null;
  twilioFromNumber?: string | null;
}

function hasNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidSmtpPort(rawPort: unknown): boolean {
  if (rawPort === undefined || rawPort === null || rawPort === '') {
    return true;
  }
  const parsed =
    typeof rawPort === 'number'
      ? rawPort
      : typeof rawPort === 'string' && /^\d+$/.test(rawPort.trim())
        ? Number(rawPort.trim())
        : Number.NaN;
  return Number.isInteger(parsed) && ALLOWED_SMTP_PORTS.has(parsed);
}

export function isEmailProviderActive(
  config: OutboundMessagingConfigLike | null | undefined,
): boolean {
  if (!config || typeof config !== 'object') {
    return false;
  }
  const provider =
    typeof config.emailProvider === 'string' && config.emailProvider.trim()
      ? config.emailProvider.trim().toLowerCase()
      : 'smtp';

  if (provider === 'resend') {
    return hasNonEmptyString(config.resendApiKey) || config.hasResendApiKey === true;
  }
  if (provider === 'sendgrid') {
    return hasNonEmptyString(config.sendgridApiKey) || config.hasSendgridApiKey === true;
  }
  if (provider === 'smtp') {
    if (!hasNonEmptyString(config.smtpHost) || !isValidSmtpPort(config.smtpPort)) {
      return false;
    }
    if (hasNonEmptyString(config.smtpUser)) {
      return hasNonEmptyString(config.smtpPass) || config.hasSmtpPass === true;
    }
    return true;
  }
  return false;
}

export function isSmsProviderActive(
  config: OutboundMessagingConfigLike | null | undefined,
): boolean {
  if (!config || typeof config !== 'object') {
    return false;
  }
  const provider =
    typeof config.smsProvider === 'string' && config.smsProvider.trim()
      ? config.smsProvider.trim().toLowerCase()
      : 'none';

  if (provider === 'twilio') {
    return (
      hasNonEmptyString(config.twilioAccountSid) &&
      hasNonEmptyString(config.twilioFromNumber) &&
      (hasNonEmptyString(config.twilioAuthToken) || config.hasTwilioAuthToken === true)
    );
  }
  return false;
}

export function isOutboundMessagingActive(
  config: OutboundMessagingConfigLike | null | undefined,
): boolean {
  return isEmailProviderActive(config) || isSmsProviderActive(config);
}

export function hasRecoveryHoneypotTripped(body: Record<string, unknown>): boolean {
  const candidates = [body.website, body.honeypot, body.hp_field, body.confirm_email];
  return candidates.some((val) => typeof val === 'string' && val.trim().length > 0);
}

export type ParsedRecoveryIdentifier =
  | { kind: 'email'; email: string }
  | { kind: 'name'; fullName: string; normalizedName: string; strippedHonorificName: string };

function normalizeNameForComparison(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[.,'`’"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHonorificTokens(normalizedName: string): string {
  return normalizedName
    .split(' ')
    .filter((token) => token && !HONORIFIC_AND_CONNECTOR_TOKENS.has(token))
    .join(' ')
    .trim();
}

function countSignificantNameWords(raw: string): number {
  const normalized = normalizeNameForComparison(raw);
  const stripped = stripHonorificTokens(normalized);
  if (!stripped) return 0;
  return stripped
    .split(' ')
    .filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

export function parseRecoveryIdentifier(input: {
  identifier?: string;
  query?: string;
  email?: string;
  name?: string;
}): { ok: true; data: ParsedRecoveryIdentifier } | { ok: false; error: string } {
  const rawEmail = typeof input.email === 'string' ? input.email.trim() : '';
  const rawName = typeof input.name === 'string' ? input.name.trim() : '';
  const rawUnified =
    typeof input.identifier === 'string' && input.identifier.trim()
      ? input.identifier.trim()
      : typeof input.query === 'string' && input.query.trim()
        ? input.query.trim()
        : '';

  if (rawEmail || rawUnified.includes('@')) {
    const candidateEmail = (rawEmail || rawUnified).trim().toLowerCase();
    if (candidateEmail.length > 254 || !z.email().safeParse(candidateEmail).success) {
      return {
        ok: false,
        error: 'Please enter a valid email address or your full first and last name.',
      };
    }
    return {
      ok: true,
      data: { kind: 'email', email: candidateEmail },
    };
  }

  const candidateName = (rawName || rawUnified).replace(/\s+/g, ' ').trim();
  if (!candidateName) {
    return {
      ok: false,
      error: 'Please enter the email address or full guest name on your invitation.',
    };
  }

  if (
    candidateName.length < 3 ||
    candidateName.length > 120 ||
    /[<>[\]\u0000-\u001F\u007F]/.test(candidateName)
  ) {
    return {
      ok: false,
      error: 'Please enter a valid email address or your full first and last name.',
    };
  }

  if (countSignificantNameWords(candidateName) < 2) {
    return {
      ok: false,
      error: 'Please enter both your first and last name, or your email address.',
    };
  }

  const normalizedName = normalizeNameForComparison(candidateName);
  const strippedHonorificName = stripHonorificTokens(normalizedName);

  return {
    ok: true,
    data: {
      kind: 'name',
      fullName: candidateName,
      normalizedName,
      strippedHonorificName,
    },
  };
}

interface RecoverableMemberRecord {
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  displayOrder?: number | null;
}

export interface RecoverableInvitationRecord {
  id: string;
  code: string;
  guestName: string;
  householdName?: string | null;
  email?: string | null;
  plusOneFirstName?: string | null;
  plusOneLastName?: string | null;
  partyTags?: unknown;
  extraFields?: unknown;
  isSample?: boolean | null;
  members?: RecoverableMemberRecord[] | null;
}

function isAddressCollectionOnlyRecord(partyTags: unknown): boolean {
  if (!Array.isArray(partyTags)) return false;
  return partyTags.some(
    (tag) => typeof tag === 'string' && tag.trim().toLowerCase() === 'address-collection',
  );
}

function collectCandidateNameForms(invite: RecoverableInvitationRecord): Set<string> {
  const candidates = new Set<string>();
  const addCandidate = (raw: string | null | undefined) => {
    if (!raw || typeof raw !== 'string') return;
    const normalized = normalizeNameForComparison(raw);
    if (normalized) {
      candidates.add(normalized);
    }
    const stripped = stripHonorificTokens(normalized);
    if (stripped && stripped.split(' ').length >= 2) {
      candidates.add(stripped);
    }
  };

  addCandidate(invite.guestName);

  // Support couple household names such as "John & Jane Smith" or "Mr. & Mrs. Robert Smith"
  const rawGuestName = typeof invite.guestName === 'string' ? invite.guestName.trim() : '';
  const splitParts = rawGuestName.split(/\s+(?:&|and|\+)\s+/i).map((p) => p.trim()).filter(Boolean);
  if (splitParts.length === 2) {
    const [leftRaw, rightRaw] = splitParts;
    addCandidate(leftRaw);
    addCandidate(rightRaw);

    const rightStrippedTokens = stripHonorificTokens(normalizeNameForComparison(rightRaw))
      .split(' ')
      .filter(Boolean);
    const leftStrippedTokens = stripHonorificTokens(normalizeNameForComparison(leftRaw))
      .split(' ')
      .filter(Boolean);

    if (leftStrippedTokens.length === 1 && rightStrippedTokens.length >= 2) {
      const sharedSurname = rightStrippedTokens[rightStrippedTokens.length - 1];
      candidates.add(`${leftStrippedTokens[0]} ${sharedSurname}`);
    }
  }

  const plusOneCombined = [invite.plusOneFirstName, invite.plusOneLastName]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(' ');
  if (plusOneCombined) {
    addCandidate(plusOneCombined);
  }

  if (Array.isArray(invite.members)) {
    for (const member of invite.members) {
      if (!member || member.role === 'CHILD') continue;
      addCandidate(member.fullName);
      const memberCombined = [member.firstName, member.lastName]
        .map((part) => (typeof part === 'string' ? part.trim() : ''))
        .filter(Boolean)
        .join(' ');
      if (memberCombined) {
        addCandidate(memberCombined);
      }
    }
  }

  return candidates;
}

function readExtraFieldString(extraFields: unknown, keys: string[]): string | null {
  if (!extraFields) return null;
  let parsed: unknown = extraFields;
  if (typeof extraFields === 'string') {
    try {
      parsed = JSON.parse(extraFields);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  for (const key of keys) {
    const val = record[key];
    if (typeof val === 'string' && val.trim()) {
      return val.trim();
    }
  }
  return null;
}

export interface MatchedRecoverableInvitation<T extends RecoverableInvitationRecord> {
  invitation: T;
  preferredEmail: string | null;
}

export function findUnambiguousRecoverableInvitation<T extends RecoverableInvitationRecord>(
  invitations: readonly T[],
  parsed: ParsedRecoveryIdentifier,
): MatchedRecoverableInvitation<T> | null {
  const matches: MatchedRecoverableInvitation<T>[] = [];

  for (const invite of invitations) {
    if (!invite || invite.isSample === true) continue;
    if (!invite.code || !invite.code.trim()) continue;
    if (isAddressCollectionOnlyRecord(invite.partyTags)) continue;

    if (parsed.kind === 'email') {
      const targetEmail = parsed.email;
      const primaryEmail = typeof invite.email === 'string' ? invite.email.trim() : '';
      if (primaryEmail && primaryEmail.toLowerCase() === targetEmail) {
        matches.push({ invitation: invite, preferredEmail: primaryEmail });
        continue;
      }

      const matchedMember = Array.isArray(invite.members)
        ? invite.members.find(
          (m) =>
            m &&
            m.role !== 'CHILD' &&
            typeof m.email === 'string' &&
            m.email.trim().toLowerCase() === targetEmail,
        )
        : undefined;
      if (matchedMember && typeof matchedMember.email === 'string') {
        matches.push({ invitation: invite, preferredEmail: matchedMember.email.trim() });
        continue;
      }

      const extraEmail = readExtraFieldString(invite.extraFields, [
        'email',
        'Email',
        'guestEmail',
        'contactEmail',
      ]);
      if (extraEmail && extraEmail.toLowerCase() === targetEmail) {
        matches.push({ invitation: invite, preferredEmail: extraEmail });
      }
      continue;
    }

    const candidates = collectCandidateNameForms(invite);
    if (
      candidates.has(parsed.normalizedName) ||
      (parsed.strippedHonorificName.split(' ').length >= 2 &&
        candidates.has(parsed.strippedHonorificName))
    ) {
      matches.push({ invitation: invite, preferredEmail: null });
    }
  }

  if (matches.length !== 1) {
    return null;
  }

  return matches[0];
}

const householdRecoveryCooldownMap = new Map<string, number>();

function pruneExpiredRecoveryCooldowns(nowMs: number): void {
  if (householdRecoveryCooldownMap.size === 0) return;
  for (const [key, expiresAt] of householdRecoveryCooldownMap.entries()) {
    if (expiresAt <= nowMs) {
      householdRecoveryCooldownMap.delete(key);
    }
  }
  while (householdRecoveryCooldownMap.size > MAX_COOLDOWN_ENTRIES) {
    const oldestKey = householdRecoveryCooldownMap.keys().next().value;
    if (oldestKey === undefined) break;
    householdRecoveryCooldownMap.delete(oldestKey);
  }
}

export function isHouseholdOnRecoveryCooldown(
  householdKey: string,
  nowMs: number = Date.now(),
): boolean {
  pruneExpiredRecoveryCooldowns(nowMs);
  const expiresAt = householdRecoveryCooldownMap.get(householdKey);
  return typeof expiresAt === 'number' && expiresAt > nowMs;
}

export function markHouseholdRecoverySent(
  householdKey: string,
  cooldownMs: number = HOUSEHOLD_RECOVERY_COOLDOWN_MS,
  nowMs: number = Date.now(),
): void {
  pruneExpiredRecoveryCooldowns(nowMs);
  householdRecoveryCooldownMap.set(householdKey, nowMs + cooldownMs);
}

export function resetHouseholdRecoveryCooldownsForTests(): void {
  householdRecoveryCooldownMap.clear();
}
