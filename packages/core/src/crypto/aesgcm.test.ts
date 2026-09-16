import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, lastFour } from './aesgcm.js';

// A 32-byte key, base64-encoded.
const KEY = btoa('0123456789abcdef0123456789abcdef');
const OTHER_KEY = btoa('ffffffffffffffffffffffffffffffff');

describe('AES-GCM secret encryption', () => {
  it('round-trips a secret', async () => {
    const secret = 'sk-deepseek-abcdef123456';
    const enc = await encryptSecret(secret, KEY);
    expect(enc.ciphertext).not.toContain(secret);
    const dec = await decryptSecret(enc, KEY);
    expect(dec).toBe(secret);
  });

  it('uses a fresh IV each time (different ciphertext for same input)', async () => {
    const a = await encryptSecret('same-secret', KEY);
    const b = await encryptSecret('same-secret', KEY);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('fails to decrypt with the wrong key', async () => {
    const enc = await encryptSecret('sk-secret', KEY);
    await expect(decryptSecret(enc, OTHER_KEY)).rejects.toBeTruthy();
  });

  it('fails to decrypt tampered ciphertext (GCM auth tag)', async () => {
    const enc = await encryptSecret('sk-secret', KEY);
    const bytes = atob(enc.ciphertext).split('');
    bytes[0] = String.fromCharCode(bytes[0]!.charCodeAt(0) ^ 0xff);
    const tampered = { ...enc, ciphertext: btoa(bytes.join('')) };
    await expect(decryptSecret(tampered, KEY)).rejects.toBeTruthy();
  });

  it('rejects a master key of the wrong length', async () => {
    await expect(encryptSecret('x', btoa('too-short'))).rejects.toThrow(/16, 24, or 32/);
  });
});

describe('lastFour', () => {
  it('returns the last 4 characters', () => {
    expect(lastFour('sk-deepseek-ab12')).toBe('ab12');
  });

  it('returns the whole string when 4 or fewer characters', () => {
    expect(lastFour('abc')).toBe('abc');
  });
});
