import type { BotReply } from '@foodlog/core';

/** Minimal fetch signature so the client is mockable in tests. */
export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** Result of a send: the new message's id when Telegram returned one. */
export interface SentMessage {
  messageId: number | null;
}

/** Parses a Telegram sendMessage response into a {@link SentMessage}. */
async function parseSent(res: {
  ok: boolean;
  text(): Promise<string>;
}): Promise<SentMessage> {
  if (!res.ok) return { messageId: null };
  try {
    const json = JSON.parse(await res.text()) as {
      ok: boolean;
      result?: { message_id?: number };
    };
    return { messageId: json.ok && json.result?.message_id != null ? json.result.message_id : null };
  } catch {
    return { messageId: null };
  }
}

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

  async sendMessage(chatId: number, reply: BotReply): Promise<SentMessage> {
    const body: Record<string, unknown> = { chat_id: chatId, text: reply.text };
    if (reply.replyMarkup) body.reply_markup = reply.replyMarkup;
    if (reply.replyToMessageId != null) {
      body.reply_parameters = { message_id: reply.replyToMessageId };
    }
    if (reply.threadId != null) body.message_thread_id = reply.threadId;

    const res = await this.#fetch(`https://api.telegram.org/bot${this.#token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return parseSent(res);
  }

  /**
   * Edits a previously-sent message's text (and optional inline keyboard) in
   * place. Best-effort: returns false on any failure (e.g. Telegram's 48h edit
   * window has passed, or the message is identical). Never throws.
   */
  async editMessageText(chatId: number, messageId: number, reply: BotReply): Promise<boolean> {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      message_id: messageId,
      text: reply.text,
    };
    if (reply.replyMarkup) body.reply_markup = reply.replyMarkup;
    try {
      const res = await this.#fetch(
        `https://api.telegram.org/bot${this.#token}/editMessageText`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Deletes a message. Best-effort — returns false on failure, never throws. */
  async deleteMessage(chatId: number, messageId: number): Promise<boolean> {
    try {
      const res = await this.#fetch(`https://api.telegram.org/bot${this.#token}/deleteMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Shows a transient status in the chat (e.g. "typing…" / "uploading photo…")
   * so the user sees the bot is working. Telegram clears it after ~5s or when
   * the next message arrives. Best-effort — failures are swallowed.
   */
  async sendChatAction(chatId: number, action: string): Promise<void> {
    try {
      await this.#fetch(`https://api.telegram.org/bot${this.#token}/sendChatAction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, action }),
      });
    } catch {
      // never block the pipeline on a status ping
    }
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
