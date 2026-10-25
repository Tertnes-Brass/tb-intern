-- Push-abonnement knyttes til innloggingen på enheten. Økten slettes ved
-- «Logg ut andre enheter», passordbytte og utestengelse, og abonnementet går
-- med (ON DELETE CASCADE — drizzle-kit utelater den i ALTER TABLE, derfor lagt
-- til for hånd; schema.ts og snapshotet har den). Kun ADD COLUMN + CREATE INDEX.
ALTER TABLE `push_subscriptions` ADD `session_id` text REFERENCES session(id) ON DELETE cascade;--> statement-breakpoint
CREATE INDEX `push_subscriptions_session_idx` ON `push_subscriptions` (`session_id`);
