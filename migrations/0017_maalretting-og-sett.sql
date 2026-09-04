CREATE TABLE `post_seen` (
	`post_id` text NOT NULL,
	`user_id` text NOT NULL,
	`seen_at` integer NOT NULL,
	PRIMARY KEY(`post_id`, `user_id`),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `post_seen_user_idx` ON `post_seen` (`user_id`);--> statement-breakpoint
CREATE TABLE `post_targets` (
	`post_id` text NOT NULL,
	`kind` text NOT NULL,
	`ref_id` text NOT NULL,
	PRIMARY KEY(`post_id`, `kind`, `ref_id`),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade
);
