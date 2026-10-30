CREATE TABLE "ai_chat_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"follows_navigation" boolean DEFAULT false NOT NULL,
	"title" varchar(200) NOT NULL,
	"model" varchar(200) NOT NULL,
	"pinned_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" varchar(16) NOT NULL,
	"content" text NOT NULL,
	"model" varchar(200),
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"cost_usd" numeric(12, 6),
	"duration_ms" integer,
	"error" text,
	"project_id" uuid,
	"status" varchar(16) DEFAULT 'DONE' NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_chat_quota_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"cost_usd" numeric(12, 6) NOT NULL,
	"model" varchar(200),
	"message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_chat_quota_overrides" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"unlimited" boolean DEFAULT false NOT NULL,
	"reset_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_chat_tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"tool" varchar(100) NOT NULL,
	"arguments" jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'PROPOSED' NOT NULL,
	"result" jsonb,
	"error" text,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_chat_conversations" ADD CONSTRAINT "ai_chat_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_chat_conversations" ADD CONSTRAINT "ai_chat_conversations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_chat_messages" ADD CONSTRAINT "ai_chat_messages_conversation_id_ai_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_chat_quota_ledger" ADD CONSTRAINT "ai_chat_quota_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_chat_quota_overrides" ADD CONSTRAINT "ai_chat_quota_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_chat_tool_calls" ADD CONSTRAINT "ai_chat_tool_calls_message_id_ai_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."ai_chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_chat_conv_user_updated_idx" ON "ai_chat_conversations" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "ai_chat_conv_project_idx" ON "ai_chat_conversations" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ai_chat_msg_conv_created_idx" ON "ai_chat_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_chat_msg_running_idx" ON "ai_chat_messages" USING btree ("status") WHERE "ai_chat_messages"."status" = 'RUNNING';--> statement-breakpoint
CREATE INDEX "ai_chat_ledger_user_created_idx" ON "ai_chat_quota_ledger" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_chat_tool_msg_idx" ON "ai_chat_tool_calls" USING btree ("message_id");