import crypto from 'node:crypto';

const KEY_LENGTH = 64;
const SCRYPT_PARAMS = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 32 * 1024 * 1024,
};

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
      } catch (e) {
        resolve(false);
      }
    });
  });
}
