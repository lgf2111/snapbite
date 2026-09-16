import { describe, expect, it, vi } from 'vitest';
import { TelegramBotClient } from './botClient.js';

describe('TelegramBotClient', () => {
  it('sends a message via the injected fetch', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => '{}' }));
    const client = new TelegramBotClient('token123', fetchMock);
    await client.sendMessage(42, { text: 'hello', replyMarkup: { inline_keyboard: [] } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe('https://api.telegram.org/bottoken123/sendMessage');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ chat_id: 42, text: 'hello' });
    expect(body.reply_markup).toBeDefined();
  });

  it('binds the default global fetch (no "Illegal invocation")', async () => {
    // Replace global fetch with a spy; the client must call it without a bad
    // `this`. If the binding were wrong this would throw in workerd; here we at
    // least assert construction + call path uses the global.
    const original = globalThis.fetch;
    const spy = vi.fn(async () => new Response('{}', { status: 200 }));
    globalThis.fetch = spy as unknown as typeof fetch;
    try {
      const client = new TelegramBotClient('tok');
      await client.sendMessage(1, { text: 'hi' });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = original;
    }
  });
});
