CREATE TABLE `social_events` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`location` text,
	`starts_at` integer NOT NULL,
	`signup_deadline` integer,
	`capacity` integer,
	`host_user_id` text,
	`cancelled_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`host_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `social_events_start_idx` ON `social_events` (`starts_at`);--> statement-breakpoint
CREATE INDEX `social_events_host_idx` ON `social_events` (`host_user_id`);--> statement-breakpoint
CREATE TABLE `social_signups` (
	`social_event_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`comment` text,
	`attending_since` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`social_event_id`, `user_id`),
	FOREIGN KEY (`social_event_id`) REFERENCES `social_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `social_signups_user_idx` ON `social_signups` (`user_id`);--> statement-breakpoint
CREATE INDEX `social_signups_queue_idx` ON `social_signups` (`social_event_id`,`attending_since`);