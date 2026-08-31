CREATE TABLE `notification_log` (
	`post_id` text NOT NULL,
	`user_id` text NOT NULL,
	`sent_at` integer NOT NULL,
	`outcome` text NOT NULL,
	PRIMARY KEY(`post_id`, `user_id`),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `notification_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`posts` text DEFAULT 'all' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`audience` text DEFAULT 'all' NOT NULL,
	`importance` text DEFAULT 'normal' NOT NULL,
	`author_id` text,
	`published_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `posts_published_idx` ON `posts` (`published_at`);
--> statement-breakpoint

-- Rettigheten `posts.publish` skal finnes også i installasjoner som allerede er
-- seedet: seedBaseConfig fyller bare rettigheter i en helt tom database (samme
-- mønster som migrations/0008_board-role.sql). Admin har `*` og trenger ingen
-- rad. Styremedlem og Dirigent skriver og publiserer beskjeder.
-- Skrives via SELECT fra `roles` slik at en tom database (der rollene ennå ikke
-- er seedet) ikke bryter fremmednøkkelen — ON CONFLICT/IGNORE dekker ikke FK.
INSERT OR IGNORE INTO `role_permissions` (`role_id`, `permission`)
SELECT `id`, 'posts.publish' FROM `roles` WHERE `id` IN ('board', 'conductor');
