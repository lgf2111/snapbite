CREATE TABLE `metrics` (
	`day` text NOT NULL,
	`name` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`day`, `name`)
);
--> statement-breakpoint
CREATE TABLE `user_activity` (
	`user_id` integer NOT NULL,
	`week` text NOT NULL,
	PRIMARY KEY(`user_id`, `week`)
);
