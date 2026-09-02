-- Flere roller per medlem (#48). RENT ADDITIV: to nye tabeller, én indeks og en
-- backfill som bare LEGGER TIL rader. Ingen ALTER, ingen DROP, ingen
-- tabell-rebuild (`__new_`-mønsteret) — en rebuild ville i D1 cascadet til
-- barnetabellene inne i transaksjonen, der `PRAGMA foreign_keys=OFF` er en
-- no-op (se AGENTS.md).
--
-- `member_profiles.role_id` og `invitations.role_id` blir STÅENDE urørt. De er
-- deprecated fra og med denne migrasjonen — all lesing går over til
-- koblingstabellene — men kolonnene er NOT NULL uten standardverdi og kan ikke
-- fjernes uten nettopp den rebuilden vi ikke gjør. Skrivestien holder dem i takt
-- med hovedrollen, og `currentUser()` faller tilbake på `member_profiles.role_id`
-- for et medlem uten koblingsrader: mellom denne migrasjonen og deployen kjører
-- fortsatt gammel kode, og en konto som opprettes i det vinduet får bare den
-- gamle kolonnen. Fallbacken gjør vinduet ufarlig.
CREATE TABLE `invitation_roles` (
	`email` text NOT NULL,
	`role_id` text NOT NULL,
	PRIMARY KEY(`email`, `role_id`),
	FOREIGN KEY (`email`) REFERENCES `invitations`(`email`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action
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
CREATE INDEX `member_roles_role_idx` ON `member_roles` (`role_id`);
--> statement-breakpoint
-- Backfill: dagens énrolle-data inn i koblingstabellen. `INSERT ... SELECT` fra
-- kildetabellen, ikke `VALUES` — begge kildekolonnene er NOT NULL-fremmednøkler
-- mot `roles`, så hver rad som velges er FK-trygg per konstruksjon, og i en tom
-- database velges ingenting i stedet for at setningen feiler (samme grunn som i
-- 0011/0015). `OR IGNORE` gjør steget idempotent: kjøres migrasjonen om igjen,
-- eller har skrivestien allerede lagt inn raden, skjer ingenting.
-- Ingen eksisterende medlem mister en tilgang: hver rad her er nøyaktig den
-- rollen medlemmet hadde fra før.
INSERT OR IGNORE INTO `member_roles` (`auth_user_id`, `role_id`)
SELECT `auth_user_id`, `role_id` FROM `member_profiles`;
--> statement-breakpoint
-- Samme for invitasjoner som ennå ikke er tatt i bruk, OG for dem som er det:
-- rollematrisen teller begge i «i bruk», og `deleteRole` nekter å slette en
-- rolle så lenge en invitasjon peker på den. Utelot vi de aksepterte, ville
-- tellingen og slettevakten svart forskjellig før og etter migrasjonen.
INSERT OR IGNORE INTO `invitation_roles` (`email`, `role_id`)
SELECT `email`, `role_id` FROM `invitations`;
