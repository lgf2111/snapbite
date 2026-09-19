import { type AIFoodAnalysis, type BotReply, MockAIProvider, signInitData } from '@foodlog/core';
import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { INIT_DATA_HEADER } from '../middleware/auth.js';

const SECRET_HEADER = 'x-telegram-bot-api-secret-token';
const SECRET = 'test-webhook-secret';

/** A full BotClient mock; photo helpers return canned data. */
function mockBot(sent: Array<{ chatId: number; reply: BotReply }>) {
  let nextId = 1000;
  const edits: Array<{ chatId: number; messageId: number; reply: BotReply }> = [];
  const bot = {
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
    async editMessageText(chatId: number, messageId: number, reply: BotReply) {
      edits.push({ chatId, messageId, reply });
      // Reflect the edit in `sent` so lastText()/assertions see the final text.
      sent.push({ chatId, reply });
      return true;
    },
    async deleteMessage() {
      return true;
    },
  };
  // Expose the edit log for assertions that need it.
  (bot as unknown as { edits: typeof edits }).edits = edits;
  return bot;
}

/** Captures messages the webhook would send, via an injected mock bot client. */
function appWithCapture(analysis?: AIFoodAnalysis) {
  const sent: Array<{ chatId: number; reply: BotReply }> = [];
  const app = createApp({
    botClientFactory: () => mockBot(sent),
    providerFactory: () => new MockAIProvider(analysis),
  });
  return { app, sent };
}

function post(body: unknown, secret: string | null = SECRET) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret !== null) headers[SECRET_HEADER] = secret;
  return { method: 'POST', headers, body: JSON.stringify(body) };
}

/** The final message the bot sent (photo flow sends an "Analyzing…" first). */
function lastText(sent: Array<{ chatId: number; reply: BotReply }>): string {
  return sent[sent.length - 1]?.reply.text ?? '';
}

