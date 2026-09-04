CREATE TABLE `part_shares` (
	`from_user_id` text NOT NULL,
	`to_user_id` text NOT NULL,
	`part_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`from_user_id`, `to_user_id`, `part_id`),
	FOREIGN KEY (`from_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `part_shares_to_idx` ON `part_shares` (`to_user_id`);