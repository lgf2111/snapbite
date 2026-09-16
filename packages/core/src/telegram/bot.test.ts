import { describe, expect, it } from 'vitest';
import { mealLoggedMessage, parseUpdate, replyForCommand } from './bot.js';

const CONFIG = { miniAppUrl: 'https://app.example.com' };

describe('parseUpdate', () => {
  it('parses a /start command', () => {
    const parsed = parseUpdate({ message: { text: '/start', chat: { id: 5 } } });
    expect(parsed).toMatchObject({ chatId: 5, command: 'start', args: '' });
  });

  it('strips a @botname suffix and reads args', () => {
    const parsed = parseUpdate({
      message: { text: '/settings@FoodLogBot deepseek', chat: { id: 9 } },
    });
    expect(parsed?.command).toBe('settings');
    expect(parsed?.args).toBe('deepseek');
  });

  it('returns command null for a plain message', () => {
    const parsed = parseUpdate({ message: { text: 'hello there', chat: { id: 1 } } });
    expect(parsed?.command).toBeNull();
    expect(parsed?.text).toBe('hello there');
  });

  it('returns null when there is no chat', () => {
    expect(parseUpdate({})).toBeNull();
  });
});

describe('replyForCommand', () => {
  it('replies to /start with a web_app launch button', () => {
    const reply = replyForCommand({ chatId: 1, command: 'start', args: '', text: '/start' }, CONFIG);
    expect(reply?.text).toContain('Welcome');
    const button = reply?.replyMarkup?.inline_keyboard[0]?.[0];
    expect(button?.web_app?.url).toBe('https://app.example.com');
  });

  it('replies to /help', () => {
    const reply = replyForCommand({ chatId: 1, command: 'help', args: '', text: '/help' }, CONFIG);
    expect(reply?.text).toContain('logs meals');
  });

  it('nudges for unknown/plain messages', () => {
    const reply = replyForCommand({ chatId: 1, command: null, args: '', text: 'hi' }, CONFIG);
    expect(reply?.text).toContain('open FoodLog');
  });

  it('omits the button when no miniAppUrl is configured', () => {
    const reply = replyForCommand(
      { chatId: 1, command: 'start', args: '', text: '/start' },
      { miniAppUrl: '' },
    );
    expect(reply?.replyMarkup).toBeUndefined();
  });
});

describe('mealLoggedMessage', () => {
  it('lists foods with an estimated kcal', () => {
    expect(mealLoggedMessage(['rice', 'chicken'], 530)).toBe(
      '✅ Logged rice, chicken (~530 kcal, estimate).',
    );
  });

  it('handles no kcal', () => {
    expect(mealLoggedMessage(['soup'], null)).toBe('✅ Logged soup.');
  });
});
