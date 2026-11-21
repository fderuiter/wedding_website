import crypto from 'node:crypto';

const SALT_LENGTH = 16;
const KEY_LENGTH = 64;
const SCRYPT_PARAMS = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 32 * 1024 * 1024,
};

export const ADMIN_PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;

export async function hashPassword(password: string): Promise<string> {
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string');
  }

  const salt = crypto.randomBytes(SALT_LENGTH);
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LENGTH, SCRYPT_PARAMS, (err, derivedKey) => {
      if (err) {
        return reject(err);
      }
      resolve(`scrypt:${salt.toString('base64')}:${derivedKey.toString('base64')}`);
    });
  });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!hash.startsWith('scrypt:')) {
    return false;
  }

  const [, saltBase64, keyBase64] = hash.split(':');

  if (!saltBase64 || !keyBase64) return false;

  const salt = Buffer.from(saltBase64, 'base64');
  const expectedKey = Buffer.from(keyBase64, 'base64');

  return new Promise((resolve) => {
    crypto.scrypt(password, salt, KEY_LENGTH, SCRYPT_PARAMS, (err, derivedKey) => {
      if (err) return resolve(false);

      try {
        const match = crypto.timingSafeEqual(expectedKey, derivedKey);
        resolve(match);
      } catch {
        resolve(false);
      }
    });
  });
}

export interface AdminPasswordResetKeyMaterial {
  envAdminPassword: string;
  activePasswordHash: string;
  adminSessionVersion: number;
}

export type AdminPasswordResetVerificationResult =
  | { valid: true }
  | {
    valid: false;
    reason: 'expired' | 'invalid_or_used';
    error: string;
  };

function deriveAdminResetSecret({
  envAdminPassword,
  activePasswordHash,
  adminSessionVersion,
}: AdminPasswordResetKeyMaterial): string {
  if (!envAdminPassword) {
    throw new Error('ADMIN_PASSWORD secret is required to derive password reset key');
  }
  return crypto
    .createHmac('sha256', envAdminPassword)
    .update(`admin-password-reset:v1:${activePasswordHash}:${adminSessionVersion}`)
    .digest('hex');
}

export function signAdminPasswordResetToken(
  keyMaterial: AdminPasswordResetKeyMaterial,
  options?: { iat?: number; ttlMs?: number }
): string {
  const secret = deriveAdminResetSecret(keyMaterial);
  const iat = options?.iat ?? Date.now();
  const ttlMs = options?.ttlMs ?? ADMIN_PASSWORD_RESET_TTL_MS;
  const payload = {
    purpose: 'admin-password-reset',
    v: keyMaterial.adminSessionVersion,
    iat,
    exp: iat + ttlMs,
    jti: crypto.randomBytes(12).toString('base64url'),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${signature}`;
}

export function verifyAdminPasswordResetToken(
  token: string,
  keyMaterial: AdminPasswordResetKeyMaterial,
  now: number = Date.now()
): AdminPasswordResetVerificationResult {
  const invalidResult: AdminPasswordResetVerificationResult = {
    valid: false,
    reason: 'invalid_or_used',
    error: 'This password reset link is invalid or has already been used. Please request a new reset link.',
  };

  if (!token || typeof token !== 'string') {
    return invalidResult;
  }

  const parts = token.trim().split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return invalidResult;
  }

  const [encodedPayload, providedSignature] = parts;
  let secret: string;
  try {
    secret = deriveAdminResetSecret(keyMaterial);
  } catch {
    return invalidResult;
  }

  const expectedSignature = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  const providedBuf = Buffer.from(providedSignature, 'utf8');
  const expectedBuf = Buffer.from(expectedSignature, 'utf8');

  if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    return invalidResult;
  }

  try {
    const decoded = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as {
      purpose?: unknown;
      v?: unknown;
      exp?: unknown;
    };

    if (
      !decoded ||
      decoded.purpose !== 'admin-password-reset' ||
      decoded.v !== keyMaterial.adminSessionVersion ||
      typeof decoded.exp !== 'number'
    ) {
      return invalidResult;
    }

    if (decoded.exp < now) {
      return {
        valid: false,
        reason: 'expired',
        error: 'This password reset link has expired. Please request a new reset link.',
      };
    }

    return { valid: true };
  } catch {
    return invalidResult;
  }
}
