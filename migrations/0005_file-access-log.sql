ALTER TABLE `download_log` ADD `access_type` text DEFAULT 'download' NOT NULL;--> statement-breakpoint
CREATE INDEX `download_log_user_dedupe_idx` ON `download_log` (`work_file_id`,`access_type`,`user_id`,`at`);--> statement-breakpoint
CREATE INDEX `download_log_share_dedupe_idx` ON `download_log` (`work_file_id`,`access_type`,`share_link_id`,`at`);