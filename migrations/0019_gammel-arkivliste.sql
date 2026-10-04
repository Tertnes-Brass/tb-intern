CREATE TABLE `legacy_archive_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`archive_number` text,
	`title` text NOT NULL,
	`composer` text,
	`arranger` text,
	`missing_parts` text,
	`last_checked` text,
	`category_code` text,
	`notes` text,
	`loaned_to` text,
	`marked_digitized` integer DEFAULT false NOT NULL,
	`source_row` integer NOT NULL,
	`source_data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `legacy_archive_number_idx` ON `legacy_archive_entries` (`archive_number`);--> statement-breakpoint
CREATE INDEX `legacy_archive_title_idx` ON `legacy_archive_entries` (`title`);