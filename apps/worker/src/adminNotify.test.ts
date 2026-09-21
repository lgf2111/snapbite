import type { BotReply } from '@snapbite/core';
import { describe, expect, it } from 'vitest';
import { adminNotify } from './adminNotify.js';
import type { Env } from './env.js';

function mockBot() {
  const sent: Array<{ chatId: number; reply: BotReply }> = [];
  const bot = {
    async sendMessage(chatId: number, reply: BotReply) {
      sent.push({ chatId, reply });
      return { messageId: 1 };
    },
  };
  return { bot, sent };
}

/** Minimal Env with just the routing fields the router reads. */
function env(overrides: Partial<Env>): Env {
  return { DB: {} as D1Database, TELEGRAM_BOT_TOKEN: 't', ...overrides } as Env;
}

describe('adminNotify', () => {
  it('posts to the group topic for the kind when a group is configured', async () => {
    const { bot, sent } = mockBot();
    await adminNotify(
      env({
        ADMIN_GROUP_CHAT_ID: '-1003990101342',
        ERRORS_THREAD_ID: '2',
        FEEDBACK_THREAD_ID: '3',
        BROADCAST_THREAD_ID: '4',
        ADMIN_TELEGRAM_ID: '999000',
      }),
      bot,
      'error',
      'boom',
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]?.chatId).toBe(-1003990101342);
    expect(sent[0]?.reply.threadId).toBe(2);
    expect(sent[0]?.reply.text).toBe('boom');
  });

  it('routes each kind to its own thread', async () => {
    const { bot, sent } = mockBot();
    const e = env({
      ADMIN_GROUP_CHAT_ID: '-100123',
      ERRORS_THREAD_ID: '2',
      FEEDBACK_THREAD_ID: '3',
      BROADCAST_THREAD_ID: '4',
    });
    await adminNotify(e, bot, 'feedback', 'f');
    await adminNotify(e, bot, 'broadcast', 'b');
    expect(sent[0]?.reply.threadId).toBe(3);
    expect(sent[1]?.reply.threadId).toBe(4);
  });

  it('DMs the admin id when no group is configured', async () => {
    const { bot, sent } = mockBot();
    await adminNotify(env({ ADMIN_TELEGRAM_ID: '999000' }), bot, 'error', 'boom');
    expect(sent[0]?.chatId).toBe(999000);
    expect(sent[0]?.reply.threadId).toBeUndefined();
  });

  it('is a no-op when neither group nor admin id is set', async () => {
    const { bot, sent } = mockBot();
    await adminNotify(env({}), bot, 'error', 'boom');
    expect(sent).toHaveLength(0);
  });

  it('never throws even if the bot send fails', async () => {
    const bot = {
      async sendMessage() {
        throw new Error('network');
      },
    };
    await expect(
      adminNotify(env({ ADMIN_TELEGRAM_ID: '999000' }), bot, 'error', 'boom'),
    ).resolves.toBeUndefined();
  });
});
