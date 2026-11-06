import { scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { compare, hash } from 'bcryptjs';

const scrypt = promisify(scryptCallback);

export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length < 12 || password.length > 200) {
    throw Object.assign(new Error('Password must be between 12 and 200 characters.'), { status: 400 });
  }
  return hash(password, 12);
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  if (encoded.startsWith('$2')) return compare(password, encoded);
  const [saltHex, hashHex] = encoded.split(':');
  if (!saltHex || !hashHex || typeof password !== 'string') return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  if (salt.length !== 16 || expected.length !== 64) return false;
  const actual = await scrypt(password, salt, expected.length) as Buffer;
  return timingSafeEqual(actual, expected);
}
