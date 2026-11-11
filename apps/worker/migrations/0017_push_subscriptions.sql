-- Web push subscriptions (one row per browser/device that turned reminders on).
-- `endpoint` is the push service URL and is unique: subscribing the same device
-- again updates its row instead of adding a second one. Rows go when the user
-- unsubscribes, when the push service says the subscription is gone (404/410),
-- after repeated failures, or when the account is deleted.
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`created_at` text NOT NULL,
	`last_ok_at` text,
	`fail_count` integer DEFAULT 0 NOT NULL,
	`user_agent` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);
--> statement-breakpoint
CREATE INDEX `push_subscriptions_user_idx` ON `push_subscriptions` (`user_id`);
