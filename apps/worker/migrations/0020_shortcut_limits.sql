ALTER TABLE `meals` ADD `photo_bytes` integer;--> statement-breakpoint
CREATE TABLE `token_usage` (
	`token_id` text NOT NULL,
	`hour_bucket` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`token_id`, `hour_bucket`)
);
