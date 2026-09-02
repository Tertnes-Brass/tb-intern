-- Oppkjøring og tidsplan (#9 + #10 + #29). Ren additiv migrasjon: to nye
-- tabeller, ti nye kolonner på `event_meta`, og én INSERT som flytter den gamle
-- 1:1-prosjektkoblingen over i den nye n:m-tabellen. Ingen DROP, ingen DELETE,
-- ingen tabell-rebuild — ingen eksisterende rad endres eller slettes.
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
-- Håndskrevet: flytter den gamle 1:1-koblingen `event_meta.linked_project_id`
-- inn i `event_projects`. Uten dette ville hver øving som ALLEREDE peker på en
-- konsert mistet koblingen i det koden begynner å lese den nye tabellen.
--
-- INNER JOIN mot `projects`: en kobling til et prosjekt som ikke finnes ville
-- brutt fremmednøkkelen og veltet hele migrasjonen. Kolonnen er `ON DELETE SET
-- NULL`, så det skal ikke kunne skje — men en migrasjon er feil sted å stole
-- på det. `OR IGNORE` dekker uansett ikke FK-brudd (se 0015).
--
-- Kolonnen `linked_project_id` blir stående (utgått, ingen leser den):
-- `DROP COLUMN` er en tabell-rebuild i SQLite, og en rebuild i D1 cascader til
-- `event_setlist`/`event_attendance`/`event_projects` og sletter dem i
-- stillhet. Se AGENTS.md.
INSERT OR IGNORE INTO `event_projects` (`occurrence_key`, `project_id`, `created_by`, `created_at`)
SELECT `m`.`occurrence_key`, `m`.`linked_project_id`, `m`.`created_by`, `m`.`created_at`
FROM `event_meta` `m`
INNER JOIN `projects` `p` ON `p`.`id` = `m`.`linked_project_id`
WHERE `m`.`linked_project_id` IS NOT NULL;
