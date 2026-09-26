CREATE TABLE `forum_reply_reads` (
	`user_id` text NOT NULL,
	`reply_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `reply_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reply_id`) REFERENCES `forum_replies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `forum_reply_reads_reply_idx` ON `forum_reply_reads` (`reply_id`);