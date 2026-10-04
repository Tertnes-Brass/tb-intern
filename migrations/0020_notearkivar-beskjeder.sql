ALTER TABLE `posts` ADD `from_archive` integer DEFAULT false NOT NULL;
--> statement-breakpoint
INSERT OR IGNORE INTO `role_permissions` (`role_id`, `permission`)
SELECT `id`, 'posts.archive' FROM `roles` WHERE `id` = 'archivist';
