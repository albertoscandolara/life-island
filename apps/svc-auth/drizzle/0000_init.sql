-- The schema itself is created by infra/postgres/init (owned by auth_svc).
CREATE TABLE "auth"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" varchar(120) NOT NULL,
	"role" text NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"totp_last_step" bigint,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_role_check" CHECK ("role" in ('owner', 'member'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "auth"."users" (lower("email"));
--> statement-breakpoint
CREATE TABLE "auth"."sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" char(64) NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "auth"."users"("id") ON DELETE CASCADE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_agent" varchar(300),
	"ip" varchar(64)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_idx" ON "auth"."sessions" ("token_hash");
--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "auth"."sessions" ("user_id");
--> statement-breakpoint
CREATE TABLE "auth"."invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" char(64) NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_by" uuid NOT NULL REFERENCES "auth"."users"("id") ON DELETE CASCADE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "invites_role_check" CHECK ("role" in ('owner', 'member'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "invites_token_hash_idx" ON "auth"."invites" ("token_hash");
--> statement-breakpoint
CREATE TABLE "auth"."audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"event" text NOT NULL,
	"ip" varchar(64),
	"detail" varchar(300)
);
--> statement-breakpoint
CREATE INDEX "audit_at_idx" ON "auth"."audit" ("at");