describe('POST /webhook', () => {
  it('replies to /start with a launch button', async () => {
    const { app, sent } = appWithCapture();
    const res = await app.request(
      '/webhook',
      post({ message: { text: '/start', chat: { id: 111 } } }),
      env,
    );
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.chatId).toBe(111);
    expect(sent[0]?.reply.replyMarkup?.inline_keyboard[0]?.[0]?.web_app?.url).toBe(
      'https://app.example.com',
    );
  });

  it('rejects a wrong secret token with 403 and sends nothing', async () => {
    const { app, sent } = appWithCapture();
    const res = await app.request(
      '/webhook',
      post({ message: { text: '/start', chat: { id: 1 } } }, 'wrong-secret'),
      env,
    );
    expect(res.status).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it('acks a non-message update without sending', async () => {
    const { app, sent } = appWithCapture();
    const res = await app.request('/webhook', post({ update_id: 1 }), env);
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(0);
  });

  it('replies to a plain message with a nudge', async () => {
    const { app, sent } = appWithCapture();
    await app.request('/webhook', post({ message: { text: 'hello', chat: { id: 7 } } }), env);
    expect(sent[0]?.reply.text.toLowerCase()).toContain('open snapbite');
  });

  it('acks malformed JSON without throwing', async () => {
    const { app } = appWithCapture();
    const res = await app.request(
      '/webhook',
      { method: 'POST', headers: { 'content-type': 'application/json', [SECRET_HEADER]: SECRET }, body: 'not json' },
      env,
    );
    expect(res.status).toBe(200);
  });

  it('prompts for an API key when a photo is sent but no key is saved', async () => {
    const { app, sent } = appWithCapture();
    const res = await app.request(
      '/webhook',
      post({ message: { photo: [{ file_id: 'f1' }], chat: { id: 8100 }, from: { id: 8100 } } }),
      env,
    );
    expect(res.status).toBe(200);
    expect(sent[0]?.reply.text).toContain('Add your AI key');
  });

  it('auto-logs a photo when the user has a key', async () => {
    // Save a key for this user via the authenticated settings endpoint first.
    const tgId = 8200;
    const user = JSON.stringify({ id: tgId, first_name: 'Ada' });
    const authDate = String(Math.floor(Date.now() / 1000));
    const initData = await signInitData({ user, auth_date: authDate }, '123456:LOCAL-DEV-BOT-TOKEN');
    const keyApp = createApp();
    await keyApp.request(
      '/api/settings',
      {
        method: 'PUT',
        headers: { [INIT_DATA_HEADER]: initData, 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: 'sk-test-key' }),
      },
      env,
    );

    const { app, sent } = appWithCapture();
    const res = await app.request(
      '/webhook',
      post({
        message: { photo: [{ file_id: 'f_small' }, { file_id: 'f_large' }], chat: { id: tgId }, from: { id: tgId } },
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(lastText(sent)).toContain('Logged');

    // The meal should now be listed for that user, tagged with the provider used.
    const list = (await (
      await createApp().request('/api/meals', { headers: { [INIT_DATA_HEADER]: initData } }, env)
    ).json()) as { meals: Array<{ aiProvider: string | null }> };
    expect(list.meals.length).toBeGreaterThanOrEqual(1);
    expect(list.meals[0]?.aiProvider).toBe('gemini');
  });

  it('fails over to the fallback provider when the primary hits a quota error', async () => {
    const tgId = 8300;
    const user = JSON.stringify({ id: tgId, first_name: 'Ada' });
    const authDate = String(Math.floor(Date.now() / 1000));
    const initData = await signInitData({ user, auth_date: authDate }, '123456:LOCAL-DEV-BOT-TOKEN');
    const headers = { [INIT_DATA_HEADER]: initData, 'content-type': 'application/json' };
    const setup = createApp();
    // Primary key (gemini) + a fallback (deepseek).
    await setup.request(
      '/api/settings',
      { method: 'PUT', headers, body: JSON.stringify({ apiKey: 'primary-key', aiProvider: 'gemini' }) },
      env,
    );
    await setup.request(
      '/api/settings/fallback',
      { method: 'PUT', headers, body: JSON.stringify({ apiKey: 'fallback-key', aiProvider: 'deepseek' }) },
      env,
    );

    // Provider factory: the primary key throws a 429; the fallback key succeeds.
    const sent: Array<{ chatId: number; reply: BotReply }> = [];
    const app = createApp({
      botClientFactory: () => mockBot(sent),
      providerFactory: ({ apiKey }) => {
        if (apiKey === 'fallback-key') return new MockAIProvider();
        return {
          id: 'primary',
          analyzeMeal: async () => {
            throw Object.assign(new Error('quota exceeded'), { kind: 'http', status: 429 });
          },
          reviseMeal: async () => {
            throw new Error('n/a');
          },
        };
      },
    });

    const res = await app.request(
      '/webhook',
      post({ message: { photo: [{ file_id: 'f1' }], chat: { id: tgId }, from: { id: tgId } } }),
      env,
    );
    expect(res.status).toBe(200);
    // The fallback produced a successful log rather than an error message.
    expect(lastText(sent)).toContain('Logged');
    // And the meal is tagged with the fallback provider that actually ran it.
    const list = (await (
      await createApp().request('/api/meals', { headers: { [INIT_DATA_HEADER]: initData } }, env)
    ).json()) as { meals: Array<{ aiProvider: string | null }> };
    expect(list.meals[0]?.aiProvider).toBe('deepseek');
  });

  it('fails over to the fallback on a billing/credit (402) error', async () => {
    const tgId = 8301;
    const user = JSON.stringify({ id: tgId, first_name: 'Ada' });
    const authDate = String(Math.floor(Date.now() / 1000));
    const initData = await signInitData({ user, auth_date: authDate }, '123456:LOCAL-DEV-BOT-TOKEN');
    const headers = { [INIT_DATA_HEADER]: initData, 'content-type': 'application/json' };
    const setup = createApp();
    await setup.request(
      '/api/settings',
      { method: 'PUT', headers, body: JSON.stringify({ apiKey: 'primary-key', aiProvider: 'gemini' }) },
      env,
    );
    await setup.request(
      '/api/settings/fallback',
      { method: 'PUT', headers, body: JSON.stringify({ apiKey: 'fallback-key', aiProvider: 'openai' }) },
      env,
    );

    const sent: Array<{ chatId: number; reply: BotReply }> = [];
    const app = createApp({
      botClientFactory: () => mockBot(sent),
      providerFactory: ({ apiKey }) => {
        if (apiKey === 'fallback-key') return new MockAIProvider();
        return {
          id: 'primary',
          analyzeMeal: async () => {
            // Mirrors the real provider: HTTP 402 with a credit body in `cause`.
            throw Object.assign(new Error('primary returned HTTP 402'), {
              kind: 'http',
              status: 402,
              cause: JSON.stringify({ error: { message: 'prepayment credits are needed' } }),
            });
          },
          reviseMeal: async () => {
            throw new Error('n/a');
          },
        };
      },
    });

    const res = await app.request(
      '/webhook',
      post({ message: { photo: [{ file_id: 'f1' }], chat: { id: tgId }, from: { id: tgId } } }),
      env,
    );
    expect(res.status).toBe(200);
    expect(lastText(sent)).toContain('Logged');
  });

  it('does NOT fail over when the fallback is disabled', async () => {
    const tgId = 8302;
    const user = JSON.stringify({ id: tgId, first_name: 'Ada' });
    const authDate = String(Math.floor(Date.now() / 1000));
    const initData = await signInitData({ user, auth_date: authDate }, '123456:LOCAL-DEV-BOT-TOKEN');
    const headers = { [INIT_DATA_HEADER]: initData, 'content-type': 'application/json' };
    const setup = createApp();
    await setup.request(
      '/api/settings',
      { method: 'PUT', headers, body: JSON.stringify({ apiKey: 'primary-key', aiProvider: 'gemini' }) },
      env,
    );
    // Store a fallback, then disable it (key retained).
    await setup.request(
      '/api/settings/fallback',
      { method: 'PUT', headers, body: JSON.stringify({ apiKey: 'fallback-key', aiProvider: 'openai' }) },
      env,
    );
    await setup.request(
      '/api/settings/fallback',
      { method: 'PUT', headers, body: JSON.stringify({ enabled: false }) },
      env,
    );

    const sent: Array<{ chatId: number; reply: BotReply }> = [];
    const app = createApp({
      botClientFactory: () => mockBot(sent),
      providerFactory: ({ apiKey }) => {
        if (apiKey === 'fallback-key') return new MockAIProvider();
        return {
          id: 'primary',
          analyzeMeal: async () => {
            throw Object.assign(new Error('quota exceeded'), { kind: 'http', status: 429 });
          },
          reviseMeal: async () => {
            throw new Error('n/a');
          },
        };
      },
    });

    const res = await app.request(
      '/webhook',
      post({ message: { photo: [{ file_id: 'f1' }], chat: { id: tgId }, from: { id: tgId } } }),
      env,
    );
    expect(res.status).toBe(200);
    // Fallback was off → the primary error is surfaced, not a successful log.
    expect(lastText(sent)).not.toContain('Logged');
    expect(lastText(sent).toLowerCase()).toContain('rate limit');
  });

  it('retries a transient 503 on the primary, then succeeds', async () => {
    const tgId = 8303;
    const user = JSON.stringify({ id: tgId, first_name: 'Ada' });
    const authDate = String(Math.floor(Date.now() / 1000));
    const initData = await signInitData({ user, auth_date: authDate }, '123456:LOCAL-DEV-BOT-TOKEN');
    const headers = { [INIT_DATA_HEADER]: initData, 'content-type': 'application/json' };
    await createApp().request(
      '/api/settings',
      { method: 'PUT', headers, body: JSON.stringify({ apiKey: 'primary-key', aiProvider: 'gemini' }) },
      env,
    );

    // Primary throws 503 on the first call, then succeeds on the retry.
    let calls = 0;
    const sent: Array<{ chatId: number; reply: BotReply }> = [];
    const app = createApp({
      botClientFactory: () => mockBot(sent),
      providerFactory: () => {
        const mock = new MockAIProvider();
        return {
          id: 'primary',
          analyzeMeal: async (img: Parameters<MockAIProvider['analyzeMeal']>[0]) => {
            calls += 1;
            if (calls === 1) throw Object.assign(new Error('overloaded'), { kind: 'http', status: 503 });
            return mock.analyzeMeal(img);
          },
          reviseMeal: async () => {
            throw new Error('n/a');
          },
        };
      },
    });

    const res = await app.request(
      '/webhook',
      post({ message: { photo: [{ file_id: 'f1' }], chat: { id: tgId }, from: { id: tgId } } }),
      env,
    );
    expect(res.status).toBe(200);
    expect(calls).toBe(2); // one failure + one successful retry
    expect(lastText(sent)).toContain('Logged');
  });
});

const ADMIN_ID = 999000; // matches vitest.config.ts ADMIN_TELEGRAM_ID

describe('/feedback command', () => {
  it('stores a user message, thanks them, and DMs the owner', async () => {
    const { app, sent } = appWithCapture();
    const res = await app.request(
      '/webhook',
      post({ message: { text: '/feedback the salad estimate was way off', chat: { id: 4100 }, from: { id: 4100 } } }),
      env,
    );
    expect(res.status).toBe(200);
    // User got a thank-you in their own chat.
    const toUser = sent.find((s) => s.chatId === 4100);
    expect(toUser?.reply.text.toLowerCase()).toContain('thanks');
    // Owner got a DM with the message.
    const toAdmin = sent.find((s) => s.chatId === ADMIN_ID);
    expect(toAdmin?.reply.text).toContain('the salad estimate was way off');

    // And it's readable back via the admin `/feedback` review.
    const review = appWithCapture();
    await review.app.request(
      '/webhook',
      post({ message: { text: '/feedback', chat: { id: ADMIN_ID }, from: { id: ADMIN_ID } } }),
      env,
    );
    expect(lastText(review.sent)).toContain('the salad estimate was way off');
  });

  it('prompts a normal user who sends /feedback with no text', async () => {
    const { app, sent } = appWithCapture();
    await app.request(
      '/webhook',
      post({ message: { text: '/feedback', chat: { id: 4200 }, from: { id: 4200 } } }),
      env,
    );
    expect(lastText(sent).toLowerCase()).toContain('tell me');
  });
});

describe('/errors command (admin-gated)', () => {
  it('shows the error list to the admin', async () => {
    // Seed an error via a photo failure path: user with a key whose provider throws.
    const tgId = 4300;
    const user = JSON.stringify({ id: tgId, first_name: 'Ada' });
    const authDate = String(Math.floor(Date.now() / 1000));
    const initData = await signInitData({ user, auth_date: authDate }, '123456:LOCAL-DEV-BOT-TOKEN');
    await createApp().request(
      '/api/settings',
      {
        method: 'PUT',
        headers: { [INIT_DATA_HEADER]: initData, 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: 'k', aiProvider: 'gemini' }),
      },
      env,
    );
    const failing = createApp({
      botClientFactory: () => mockBot([]),
      providerFactory: () => ({
        id: 'primary',
        analyzeMeal: async () => {
          throw Object.assign(new Error('bad request'), { kind: 'http', status: 400 });
        },
        reviseMeal: async () => {
          throw new Error('n/a');
        },
      }),
    });
    await failing.request(
      '/webhook',
      post({ message: { photo: [{ file_id: 'f1' }], chat: { id: tgId }, from: { id: tgId } } }),
      env,
    );

    const { app, sent } = appWithCapture();
    await app.request(
      '/webhook',
      post({ message: { text: '/errors', chat: { id: ADMIN_ID }, from: { id: ADMIN_ID } } }),
      env,
    );
    expect(lastText(sent).toLowerCase()).toContain('errors');
  });

  it('hides /errors from non-admins (generic nudge instead)', async () => {
    const { app, sent } = appWithCapture();
    await app.request(
      '/webhook',
      post({ message: { text: '/errors', chat: { id: 4400 }, from: { id: 4400 } } }),
      env,
    );
    // Non-admin gets the normal fallback nudge, not an error list.
    expect(lastText(sent).toLowerCase()).toContain('open snapbite');
    expect(lastText(sent).toLowerCase()).not.toContain('latest errors');
  });
});

describe('webhook photo failure logging', () => {
  it('writes an error_logs row and DMs the admin on a photo failure', async () => {
    const tgId = 4500;
    const user = JSON.stringify({ id: tgId, first_name: 'Ada' });
    const authDate = String(Math.floor(Date.now() / 1000));
    const initData = await signInitData({ user, auth_date: authDate }, '123456:LOCAL-DEV-BOT-TOKEN');
    await createApp().request(
      '/api/settings',
      {
        method: 'PUT',
        headers: { [INIT_DATA_HEADER]: initData, 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: 'k', aiProvider: 'gemini' }),
      },
      env,
    );

    const sent: Array<{ chatId: number; reply: BotReply }> = [];
    const app = createApp({
      botClientFactory: () => mockBot(sent),
      providerFactory: () => ({
        id: 'primary',
        analyzeMeal: async () => {
          throw Object.assign(new Error('kaboom'), { kind: 'http', status: 400 });
        },
        reviseMeal: async () => {
          throw new Error('n/a');
        },
      }),
    });
    const res = await app.request(
      '/webhook',
      post({ message: { photo: [{ file_id: 'f1' }], chat: { id: tgId }, from: { id: tgId } } }),
      env,
    );
    expect(res.status).toBe(200);
    // Admin was alerted about the user-facing failure.
    const dm = sent.find((s) => s.chatId === ADMIN_ID);
    expect(dm?.reply.text).toContain(String(tgId));
  });
});

describe('photo edit-in-place', () => {
  it('edits the "Analyzing…" message into the logged result (no second message)', async () => {
    const tgId = 8600;
    const user = JSON.stringify({ id: tgId, first_name: 'Ada' });
    const authDate = String(Math.floor(Date.now() / 1000));
    const initData = await signInitData({ user, auth_date: authDate }, '123456:LOCAL-DEV-BOT-TOKEN');
    await createApp().request(
      '/api/settings',
      {
        method: 'PUT',
        headers: { [INIT_DATA_HEADER]: initData, 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: 'k', aiProvider: 'gemini' }),
      },
      env,
    );

    const sent: Array<{ chatId: number; reply: BotReply }> = [];
    const bot = mockBot(sent);
    const app = createApp({
      botClientFactory: () => bot,
      providerFactory: () => new MockAIProvider(),
    });
    await app.request(
      '/webhook',
      post({ message: { photo: [{ file_id: 'f1' }], chat: { id: tgId }, from: { id: tgId } } }),
      env,
    );
    // The analyzing ack was sent, then EDITED into the result (edit recorded).
    const edits = (bot as unknown as { edits: Array<{ reply: BotReply }> }).edits;
    expect(edits.length).toBeGreaterThanOrEqual(1);
    expect(edits.some((e) => e.reply.text.includes('Logged'))).toBe(true);
  });
});

