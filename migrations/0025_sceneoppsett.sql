CREATE TABLE `stage_setups` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`notes` text,
	`scene` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_by` text,
	`updated_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `stage_setups_project_idx` ON `stage_setups` (`project_id`,`created_at`);--> statement-breakpoint
-- `stage.manage` til alle roller som i dag kan forvalte prosjekter (arkivar og
-- dirigent i standardoppsettet): ingen som kunne sette opp slagverket før,
-- mister muligheten til å tegne sceneoppsettet nå. Rettigheten er likevel egen,
-- slik at en slagverksansvarlig eller materialforvalter kan få den uten å kunne
-- endre programmet. Administrator har `*` og trenger ingen rad. Skrevet som
-- SELECT, så migrasjonen også går gjennom i en database uten roller.
INSERT OR IGNORE INTO `role_permissions` (`role_id`, `permission`)
SELECT `role_id`, 'stage.manage' FROM `role_permissions` WHERE `permission` = 'projects.manage';
