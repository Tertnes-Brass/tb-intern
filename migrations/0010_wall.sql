-- Veggen (#28, trinn B): medlemsinnlegg, kommentarer, reaksjoner og bilder.
--
-- `posts` bygges om fordi `title` blir valgfri og `official` kommer til.
-- Rebuilden kjøres FØRST, og med `0` for `official` — kolonnen finnes ikke i
-- den gamle tabellen. Eksisterende rader beholder tittel, tekst og
-- publiseringstidspunkt; `notification_log` peker på id-ene og overlever.
-- NB: D1 kjører migrasjonen i en transaksjon, der `PRAGMA foreign_keys` er en
-- no-op. `DROP TABLE posts` cascader derfor til `notification_log`. Radene
-- sikres og legges tilbake etterpå — uten dette ville alle medlemmer fått
-- e-post om gamle beskjeder på nytt ved neste «send på nytt».
CREATE TABLE `__notification_log_backup` AS SELECT * FROM `notification_log`;
--> statement-breakpoint

PRAGMA foreign_keys=OFF;
--> statement-breakpoint

CREATE TABLE `__new_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text,
	`body` text NOT NULL,
	`audience` text DEFAULT 'all' NOT NULL,
	`importance` text DEFAULT 'normal' NOT NULL,
	`official` integer DEFAULT false NOT NULL,
	`author_id` text,
	`published_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint

INSERT INTO `__new_posts`("id", "title", "body", "audience", "importance", "official", "author_id", "published_at", "created_at", "updated_at") SELECT "id", "title", "body", "audience", "importance", 0, "author_id", "published_at", "created_at", "updated_at" FROM `posts`;
--> statement-breakpoint

DROP TABLE `posts`;
--> statement-breakpoint

ALTER TABLE `__new_posts` RENAME TO `posts`;
--> statement-breakpoint

PRAGMA foreign_keys=ON;
--> statement-breakpoint

CREATE INDEX `posts_published_idx` ON `posts` (`published_at`);
--> statement-breakpoint

INSERT OR IGNORE INTO `notification_log` ("post_id", "user_id", "sent_at", "outcome") SELECT "post_id", "user_id", "sent_at", "outcome" FROM `__notification_log_backup`;
--> statement-breakpoint

DROP TABLE `__notification_log_backup`;
--> statement-breakpoint

CREATE TABLE `post_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`author_id` text,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint

CREATE INDEX `post_comments_post_idx` ON `post_comments` (`post_id`,`created_at`);
--> statement-breakpoint

CREATE TABLE `post_images` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`file_name` text NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`content_type` text NOT NULL,
	`width` integer,
	`height` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`uploaded_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint

CREATE INDEX `post_images_post_idx` ON `post_images` (`post_id`,`sort_order`);
--> statement-breakpoint

CREATE TABLE `post_reactions` (
	`post_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text DEFAULT 'like' NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`post_id`, `user_id`),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
