-- People drops the renewal guides (and the copy of the settings that only
-- gated that AI tool) and the history of your edits and merges.
DROP TABLE "people"."person_edits" CASCADE;--> statement-breakpoint
DROP TABLE "people"."renewal_guides" CASCADE;--> statement-breakpoint
DROP TABLE "people"."settings_replica" CASCADE;