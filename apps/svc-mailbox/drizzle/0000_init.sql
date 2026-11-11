-- The schema itself is created by infra/postgres/init (owned by mailbox_svc).
CREATE TABLE "mailbox"."letters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"received_on" date NOT NULL,
	"sender" text NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"subject" text NOT NULL,
	"text" text,
	"reference" text,
	"amount" numeric(12, 2),
	"due_on" date,
	"status" text DEFAULT 'todo' NOT NULL,
	"action" text,
	"notes" text,
	"explanation" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailbox"."settings_replica" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"changed_at" timestamp with time zone NOT NULL
);
