CREATE TABLE `food_items` (
	`id` text PRIMARY KEY NOT NULL,
	`meal_id` text NOT NULL,
	`name` text NOT NULL,
	`estimated_weight_g` real,
	`portion` text,
	`quantity` real DEFAULT 1 NOT NULL,
	`confidence` real,
	FOREIGN KEY (`meal_id`) REFERENCES `meals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `food_items_meal_idx` ON `food_items` (`meal_id`);--> statement-breakpoint
CREATE INDEX `food_items_name_idx` ON `food_items` (`name`);--> statement-breakpoint
CREATE TABLE `meals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`telegram_file_id` text,
	`notes` text,
	`confidence` real,
	`created_at` integer NOT NULL,
	`logged_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `meals_user_logged_idx` ON `meals` (`user_id`,`logged_at`);--> statement-breakpoint
CREATE TABLE `nutrition` (
	`meal_id` text PRIMARY KEY NOT NULL,
	`energy_kcal` real NOT NULL,
	`protein_g` real NOT NULL,
	`carbs_g` real NOT NULL,
	`fat_g` real NOT NULL,
	`source` text NOT NULL,
	FOREIGN KEY (`meal_id`) REFERENCES `meals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`ai_provider` text DEFAULT 'deepseek' NOT NULL,
	`api_key_ciphertext` text,
	`api_key_iv` text,
	`preferences_json` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`telegram_user_id` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_telegram_user_id_idx` ON `users` (`telegram_user_id`);