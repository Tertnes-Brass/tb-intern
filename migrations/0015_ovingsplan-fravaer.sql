-- Øvingsplan og oppmøte (#82 + #24). Ren additiv migrasjon: tre nye tabeller,
-- ingen ALTER, ingen tabell-rebuild — ingen eksisterende rad røres.
-- Tabellene opprettes i FK-rekkefølge (event_meta først), så migrasjonen er
-- gyldig uansett hvordan D1 håndhever fremmednøkler under kjøringen.
CREATE TABLE `event_meta` (
	`occurrence_key` text PRIMARY KEY NOT NULL,
	`uid` text NOT NULL,
	`summary` text NOT NULL,
	`start` integer NOT NULL,
	`linked_project_id` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`linked_project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `event_meta_uid_idx` ON `event_meta` (`uid`);
--> statement-breakpoint
CREATE TABLE `event_setlist` (
	`id` text PRIMARY KEY NOT NULL,
	`occurrence_key` text NOT NULL,
	`work_id` text,
	`custom_title` text,
	`note` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`occurrence_key`) REFERENCES `event_meta`(`occurrence_key`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`work_id`) REFERENCES `works`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `event_setlist_key_idx` ON `event_setlist` (`occurrence_key`,`sort_order`);
--> statement-breakpoint
CREATE TABLE `event_attendance` (
	`occurrence_key` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`comment` text,
	`source` text DEFAULT 'self' NOT NULL,
	`registered_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`occurrence_key`, `user_id`),
	FOREIGN KEY (`occurrence_key`) REFERENCES `event_meta`(`occurrence_key`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`registered_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `event_attendance_user_idx` ON `event_attendance` (`user_id`);
--> statement-breakpoint
-- Rettigheter til eksisterende installasjoner (prod seedes ikke av seg selv).
-- Skrives via SELECT fra `roles` slik at en tom database (der rollene ennå ikke
-- er seedet) ikke bryter fremmednøkkelen — OR IGNORE dekker ikke FK-brudd.
-- Dirigenten eier øvingsplanen og fraværet fra dag én; andre roller kan få
-- rettighetene i rollematrisen. Administrator har `*` og trenger ingen rad.
INSERT OR IGNORE INTO `role_permissions` (`role_id`, `permission`)
SELECT `id`, 'calendar.manage' FROM `roles` WHERE `id` = 'conductor';
--> statement-breakpoint
INSERT OR IGNORE INTO `role_permissions` (`role_id`, `permission`)
SELECT `id`, 'attendance.manage' FROM `roles` WHERE `id` = 'conductor';
