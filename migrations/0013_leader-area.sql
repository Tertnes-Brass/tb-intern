-- Gruppelederområdet (#81): tre helt nye tabeller, ingen ALTER og ingen rebuild.
-- `leader_messages.reply_to_id` har ON DELETE SET NULL — i en CREATE TABLE
-- skriver drizzle-kit klausulen selv (det er i ADD COLUMN den faller bort, jf.
-- 0012). Uten den ville sletting av en melding med svar feilet på fremmednøkkelen
-- i D1, der `PRAGMA foreign_keys` er PÅ.
CREATE TABLE `leader_channel_reads` (
	`user_id` text NOT NULL,
	`channel` text NOT NULL,
	`last_read_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `channel`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `leader_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'custom' NOT NULL,
	`name` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `leader_channels_kind_idx` ON `leader_channels` (`kind`,`archived_at`);--> statement-breakpoint
CREATE TABLE `leader_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`channel` text NOT NULL,
	`author_id` text,
	`body` text NOT NULL,
	`reply_to_id` text,
	`reply_to_deleted` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reply_to_id`) REFERENCES `leader_messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `leader_messages_channel_idx` ON `leader_messages` (`channel`,`created_at`);