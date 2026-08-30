-- Rollen «Styremedlem» skal finnes også i installasjoner som allerede er
-- seedet: seedBaseConfig fyller bare roller i en helt tom database.
-- Rettighetene er inntil videre de samme som Musiker har (scores.view); egne
-- styrerettigheter kommer med Beskjeder (fase 2) og Styre (fase 3).
INSERT OR IGNORE INTO `roles` (`id`, `name`, `is_system`) VALUES ('board', 'Styremedlem', 1);
--> statement-breakpoint

INSERT OR IGNORE INTO `role_permissions` (`role_id`, `permission`) VALUES ('board', 'scores.view');
