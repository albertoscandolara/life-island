CREATE TABLE "agenda"."digest_sends" (
	"period" text PRIMARY KEY NOT NULL,
	"recipient" text,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
