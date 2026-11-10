-- The parse worker's copy of the settings it reads, kept by its consumer of
-- settings.changed@1 (svc-settings). Nothing else writes it.
CREATE TABLE "ingestion"."settings_replica" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"changed_at" timestamp with time zone NOT NULL
);
