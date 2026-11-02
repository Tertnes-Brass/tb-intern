-- Systemrollen «Fraværsansvarlig» (id `attendance`): alt en musiker har
-- (`scores.view`) pluss `attendance.manage` — hele oppmøtelista, registrering
-- av fravær for andre og fraværsoversikten på /fravaer. Ingen prosjekt-,
-- medlems- eller admintilgang; det er nettopp derfor `attendance.manage` og
-- `calendar.manage` ble to rettigheter i #82.
--
-- Én rolle per medlem: en fraværsansvarlig som også sitter i styret, trenger en
-- egen rolle med begge rettighetene (rollematrisen i /innstillinger).
--
-- Lærdommen fra 0008/0011 (#78): sjekk NAVNET, ikke bare id-en. Finnes det
-- allerede en brukeropprettet rolle som heter «Fraværsansvarlig», legges
-- systemrollen ikke inn — da ville rollematrisen fått to like rader. Den
-- eksisterende rollen beholder rettighetene den har, og rettighetssetningene
-- under blir no-ops fordi de bare treffer `attendance`.
--
-- `INSERT ... SELECT ... FROM roles` (ikke VALUES) så migrasjonen også går
-- gjennom i en database der rollen ikke ble lagt inn. Trygg å kjøre om igjen.
INSERT OR IGNORE INTO `roles` (`id`, `name`, `is_system`)
SELECT 'attendance', 'Fraværsansvarlig', 1
WHERE NOT EXISTS (
  SELECT 1 FROM `roles` WHERE lower(trim(`name`)) IN ('fraværsansvarlig', 'fravaersansvarlig')
);
--> statement-breakpoint

INSERT OR IGNORE INTO `role_permissions` (`role_id`, `permission`)
SELECT `id`, 'scores.view' FROM `roles` WHERE `id` = 'attendance';
--> statement-breakpoint

INSERT OR IGNORE INTO `role_permissions` (`role_id`, `permission`)
SELECT `id`, 'attendance.manage' FROM `roles` WHERE `id` = 'attendance';
