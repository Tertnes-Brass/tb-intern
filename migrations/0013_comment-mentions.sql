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