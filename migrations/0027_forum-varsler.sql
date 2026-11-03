-- Push-varsel om nye svar i forumtråder man følger (forslaget fra forumtråden
-- «Tilbakemeldinger på internsidene», 31.10.2026). Kun additivt:
--
-- * `forum_follows` er de EKSPLISITTE valgene. Den som startet tråden eller har
--   svart i den, følger den uten rad; `following = 0` demper tråden, `1` følger
--   den uten å ha skrevet noe. `updated_at` er tidspunktet man begynte å følge,
--   så eldre uleste svar ikke holder varslene tilbake.
-- * `notification_preferences.forum_replies` er det samlede valget på
--   /min-profil (ingen rad = 'all').
CREATE TABLE `forum_follows` (
	`topic_id` text NOT NULL,
	`user_id` text NOT NULL,
	`following` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`topic_id`, `user_id`),
	FOREIGN KEY (`topic_id`) REFERENCES `forum_topics`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `forum_follows_user_idx` ON `forum_follows` (`user_id`);--> statement-breakpoint
ALTER TABLE `notification_preferences` ADD `forum_replies` text DEFAULT 'all' NOT NULL;