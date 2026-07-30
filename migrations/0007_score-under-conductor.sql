-- Partitur er en visuell understemme av Dirigent. Koblingen er betinget fordi
-- eldre/ferske installasjoner kan mangle den egendefinerte conductor-raden.
-- Tilgang til partitur styres fortsatt separat av scores.view.
UPDATE `parts`
SET `parent_id` = 'conductor'
WHERE `id` = 'score'
  AND EXISTS (
    SELECT 1
    FROM `parts` AS `parent`
    WHERE `parent`.`id` = 'conductor'
      AND `parent`.`parent_id` IS NULL
  );
