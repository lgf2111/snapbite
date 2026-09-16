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
    const globalFetch = (globalThis as { fetch?: unknown }).fetch;
    if (fetchImpl) {
      this.#fetch = fetchImpl;
    } else if (typeof globalFetch === 'function') {
      // Bind to globalThis so `fetch` keeps its `this` (workerd throws
      // "Illegal invocation" otherwise).
      this.#fetch = (globalFetch as (...a: unknown[]) => unknown).bind(
        globalThis,
      ) as unknown as FetchLike;
    } else {
      throw new Error('No fetch implementation available');
    }
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

  /** Resolves a file_id to a downloadable file_path via getFile. */
  async getFilePath(fileId: string): Promise<string | null> {
    const res = await this.#fetch(`https://api.telegram.org/bot${this.#token}/getFile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId }),
    });
    if (!res.ok) return null;
    try {
      const json = JSON.parse(await res.text()) as { ok: boolean; result?: { file_path?: string } };
      return json.ok && json.result?.file_path ? json.result.file_path : null;
    } catch {
      return null;
    }
  }

  /** Downloads a file by its file_path and returns base64 + detected mime. */
  async downloadFile(
    filePath: string,
  ): Promise<{ base64: string; mimeType: string } | null> {
    // The file download endpoint is a plain GET; use the raw global fetch so we
    // get a real Response with arrayBuffer().
    const url = `https://api.telegram.org/file/bot${this.#token}/${filePath}`;
    const globalFetch = (globalThis as { fetch?: typeof fetch }).fetch;
    if (typeof globalFetch !== 'function') return null;
    const res = await globalFetch.call(globalThis, url);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    let binary = '';
    for (const b of buf) binary += String.fromCharCode(b);
    const base64 = btoa(binary);
    const mimeType = mimeFromPath(filePath);
    return { base64, mimeType };
  }
}

function mimeFromPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}
