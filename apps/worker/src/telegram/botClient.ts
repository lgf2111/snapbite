import type { BotReply } from '@foodlog/core';

/** Minimal fetch signature so the client is mockable in tests. */
export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/**
 * Thin Telegram Bot API client. Only the calls the bot launcher needs.
 * Fetch is injectable so tests never hit the network.
 */
export class TelegramBotClient {
  readonly #token: string;
  readonly #fetch: FetchLike;

  constructor(token: string, fetchImpl?: FetchLike) {
    this.#token = token;
    const injected = fetchImpl;
    const globalFetch = (globalThis as { fetch?: unknown }).fetch;
    if (injected) this.#fetch = injected;
    else if (typeof globalFetch === 'function') this.#fetch = globalFetch as unknown as FetchLike;
    else throw new Error('No fetch implementation available');
  }

  async sendMessage(chatId: number, reply: BotReply): Promise<void> {
    const body: Record<string, unknown> = { chat_id: chatId, text: reply.text };
    if (reply.replyMarkup) body.reply_markup = reply.replyMarkup;

    await this.#fetch(`https://api.telegram.org/bot${this.#token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
}
