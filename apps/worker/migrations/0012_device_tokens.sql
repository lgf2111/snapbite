CREATE TABLE `device_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`label` text,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_tokens_hash_idx` ON `device_tokens` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `device_tokens_user_idx` ON `device_tokens` (`user_id`);