describe('plain-text revise of the last meal', () => {
  async function setupKeyedUser(tgId: number) {
    const user = JSON.stringify({ id: tgId, first_name: 'Ada' });
    const authDate = String(Math.floor(Date.now() / 1000));
    const initData = await signInitData({ user, auth_date: authDate }, '123456:LOCAL-DEV-BOT-TOKEN');
    await createApp().request(
      '/api/settings',
      {
        method: 'PUT',
        headers: { [INIT_DATA_HEADER]: initData, 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: 'k', aiProvider: 'gemini' }),
      },
      env,
    );
  }

  it('revises the single recent meal and edits its confirmation in place', async () => {
    const tgId = 8700;
    await setupKeyedUser(tgId);
    const sent: Array<{ chatId: number; reply: BotReply }> = [];
    const bot = mockBot(sent);
    const app = createApp({
      botClientFactory: () => bot,
      providerFactory: () => new MockAIProvider(),
    });
    // Log a photo meal first (creates one recent meal with a confirmation msg).
    await app.request(
      '/webhook',
      post({ message: { photo: [{ file_id: 'f1' }], chat: { id: tgId }, from: { id: tgId } } }),
      env,
    );
    const editsBefore = (bot as unknown as { edits: unknown[] }).edits.length;

    // Now send plain text — should revise that meal and edit in place.
    const res = await app.request(
      '/webhook',
      post({ message: { text: 'add a coke', chat: { id: tgId }, from: { id: tgId } } }),
      env,
    );
    expect(res.status).toBe(200);
    const editsAfter = (bot as unknown as { edits: unknown[] }).edits.length;
    expect(editsAfter).toBeGreaterThan(editsBefore); // the confirmation was edited again
  });

  it('asks the user to reply when several meals were logged recently', async () => {
    const tgId = 8701;
    await setupKeyedUser(tgId);
    const sent: Array<{ chatId: number; reply: BotReply }> = [];
    const app = createApp({
      botClientFactory: () => mockBot(sent),
      providerFactory: () => new MockAIProvider(),
    });
    // Log two photos → two recent meals.
    for (const f of ['a', 'b']) {
      await app.request(
        '/webhook',
        post({ message: { photo: [{ file_id: f }], chat: { id: tgId }, from: { id: tgId } } }),
        env,
      );
    }
    await app.request(
      '/webhook',
      post({ message: { text: 'add a coke', chat: { id: tgId }, from: { id: tgId } } }),
      env,
    );
    expect(lastText(sent).toLowerCase()).toContain('reply');
  });

  it('honors reply-to targeting to disambiguate', async () => {
    const tgId = 8702;
    await setupKeyedUser(tgId);
    const sent: Array<{ chatId: number; reply: BotReply }> = [];
    const bot = mockBot(sent);
    const app = createApp({
      botClientFactory: () => bot,
      providerFactory: () => new MockAIProvider(),
    });
    // Two meals; capture the message ids of their confirmations.
    for (const f of ['a', 'b']) {
      await app.request(
        '/webhook',
        post({ message: { photo: [{ file_id: f }], chat: { id: tgId }, from: { id: tgId } } }),
        env,
      );
    }
    const edits = (bot as unknown as { edits: Array<{ messageId: number }> }).edits;
    const firstConfirmationId = edits[0]?.messageId;
    expect(firstConfirmationId).toBeTruthy();

    const res = await app.request(
      '/webhook',
      post({
        message: {
          text: 'add a coke',
          chat: { id: tgId },
          from: { id: tgId },
          reply_to_message: { message_id: firstConfirmationId },
        },
      }),
      env,
    );
    expect(res.status).toBe(200);
    // Not the ambiguity prompt — it targeted the replied-to meal.
    expect(lastText(sent).toLowerCase()).not.toContain('reply directly');
    // An "Updated" ack was sent as a reply to the meal's confirmation message.
    const ack = sent[sent.length - 1];
    expect(ack?.reply.text).toContain('Updated');
    expect(ack?.reply.replyToMessageId).toBe(firstConfirmationId);
  });
});

