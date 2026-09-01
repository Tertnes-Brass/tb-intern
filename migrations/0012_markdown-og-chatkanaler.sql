CREATE TABLE `board_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'custom' NOT NULL,
	`name` text NOT NULL,
	`board_project_id` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`board_project_id`) REFERENCES `board_projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `board_channels_kind_idx` ON `board_channels` (`kind`,`archived_at`);--> statement-breakpoint
-- drizzle-kit skriver ikke ON DELETE i ADD COLUMN; lagt til for hånd så sletting
-- av en melding med svar nullstiller referansen i stedet for å feile på FK-en.
ALTER TABLE `board_messages` ADD `reply_to_id` text REFERENCES board_messages(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `board_messages` ADD `reply_to_deleted` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `posts` ADD `format` text DEFAULT 'plain_text' NOT NULL;