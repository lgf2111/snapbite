-- Billing: credits, entitlement, metering and Stripe event log.
-- Additive only. Billing rows deliberately have no foreign key to users: deleting
-- an account must not erase purchase history or let a re-created account claim a
-- second trial.

CREATE TABLE `billing_accounts` (
	`email` text PRIMARY KEY NOT NULL,
	`stripe_customer_id` text,
	`credits` integer DEFAULT 0 NOT NULL,
	`supporter_since` integer,
	`trial_granted_at` integer,
	`trial_until` integer,
	`overflow_enabled` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `credit_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`delta` integer NOT NULL,
	`reason` text NOT NULL,
	`meal_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `credit_ledger_email_created_idx` ON `credit_ledger` (`email`, `created_at`);
--> statement-breakpoint
CREATE TABLE `ai_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`email` text,
	`provider` text,
	`model` text,
	`tokens_in` integer,
	`tokens_out` integer,
	`cost_micros` integer,
	`latency_ms` integer,
	`ok` integer NOT NULL,
	`kind` text,
	`request_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_usage_created_idx` ON `ai_usage` (`created_at`);
--> statement-breakpoint
CREATE INDEX `ai_usage_user_created_idx` ON `ai_usage` (`user_id`, `created_at`);
--> statement-breakpoint
CREATE TABLE `billing_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`received_at` integer NOT NULL,
	`applied_at` integer,
	`payload_hash` text
);
--> statement-breakpoint
ALTER TABLE `users` ADD `plan` text DEFAULT 'free' NOT NULL;