describe('/broadcast (admin-gated)', () => {
  it('sends the changelog to known users and reports a summary to the admin', async () => {
    // Create a couple of users by having them interact (upsertUser via a message).
    const app0 = createApp({ botClientFactory: () => mockBot([]) });
    for (const id of [7301, 7302]) {
      await app0.request(
        '/webhook',
        post({ message: { text: 'hi', chat: { id }, from: { id } } }),
        env,
      );
    }

    const sent: Array<{ chatId: number; reply: BotReply }> = [];
    const app = createApp({ botClientFactory: () => mockBot(sent) });
    const res = await app.request(
      '/webhook',
      post({ message: { text: '/broadcast', chat: { id: ADMIN_ID }, from: { id: ADMIN_ID } } }),
      env,
    );
    expect(res.status).toBe(200);
    // The two users each got the update message (contains the version header).
    expect(sent.some((s) => s.chatId === 7301 && s.reply.text.includes('FoodLog update'))).toBe(
      true,
    );
    // The admin got a summary.
    const summary = sent.find((s) => s.chatId === ADMIN_ID);
    expect(summary?.reply.text).toContain('Broadcast');
  });

  it('is invisible to non-admins (generic nudge, no broadcast)', async () => {
    const sent: Array<{ chatId: number; reply: BotReply }> = [];
    const app = createApp({ botClientFactory: () => mockBot(sent) });
    await app.request(
      '/webhook',
      post({ message: { text: '/broadcast', chat: { id: 7400 }, from: { id: 7400 } } }),
      env,
    );
    expect(lastText(sent).toLowerCase()).toContain('open snapbite');
    expect(lastText(sent)).not.toContain('SnapBite update');
  });
});

