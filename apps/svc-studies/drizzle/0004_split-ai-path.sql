-- The AI path splits in two: "Agentic engineering" (ai-coding, applied) and
-- "How AI works, inside out" (ai-theory). The one step that moves keeps your
-- progress, sessions and courses, and following the AI path follows both.
-- A path you rewrote yourself (a learning_paths row) is left as you wrote it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "studies"."learning_paths" WHERE "id" = 'ai-coding') THEN
    UPDATE "studies"."step_progress"
      SET "step_id" = 'ai-theory.assistant.sampling', "path_id" = 'ai-theory'
      WHERE "step_id" = 'ai-coding.foundations.llm-basics';
    UPDATE "studies"."study_sessions"
      SET "step_id" = 'ai-theory.assistant.sampling', "path_id" = 'ai-theory'
      WHERE "step_id" = 'ai-coding.foundations.llm-basics';
    UPDATE "studies"."courses"
      SET "step_id" = 'ai-theory.assistant.sampling'
      WHERE "step_id" = 'ai-coding.foundations.llm-basics';
    UPDATE "studies"."scout_resources"
      SET "step_id" = 'ai-theory.assistant.sampling', "path_id" = 'ai-theory'
      WHERE "step_id" = 'ai-coding.foundations.llm-basics';
    UPDATE "studies"."scout_steps"
      SET "step_id" = 'ai-theory.assistant.sampling', "path_id" = 'ai-theory'
      WHERE "step_id" = 'ai-coding.foundations.llm-basics';
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO "studies"."path_progress" ("path_id", "status", "started_on", "scout_watch")
  SELECT 'ai-theory', 'following', CURRENT_DATE, "scout_watch"
  FROM "studies"."path_progress"
  WHERE "path_id" = 'ai-coding' AND "status" = 'following'
ON CONFLICT ("path_id") DO NOTHING;
