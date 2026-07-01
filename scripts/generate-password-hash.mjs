import crypto from 'node:crypto';

const password = process.argv[2];

if (!password) {
  console.error('Please provide a password as an argument.');
  process.exit(1);
}

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const SCRYPT_PARAMS = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 32 * 1024 * 1024,
};

crypto.randomBytes(SALT_LENGTH, (err, salt) => {
  if (err) {
    console.error('Error generating salt:', err);
    process.exit(1);
  }
  
  crypto.scrypt(password, salt, KEY_LENGTH, SCRYPT_PARAMS, (err, derivedKey) => {
    if (err) {
      console.error('Error hashing password:', err);
      process.exit(1);
    }
    const hash = `scrypt:${salt.toString('base64')}:${derivedKey.toString('base64')}`;
    console.log(hash);
  });
});
