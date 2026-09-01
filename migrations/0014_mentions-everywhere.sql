CREATE TABLE `post_mentions` (
	`post_id` text NOT NULL,
	`user_id` text NOT NULL,
	`notified_at` integer,
	PRIMARY KEY(`post_id`, `user_id`),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `post_mentions_user_idx` ON `post_mentions` (`user_id`);