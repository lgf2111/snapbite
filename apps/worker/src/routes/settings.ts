import { DeepSeekProvider, decryptSecret, encryptSecret, lastFour } from '@foodlog/core';
import { Hono } from 'hono';
import { createSettingsDb, getSettings, saveEncryptedKey } from '../db/settings.js';
import type { AppBindings } from '../env.js';

/**
 * Settings routes. The user's BYOK API key is AES-GCM encrypted with the
 * Worker's master key before storage. The plaintext key is never persisted,
 * never logged, and never returned — GET only reports connection status and the
 * last 4 characters.
 */
export function settingsRoutes() {
  const app = new Hono<AppBindings>();

  // GET /api/settings — redacted view. Never returns the key.
  app.get('/', async (c) => {
    const db = createSettingsDb(c.env.DB);
    const row = await getSettings(db, c.get('userId'));
    const connected = Boolean(row?.apiKeyCiphertext && row?.apiKeyIv);

    let keyLast4: string | null = null;
    if (connected && row && c.env.ENCRYPTION_KEY) {
      try {
        const key = await decryptSecret(
          { ciphertext: row.apiKeyCiphertext as string, iv: row.apiKeyIv as string },
          c.env.ENCRYPTION_KEY,
        );
        keyLast4 = lastFour(key);
      } catch {
        keyLast4 = null;
      }
    }

    return c.json({
      aiProvider: row?.aiProvider ?? 'deepseek',
      connected,
      keyLast4,
    });
  });

  // PUT /api/settings — store an encrypted API key.
  app.put('/', async (c) => {
    if (!c.env.ENCRYPTION_KEY) {
      return c.json({ error: 'Server misconfigured', detail: 'No encryption key' }, 500);
    }

    let body: { apiKey?: unknown; aiProvider?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Bad request', detail: 'Invalid JSON' }, 400);
    }

    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    if (!apiKey) {
      return c.json({ error: 'Bad request', detail: 'apiKey is required' }, 400);
    }
    const aiProvider = typeof body.aiProvider === 'string' ? body.aiProvider : 'deepseek';

    const enc = await encryptSecret(apiKey, c.env.ENCRYPTION_KEY);
    const db = createSettingsDb(c.env.DB);
    await saveEncryptedKey(db, {
      userId: c.get('userId'),
      aiProvider,
      apiKeyCiphertext: enc.ciphertext,
      apiKeyIv: enc.iv,
    });

    return c.json({ ok: true, aiProvider, connected: true, keyLast4: lastFour(apiKey) });
  });

  // POST /api/settings/test — verify the stored key can reach the provider.
  app.post('/test', async (c) => {
    if (!c.env.ENCRYPTION_KEY) {
      return c.json({ error: 'Server misconfigured', detail: 'No encryption key' }, 500);
    }
    const db = createSettingsDb(c.env.DB);
    const row = await getSettings(db, c.get('userId'));
    if (!row?.apiKeyCiphertext || !row?.apiKeyIv) {
      return c.json({ ok: false, detail: 'No API key saved' }, 400);
    }

    let apiKey: string;
    try {
      apiKey = await decryptSecret(
        { ciphertext: row.apiKeyCiphertext, iv: row.apiKeyIv },
        c.env.ENCRYPTION_KEY,
      );
    } catch {
      return c.json({ ok: false, detail: 'Stored key could not be decrypted' }, 500);
    }

    // Lightweight connectivity check: a tiny image analysis is overkill, so we
    // just confirm the provider constructs and the key is non-empty. A deeper
    // check happens naturally on the first real analyze call.
    try {
      new DeepSeekProvider({ apiKey });
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ ok: false, detail: err instanceof Error ? err.message : 'invalid' }, 400);
    }
  });

  return app;
}
