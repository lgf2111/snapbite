import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/** Application users, keyed to a Telegram user id. */
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    /** Null for accounts created by email sign-in (they never touch the bot). */
    telegramUserId: integer('telegram_user_id'),
    /**
     * Optional sign-in credential. A Telegram user can attach an email and keep
     * the same row (same meals); a browser user gets a row with no Telegram id.
     * Null means "no email credential for this person".
     */
    email: text('email'),
    emailVerifiedAt: integer('email_verified_at'),
    createdAt: integer('created_at').notNull(),
    /** The user's DM chat id + message id of the last update broadcast we sent
     * them, so a newer update can EDIT it in place while still editable (<48h).
     * Null until the first broadcast reaches them. */
    lastBroadcastChatId: integer('last_broadcast_chat_id'),
    lastBroadcastMessageId: integer('last_broadcast_message_id'),
    lastBroadcastAt: integer('last_broadcast_at'),
    lastBroadcastVersion: text('last_broadcast_version'),
  },
  (t) => ({
    telegramIdx: uniqueIndex('users_telegram_user_id_idx').on(t.telegramUserId),
    emailIdx: uniqueIndex('users_email_idx').on(t.email),
  }),
);

/** Per-user settings, including the encrypted BYOK key (populated in Task 7). */
export const settings = sqliteTable('settings', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  aiProvider: text('ai_provider').notNull().default('gemini'),
  aiModel: text('ai_model'),
  apiKeyCiphertext: text('api_key_ciphertext'),
  apiKeyIv: text('api_key_iv'),
  preferencesJson: text('preferences_json'),
  updatedAt: integer('updated_at').notNull(),
});

/** A logged meal. Image bytes are never stored — only a Telegram file_id. */
export const meals = sqliteTable(
  'meals',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    telegramFileId: text('telegram_file_id'),
    /** R2 key of the photo we own the bytes for (null for bot-only/photo-less meals). */
    photoKey: text('photo_key'),
    /** Mime type of the stored photo object. */
    photoMime: text('photo_mime'),
    /** Short, shareable meal name (2–4 words) for the UI + share card. */
    title: text('title'),
    notes: text('notes'),
    confidence: real('confidence'),
    /** AI provider that analyzed this meal (e.g. 'gemini', 'openai'); null for manual/older meals. */
    aiProvider: text('ai_provider'),
    /** Chat + message id of the bot's confirmation message, so it can be edited
     * in place when the meal is revised (Telegram allows edits for ~48h). Null
     * for meals not logged via the bot (e.g. manual Mini App entries). */
    telegramChatId: integer('telegram_chat_id'),
    telegramMessageId: integer('telegram_message_id'),
    createdAt: integer('created_at').notNull(),
    loggedAt: integer('logged_at').notNull(),
  },
  (t) => ({
    userLoggedIdx: index('meals_user_logged_idx').on(t.userId, t.loggedAt),
  }),
);

