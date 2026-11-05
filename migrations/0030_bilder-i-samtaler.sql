-- Bilder, GIF-er, stickers og memes i forumet, i kommentarene på veggen og i
-- chattene. Kun CREATE TABLE + CREATE INDEX — ingen eksisterende tabell røres,
-- og alle eksisterende innlegg, svar, kommentarer og meldinger er uendret.
--
-- En rad er enten en opplastet fil (`source = 'upload'`, bytene i R2) eller et
-- valg fra GIF-velgeren (`source = 'klipy'`, adressen til KLIPYs CDN). Den lages
-- før teksten sendes (target_* er da NULL og bare eieren ser den), og kobles til
-- raden den står i når meldingen sendes. Ingen fremmednøkkel til målet: det kan
-- være én av fem tabeller. Tilgangen sjekkes i /api/message-media/$mediaId, og
-- den daglige cron-en rydder rader uten mål.
CREATE TABLE `message_media` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text,
	`target_kind` text,
	`target_id` text,
	`source` text DEFAULT 'upload' NOT NULL,
	`r2_key` text,
	`external_url` text,
	`external_kind` text,
	`external_slug` text,
	`title` text,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`attached_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `message_media_target_idx` ON `message_media` (`target_kind`,`target_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `message_media_owner_idx` ON `message_media` (`owner_id`,`target_id`);