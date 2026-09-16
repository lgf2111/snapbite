import { describe, expect, it } from 'vitest';
import { signInitData, verifyInitData } from './initData.js';

const BOT_TOKEN = '123456:TEST-BOT-TOKEN';
const NOW = 1_700_000_000_000; // fixed clock (ms)
const authDate = String(Math.floor(NOW / 1000));

const user = JSON.stringify({ id: 42, first_name: 'Ada', username: 'ada' });

async function validInitData(overrides: Record<string, string> = {}): Promise<string> {
  return signInitData({ user, auth_date: authDate, query_id: 'AAA', ...overrides }, BOT_TOKEN);
}

describe('verifyInitData', () => {
  it('accepts a correctly signed payload', async () => {
    const initData = await validInitData();
    const result = await verifyInitData(initData, BOT_TOKEN, { now: () => NOW });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.user.id).toBe(42);
      expect(result.data.user.username).toBe('ada');
    }
  });

  it('rejects a tampered payload (bad hash)', async () => {
    const initData = await validInitData();
    // Flip the user id after signing.
    const tampered = initData.replace('%22id%22%3A42', '%22id%22%3A99');
    const result = await verifyInitData(tampered, BOT_TOKEN, { now: () => NOW });
    expect(result).toEqual({ ok: false, reason: 'bad_hash' });
  });

  it('rejects a payload signed with a different token', async () => {
    const initData = await signInitData({ user, auth_date: authDate }, 'other-token');
    const result = await verifyInitData(initData, BOT_TOKEN, { now: () => NOW });
    expect(result).toEqual({ ok: false, reason: 'bad_hash' });
  });

  it('rejects when the hash is missing', async () => {
    const result = await verifyInitData(`user=${encodeURIComponent(user)}`, BOT_TOKEN, {
      now: () => NOW,
    });
    expect(result).toEqual({ ok: false, reason: 'missing_hash' });
  });

  it('rejects expired auth_date', async () => {
    const initData = await validInitData();
    // 25 hours later, default max age is 24h.
    const later = NOW + 25 * 60 * 60 * 1000;
    const result = await verifyInitData(initData, BOT_TOKEN, { now: () => later });
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects when the user field is absent', async () => {
    const initData = await signInitData({ auth_date: authDate }, BOT_TOKEN);
    const result = await verifyInitData(initData, BOT_TOKEN, { now: () => NOW });
    expect(result).toEqual({ ok: false, reason: 'missing_user' });
  });

  it('round-trips through signInitData for arbitrary fields', async () => {
    const initData = await signInitData(
      { user, auth_date: authDate, start_param: 'ref_123' },
      BOT_TOKEN,
    );
    const result = await verifyInitData(initData, BOT_TOKEN, { now: () => NOW });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.raw.start_param).toBe('ref_123');
  });
});
