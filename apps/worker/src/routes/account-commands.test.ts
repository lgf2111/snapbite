import { env } from 'cloudflare:test';
import {
  type BotReply,
  DELETE_CANCEL_DATA,
  DELETE_CONFIRM_DATA,
  MockAIProvider,
  signInitData,
} from '@snapbite/core';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { INIT_DATA_HEADER } from '../middleware/auth.js';

const SECRET_HEADER = 'x-telegram-bot-api-secret-token';
const SECRET = 'test-webhook-secret';
const BOT_TOKEN = '123456:LOCAL-DEV-BOT-TOKEN';

interface SentDoc {
  chatId: number;
  doc: { filename: string; content: string; mimeType: string; caption?: string };
}

/** A BotClient mock that also captures sendDocument calls and callback answers. */
function mockBot(
  sent: Array<{ chatId: number; reply: BotReply }>,
  docs: SentDoc[],
  answers: Array<{ callbackId: string; text?: string }>,
) {
  let nextId = 2000;
  return {
    async sendMessage(chatId: number, reply: BotReply) {
      sent.push({ chatId, reply });
      return { messageId: nextId++ };
    },
    async getFilePath() {
      return 'photos/file_1.jpg';
    },
    async downloadFile() {
      return { base64: 'QUJD', mimeType: 'image/jpeg' };
    },
    async editMessageText(chatId: number, _messageId: number, reply: BotReply) {
      sent.push({ chatId, reply });
      return true;
    },
    async deleteMessage() {
      return true;
    },
    async answerCallbackQuery(callbackId: string, text?: string) {
      answers.push({ callbackId, text });
      return true;
    },
    async sendDocument(chatId: number, doc: SentDoc['doc']) {
      docs.push({ chatId, doc });
      return true;
    },
  };
}

function capture() {
  const sent: Array<{ chatId: number; reply: BotReply }> = [];
  const docs: SentDoc[] = [];
  const answers: Array<{ callbackId: string; text?: string }> = [];
  const app = createApp({
    botClientFactory: () => mockBot(sent, docs, answers),
    providerFactory: () => new MockAIProvider(),
  });
  return { app, sent, docs, answers };
}

function post(body: unknown) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', [SECRET_HEADER]: SECRET },
    body: JSON.stringify(body),
  };
}

function lastText(sent: Array<{ chatId: number; reply: BotReply }>): string {
  return sent[sent.length - 1]?.reply.text ?? '';
}

async function authHeaders(tgId: number): Promise<Record<string, string>> {
  const user = JSON.stringify({ id: tgId, first_name: 'Ada' });
  const authDate = String(Math.floor(Date.now() / 1000));
  return {
    [INIT_DATA_HEADER]: await signInitData({ user, auth_date: authDate }, BOT_TOKEN),
    'content-type': 'application/json',
  };
}

const meal = {
  foods: [
    {
      food: { name: 'rice', estimatedWeightG: 200, quantity: 1, confidence: 0.9 },
      nutrition: { energyKcal: 260, proteinG: 5.4, carbsG: 56, fatG: 0.6, source: 'table' },
    },
  ],
  total: { energyKcal: 260, proteinG: 5.4, carbsG: 56, fatG: 0.6, source: 'table' },
  confidence: 0.9,
  needsConfirmation: false,
  notes: 'lunch',
};

/** Seeds a key + one logged meal for the given Telegram id via the authed API. */
async function seedKeyAndMeal(tgId: number): Promise<void> {
  const h = await authHeaders(tgId);
  await createApp().request(
    '/api/settings',
    { method: 'PUT', headers: h, body: JSON.stringify({ apiKey: 'sk-secret-7777' }) },
    env,
  );
  await createApp().request(
    '/api/meals',
    { method: 'POST', headers: h, body: JSON.stringify({ meal }) },
    env,
  );
}

/** Counts rows across every table a user touches, scoped by their app user id. */
async function countUserRows(tgId: number): Promise<{
  users: number;
  settings: number;
  meals: number;
  foodItems: number;
  nutrition: number;
  savedMeals: number;
  pending: number;
}> {
  const idRow = await env.DB.prepare('SELECT id FROM users WHERE telegram_user_id = ?')
    .bind(tgId)
    .first<{ id: string }>();
  const id = idRow?.id ?? '__none__';
  const one = async (sql: string): Promise<number> => {
    const r = await env.DB.prepare(sql).bind(id).first<{ n: number }>();
    return r?.n ?? 0;
  };
  return {
    users: await one('SELECT COUNT(*) n FROM users WHERE id = ?'),
    settings: await one('SELECT COUNT(*) n FROM settings WHERE user_id = ?'),
    meals: await one('SELECT COUNT(*) n FROM meals WHERE user_id = ?'),
    foodItems: await one(
      'SELECT COUNT(*) n FROM food_items WHERE meal_id IN (SELECT id FROM meals WHERE user_id = ?)',
    ),
    nutrition: await one(
      'SELECT COUNT(*) n FROM nutrition WHERE meal_id IN (SELECT id FROM meals WHERE user_id = ?)',
    ),
    savedMeals: await one('SELECT COUNT(*) n FROM saved_meals WHERE user_id = ?'),
    pending: await one('SELECT COUNT(*) n FROM pending_photo_retries WHERE user_id = ?'),
  };
}

