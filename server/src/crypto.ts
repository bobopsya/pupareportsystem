import crypto from 'node:crypto';

/** AES-256-GCM helpers for data the server must be able to read (files, ZeroTier token). */
export class ServerCrypto {
  private readonly key: Buffer;

  constructor(secretHex: string, purpose: string) {
    this.key = crypto.createHash('sha256').update(`${purpose}:${secretHex}`).digest();
  }

  /** Layout: 12-byte IV | 16-byte tag | ciphertext */
  encrypt(plain: Buffer): Buffer {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ct]);
  }

  decrypt(blob: Buffer): Buffer {
    const iv = blob.subarray(0, 12);
    const tag = blob.subarray(12, 28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]);
  }

  encryptString(s: string): string {
    return this.encrypt(Buffer.from(s, 'utf8')).toString('base64');
  }

  decryptString(s: string): string {
    return this.decrypt(Buffer.from(s, 'base64')).toString('utf8');
  }
}

export function randomId(): string {
  return crypto.randomUUID();
}

export function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

const TEMP_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Human-friendly temporary password, e.g. "kX7m-pQ2r-Tn8w". */
export function tempPassword(): string {
  const groups: string[] = [];
  for (let g = 0; g < 3; g++) {
    let s = '';
    for (let i = 0; i < 4; i++) s += TEMP_ALPHABET[crypto.randomInt(TEMP_ALPHABET.length)];
    groups.push(s);
  }
  return groups.join('-');
}
