import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/** Application users, keyed to a Telegram user id. */
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    telegramUserId: integer('telegram_user_id').notNull(),
    createdAt: integer('created_at').notNull(),
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
  aiProvider: text('ai_provider').notNull().default('deepseek'),
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

export type UserRow = typeof users.$inferSelect;
export type SettingsRow = typeof settings.$inferSelect;
export type MealRow = typeof meals.$inferSelect;
export type FoodItemRow = typeof foodItems.$inferSelect;
export type NutritionRow = typeof nutrition.$inferSelect;
