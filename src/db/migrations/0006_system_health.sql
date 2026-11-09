CREATE TABLE "system_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"level" varchar(8) NOT NULL,
	"category" varchar(30) NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb,
	"stack" text,
	"route" varchar(500),
	"method" varchar(10),
	"user_id" uuid,
	"fingerprint" varchar(64) NOT NULL,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_task_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task" varchar(50) NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"success" boolean,
	"detail" jsonb
);
--> statement-breakpoint
ALTER TABLE "system_events" ADD CONSTRAINT "system_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "system_events_fingerprint_idx" ON "system_events" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "system_events_last_seen_idx" ON "system_events" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "system_task_runs_task_started_idx" ON "system_task_runs" USING btree ("task","started_at");--> statement-breakpoint
CREATE INDEX "ai_chat_conv_updated_idx" ON "ai_chat_conversations" USING btree ("updated_at");--> statement-breakpoint
-- AI history and System health pages: default permissions of the Administrateur
-- role (…0001) on existing databases (the seed only runs on an empty database).
-- Super Administrateur has them through the isAdmin bypass; the other roles do
-- not (the administrator grants them). Idempotent.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r."id", p."permission"
FROM "roles" r
CROSS JOIN (VALUES
  ('pages:ai_history'),
  ('ai_history:purge'),
  ('pages:system_health'),
  ('system_health:purge')
) AS p("permission")
WHERE r."id" = '00000000-0000-0000-0000-000000000001'::uuid
ON CONFLICT ("role_id", "permission") DO NOTHING;
--> statement-breakpoint
-- The in-memory log buffer is gone (System health stores warnings and errors):
-- its settings no longer exist.
DELETE FROM "app_config" WHERE "key" IN ('LOGS_ENABLED', 'LOGS_LEVEL', 'LOGS_MAX_ENTRIES');
--> statement-breakpoint
-- The "Team / day" planning view is gone: its permission no longer grants anything.
DELETE FROM "role_permissions" WHERE "permission" = 'planning:view_team_day';
