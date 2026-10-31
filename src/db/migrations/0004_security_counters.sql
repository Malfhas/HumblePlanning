CREATE TABLE "security_counters" (
	"key" varchar(255) PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "two_factor_last_step" integer;--> statement-breakpoint
CREATE INDEX "security_counters_expires_at_idx" ON "security_counters" USING btree ("expires_at");