describe('barcode → Open Food Facts enrichment', () => {
  it('replaces a barcoded food\'s macros with the looked-up product and tags provider', async () => {
    const tgId = 7500;
    const user = JSON.stringify({ id: tgId, first_name: 'Ada' });
    const authDate = String(Math.floor(Date.now() / 1000));
    const initData = await signInitData({ user, auth_date: authDate }, '123456:LOCAL-DEV-BOT-TOKEN');
    await createApp().request(
      '/api/settings',
      {
        method: 'PUT',
        headers: { [INIT_DATA_HEADER]: initData, 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: 'k', aiProvider: 'gemini' }),
      },
      env,
    );

    // Provider returns a food carrying a barcode; the global fetch is stubbed so
    // the OFF lookup returns a known product.
    const analysisWithBarcode = {
      foods: [
        {
          name: 'unknown snack',
          estimatedWeightG: 100,
          quantity: 1,
          confidence: 0.6,
          aiNutrition: { energyKcal: 100, proteinG: 1, carbsG: 10, fatG: 2 },
          barcode: '3017620422003',
        },
      ],
      confidence: 0.6,
      needsConfirmation: false,
    };
    const sent: Array<{ chatId: number; reply: BotReply }> = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).includes('openfoodfacts.org')) {
        return new Response(
          JSON.stringify({
            status: 1,
            product: {
              product_name: 'Test Bar',
              serving_quantity: 50,
              nutriments: {
                'energy-kcal_100g': 400,
                proteins_100g: 8,
                carbohydrates_100g: 60,
                fat_100g: 15,
              },
            },
          }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 200 });
    });

    try {
      const app = createApp({
        botClientFactory: () => mockBot(sent),
        providerFactory: () => ({
          id: 'primary',
          analyzeMeal: async () => analysisWithBarcode,
          reviseMeal: async () => {
            throw new Error('n/a');
          },
        }),
      });
      await app.request(
        '/webhook',
        post({ message: { photo: [{ file_id: 'f1' }], chat: { id: tgId }, from: { id: tgId } } }),
        env,
      );
    } finally {
      fetchSpy.mockRestore();
    }

    // The saved meal should reflect the OFF product name + macros (400 kcal/100g
    // × 50g serving = 200 kcal), and be tagged with the openfoodfacts provider.
    const list = (await (
      await createApp().request('/api/meals', { headers: { [INIT_DATA_HEADER]: initData } }, env)
    ).json()) as { meals: Array<{ foods: string[]; energyKcal: number | null; aiProvider: string | null }> };
    const meal = list.meals[0];
    expect(meal?.foods).toContain('Test Bar');
    expect(meal?.energyKcal).toBe(200);
    expect(meal?.aiProvider).toBe('openfoodfacts');
  });
});

