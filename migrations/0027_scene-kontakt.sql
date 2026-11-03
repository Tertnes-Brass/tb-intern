-- Kontaktperson på sceneoppsettet (navn, e-post, telefon) — kommer med i
-- PDF-en til arrangøren. Rene ADD COLUMN, nullbare: eksisterende oppsett er
-- uendret og har bare ingen kontaktperson før noen fyller den inn.
--
-- NB: fila heter 0027, men er nr. 28 i journalen (etter 0027_forum-varsler).
-- Begge 0027-filene ble anvendt på staging under disse navnene, og wrangler
-- husker migrasjoner på filnavn — et nytt navn ville kjørt ADD COLUMN på nytt
-- og feilet. Ikke gi den nytt navn.
ALTER TABLE `stage_setups` ADD `contact_name` text;--> statement-breakpoint
ALTER TABLE `stage_setups` ADD `contact_email` text;--> statement-breakpoint
ALTER TABLE `stage_setups` ADD `contact_phone` text;
