-- Slår sammen de to «Styremedlem»-rollene (#78).
--
-- Migrasjon `0008_board-role.sql` la inn systemrollen `board` («Styremedlem»)
-- og sjekket bare rolle-ID-en. I prod fantes det allerede en brukeropprettet
-- rolle med ID `styremedlem` og nøyaktig samme visningsnavn, så rollematrisen
-- endte med to visuelt identiske rader med ulike rettigheter. Den gamle rollen
-- kunne ikke slettes i /innstillinger, fordi `deleteRole` med rette stopper når
-- invitasjoner fortsatt peker på rollen.
--
-- Rekkefølgen er ikke valgfri: `invitations.role_id` og `member_profiles.role_id`
-- har fremmednøkler UTEN `ON DELETE`, så alt må flyttes før rollen slettes.
--
-- Rettighetene flyttes med. Den gamle rollen hadde `archive.viewAll`, som
-- systemrollen `board` ikke har — den tas bevisst med, slik at styret ikke
-- mister arkivinnsynet det har hatt. Rettigheter `board` allerede har,
-- påvirkes ikke (`INSERT OR IGNORE`), og ingen annen rolle røres.
--
-- Alt er gated på at den brukeropprettede rollen faktisk finnes
-- (`is_system = 0`): i en database uten kollisjonen — en fersk installasjon,
-- eller etter at migrasjonen har kjørt én gang — er hver setning en no-op.
-- Migrasjonen er derfor trygg å kjøre om igjen.

-- Invitasjoner: flytt til systemrollen før den gamle rollen kan slettes.
UPDATE `invitations`
SET `role_id` = 'board'
WHERE `role_id` = 'styremedlem'
  AND EXISTS (SELECT 1 FROM `roles` WHERE `id` = 'styremedlem' AND `is_system` = 0)
  AND EXISTS (SELECT 1 FROM `roles` WHERE `id` = 'board');
--> statement-breakpoint

-- Medlemmer: tomt i prod (de tre ble flyttet manuelt 1. september 2026), men
-- migrasjonen skal ikke være avhengig av det.
UPDATE `member_profiles`
SET `role_id` = 'board'
WHERE `role_id` = 'styremedlem'
  AND EXISTS (SELECT 1 FROM `roles` WHERE `id` = 'styremedlem' AND `is_system` = 0)
  AND EXISTS (SELECT 1 FROM `roles` WHERE `id` = 'board');
--> statement-breakpoint

-- Rettigheter den gamle rollen hadde og `board` mangler — i praksis
-- `archive.viewAll`. `INSERT ... SELECT` framfor `VALUES`, slik at setningen
-- ikke bryter fremmednøkkelen i en database uten rollene.
INSERT OR IGNORE INTO `role_permissions` (`role_id`, `permission`)
SELECT 'board', `permission`
FROM `role_permissions`
WHERE `role_id` = 'styremedlem'
  AND EXISTS (SELECT 1 FROM `roles` WHERE `id` = 'styremedlem' AND `is_system` = 0)
  AND EXISTS (SELECT 1 FROM `roles` WHERE `id` = 'board');
--> statement-breakpoint

DELETE FROM `role_permissions`
WHERE `role_id` = 'styremedlem'
  AND EXISTS (SELECT 1 FROM `roles` WHERE `id` = 'styremedlem' AND `is_system` = 0);
--> statement-breakpoint

-- Til slutt rollen selv. `NOT EXISTS`-vaktene er med vilje: skulle en rad ha
-- kommet til mellom setningene over, blir dette en no-op i stedet for en
-- fremmednøkkelfeil midt i en migrasjon.
DELETE FROM `roles`
WHERE `id` = 'styremedlem'
  AND `is_system` = 0
  AND NOT EXISTS (SELECT 1 FROM `member_profiles` WHERE `role_id` = 'styremedlem')
  AND NOT EXISTS (SELECT 1 FROM `invitations` WHERE `role_id` = 'styremedlem');