/** Individual foods within a meal. */
export const foodItems = sqliteTable(
  'food_items',
  {
    id: text('id').primaryKey(),
    mealId: text('meal_id')
      .notNull()
      .references(() => meals.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    estimatedWeightG: real('estimated_weight_g'),
    portion: text('portion'),
    quantity: real('quantity').notNull().default(1),
    confidence: real('confidence'),
    // Per-food resolved nutrition (persisted so meals reload with real values).
    energyKcal: real('energy_kcal'),
    proteinG: real('protein_g'),
    carbsG: real('carbs_g'),
    fatG: real('fat_g'),
    /** Dietary fiber (grams). Nullable — null means "unknown", not zero. */
    fiberG: real('fiber_g'),
    nutritionSource: text('nutrition_source'),
  },
  (t) => ({
    mealIdx: index('food_items_meal_idx').on(t.mealId),
    nameIdx: index('food_items_name_idx').on(t.name),
  }),
);

/** Resolved nutrition per meal, with a source label. */
export const nutrition = sqliteTable('nutrition', {
  mealId: text('meal_id')
    .primaryKey()
    .references(() => meals.id, { onDelete: 'cascade' }),
  energyKcal: real('energy_kcal').notNull(),
  proteinG: real('protein_g').notNull(),
  carbsG: real('carbs_g').notNull(),
  fatG: real('fat_g').notNull(),
  /** Dietary fiber (grams). Nullable — null means "unknown", not zero. */
  fiberG: real('fiber_g'),
  source: text('source').notNull(),
});

/** Durable, queryable error log (see §14). Written best-effort; never blocks users. */
export const errorLogs = sqliteTable(
  'error_logs',
  {
    id: text('id').primaryKey(),
    createdAt: integer('created_at').notNull(),
    /** Telegram user id when known (null for unauthenticated/system errors). */
    telegramUserId: integer('telegram_user_id'),
    /** Where it happened: 'webhook' | 'api' | 'analyze' | 'revise' | 'settings' | … */
    source: text('source').notNull(),
    /** Error kind — AIProviderError.kind, HTTP-ish label, or 'unhandled'. */
    kind: text('kind').notNull(),
    /** HTTP-ish status when applicable. */
    status: integer('status'),
    message: text('message').notNull(),
    /** Provider message / trimmed stack snippet. Never contains secrets. */
    detail: text('detail'),
  },
  (t) => ({
    createdIdx: index('error_logs_created_at_idx').on(t.createdAt),
  }),
);

/** User-submitted feedback (see §14), from the bot or the Mini App. */
export const feedback = sqliteTable(
  'feedback',
  {
    id: text('id').primaryKey(),
    createdAt: integer('created_at').notNull(),
    telegramUserId: integer('telegram_user_id'),
    /** 'bot' | 'miniapp' */
    source: text('source').notNull(),
    message: text('message').notNull(),
    /** 0 = unhandled, 1 = handled/acknowledged by the owner. */
    handled: integer('handled').notNull().default(0),
  },
  (t) => ({
    createdIdx: index('feedback_created_at_idx').on(t.createdAt),
  }),
);

/**
 * User-saved meal templates ("favorites"). Stores the full MealResult as JSON
 * so a favorite is a standalone, reusable template that survives even if the
 * original logged meal is deleted. Reusing one just copies the JSON into a new
 * meal (no AI call, no key needed).
 */
export const savedMeals = sqliteTable(
  'saved_meals',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Display name for the saved meal (defaults from the meal's foods). */
    label: text('label').notNull(),
    /** The full MealResult, serialized (validated against the core schema on save). */
    mealJson: text('meal_json').notNull(),
    /** Denormalized total kcal for a cheap list preview without parsing JSON. */
    energyKcal: real('energy_kcal'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    userIdx: index('saved_meals_user_idx').on(t.userId, t.createdAt),
  }),
);

export type UserRow = typeof users.$inferSelect;
export type SettingsRow = typeof settings.$inferSelect;
export type SavedMealRow = typeof savedMeals.$inferSelect;
export type MealRow = typeof meals.$inferSelect;
export type FoodItemRow = typeof foodItems.$inferSelect;
export type NutritionRow = typeof nutrition.$inferSelect;
export type ErrorLogRow = typeof errorLogs.$inferSelect;
export type FeedbackRow = typeof feedback.$inferSelect;

/**
 * Photos whose analysis hit a transient overload (503) and couldn't be logged
 * inline. The cron re-analyzes them a few minutes later and edits the "busy"
 * message into the result. Deleted on success or after the attempt cap (§17).
 */
export const pendingPhotoRetries = sqliteTable(
  'pending_photo_retries',
  {
    id: text('id').primaryKey(),
    /** App user id (to re-load their encrypted key). */
    userId: text('user_id').notNull(),
    telegramUserId: integer('telegram_user_id').notNull(),
    chatId: integer('chat_id').notNull(),
    /** The "busy…" status message to edit into the result (null if none). */
    statusMessageId: integer('status_message_id'),
    /** Telegram file_id of the photo to re-download + analyze. */
    fileId: text('file_id').notNull(),
    caption: text('caption'),
    attempts: integer('attempts').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    /** Earliest time (ms) the cron should try again. */
    nextAt: integer('next_at').notNull(),
  },
  (t) => ({
    nextAtIdx: index('pending_photo_retries_next_at_idx').on(t.nextAt),
  }),
);

export type PendingPhotoRetryRow = typeof pendingPhotoRetries.$inferSelect;

/**
 * First-party product counters (no third-party analytics). One row per
 * (day, name) holding a running count, bumped via an UPSERT. Day is a local
 * 'YYYY-MM-DD'; name is an event like 'user_started' | 'first_meal' |
 * 'meal_logged'. Written best-effort — a metrics failure never fails a user
 * action.
 */
export const metrics = sqliteTable(
  'metrics',
  {
    day: text('day').notNull(),
    name: text('name').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.day, t.name] }),
  }),
);

