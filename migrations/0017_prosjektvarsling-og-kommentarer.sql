CREATE TABLE `project_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`subject` text,
	`detail` text,
	`actor_user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `project_changes_project_idx` ON `project_changes` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `project_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`parent_id` text,
	`author_id` text,
	`body` text NOT NULL,
	`resolved_at` integer,
	`resolved_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `project_comments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`resolved_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `project_comments_project_idx` ON `project_comments` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `project_comments_parent_idx` ON `project_comments` (`parent_id`);--> statement-breakpoint
CREATE TABLE `project_notifications` (
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`sent_at` integer NOT NULL,
	`outcome` text NOT NULL,
	PRIMARY KEY(`project_id`, `user_id`, `kind`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `notification_preferences` ADD `projects` text DEFAULT 'all' NOT NULL;