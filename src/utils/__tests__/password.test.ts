import crypto from 'node:crypto';
import { MAX_PASSWORD_LENGTH, verifyPassword } from '../password';

const VALID_SCRYPT_SECRET_HASH =
  'scrypt:8R6mvU36W2Cqp3C8vq+r1g==:XlhFCFplIJUauzo9FzPUPVgA5458RRwbTpQtFCRWjoLN4AI6VCH76jOksMQdQX/5f45ALowp67Xxo58mFrcb3g==';

describe('verifyPassword', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('exports verifyPassword and MAX_PASSWORD_LENGTH = 256', () => {
    expect(typeof verifyPassword).toBe('function');
    expect(MAX_PASSWORD_LENGTH).toBe(256);
  });

  test('verifies valid passwords up to 256 characters and rejects wrong passwords', async () => {
    expect(await verifyPassword('secret', VALID_SCRYPT_SECRET_HASH)).toBe(true);
    expect(await verifyPassword('wrong', VALID_SCRYPT_SECRET_HASH)).toBe(false);
    expect(await verifyPassword('a'.repeat(256), VALID_SCRYPT_SECRET_HASH)).toBe(false);
  });

  test('rejects empty or >256-character passwords before invoking crypto.scrypt', async () => {
    const scryptSpy = jest.spyOn(crypto, 'scrypt');

    expect(await verifyPassword('', VALID_SCRYPT_SECRET_HASH)).toBe(false);
    expect(await verifyPassword('a'.repeat(257), VALID_SCRYPT_SECRET_HASH)).toBe(false);
    expect(await verifyPassword('x'.repeat(100_000), VALID_SCRYPT_SECRET_HASH)).toBe(false);

    expect(scryptSpy).not.toHaveBeenCalled();
  });
});
