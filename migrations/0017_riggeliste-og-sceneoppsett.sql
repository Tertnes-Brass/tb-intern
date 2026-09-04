-- Riggeliste (#12) og sceneoppsett (#11).
--
-- RENT ADDITIV: to CREATE TABLE og tre CREATE INDEX. Ingen DROP, ingen
-- tabell-rebuild (`__new_`), ingen datamigrering — og dermed ingenting som kan
-- cascade-slette i D1 (se AGENTS.md om tabell-rebuild).
--
-- INGEN rettighetsseeding, med vilje: begge funksjonene gjenbruker
-- `projects.manage` og `assets.manage`, som allerede er seedet. En egen
-- `rig.manage` ville betydd at både prosjektansvarlig og materialforvalteren
-- måtte be om en rettighet til for å bruke en sjekkliste.
--
-- Merk at `rig_items` bevisst mangler en CHECK på «nøyaktig én av project_id og
-- occurrence_key»: en CHECK kan ikke legges til senere uten rebuild, og
-- invarianten håndheves i `parseRigScope` (src/lib/rigg.ts) med tester.
CREATE TABLE `rig_items` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`occurrence_key` text,
	`asset_id` text,
	`name` text NOT NULL,
	`responsible_user_id` text,
	`responsible_name` text,
	`taken_at` integer,
	`taken_by` text,
	`returned_at` integer,
	`returned_by` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`occurrence_key`) REFERENCES `event_meta`(`occurrence_key`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`responsible_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`taken_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`returned_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `rig_items_project_idx` ON `rig_items` (`project_id`);--> statement-breakpoint
CREATE INDEX `rig_items_occurrence_idx` ON `rig_items` (`occurrence_key`);--> statement-breakpoint
CREATE INDEX `rig_items_asset_idx` ON `rig_items` (`asset_id`);--> statement-breakpoint
CREATE TABLE `stage_plots` (
	`project_id` text PRIMARY KEY NOT NULL,
	`layout` text NOT NULL,
	`note` text,
	`updated_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
