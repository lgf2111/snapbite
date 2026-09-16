/**
 * Pure, transport-agnostic helpers for the Telegram bot: parse an incoming
 * Update, decide the reply for a command, and build the "meal logged" feed
 * message. No network here — the Worker supplies the send transport.
 */

/** The subset of a Telegram Update we care about. */
export interface TelegramUpdate {
  update_id?: number;
  message?: {
    message_id?: number;
    text?: string;
    chat?: { id: number; type?: string };
    from?: { id: number; first_name?: string; username?: string };
  };
}

export interface ParsedCommand {
  chatId: number;
  /** The command without the leading slash, lowercased (e.g. "start"). */
  command: string | null;
  /** Raw text after the command, if any. */
  args: string;
  text: string;
}

/** Extracts the chat id, command, and args from an update's message. */
export function parseUpdate(update: TelegramUpdate): ParsedCommand | null {
  const message = update.message;
  if (!message?.chat) return null;

  const text = (message.text ?? '').trim();
  let command: string | null = null;
  let args = '';

  if (text.startsWith('/')) {
    const [head, ...rest] = text.split(/\s+/);
    // Strip a possible @botusername suffix: /start@FoodLogBot
    command = (head ?? '').slice(1).split('@')[0]?.toLowerCase() || null;
    args = rest.join(' ');
  }

  return { chatId: message.chat.id, command, args, text };
}

export interface InlineKeyboardButton {
  text: string;
  web_app?: { url: string };
  url?: string;
}

export interface BotReply {
  text: string;
  /** Optional inline keyboard (e.g. a web_app launch button). */
  replyMarkup?: { inline_keyboard: InlineKeyboardButton[][] };
}

export interface BotConfig {
  /** HTTPS URL of the Mini App, used for the launch button. */
  miniAppUrl: string;
}

/**
 * Produces the reply for a parsed command. Returns null when there's nothing to
 * say (non-command messages just get a gentle nudge to open the app).
 */
export function replyForCommand(parsed: ParsedCommand, config: BotConfig): BotReply | null {
  const launchButton: InlineKeyboardButton[][] | undefined = config.miniAppUrl
    ? [[{ text: '📷 Open FoodLog', web_app: { url: config.miniAppUrl } }]]
    : undefined;

  const withButton = (text: string): BotReply =>
    launchButton ? { text, replyMarkup: { inline_keyboard: launchButton } } : { text };

  switch (parsed.command) {
    case 'start':
      return withButton(
        'Welcome to FoodLog. Snap a photo of your meal and I\'ll estimate the nutrition — always editable. Tap below to open the app.',
      );
    case 'help':
      return withButton(
        'FoodLog logs meals from photos.\n\n• Open the app and take a photo\n• Review the AI estimate and correct anything\n• Save it to your history\n\nUse /settings to add your AI key.',
      );
    case 'settings':
      return withButton('Open FoodLog and go to Settings to add or update your AI key.');
    default:
      // Any other message: nudge toward the app rather than staying silent.
      return withButton('Tap below to open FoodLog and log a meal.');
  }
}

/** Builds the "meal logged" feed message posted after a successful save. */
export function mealLoggedMessage(foods: string[], energyKcal: number | null): string {
  const list = foods.length > 0 ? foods.join(', ') : 'your meal';
  const kcal = energyKcal != null ? ` (~${energyKcal} kcal, estimate)` : '';
  return `✅ Logged ${list}${kcal}.`;
}
