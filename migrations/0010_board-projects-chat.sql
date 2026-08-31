CREATE TABLE `board_channel_reads` (
	`user_id` text NOT NULL,
	`channel` text NOT NULL,
	`last_read_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `channel`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `board_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`channel` text NOT NULL,
	`author_id` text,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `board_messages_channel_idx` ON `board_messages` (`channel`,`created_at`);--> statement-breakpoint
CREATE TABLE `board_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`goal` text,
	`owner_user_id` text,
	`due_date` text,
	`status` text DEFAULT 'active' NOT NULL,
	`linked_project_id` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`linked_project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `board_projects_status_idx` ON `board_projects` (`status`);--> statement-breakpoint
ALTER TABLE `board_meetings` ADD `agenda` text;--> statement-breakpoint
ALTER TABLE `board_meetings` ADD `decisions` text;--> statement-breakpoint
ALTER TABLE `board_tasks` ADD `board_project_id` text REFERENCES board_projects(id);