CREATE TABLE "mobile_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(50) NOT NULL,
	"title" varchar(200) NOT NULL,
	"message" text NOT NULL,
	"action_url" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mobile_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"platform" varchar(20) DEFAULT 'android' NOT NULL,
	"device_name" varchar(100),
	"app_version" varchar(30),
	"locale" varchar(10),
	"push_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mobile_devices_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mobile_push_notifications" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mobile_push_notifications_user" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "mobile_alerts" ADD CONSTRAINT "mobile_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_devices" ADD CONSTRAINT "mobile_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_devices" ADD CONSTRAINT "mobile_devices_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mobile_alerts_user_created_idx" ON "mobile_alerts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "mobile_devices_user_id_idx" ON "mobile_devices" USING btree ("user_id");--> statement-breakpoint
-- Mobile app permission of the system roles, on existing databases (the seed
-- only runs on an empty database). Administrateur (…0001) and Manager (…0002);
-- Super Administrateur has it through the isAdmin bypass; Membre+ and Membre
-- do not (the administrator grants it). Idempotent.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r."id", 'mobile_app:use'
FROM "roles" r
WHERE r."id" IN ('00000000-0000-0000-0000-000000000001'::uuid, '00000000-0000-0000-0000-000000000002'::uuid)
ON CONFLICT ("role_id", "permission") DO NOTHING;
