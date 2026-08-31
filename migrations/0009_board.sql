CREATE TABLE `board_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`author_id` text,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `board_tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `board_comments_task_idx` ON `board_comments` (`task_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `board_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`r2_key` text NOT NULL,
	`file_name` text NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`content_type` text DEFAULT 'application/octet-stream' NOT NULL,
	`meeting_id` text,
	`uploaded_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `board_meetings`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`uploaded_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `board_documents_meeting_idx` ON `board_documents` (`meeting_id`);--> statement-breakpoint
CREATE TABLE `board_meetings` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`title` text NOT NULL,
	`notes` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `board_meetings_date_idx` ON `board_meetings` (`date`);--> statement-breakpoint
CREATE TABLE `board_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'open' NOT NULL,
	`assignee_user_id` text,
	`due_date` text,
	`project_id` text,
	`meeting_id` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`assignee_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`meeting_id`) REFERENCES `board_meetings`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `board_tasks_status_idx` ON `board_tasks` (`status`);--> statement-breakpoint
CREATE INDEX `board_tasks_meeting_idx` ON `board_tasks` (`meeting_id`);--> statement-breakpoint

-- Styrerettigheten skal finnes også i installasjoner som allerede er seedet:
-- seedBaseConfig fyller bare rettigheter i en helt tom database (mønster fra
-- 0008_board-role.sql). Admin dekkes av `*`.
INSERT OR IGNORE INTO `role_permissions` (`role_id`, `permission`) VALUES ('board', 'board.manage');
