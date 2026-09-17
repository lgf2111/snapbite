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
    expect(sent[0]?.reply.text).toContain('Logged');

    // The meal should now be listed for that user.
    const list = (await (
      await createApp().request('/api/meals', { headers: { [INIT_DATA_HEADER]: initData } }, env)
    ).json()) as { meals: unknown[] };
    expect(list.meals.length).toBeGreaterThanOrEqual(1);
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
    expect(sent[0]?.reply.text).toContain('Logged');
  });
});
