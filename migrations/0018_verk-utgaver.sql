CREATE TABLE `work_editions` (
	`id` text PRIMARY KEY NOT NULL,
	`work_id` text NOT NULL,
	`name` text NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`work_id`) REFERENCES `works`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `work_editions_work_idx` ON `work_editions` (`work_id`);--> statement-breakpoint
ALTER TABLE `project_works` ADD `edition_id` text REFERENCES work_editions(id);--> statement-breakpoint
ALTER TABLE `work_files` ADD `edition_id` text REFERENCES work_editions(id);--> statement-breakpoint
ALTER TABLE `works` ADD `current_edition_id` text;