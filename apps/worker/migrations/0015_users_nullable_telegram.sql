-- Rebuild `users` so `telegram_user_id` can be NULL (browser/email accounts have
-- no Telegram identity). SQLite cannot drop NOT NULL in place, so this is the
-- create/copy/drop/rename rebuild.
--
-- WARNING: DROP TABLE on a parent is a DELETE. D1 enforces foreign keys and does
-- not let a migration turn that off (`PRAGMA foreign_keys = OFF` is ignored, and
-- `defer_foreign_keys` only postpones constraint checks, not ON DELETE CASCADE),
-- so dropping `users` deleted every meal, setting, token and session. The first
-- version of this file did exactly that. Preserving ids does not help: the rows
-- are gone before anything can point at them.
--
-- So the children are copied out first, with no foreign keys, and put back after
-- the swap. Order matters on the way back in: parents before their children.
-- `src/db/migrations.test.ts` replays this on a populated database.
CREATE TABLE `_bak_settings` AS SELECT * FROM `settings`;
--> statement-breakpoint
CREATE TABLE `_bak_meals` AS SELECT * FROM `meals`;
--> statement-breakpoint
CREATE TABLE `_bak_food_items` AS SELECT * FROM `food_items`;
--> statement-breakpoint
CREATE TABLE `_bak_nutrition` AS SELECT * FROM `nutrition`;
--> statement-breakpoint
CREATE TABLE `_bak_saved_meals` AS SELECT * FROM `saved_meals`;
--> statement-breakpoint
CREATE TABLE `_bak_sessions` AS SELECT * FROM `sessions`;
--> statement-breakpoint
CREATE TABLE `_bak_device_tokens` AS SELECT * FROM `device_tokens`;
--> statement-breakpoint
CREATE TABLE `users_new` (
	`id` text PRIMARY KEY NOT NULL,
	`telegram_user_id` integer,
	`email` text,
	`email_verified_at` integer,
	`created_at` integer NOT NULL,
	`last_broadcast_chat_id` integer,
	`last_broadcast_message_id` integer,
	`last_broadcast_at` integer,
	`last_broadcast_version` text
);
--> statement-breakpoint
INSERT INTO `users_new` (
	`id`, `telegram_user_id`, `email`, `email_verified_at`, `created_at`,
	`last_broadcast_chat_id`, `last_broadcast_message_id`, `last_broadcast_at`,
	`last_broadcast_version`
)
SELECT
	`id`, `telegram_user_id`, `email`, `email_verified_at`, `created_at`,
	`last_broadcast_chat_id`, `last_broadcast_message_id`, `last_broadcast_at`,
	`last_broadcast_version`
FROM `users`;
--> statement-breakpoint
DROP TABLE `users`;
--> statement-breakpoint
ALTER TABLE `users_new` RENAME TO `users`;
--> statement-breakpoint
CREATE UNIQUE INDEX `users_telegram_user_id_idx` ON `users` (`telegram_user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_idx` ON `users` (`email`);
--> statement-breakpoint
INSERT INTO `settings` SELECT * FROM `_bak_settings`;
--> statement-breakpoint
INSERT INTO `meals` SELECT * FROM `_bak_meals`;
--> statement-breakpoint
INSERT INTO `food_items` SELECT * FROM `_bak_food_items`;
--> statement-breakpoint
INSERT INTO `nutrition` SELECT * FROM `_bak_nutrition`;
--> statement-breakpoint
INSERT INTO `saved_meals` SELECT * FROM `_bak_saved_meals`;
--> statement-breakpoint
INSERT INTO `sessions` SELECT * FROM `_bak_sessions`;
--> statement-breakpoint
INSERT INTO `device_tokens` SELECT * FROM `_bak_device_tokens`;
--> statement-breakpoint
DROP TABLE `_bak_settings`;
--> statement-breakpoint
DROP TABLE `_bak_meals`;
--> statement-breakpoint
DROP TABLE `_bak_food_items`;
--> statement-breakpoint
DROP TABLE `_bak_nutrition`;
--> statement-breakpoint
DROP TABLE `_bak_saved_meals`;
--> statement-breakpoint
DROP TABLE `_bak_sessions`;
--> statement-breakpoint
DROP TABLE `_bak_device_tokens`;
