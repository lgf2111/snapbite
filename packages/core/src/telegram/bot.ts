/**
 * Pure, transport-agnostic helpers for the Telegram bot: parse an incoming
 * Update, decide the reply for a command, and build the "meal logged" feed
 * message. No network here — the Worker supplies the send transport.
 */

/** One size of a photo Telegram delivered. */
export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id?: string;
  width?: number;
  height?: number;
  file_size?: number;
}

/** The subset of a Telegram Update we care about. */
export interface TelegramUpdate {
  update_id?: number;
  message?: {
    message_id?: number;
    text?: string;
    caption?: string;
    photo?: TelegramPhotoSize[];
    chat?: { id: number; type?: string };
    from?: { id: number; first_name?: string; username?: string };
    /** The message this one replies to (Telegram populates it on a reply). */
    reply_to_message?: { message_id?: number };
  };
}

export interface ParsedCommand {
  chatId: number;
  /** The Telegram user id (for resolving the app user), when present. */
  fromId: number | null;
  /** The command without the leading slash, lowercased (e.g. "start"). */
  command: string | null;
  /** Raw text after the command, if any. */
  args: string;
  text: string;
  /** file_id of the largest photo in the message, if this is a photo message. */
  photoFileId: string | null;
  /** Caption text accompanying a photo, if any. */
  caption: string;
  /** This message's own Telegram message_id, when present. */
  messageId: number | null;
  /** message_id this message is a reply to, when it's a reply. */
  replyToMessageId: number | null;
}

/** Extracts the chat id, command, args, and any photo from an update's message. */
export function parseUpdate(update: TelegramUpdate): ParsedCommand | null {
  const message = update.message;
  if (!message?.chat) return null;

  const text = (message.text ?? '').trim();
  let command: string | null = null;
  let args = '';

  if (text.startsWith('/')) {
    const [head, ...rest] = text.split(/\s+/);
    // Strip a possible @botusername suffix: /start@SnapBiteAI_bot
    command = (head ?? '').slice(1).split('@')[0]?.toLowerCase() || null;
    args = rest.join(' ');
  }

  // Telegram sends an array of photo sizes ascending; the last is the largest.
  const photo = message.photo;
  const photoFileId = photo && photo.length > 0 ? (photo[photo.length - 1]?.file_id ?? null) : null;

  return {
    chatId: message.chat.id,
    fromId: message.from?.id ?? null,
    command,
    args,
    text,
    photoFileId,
    caption: (message.caption ?? '').trim(),
    messageId: message.message_id ?? null,
    replyToMessageId: message.reply_to_message?.message_id ?? null,
  };
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
  /** When set, the message is sent as a reply to this Telegram message_id. */
  replyToMessageId?: number;
  /** When set, posts into a forum/group Topic (Telegram `message_thread_id`). */
  threadId?: number;
}

export interface BotConfig {
  /** HTTPS URL of the Mini App, used for the launch button. */
  miniAppUrl: string;
}

/**
 * Produces the reply for a parsed command. Returns null when there's nothing to
 * say (non-command messages just get a gentle nudge to open the app).
 */
export function replyForCommand(
  parsed: Pick<ParsedCommand, 'command'>,
  config: BotConfig,
): BotReply | null {
  const launchButton: InlineKeyboardButton[][] | undefined = config.miniAppUrl
    ? [[{ text: '🍽️ Open SnapBite', web_app: { url: config.miniAppUrl } }]]
    : undefined;

  const withButton = (text: string): BotReply =>
    launchButton ? { text, replyMarkup: { inline_keyboard: launchButton } } : { text };

  switch (parsed.command) {
    case 'start':
      return withButton(
        "Welcome to SnapBite. Just send me a photo of your meal and I'll log it — calories, protein, carbs, and fat, always editable. Open the app to review your history, search, and trends.\n\nFirst time? Open SnapBite → Settings and add your AI key.",
      );
    case 'help':
      return withButton(
        'SnapBite logs meals from photos.\n\n• Send a photo straight to this chat — I analyze it and log it\n• Open the app to review or correct any entry\n• Browse history, search, and see your trends there\n\nUse /settings to add or update your AI key.\nHit a problem? Send /feedback <your message> and it goes straight to the maintainer.',
      );
    case 'settings':
      return withButton('Open SnapBite and go to Settings to add or update your AI key.');
    default:
      // Any other message: nudge toward the actual flow rather than staying silent.
      return withButton('Send me a meal photo to log it, or open SnapBite to view your history.');
  }
}

/** Prompt shown for `/feedback` with no text — tells the user how to send it. */
export const FEEDBACK_PROMPT =
  'Tell me what went wrong or what you\'d like improved.\n\nSend it like: /feedback the photo analysis was way off for my salad';

/** Confirmation shown after a user's feedback is stored + forwarded. */
export const FEEDBACK_THANKS = '🙏 Thanks — your feedback was sent to the maintainer.';

/** Max feedback length accepted from the bot (mirrors the API cap). */
export const FEEDBACK_MAX_LEN = 2000;

/** Builds the "meal logged" feed message posted after a successful save. */
export function mealLoggedMessage(foods: string[], energyKcal: number | null): string {
  const list = foods.length > 0 ? foods.join(', ') : 'your meal';
  const kcal = energyKcal != null ? ` (~${energyKcal} kcal, estimate)` : '';
  return `✅ Logged ${list}${kcal}.`;
}

/** The macro/energy totals shown in the detailed photo-logged reply. */
export interface PhotoLoggedTotals {
  energyKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/** Rounds to one decimal for display. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Reply shown when a photo is logged straight from the bot chat. Summarizes
 * what the AI interpreted: the foods and the meal's total calories + macros
 * (protein/carbs/fat), all framed as estimates and correctable in the app.
 */
export function photoLoggedReply(
  foods: string[],
  totals: PhotoLoggedTotals,
  config: BotConfig,
): BotReply {
  const list = foods.length > 0 ? foods.join(', ') : 'your meal';
  const lines = [
    `✅ Logged: ${list}`,
    '',
    'Estimated totals:',
    `🔥 ${round1(totals.energyKcal)} kcal`,
    `🥩 Protein ${round1(totals.proteinG)} g`,
    `🍚 Carbs ${round1(totals.carbsG)} g`,
    `🧈 Fat ${round1(totals.fatG)} g`,
    '',
    'These are estimates — open the app to review or correct.',
  ];
  const text = lines.join('\n');
  if (config.miniAppUrl) {
    return {
      text,
      replyMarkup: { inline_keyboard: [[{ text: '🍽️ Open SnapBite', web_app: { url: config.miniAppUrl } }]] },
    };
  }
  return { text };
}
