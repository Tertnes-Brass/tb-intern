-- Svar på svar i forumet og i kommentarene på veggen. Kun ADD COLUMN + CREATE
-- INDEX — ingen tabell bygges på nytt, og eksisterende svar og kommentarer blir
-- stående som svar rett på tråden/innlegget (alle nye kolonner er NULL).
--
-- * `parent_id` er svaret/kommentaren et svar står under (to nivåer, se
--   src/lib/threads.ts), `reply_to_id` det konkrete svaret det svarer på.
-- * `post_comments.deleted_at` merker en kommentar som er slettet, men som noen
--   har svart på: teksten og forfatteren fjernes, merket blir stående så svarene
--   beholder sammenhengen.
-- * ON DELETE SET NULL er lagt til for hånd (drizzle-kit utelater den i ALTER
--   TABLE; schema.ts og snapshotet har den). Den er siste skanse: ingen andres
--   tekst skal forsvinne fordi noe den svarte på ble slettet.
--
-- Nummer 0029: journal-idx 28 er holdt av for 0027_scene-kontakt.sql (#97).
ALTER TABLE `forum_replies` ADD `parent_id` text REFERENCES forum_replies(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `forum_replies` ADD `reply_to_id` text REFERENCES forum_replies(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `forum_replies_parent_idx` ON `forum_replies` (`parent_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `forum_replies_reply_to_idx` ON `forum_replies` (`reply_to_id`);--> statement-breakpoint
ALTER TABLE `post_comments` ADD `parent_id` text REFERENCES post_comments(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `post_comments` ADD `reply_to_id` text REFERENCES post_comments(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `post_comments` ADD `deleted_at` integer;--> statement-breakpoint
CREATE INDEX `post_comments_parent_idx` ON `post_comments` (`parent_id`);--> statement-breakpoint
CREATE INDEX `post_comments_reply_to_idx` ON `post_comments` (`reply_to_id`);
