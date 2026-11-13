-- One advanced report per (user, range), valid for the user's local day.
-- Rows are deleted by every meal write, so opening Reports twice does not
-- recompute the report; the next meal (even a bot/Shortcut one) rebuilds it.
CREATE TABLE `analytics_cache` (
	`user_id` text NOT NULL,
	`range` text NOT NULL,
	`computed_at` integer NOT NULL,
	`payload_json` text NOT NULL,
	PRIMARY KEY(`user_id`, `range`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
