ALTER TABLE `users` ADD `email` text;
--> statement-breakpoint
ALTER TABLE `users` ADD `email_verified_at` integer;
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_idx` ON `users` (`email`);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_idx` ON `sessions` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);
--> statement-breakpoint
CREATE TABLE `login_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer
);
--> statement-breakpoint
CREATE INDEX `login_tokens_email_idx` ON `login_tokens` (`email`);
