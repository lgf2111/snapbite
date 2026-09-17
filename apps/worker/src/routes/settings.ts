import {
  computeTargets,
  createProvider,
  type DailyTargets,
  decryptSecret,
  DEFAULT_PROVIDER_ID,
  encryptSecret,
  isProviderId,
  lastFour,
  UserProfile,
} from '@foodlog/core';
import { Hono } from 'hono';
import { createSettingsDb, getSettings, saveEncryptedKey, savePreferences } from '../db/settings.js';
import type { AppBindings } from '../env.js';

/** Parses the stored preferences JSON into a validated profile (or null). */
function parseProfile(preferencesJson: string | null): UserProfile | null {
  if (!preferencesJson) return null;
  try {
    const parsed: unknown = JSON.parse(preferencesJson);
    const profileField = (parsed as { profile?: unknown })?.profile ?? parsed;
    const result = UserProfile.safeParse(profileField);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Settings routes. The user's BYOK API key is AES-GCM encrypted with the
 * Worker's master key before storage. The plaintext key is never persisted,
 * never logged, and never returned — GET only reports connection status and the
 * last 4 characters, plus the chosen provider + model.
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

    const profile = parseProfile(row?.preferencesJson ?? null);
    const targets: DailyTargets | null = profile ? computeTargets(profile) : null;

    return c.json({
      aiProvider: row?.aiProvider ?? DEFAULT_PROVIDER_ID,
      aiModel: row?.aiModel ?? null,
      connected,
      keyLast4,
      profile,
      targets,
    });
  });

  // PUT /api/settings/profile — store the user's profile + goal (no key needed).
  app.put('/profile', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Bad request', detail: 'Invalid JSON' }, 400);
    }
    const profileField = (body as { profile?: unknown })?.profile ?? body;
    const parsed = UserProfile.safeParse(profileField);
    if (!parsed.success) {
      return c.json(
        { error: 'Bad request', detail: 'Invalid profile', issues: parsed.error.issues },
        400,
      );
    }

    const db = createSettingsDb(c.env.DB);
    await savePreferences(
      db,
      c.get('userId'),
      JSON.stringify({ profile: parsed.data, updatedAt: Date.now() }),
    );
    return c.json({ ok: true, profile: parsed.data, targets: computeTargets(parsed.data) });
  });

  // PUT /api/settings — store an encrypted API key + provider/model.
  app.put('/', async (c) => {
    if (!c.env.ENCRYPTION_KEY) {
      return c.json({ error: 'Server misconfigured', detail: 'No encryption key' }, 500);
    }

    let body: { apiKey?: unknown; aiProvider?: unknown; aiModel?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Bad request', detail: 'Invalid JSON' }, 400);
    }

    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    if (!apiKey) {
      return c.json({ error: 'Bad request', detail: 'apiKey is required' }, 400);
    }
    const aiProvider =
      typeof body.aiProvider === 'string' && isProviderId(body.aiProvider)
        ? body.aiProvider
        : DEFAULT_PROVIDER_ID;
    const aiModel =
      typeof body.aiModel === 'string' && body.aiModel.trim() ? body.aiModel.trim() : null;

    const enc = await encryptSecret(apiKey, c.env.ENCRYPTION_KEY);
    const db = createSettingsDb(c.env.DB);
    await saveEncryptedKey(db, {
      userId: c.get('userId'),
      aiProvider,
      aiModel,
      apiKeyCiphertext: enc.ciphertext,
      apiKeyIv: enc.iv,
    });

    return c.json({ ok: true, aiProvider, aiModel, connected: true, keyLast4: lastFour(apiKey) });
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

    // Lightweight check: confirm the provider constructs with the stored key +
    // provider id. A deeper check happens on the first real analyze call.
    try {
      createProvider({ providerId: row.aiProvider, apiKey, ...(row.aiModel ? { model: row.aiModel } : {}) });
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ ok: false, detail: err instanceof Error ? err.message : 'invalid' }, 400);
    }
  });

  return app;
}
