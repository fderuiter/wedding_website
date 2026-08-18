import crypto from 'crypto';

export interface EncryptedBackupPayload {
  encrypted: true;
  algorithm: 'AES-GCM';
  iv: string;
  tag: string;
  data: string;
}

function getBackupEncryptionKey(): Buffer {
  const secret =
    process.env.BACKUP_ENCRYPTION_KEY ||
    process.env.ADMIN_PASSWORD ||
    'wedding-website-backup-secret-key-32-bytes!';
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptBackupData(dataObj: any): EncryptedBackupPayload {
  const key = getBackupEncryptionKey();
  const iv = crypto.randomBytes(12); // 96-bit IV for AES-GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const jsonStr = JSON.stringify(dataObj);
  const encrypted = Buffer.concat([cipher.update(jsonStr, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    encrypted: true,
    algorithm: 'AES-GCM',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64'),
  };
}

export function decryptBackupData(payload: any): any {
  if (!payload || typeof payload !== 'object' || !payload.encrypted) {
    return payload; // Return raw JSON if not encrypted
  }
  const key = getBackupEncryptionKey();
  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.data, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString('utf8'));
}
