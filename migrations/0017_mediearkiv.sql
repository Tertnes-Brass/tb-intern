CREATE TABLE `media_items` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`recorded_on` text,
	`description` text,
	`visibility` text DEFAULT 'intern' NOT NULL,
	`project_id` text,
	`work_id` text,
	`r2_key` text NOT NULL,
	`file_name` text NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`content_type` text NOT NULL,
	`uploaded_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`work_id`) REFERENCES `works`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`uploaded_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `media_items_recorded_idx` ON `media_items` (`recorded_on`);--> statement-breakpoint
CREATE INDEX `media_items_project_idx` ON `media_items` (`project_id`);--> statement-breakpoint
CREATE INDEX `media_items_work_idx` ON `media_items` (`work_id`);--> statement-breakpoint
-- ============================================================================
-- Håndskrevet datasteg (#32). Rent additivt: kun INSERT OR IGNORE ... SELECT.
--
-- `INSERT OR IGNORE` alene dekker ikke fremmednøkler — derfor SELECT fra
-- `roles` i stedet for en VALUES-liste, slik at migrasjonen også går gjennom i
-- en database uten seedede roller (samme mønster som 0008/0009/0016, se
-- AGENTS.md). Ingen rad velges der rollen ikke finnes.
-- ============================================================================
-- Rettigheten `media.manage` gater ALL skriving i mediearkivet. Admin har `*`
-- fra før og trenger den ikke teknisk — raden finnes for rollematrisen i
-- /innstillinger, slik at avkryssingen viser sannheten. Styret får den fordi
-- det er styret og dirigenten som faktisk sitter med konsertopptakene.
--
-- Lesing seedes IKKE: `intern` og `offentlig-kandidat` leses av alle aktive
-- medlemmer uten noen rettighet, og `styre` henger på `board.manage`, som
-- allerede finnes.
INSERT OR IGNORE INTO `role_permissions` (`role_id`, `permission`)
SELECT `id`, 'media.manage' FROM `roles` WHERE `id` = 'admin';
--> statement-breakpoint
INSERT OR IGNORE INTO `role_permissions` (`role_id`, `permission`)
SELECT `id`, 'media.manage' FROM `roles` WHERE `id` = 'board';