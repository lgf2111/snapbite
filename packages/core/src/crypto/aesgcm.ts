/**
 * AES-256-GCM encryption for the user's BYOK API key.
 *
 * The Worker holds a master key (base64, 32 bytes) as a secret. Each API key is
 * encrypted with a fresh random 96-bit IV; we store ciphertext + IV (both
 * base64) and never persist or return the plaintext. Pure WebCrypto so it runs
 * in Workers and Node alike.
 */

export interface EncryptedSecret {
  /** Base64 ciphertext (includes the GCM auth tag). */
  ciphertext: string;
  /** Base64 96-bit initialization vector. */
  iv: string;
}

const IV_BYTES = 12;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** The key type returned by `crypto.subtle.importKey`, without needing the DOM lib. */
type SubtleKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

/** Imports a base64 master key (must decode to 16, 24, or 32 bytes) for AES-GCM. */
async function importKey(masterKeyB64: string): Promise<SubtleKey> {
  const raw = base64ToBytes(masterKeyB64);
  if (raw.length !== 16 && raw.length !== 24 && raw.length !== 32) {
    throw new Error('Encryption key must decode to 16, 24, or 32 bytes');
  }
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** Encrypts `plaintext` with the master key, returning base64 ciphertext + IV. */
export async function encryptSecret(
  plaintext: string,
  masterKeyB64: string,
): Promise<EncryptedSecret> {
  const key = await importKey(masterKeyB64);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return {
    ciphertext: bytesToBase64(new Uint8Array(cipherBuf)),
    iv: bytesToBase64(iv),
  };
}

/** Decrypts a previously encrypted secret. Throws if the key/IV/tag mismatch. */
export async function decryptSecret(
  secret: EncryptedSecret,
  masterKeyB64: string,
): Promise<string> {
  const key = await importKey(masterKeyB64);
  const iv = base64ToBytes(secret.iv);
  const cipher = base64ToBytes(secret.ciphertext);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return new TextDecoder().decode(plainBuf);
}

/**
 * Returns the last 4 characters of a secret for display ("✓ Connected …ab12").
 * Never exposes more than the tail.
 */
export function lastFour(secret: string): string {
  return secret.length <= 4 ? secret : secret.slice(-4);
}
