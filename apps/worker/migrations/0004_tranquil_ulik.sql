CREATE TABLE `error_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`telegram_user_id` integer,
	`source` text NOT NULL,
	`kind` text NOT NULL,
	`status` integer,
	`message` text NOT NULL,
	`detail` text
);
--> statement-breakpoint
CREATE INDEX `error_logs_created_at_idx` ON `error_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`telegram_user_id` integer,
	`source` text NOT NULL,
	`message` text NOT NULL,
	`handled` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `feedback_created_at_idx` ON `feedback` (`created_at`);