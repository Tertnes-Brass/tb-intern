CREATE TABLE `callout_responses` (
	`post_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`post_id`, `user_id`),
	FOREIGN KEY (`post_id`) REFERENCES `post_callouts`(`post_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `callout_responses_user_idx` ON `callout_responses` (`user_id`);--> statement-breakpoint
CREATE TABLE `post_callouts` (
	`post_id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`project_id` text,
	`event_date` text,
	`start_time` text,
	`location` text,
	`respond_by` text,
	`needed` integer,
	`closed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `post_callouts_project_idx` ON `post_callouts` (`project_id`);--> statement-breakpoint
CREATE INDEX `post_callouts_date_idx` ON `post_callouts` (`event_date`);