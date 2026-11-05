-- Emoji-reaksjoner på innlegg, kommentarer og i forumet. Kun CREATE TABLE,
-- CREATE INDEX og en kopi av dagens «Liker» — ingen eksisterende tabell endres.
--
-- Dagens likes (`post_reactions`, ett «👍 Liker» per medlem per innlegg) kopieres
-- hit som emojien 👍, så ingen mister et lik og mobilappens «like» (v1) teller
-- det samme som før. `post_reactions` står igjen urørt; ny kode skriver ikke dit.
-- Et lik som trykkes i sekundene mellom migrering og deploy (gammel kode skriver
-- fortsatt til `post_reactions`) blir ikke med — godtatt.
CREATE TABLE `reactions` (
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`user_id` text NOT NULL,
	`emoji` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`target_kind`, `target_id`, `user_id`, `emoji`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reactions_target_idx` ON `reactions` (`target_kind`,`target_id`,`created_at`);--> statement-breakpoint
INSERT OR IGNORE INTO `reactions` (`target_kind`, `target_id`, `user_id`, `emoji`, `created_at`)
SELECT 'post', `post_id`, `user_id`, '👍', `created_at` FROM `post_reactions`;
