CREATE TABLE `forum_replies` (
	`id` text PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL,
	`author_id` text,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `forum_topics`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `forum_replies_topic_idx` ON `forum_replies` (`topic_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `forum_topics` (
	`id` text PRIMARY KEY NOT NULL,
	`author_id` text,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`locked` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`activity_at` integer NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `forum_topics_activity_idx` ON `forum_topics` (`activity_at`);
--> statement-breakpoint
INSERT OR IGNORE INTO role_permissions (role_id, permission)
SELECT id, 'forum.moderate' FROM roles WHERE id = 'board';