describe('/export command', () => {
  it('sends a document with only the caller\u2019s meals and no key material', async () => {
    const tgId = 10001;
    const other = 10002;
    await seedKeyAndMeal(tgId);
    await seedKeyAndMeal(other); // a different user's data must not leak in

    const { app, docs } = capture();
    const res = await app.request(
      '/webhook',
      post({ message: { text: '/export', chat: { id: tgId }, from: { id: tgId } } }),
      env,
    );
    expect(res.status).toBe(200);
    expect(docs).toHaveLength(1);
    const doc = docs[0];
    expect(doc?.chatId).toBe(tgId);
    expect(doc?.doc.filename).toMatch(/^snapbite-export-\d{4}-\d{2}-\d{2}\.json$/);

    const parsed = JSON.parse(doc?.doc.content ?? '{}') as {
      user: { telegramUserId: number };
      meals: Array<{ foods: Array<{ name: string }> }>;
    };
    expect(parsed.user.telegramUserId).toBe(tgId);
    expect(parsed.meals).toHaveLength(1);
    expect(parsed.meals[0]?.foods[0]?.name).toBe('rice');

    // No key material in the payload.
    const raw = doc?.doc.content ?? '';
    expect(raw).not.toContain('sk-secret-7777');
    expect(raw.toLowerCase()).not.toContain('ciphertext');
  });

  it('tells a user with no data there is nothing to export', async () => {
    const tgId = 10003;
    const { app, sent, docs } = capture();
    await app.request(
      '/webhook',
      post({ message: { text: '/export', chat: { id: tgId }, from: { id: tgId } } }),
      env,
    );
    expect(docs).toHaveLength(0);
    expect(lastText(sent).toLowerCase()).toContain("don't have any data");
  });
});

