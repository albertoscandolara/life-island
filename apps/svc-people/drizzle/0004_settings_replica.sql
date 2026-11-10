-- svc-people keeps a copy of the settings it reads again: the reminder
-- windows of the ID documents (Settings → Reminders).
CREATE TABLE "people"."settings_replica" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"changed_at" timestamp with time zone NOT NULL
);