/**
 * One cached advanced report per (user, range). Reports are pure functions of
 * the user's meals and local day, so a repeat open within the same local day can
 * serve this row instead of recomputing. Meal writes delete the user's rows.
 */
export const analyticsCache = sqliteTable(
  'analytics_cache',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** '90d' | '12m'. */
    range: text('range').notNull(),
    /** Epoch ms the report was computed; compared to local midnight. */
    computedAt: integer('computed_at').notNull(),
    payloadJson: text('payload_json').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.range] }),
  }),
);

/**
 * Idempotent record that a user was active in a given ISO week ('YYYY-Www'),
 * so weekly-active-user counts don't need to scan meals. Inserted with INSERT
 * OR IGNORE, so repeat activity in the same week is a no-op.
 */
export const userActivity = sqliteTable(
  'user_activity',
  {
    userId: integer('user_id').notNull(),
    week: text('week').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.week] }),
  }),
);

/** Server sessions for browser sign-in (cookie holds the raw token). */
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    lastUsedAt: integer('last_used_at'),
    /** 'google' | 'email'; null for sessions opened before this was recorded. */
    method: text('method'),
  },
  (t) => ({
    tokenIdx: uniqueIndex('sessions_token_idx').on(t.tokenHash),
    userIdx: index('sessions_user_idx').on(t.userId),
  }),
);

/** Single-use magic-link tokens (hashed, 15-minute TTL). */
export const loginTokens = sqliteTable(
  'login_tokens',
  {
    tokenHash: text('token_hash').primaryKey(),
    email: text('email').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    consumedAt: integer('consumed_at'),
  },
  (t) => ({
    emailIdx: index('login_tokens_email_idx').on(t.email),
  }),
);

/** Bearer tokens for surfaces that cannot produce Telegram initData (iOS
 * Shortcut, future PWA session). Only the SHA-256 hash is stored. */
export const deviceTokens = sqliteTable(
  'device_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    label: text('label'),
    createdAt: integer('created_at').notNull(),
    lastUsedAt: integer('last_used_at'),
    revokedAt: integer('revoked_at'),
  },
  (t) => ({
    hashIdx: uniqueIndex('device_tokens_hash_idx').on(t.tokenHash),
    userIdx: index('device_tokens_user_idx').on(t.userId),
  }),
);

export type DeviceTokenRow = typeof deviceTokens.$inferSelect;

export type MetricsRow = typeof metrics.$inferSelect;
export type AnalyticsCacheRow = typeof analyticsCache.$inferSelect;
export type UserActivityRow = typeof userActivity.$inferSelect;

/** Web push subscriptions: one per device that turned reminders on (see push/send.ts). */
export const pushSubscriptions = sqliteTable(
  'push_subscriptions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    createdAt: text('created_at').notNull(),
    lastOkAt: text('last_ok_at'),
    failCount: integer('fail_count').notNull().default(0),
    userAgent: text('user_agent'),
  },
  (t) => ({
    endpointIdx: uniqueIndex('push_subscriptions_endpoint_unique').on(t.endpoint),
    userIdx: index('push_subscriptions_user_idx').on(t.userId),
  }),
);

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
