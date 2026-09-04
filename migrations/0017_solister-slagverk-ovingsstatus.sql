CREATE TABLE `project_work_practice` (
	`project_id` text NOT NULL,
	`work_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`comment` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `work_id`, `user_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`work_id`) REFERENCES `project_works`(`project_id`,`work_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_work_practice_user_idx` ON `project_work_practice` (`user_id`);--> statement-breakpoint
CREATE TABLE `project_work_soloists` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`work_id` text NOT NULL,
	`user_id` text,
	`external_name` text,
	`role` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`,`work_id`) REFERENCES `project_works`(`project_id`,`work_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_work_soloists_work_idx` ON `project_work_soloists` (`project_id`,`work_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `work_percussion` (
	`id` text PRIMARY KEY NOT NULL,
	`work_id` text NOT NULL,
	`instrument` text NOT NULL,
	`note` text,
	`part_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`work_id`) REFERENCES `works`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `work_percussion_work_idx` ON `work_percussion` (`work_id`,`sort_order`);