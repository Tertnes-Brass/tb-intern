CREATE TABLE `member_instruments` (
	`user_id` text NOT NULL,
	`part_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `part_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `member_profiles` ADD `interests` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `member_profiles` ADD `interests_note` text;--> statement-breakpoint
ALTER TABLE `member_profiles` ADD `other_instruments` text;