-- Partitur skal finnes også i installasjoner med en delvis eller eldre seed.
INSERT OR IGNORE INTO `parts`
  (`id`, `sort_order`, `name_no`, `name_en`, `aliases`, `section`, `parent_id`)
VALUES
  ('score', 10, 'Partitur', 'Full Score', '["full score","score","partitur","conductor"]', 'score', NULL);
--> statement-breakpoint

-- Synkroniser canonical standardstemmer uten å endre navn, aliaser eller
-- referanser til eksisterende parts-rader.
UPDATE `parts`
SET
  `section` = CASE `id`
    WHEN 'score' THEN 'score'
    WHEN 'soprano-cornet' THEN 'cornet'
    WHEN 'solo-cornet' THEN 'cornet'
    WHEN 'repiano-cornet' THEN 'cornet'
    WHEN 'second-cornet' THEN 'cornet'
    WHEN 'third-cornet' THEN 'cornet'
    WHEN 'flugel' THEN 'horn'
    WHEN 'solo-horn' THEN 'horn'
    WHEN 'first-horn' THEN 'horn'
    WHEN 'second-horn' THEN 'horn'
    WHEN 'first-baritone' THEN 'euph-bari'
    WHEN 'second-baritone' THEN 'euph-bari'
    WHEN 'euphonium' THEN 'euph-bari'
    WHEN 'first-trombone' THEN 'trombone'
    WHEN 'second-trombone' THEN 'trombone'
    WHEN 'bass-trombone' THEN 'trombone'
    WHEN 'eb-bass' THEN 'tuba'
    WHEN 'bb-bass' THEN 'tuba'
    WHEN 'percussion-1' THEN 'perc'
    WHEN 'percussion-2' THEN 'perc'
    WHEN 'percussion-3' THEN 'perc'
    ELSE `section`
  END,
  `sort_order` = CASE `id`
    WHEN 'score' THEN 10
    WHEN 'soprano-cornet' THEN 20
    WHEN 'solo-cornet' THEN 30
    WHEN 'repiano-cornet' THEN 40
    WHEN 'second-cornet' THEN 50
    WHEN 'third-cornet' THEN 60
    WHEN 'flugel' THEN 70
    WHEN 'solo-horn' THEN 80
    WHEN 'first-horn' THEN 90
    WHEN 'second-horn' THEN 100
    WHEN 'first-baritone' THEN 110
    WHEN 'second-baritone' THEN 120
    WHEN 'euphonium' THEN 130
    WHEN 'first-trombone' THEN 140
    WHEN 'second-trombone' THEN 150
    WHEN 'bass-trombone' THEN 160
    WHEN 'eb-bass' THEN 170
    WHEN 'bb-bass' THEN 180
    WHEN 'percussion-1' THEN 190
    WHEN 'percussion-2' THEN 200
    WHEN 'percussion-3' THEN 210
    ELSE `sort_order`
  END
WHERE `id` IN (
  'score',
  'soprano-cornet',
  'solo-cornet',
  'repiano-cornet',
  'second-cornet',
  'third-cornet',
  'flugel',
  'solo-horn',
  'first-horn',
  'second-horn',
  'first-baritone',
  'second-baritone',
  'euphonium',
  'first-trombone',
  'second-trombone',
  'bass-trombone',
  'eb-bass',
  'bb-bass',
  'percussion-1',
  'percussion-2',
  'percussion-3'
);
--> statement-breakpoint

-- Issue #47 kan finnes som en egendefinert «Tuba»-stemme som tidligere fikk
-- standardseksjonen Kornetter. Flytt bare eksakte navne-/ID-treff.
UPDATE `parts`
SET `section` = 'tuba'
WHERE lower(trim(`id`)) = 'tuba'
   OR lower(trim(`name_no`)) = 'tuba'
   OR lower(trim(`name_en`)) = 'tuba';
--> statement-breakpoint

-- Alle øvrige egendefinerte stemmer i den utgåtte low/Grovmessing-seksjonen
-- beholdes og legges konservativt i Euph/Bari. De kan flyttes til Tuba i UI.
UPDATE `parts`
SET `section` = 'euph-bari'
WHERE `section` = 'low';
--> statement-breakpoint

-- Engangskorrigering for eksisterende dirigenter uten stemme. Roller og
-- stemmer forblir separate: dirigenter med en instrumentstemme endres ikke.
INSERT OR IGNORE INTO `user_parts` (`user_id`, `part_id`, `is_primary`)
SELECT `auth_user_id`, 'score', 1
FROM `member_profiles`
WHERE `role_id` = 'conductor'
  AND NOT EXISTS (
    SELECT 1
    FROM `user_parts`
    WHERE `user_parts`.`user_id` = `member_profiles`.`auth_user_id`
  );
--> statement-breakpoint

UPDATE `invitations`
SET `part_ids` = '["score"]'
WHERE `role_id` = 'conductor'
  AND trim(`part_ids`) = '[]';
