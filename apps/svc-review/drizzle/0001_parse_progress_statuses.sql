-- Parsing can now stop part-way (some steps saved) or pause on the AI quota or a rate limit.
ALTER TYPE "review"."record_status" ADD VALUE 'PARTIALLY_PARSED' BEFORE 'PARSED';--> statement-breakpoint
ALTER TYPE "review"."record_status" ADD VALUE 'PAUSED_QUOTA' BEFORE 'PARSED';--> statement-breakpoint
ALTER TYPE "review"."record_status" ADD VALUE 'PAUSED_RATE_LIMIT' BEFORE 'PARSED';