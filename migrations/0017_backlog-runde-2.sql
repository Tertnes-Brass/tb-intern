CREATE TABLE `media_items` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`recorded_on` text,
	`description` text,
	`visibility` text DEFAULT 'intern' NOT NULL,
	`project_id` text,
	`work_id` text,
	`r2_key` text NOT NULL,
	`file_name` text NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`content_type` text NOT NULL,
	`uploaded_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`work_id`) REFERENCES `works`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`uploaded_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `media_items_recorded_idx` ON `media_items` (`recorded_on`);--> statement-breakpoint
CREATE INDEX `media_items_project_idx` ON `media_items` (`project_id`);--> statement-breakpoint
CREATE INDEX `media_items_work_idx` ON `media_items` (`work_id`);--> statement-breakpoint
CREATE TABLE `part_shares` (
	`from_user_id` text NOT NULL,
	`to_user_id` text NOT NULL,
	`part_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`from_user_id`, `to_user_id`, `part_id`),
	FOREIGN KEY (`from_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `part_shares_to_idx` ON `part_shares` (`to_user_id`);--> statement-breakpoint
CREATE TABLE `post_seen` (
	`post_id` text NOT NULL,
	`user_id` text NOT NULL,
	`seen_at` integer NOT NULL,
	PRIMARY KEY(`post_id`, `user_id`),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `post_seen_user_idx` ON `post_seen` (`user_id`);--> statement-breakpoint
CREATE TABLE `post_targets` (
	`post_id` text NOT NULL,
	`kind` text NOT NULL,
	`ref_id` text NOT NULL,
	PRIMARY KEY(`post_id`, `kind`, `ref_id`),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `project_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`subject` text,
	`detail` text,
	`actor_user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `project_changes_project_idx` ON `project_changes` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `project_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`parent_id` text,
	`author_id` text,
	`body` text NOT NULL,
	`resolved_at` integer,
	`resolved_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `project_comments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`resolved_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `project_comments_project_idx` ON `project_comments` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `project_comments_parent_idx` ON `project_comments` (`parent_id`);--> statement-breakpoint
CREATE TABLE `project_notifications` (
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`sent_at` integer NOT NULL,
	`outcome` text NOT NULL,
	PRIMARY KEY(`project_id`, `user_id`, `kind`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `project_work_practice` (
	`project_id` text NOT NULL,
	`work_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`comment` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `work_id`, `user_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`work_id`) REFERENCES `project_works`(`project_id`,`work_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_work_practice_user_idx` ON `project_work_practice` (`user_id`);--> statement-breakpoint
CREATE TABLE `project_work_soloists` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`work_id` text NOT NULL,
	`user_id` text,
	`external_name` text,
	`role` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`,`work_id`) REFERENCES `project_works`(`project_id`,`work_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_work_soloists_work_idx` ON `project_work_soloists` (`project_id`,`work_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `rig_items` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`occurrence_key` text,
	`asset_id` text,
	`name` text NOT NULL,
	`responsible_user_id` text,
	`responsible_name` text,
	`taken_at` integer,
	`taken_by` text,
	`returned_at` integer,
	`returned_by` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`occurrence_key`) REFERENCES `event_meta`(`occurrence_key`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`responsible_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`taken_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`returned_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `rig_items_project_idx` ON `rig_items` (`project_id`);--> statement-breakpoint
CREATE INDEX `rig_items_occurrence_idx` ON `rig_items` (`occurrence_key`);--> statement-breakpoint
CREATE INDEX `rig_items_asset_idx` ON `rig_items` (`asset_id`);--> statement-breakpoint
CREATE TABLE `social_events` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`location` text,
	`starts_at` integer NOT NULL,
	`signup_deadline` integer,
	`capacity` integer,
	`host_user_id` text,
	`cancelled_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`host_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `social_events_start_idx` ON `social_events` (`starts_at`);--> statement-breakpoint
CREATE INDEX `social_events_host_idx` ON `social_events` (`host_user_id`);--> statement-breakpoint
CREATE TABLE `social_signups` (
	`social_event_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`comment` text,
	`attending_since` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`social_event_id`, `user_id`),
	FOREIGN KEY (`social_event_id`) REFERENCES `social_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `social_signups_user_idx` ON `social_signups` (`user_id`);--> statement-breakpoint
CREATE INDEX `social_signups_queue_idx` ON `social_signups` (`social_event_id`,`attending_since`);--> statement-breakpoint
CREATE TABLE `stage_plots` (
	`project_id` text PRIMARY KEY NOT NULL,
	`layout` text NOT NULL,
	`note` text,
	`updated_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `work_percussion` (
	`id` text PRIMARY KEY NOT NULL,
	`work_id` text NOT NULL,
	`instrument` text NOT NULL,
	`note` text,
	`part_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`work_id`) REFERENCES `works`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `work_percussion_work_idx` ON `work_percussion` (`work_id`,`sort_order`);--> statement-breakpoint
ALTER TABLE `notification_preferences` ADD `projects` text DEFAULT 'all' NOT NULL;--> statement-breakpoint
-- ============================================================================
-- Håndskrevne datasteg (squashet fra runde 2-grenene). Kun #32 hadde noen:
-- rettigheten `media.manage` til admin (for rollematrisens skyld — admin har
-- `*`) og styret. Lesing av mediearkivet seedes IKKE: `intern` og
-- `offentlig-kandidat` leses av alle aktive medlemmer, `styre` henger på
-- `board.manage`, som finnes fra før. `INSERT OR IGNORE ... SELECT FROM roles`
-- er FK-trygt og idempotent, og en tom database velger ingenting.
-- ============================================================================
INSERT OR IGNORE INTO `role_permissions` (`role_id`, `permission`)
SELECT `id`, 'media.manage' FROM `roles` WHERE `id` = 'admin';
--> statement-breakpoint
INSERT OR IGNORE INTO `role_permissions` (`role_id`, `permission`)
SELECT `id`, 'media.manage' FROM `roles` WHERE `id` = 'board';
