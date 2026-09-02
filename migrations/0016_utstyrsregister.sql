-- Utstyrsregister / asset-tracking (#13). Ren additiv migrasjon: tre nye
-- tabeller og én ny rettighet. Ingen ALTER, ingen tabell-rebuild
-- (`__new_`-mønsteret), ingen DROP, ingen DELETE — ingen eksisterende rad røres.
--
-- Tabellene opprettes i FK-rekkefølge (`assets` først), slik at migrasjonen er
-- gyldig uansett hvordan D1 håndhever fremmednøkler under kjøringen. Det er
-- samme rekkefølgeregel som i 0015; drizzle-kit sorterer alfabetisk og la
-- barnetabellene først.
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
-- Rettigheten til eksisterende installasjoner (prod seedes ikke av seg selv).
-- Skrives via SELECT fra `roles` slik at en tom database (der rollene ennå ikke
-- er seedet) ikke bryter fremmednøkkelen — `OR IGNORE` dekker ikke FK-brudd.
--
-- LESING av registeret krever ingen rettighet: alle aktive medlemmer ser hva
-- korpset har og hvem som eier det. `assets.manage` gater kun skriving.
--
-- Administrator har `*` og trenger strengt tatt ingen rad; den skrives likevel
-- slik at rollematrisen i /innstillinger viser rettigheten som avkrysset for
-- den rollen som faktisk forvalter den. Styremedlem får den fordi
-- materialforvalteren som regel sitter i styret — men rettigheten er egen
-- nettopp for at hen skal kunne få den ALENE, uten resten av styretilgangen.
INSERT OR IGNORE INTO `role_permissions` (`role_id`, `permission`)
SELECT `id`, 'assets.manage' FROM `roles` WHERE `id` = 'admin';
--> statement-breakpoint
INSERT OR IGNORE INTO `role_permissions` (`role_id`, `permission`)
SELECT `id`, 'assets.manage' FROM `roles` WHERE `id` = 'board';
