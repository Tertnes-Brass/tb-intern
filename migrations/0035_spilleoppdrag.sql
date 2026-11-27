CREATE TABLE `project_crew` (
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`part_ids` text DEFAULT '[]' NOT NULL,
	`added_by` text,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `user_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`added_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `project_crew_user_idx` ON `project_crew` (`user_id`);--> statement-breakpoint
ALTER TABLE `projects` ADD `start_time` text;