describe('/delete command (two-step)', () => {
  it('/delete alone shows a confirm keyboard and deletes nothing', async () => {
    const tgId = 10101;
    await seedKeyAndMeal(tgId);

    const { app, sent } = capture();
    await app.request(
      '/webhook',
      post({ message: { text: '/delete', chat: { id: tgId }, from: { id: tgId } } }),
      env,
    );
    const reply = sent[sent.length - 1]?.reply;
    expect(reply?.text.toLowerCase()).toContain('permanently');
    const buttons = reply?.replyMarkup?.inline_keyboard.flat() ?? [];
    expect(buttons.some((b) => b.callback_data === DELETE_CONFIRM_DATA)).toBe(true);
    expect(buttons.some((b) => b.callback_data === DELETE_CANCEL_DATA)).toBe(true);

    // Nothing deleted yet.
    const rows = await countUserRows(tgId);
    expect(rows.users).toBe(1);
    expect(rows.meals).toBe(1);
  });

  it('the confirm callback deletes the caller\u2019s rows from every table', async () => {
    const tgId = 10102;
    await seedKeyAndMeal(tgId);
    // Enqueue a pending photo retry so we prove that (non-cascading) table is cleared too.
    const { enqueuePhotoRetry } = await import('../photoRetry.js');
    const { createDb, upsertUser } = await import('../db/users.js');
    const user = await upsertUser(createDb(env.DB), { id: tgId });
    await enqueuePhotoRetry(env.DB, {
      userId: user.id,
      telegramUserId: tgId,
      chatId: tgId,
      statusMessageId: 1,
      fileId: 'f1',
      caption: '',
    });
    // Save a favorite so saved_meals has a row.
    await createApp().request(
      '/api/favorites',
      {
        method: 'POST',
        headers: await authHeaders(tgId),
        body: JSON.stringify({ meal, label: 'Lunch' }),
      },
      env,
    );

    const before = await countUserRows(tgId);
    expect(before).toMatchObject({ users: 1, settings: 1, meals: 1, savedMeals: 1, pending: 1 });
    expect(before.foodItems).toBeGreaterThanOrEqual(1);
    expect(before.nutrition).toBeGreaterThanOrEqual(1);

    const { app, answers } = capture();
    // Step 1: /delete arms the confirmation.
    await app.request(
      '/webhook',
      post({ message: { text: '/delete', chat: { id: tgId }, from: { id: tgId } } }),
      env,
    );
    // Step 2: confirm callback deletes.
    await app.request(
      '/webhook',
      post({
        callback_query: {
          id: 'cb1',
          data: DELETE_CONFIRM_DATA,
          from: { id: tgId },
          message: { message_id: 500, chat: { id: tgId } },
        },
      }),
      env,
    );
    expect(answers.some((a) => a.text?.toLowerCase().includes('delet'))).toBe(true);

    // No orphan rows anywhere the user touched.
    const after = await countUserRows(tgId);
    expect(after).toEqual({
      users: 0,
      settings: 0,
      meals: 0,
      foodItems: 0,
      nutrition: 0,
      savedMeals: 0,
      pending: 0,
    });
  });

  it('Cancel clears the pending state and changes nothing', async () => {
    const tgId = 10103;
    await seedKeyAndMeal(tgId);
    const { app, answers } = capture();
    await app.request(
      '/webhook',
      post({ message: { text: '/delete', chat: { id: tgId }, from: { id: tgId } } }),
      env,
    );
    await app.request(
      '/webhook',
      post({
        callback_query: {
          id: 'cb2',
          data: DELETE_CANCEL_DATA,
          from: { id: tgId },
          message: { message_id: 501, chat: { id: tgId } },
        },
      }),
      env,
    );
    expect(answers.some((a) => a.text?.toLowerCase().includes('cancel'))).toBe(true);
    const rows = await countUserRows(tgId);
    expect(rows.users).toBe(1);
    expect(rows.meals).toBe(1);

    // A later confirm (pending already cleared) must NOT delete.
    await app.request(
      '/webhook',
      post({
        callback_query: {
          id: 'cb3',
          data: DELETE_CONFIRM_DATA,
          from: { id: tgId },
          message: { message_id: 502, chat: { id: tgId } },
        },
      }),
      env,
    );
    const rows2 = await countUserRows(tgId);
    expect(rows2.users).toBe(1);
    expect(rows2.meals).toBe(1);
  });

  it('a second/stale confirm callback deletes nothing and does not throw', async () => {
    const tgId = 10104;
    await seedKeyAndMeal(tgId);
    const { app } = capture();
    await app.request(
      '/webhook',
      post({ message: { text: '/delete', chat: { id: tgId }, from: { id: tgId } } }),
      env,
    );
    const confirm = () =>
      app.request(
        '/webhook',
        post({
          callback_query: {
            id: 'cbx',
            data: DELETE_CONFIRM_DATA,
            from: { id: tgId },
            message: { message_id: 600, chat: { id: tgId } },
          },
        }),
        env,
      );
    // First confirm deletes.
    const res1 = await confirm();
    expect(res1.status).toBe(200);
    expect((await countUserRows(tgId)).users).toBe(0);

    // Second (stale) confirm: the user row is re-created empty by upsert, but no
    // pending flag → no deletion of anything, and it must not throw.
    const res2 = await confirm();
    expect(res2.status).toBe(200);
    const rows = await countUserRows(tgId);
    expect(rows.meals).toBe(0); // no resurrected meals
  });

  it('a confirm from a user who never ran /delete deletes nothing', async () => {
    const tgId = 10105;
    await seedKeyAndMeal(tgId);
    const { app } = capture();
    // No /delete first — a stale/foreign confirm callback.
    await app.request(
      '/webhook',
      post({
        callback_query: {
          id: 'cbf',
          data: DELETE_CONFIRM_DATA,
          from: { id: tgId },
          message: { message_id: 700, chat: { id: tgId } },
        },
      }),
      env,
    );
    const rows = await countUserRows(tgId);
    expect(rows.users).toBe(1);
    expect(rows.meals).toBe(1);
  });

  it('after /delete, a fresh /start creates a new empty account (no resurrected meals)', async () => {
    const tgId = 10106;
    await seedKeyAndMeal(tgId);
    const { app } = capture();
    await app.request(
      '/webhook',
      post({ message: { text: '/delete', chat: { id: tgId }, from: { id: tgId } } }),
      env,
    );
    await app.request(
      '/webhook',
      post({
        callback_query: {
          id: 'cbs',
          data: DELETE_CONFIRM_DATA,
          from: { id: tgId },
          message: { message_id: 800, chat: { id: tgId } },
        },
      }),
      env,
    );
    expect((await countUserRows(tgId)).users).toBe(0);

    // Fresh /start recreates the user, with no meals.
    await app.request(
      '/webhook',
      post({ message: { text: '/start', chat: { id: tgId }, from: { id: tgId } } }),
      env,
    );
    const rows = await countUserRows(tgId);
    expect(rows.users).toBe(1);
    expect(rows.meals).toBe(0);
    expect(rows.savedMeals).toBe(0);
  });
});
