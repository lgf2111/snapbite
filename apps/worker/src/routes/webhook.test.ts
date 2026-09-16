import type { BotReply } from '@foodlog/core';
import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';

const SECRET_HEADER = 'x-telegram-bot-api-secret-token';
const SECRET = 'test-webhook-secret';

/** Captures messages the webhook would send, via an injected mock bot client. */
function appWithCapture() {
  const sent: Array<{ chatId: number; reply: BotReply }> = [];
  const app = createApp({
    botClientFactory: () => ({
      async sendMessage(chatId: number, reply: BotReply) {
        sent.push({ chatId, reply });
      },
    }),
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
    const app = createApp({ botClientFactory: () => ({ sendMessage: vi.fn() }) });
    const res = await app.request(
      '/webhook',
      { method: 'POST', headers: { 'content-type': 'application/json', [SECRET_HEADER]: SECRET }, body: 'not json' },
      env,
    );
    expect(res.status).toBe(200);
  });
});
