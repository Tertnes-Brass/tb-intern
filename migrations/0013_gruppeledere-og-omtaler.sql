CREATE TABLE `leader_channel_reads` (
	`user_id` text NOT NULL,
	`channel` text NOT NULL,
	`last_read_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `channel`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `leader_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'custom' NOT NULL,
	`name` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `leader_channels_kind_idx` ON `leader_channels` (`kind`,`archived_at`);--> statement-breakpoint
CREATE TABLE `leader_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`channel` text NOT NULL,
	`author_id` text,
	`body` text NOT NULL,
	`reply_to_id` text,
	`reply_to_deleted` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reply_to_id`) REFERENCES `leader_messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `leader_messages_channel_idx` ON `leader_messages` (`channel`,`created_at`);--> statement-breakpoint
CREATE TABLE `post_comment_mentions` (
	`comment_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`comment_id`, `user_id`),
	FOREIGN KEY (`comment_id`) REFERENCES `post_comments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `post_comment_mentions_user_idx` ON `post_comment_mentions` (`user_id`);--> statement-breakpoint
ALTER TABLE `notification_preferences` ADD `mentions` text DEFAULT 'all' NOT NULL;