describe('overload retry by message text (not just status 503)', () => {
  it('retries when overload is reported in the body with a non-503 status, then succeeds', async () => {
    const tgId = 8310;
    const user = JSON.stringify({ id: tgId, first_name: 'Ada' });
    const authDate = String(Math.floor(Date.now() / 1000));
    const initData = await signInitData({ user, auth_date: authDate }, '123456:LOCAL-DEV-BOT-TOKEN');
    await createApp().request(
      '/api/settings',
      {
        method: 'PUT',
        headers: { [INIT_DATA_HEADER]: initData, 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: 'primary-key', aiProvider: 'gemini' }),
      },
      env,
    );

    let calls = 0;
    const sent: Array<{ chatId: number; reply: BotReply }> = [];
    const app = createApp({
      botClientFactory: () => mockBot(sent),
      providerFactory: () => {
        const mock = new MockAIProvider();
        return {
          id: 'primary',
          analyzeMeal: async (img: Parameters<MockAIProvider['analyzeMeal']>[0]) => {
            calls += 1;
            if (calls === 1) {
              // Gemini-style overload: status 500 but "overloaded" only in the body.
              throw Object.assign(new Error('gemini returned HTTP 500'), {
                kind: 'http',
                status: 500,
                cause: JSON.stringify({ error: { message: 'The model is overloaded. Please try again later.' } }),
              });
            }
            return mock.analyzeMeal(img);
          },
          reviseMeal: async () => {
            throw new Error('n/a');
          },
        };
      },
    });

    const res = await app.request(
      '/webhook',
      post({ message: { photo: [{ file_id: 'f1' }], chat: { id: tgId }, from: { id: tgId } } }),
      env,
    );
    expect(res.status).toBe(200);
    expect(calls).toBe(2); // retried the overload rather than surfacing "busy"
    expect(lastText(sent)).toContain('Logged');
  });
});
