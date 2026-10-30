ALTER TABLE "notifications" ADD COLUMN "title_key" varchar(100);--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "message_key" varchar(100);--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "params" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locale" varchar(10);