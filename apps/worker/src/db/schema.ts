import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/** Application users, keyed to a Telegram user id. */
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    telegramUserId: integer('telegram_user_id').notNull(),
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

export type UserRow = typeof users.$inferSelect;
export type SettingsRow = typeof settings.$inferSelect;
export type MealRow = typeof meals.$inferSelect;
export type FoodItemRow = typeof foodItems.$inferSelect;
export type NutritionRow = typeof nutrition.$inferSelect;
export type ErrorLogRow = typeof errorLogs.$inferSelect;
export type FeedbackRow = typeof feedback.$inferSelect;
