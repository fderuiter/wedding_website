import {
  base64urlDecodeToBytes,
  hmacSha256,
  timingSafeEqualJS,
} from '@/utils/crypto';

export const GUEST_PASSCODE_DIGEST_DOMAIN =
  'wedding-website:guest-passcode-digest:v1';

/**
 * Type guard verifying a positive integer token epoch version (`>= 1`).
 */
export function isValidTokenEpochVersion(version: unknown): version is number {
  return (
    typeof version === 'number' && Number.isInteger(version) && version >= 1
  );
}

/**
 * Normalizes an optional token epoch version to a positive integer (`>= 1`), defaulting to `1`.
 */
export function normalizeTokenEpochVersion(version: unknown): number {
  return isValidTokenEpochVersion(version) ? version : 1;
}

/**
 * Computes an Edge-compatible, domain-separated HMAC-SHA256 digest of the active guest passcode.
 */
export async function computeGuestPasscodeDigest(
  secret: string,
  passcode: string
): Promise<string> {
  return hmacSha256(`${GUEST_PASSCODE_DIGEST_DOMAIN}:${secret}`, passcode);
}

/**
 * Constant-time verification of a `guest_auth` passcode digest claim (`pwd`).
 */
export async function verifyGuestPasscodeDigest(
  actualDigest: unknown,
  secret: string,
  passcode: string
): Promise<boolean> {
  if (typeof actualDigest !== 'string' || actualDigest.length === 0) {
    return false;
  }

  try {
    const expectedDigest = await computeGuestPasscodeDigest(secret, passcode);
    const actualBytes = base64urlDecodeToBytes(actualDigest);
    const expectedBytes = base64urlDecodeToBytes(expectedDigest);
    if (actualBytes.length === 0 || expectedBytes.length === 0) {
      return false;
    }
    return timingSafeEqualJS(actualBytes, expectedBytes);
  } catch {
    return false;
  }
}
