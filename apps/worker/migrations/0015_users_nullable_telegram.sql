-- Rebuild `users` so `telegram_user_id` can be NULL (browser/email accounts have
-- no Telegram identity). SQLite cannot drop NOT NULL in place, so this is the
-- standard create/copy/drop/rename rebuild. Child tables reference `users.id`
-- by value, and every copied id is preserved, so their foreign keys still
-- resolve after the rename.
--
-- `PRAGMA defer_foreign_keys` keeps the copy legal while the old table is
-- dropped; it resets automatically at the end of the migration transaction.
PRAGMA defer_foreign_keys = ON;
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
