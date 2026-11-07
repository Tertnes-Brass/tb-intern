CREATE TABLE `band_media` (
	`id` text PRIMARY KEY NOT NULL,
	`r2_key` text NOT NULL,
	`title` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`added_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`added_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `band_media_created_idx` ON `band_media` (`created_at`);
--> statement-breakpoint
INSERT OR IGNORE INTO role_permissions (role_id, permission)
SELECT id, 'gifs.manage' FROM roles WHERE id = 'board';
