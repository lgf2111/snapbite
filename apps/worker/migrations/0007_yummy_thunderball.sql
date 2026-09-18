CREATE TABLE `pending_photo_retries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`telegram_user_id` integer NOT NULL,
	`chat_id` integer NOT NULL,
	`status_message_id` integer,
	`file_id` text NOT NULL,
	`caption` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`next_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pending_photo_retries_next_at_idx` ON `pending_photo_retries` (`next_at`);