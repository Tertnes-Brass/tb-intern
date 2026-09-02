CREATE TABLE `asset_images` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`file_name` text NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`content_type` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`uploaded_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `asset_images_asset_idx` ON `asset_images` (`asset_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `asset_projects` (
	`asset_id` text NOT NULL,
	`project_id` text NOT NULL,
	`usage` text DEFAULT 'planned' NOT NULL,
	`note` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`asset_id`, `project_id`),
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `asset_projects_project_idx` ON `asset_projects` (`project_id`);--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text,
	`manufacturer` text,
	`model` text,
	`serial_number` text,
	`owner_kind` text DEFAULT 'band' NOT NULL,
	`owner_user_id` text,
	`owner_name` text,
	`loaned_from` text,
	`loan_from` text,
	`loan_until` text,
	`notes` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `assets_name_idx` ON `assets` (`name`);--> statement-breakpoint
CREATE INDEX `assets_category_idx` ON `assets` (`category`);--> statement-breakpoint
CREATE TABLE `event_projects` (
	`occurrence_key` text NOT NULL,
	`project_id` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`occurrence_key`, `project_id`),
	FOREIGN KEY (`occurrence_key`) REFERENCES `event_meta`(`occurrence_key`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `event_projects_project_idx` ON `event_projects` (`project_id`);--> statement-breakpoint
CREATE TABLE `invitation_roles` (
	`email` text NOT NULL,
	`role_id` text NOT NULL,
	PRIMARY KEY(`email`, `role_id`),
	FOREIGN KEY (`email`) REFERENCES `invitations`(`email`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `member_instruments` (
	`user_id` text NOT NULL,
	`part_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `part_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `member_roles` (
	`auth_user_id` text NOT NULL,
	`role_id` text NOT NULL,
	PRIMARY KEY(`auth_user_id`, `role_id`),
	FOREIGN KEY (`auth_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `member_roles_role_idx` ON `member_roles` (`role_id`);--> statement-breakpoint
CREATE TABLE `project_times` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text DEFAULT 'annet' NOT NULL,
	`label` text,
	`date` text NOT NULL,
	`time` text,
	`location` text,
	`audience` text DEFAULT 'alle' NOT NULL,
	`note` text,
	`responsible_user_id` text,
	`responsible_name` text,
	`contact_phone` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`responsible_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `project_times_project_idx` ON `project_times` (`project_id`,`date`,`time`);--> statement-breakpoint
ALTER TABLE `event_meta` ADD `location_name` text;--> statement-breakpoint
ALTER TABLE `event_meta` ADD `location_address` text;--> statement-breakpoint
ALTER TABLE `event_meta` ADD `map_url` text;--> statement-breakpoint
ALTER TABLE `event_meta` ADD `meetup_crew` text;--> statement-breakpoint
ALTER TABLE `event_meta` ADD `meetup_musicians` text;--> statement-breakpoint
ALTER TABLE `event_meta` ADD `conductor` text;--> statement-breakpoint
ALTER TABLE `event_meta` ADD `keyholder` text;--> statement-breakpoint
ALTER TABLE `event_meta` ADD `crew` text;--> statement-breakpoint
ALTER TABLE `event_meta` ADD `substitutes` text;--> statement-breakpoint
ALTER TABLE `event_meta` ADD `practical_note` text;--> statement-breakpoint
ALTER TABLE `member_profiles` ADD `interests` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `member_profiles` ADD `interests_note` text;--> statement-breakpoint
ALTER TABLE `member_profiles` ADD `other_instruments` text;--> statement-breakpoint
-- ============================================================================
-- Håndskrevne datasteg (squashet fra grenene for #48, #13 og #9/#10/#29).
-- Alle er INSERT OR IGNORE ... SELECT: FK-trygge per konstruksjon (kilden er
-- selv en NOT NULL-fremmednøkkel eller INNER JOIN-et mot måltabellen),
-- idempotente ved gjenkjøring, og en tom database velger ingenting.
-- ============================================================================
-- #48: dagens énrolle-data inn i koblingstabellene. Ingen eksisterende medlem
-- mister en tilgang: hver rad er nøyaktig den rollen medlemmet hadde fra før.
-- `member_profiles.role_id`/`invitations.role_id` blir stående (deprecated);
-- `currentUser()` faller tilbake på dem for kontoer skapt i vinduet mellom
-- migrasjon og deploy.
INSERT OR IGNORE INTO `member_roles` (`auth_user_id`, `role_id`)
SELECT `auth_user_id`, `role_id` FROM `member_profiles`;
--> statement-breakpoint
INSERT OR IGNORE INTO `invitation_roles` (`email`, `role_id`)
SELECT `email`, `role_id` FROM `invitations`;
--> statement-breakpoint
-- #13: rettigheten `assets.manage` til admin (for rollematrisens skyld — admin
-- har `*`) og styret. Lesing av registeret krever ingen rettighet.
INSERT OR IGNORE INTO `role_permissions` (`role_id`, `permission`)
SELECT `id`, 'assets.manage' FROM `roles` WHERE `id` = 'admin';
--> statement-breakpoint
INSERT OR IGNORE INTO `role_permissions` (`role_id`, `permission`)
SELECT `id`, 'assets.manage' FROM `roles` WHERE `id` = 'board';
--> statement-breakpoint
-- #10: den gamle 1:1-prosjektkoblingen på øvinger inn i n:m-tabellen.
-- INNER JOIN mot `projects`: en migrasjon skal ikke stole på at FK-en holdt.
-- Kolonnen `linked_project_id` blir stående (utgått, ingen leser den) —
-- DROP COLUMN er en tabell-rebuild som i D1 cascader til barnetabellene.
INSERT OR IGNORE INTO `event_projects` (`occurrence_key`, `project_id`, `created_by`, `created_at`)
SELECT `m`.`occurrence_key`, `m`.`linked_project_id`, `m`.`created_by`, `m`.`created_at`
FROM `event_meta` `m`
INNER JOIN `projects` `p` ON `p`.`id` = `m`.`linked_project_id`
WHERE `m`.`linked_project_id` IS NOT NULL;
