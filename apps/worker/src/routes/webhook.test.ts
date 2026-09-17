import { type AIFoodAnalysis, type BotReply, MockAIProvider, signInitData } from '@foodlog/core';
import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { INIT_DATA_HEADER } from '../middleware/auth.js';

const SECRET_HEADER = 'x-telegram-bot-api-secret-token';
const SECRET = 'test-webhook-secret';

/** A full BotClient mock; photo helpers return canned data. */
function mockBot(sent: Array<{ chatId: number; reply: BotReply }>) {
  return {
    async sendMessage(chatId: number, reply: BotReply) {
      sent.push({ chatId, reply });
    },
    async getFilePath() {
      return 'photos/file_1.jpg';
    },
    async downloadFile() {
      return { base64: 'QUJD', mimeType: 'image/jpeg' };
    },
  };
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
    expect(sent[0]?.reply.text.toLowerCase()).toContain('open foodlog');
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
    expect(lastText(sent).toLowerCase()).toContain('open foodlog');
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
