import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  InsufficientCredits,
  addCredits,
  ensureAccount,
  getAccount,
  getEntitlement,
  grantTrial,
  markSupporter,
} from './accounts.js';

const db = () => env.DB;
const email = () => `${crypto.randomUUID()}@example.com`;

async function createUser(address: string): Promise<string> {
  const id = crypto.randomUUID();
  await db()
    .prepare('INSERT INTO users (id, email, email_verified_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, address, Date.now(), Date.now())
    .run();
  return id;
}

async function ledger(emailAddress: string) {
  const { results } = await db()
    .prepare('SELECT delta, reason FROM credit_ledger WHERE email = ? ORDER BY created_at, rowid')
    .bind(emailAddress)
    .all<{ delta: number; reason: string }>();
  return results;
}

describe('billing accounts', () => {
  it('adds and spends credits atomically, and refuses to go negative', async () => {
    const address = email();
    expect(await addCredits(db(), address, 10, 'topup')).toBe(10);
    expect(await addCredits(db(), address, -3, 'analysis')).toBe(7);

    const entries = await ledger(address);
    expect(entries.map((e) => e.delta)).toEqual([10, -3]);

    await expect(addCredits(db(), address, -100, 'analysis')).rejects.toBeInstanceOf(
      InsufficientCredits,
    );
    expect((await getAccount(db(), address))?.credits).toBe(7);
    // The refusal must not leave a ledger row behind.
    expect(await ledger(address)).toHaveLength(2);
  });

  it('resolves supporter from a running trial and from a purchase', async () => {
    const trialled = email();
    const trialledUser = await createUser(trialled);
    const trial = await grantTrial(db(), trialled);
    expect(trial.granted).toBe(true);
    expect(await getEntitlement(db(), trialledUser)).toMatchObject({
      supporter: true,
      credits: 20,
      source: 'trial',
    });

    const buyer = email();
    const buyerUser = await createUser(buyer);
    await ensureAccount(db(), buyer);
    await markSupporter(db(), buyer, Date.now() - 1000);
    expect(await getEntitlement(db(), buyerUser)).toMatchObject({
      supporter: true,
      credits: 0,
      trialUntil: null,
      source: 'none',
    });
  });

  it('prefers a stored BYOK key as the AI source', async () => {
    const address = email();
    const userId = await createUser(address);
    await ensureAccount(db(), address);
    await db()
      .prepare(
        'INSERT INTO settings (user_id, ai_provider, api_key_ciphertext, api_key_iv, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(userId, 'gemini', 'cipher', 'iv', Date.now())
      .run();

    expect(await getEntitlement(db(), userId)).toMatchObject({
      supporter: false,
      source: 'byok',
    });
  });

  it('deleting the user keeps billing history and the trial marker', async () => {
    const address = email();
    const userId = await createUser(address);
    await grantTrial(db(), address);
    await addCredits(db(), address, 5, 'topup');

    await db().prepare('DELETE FROM users WHERE id = ?').bind(userId).run();

    const account = await getAccount(db(), address);
    expect(account?.credits).toBe(25);
    expect(account?.trialGrantedAt).not.toBeNull();
    expect(await ledger(address)).toHaveLength(2);

    // Re-creating an account with the same email cannot claim a second trial.
    await createUser(address);
    expect((await grantTrial(db(), address)).granted).toBe(false);
    expect((await getAccount(db(), address))?.credits).toBe(25);
  });
});
