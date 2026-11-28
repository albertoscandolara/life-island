import { z } from 'zod';

/*
 * Making a step stick. When you finish a step, the recall quiz (AI tool
 * `studies.recall-quiz`) writes a few short questions from the step and your
 * notes; each comes back after a day, a week and a month, and one you miss
 * starts again tomorrow. Teach-back (AI tool `studies.teach-back`) reads a
 * step explained in your own words and says what holds and what is missing.
 */

export const STUDY_RECALL_TOOL = 'studies.recall-quiz';
export const STUDY_TEACH_BACK_TOOL = 'studies.teach-back';

/** Days until a card comes back, after each answer you got right. */
export const RECALL_INTERVALS_DAYS = [1, 7, 30] as const;

/** Questions the quiz writes for a finished step. */
export const RECALL_QUESTIONS_PER_STEP = 4;

export const RECALL_RESULTS = ['got', 'missed'] as const;
export type RecallResult = (typeof RECALL_RESULTS)[number];

export interface RecallCardDto {
  id: string;
  stepId: string;
  pathId: string;
  question: string;
  answer: string;
  /** Right answers so far: 0 to 3; at 3 the card is learned and stops. */
  round: number;
  dueOn: string;
  lastResult: RecallResult | null;
  /** Written by the recall quiz (true) or from the step's own outcome. */
  ai: boolean;
}

export interface StudyRecallDto {
  /** The cards due today or earlier, oldest first. */
  due: RecallCardDto[];
  /** Cards still coming back later. */
  upcoming: number;
  /** When the next card comes back, if none is due. */
  nextOn: string | null;
  /** Cards you learned (three right answers in a row). */
  learned: number;
  /** Whether the quiz writes the questions with Claude now. */
  ai: boolean;
}

export const recallAnswerRequestSchema = z.object({
  result: z.enum(RECALL_RESULTS),
});
export type RecallAnswerRequest = z.input<typeof recallAnswerRequestSchema>;

/** What the recall quiz returns (structured output). */
export const recallQuizOutputSchema = z.object({
  questions: z.array(z.object({ question: z.string(), answer: z.string() })),
});
export type RecallQuizOutput = z.infer<typeof recallQuizOutputSchema>;

/** The next round of a card after an answer: null when it is learned. */
export function nextRecall(
  round: number,
  result: RecallResult,
  today: string,
): { round: number; dueOn: string } | null {
  if (result === 'missed') return { round: 0, dueOn: shift(today, 1) };
  const next = round + 1;
  if (next >= RECALL_INTERVALS_DAYS.length) return null;
  return { round: next, dueOn: shift(today, RECALL_INTERVALS_DAYS[next]) };
}

function shift(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- teach-back

export const teachBackRequestSchema = z.object({
  explanation: z.string().trim().min(80).max(6000),
});
export type TeachBackRequest = z.input<typeof teachBackRequestSchema>;

export const TEACH_BACK_VERDICTS = ['solid', 'gaps', 'off'] as const;
export type TeachBackVerdict = (typeof TEACH_BACK_VERDICTS)[number];

export const TEACH_BACK_VERDICT_LABELS: Record<TeachBackVerdict, string> = {
  solid: 'You have it',
  gaps: 'Nearly: a few gaps',
  off: 'Not there yet',
};

export const teachBackOutputSchema = z.object({
  verdict: z.enum(TEACH_BACK_VERDICTS),
  /** What you explained well, in a line each. */
  strengths: z.array(z.string()),
  /** What is missing or wrong, and why it matters. */
  gaps: z.array(z.object({ point: z.string(), why: z.string() })),
  /** The one thing to do next: a question to answer, a part to redo. */
  next: z.string(),
});
export type TeachBackDto = z.infer<typeof teachBackOutputSchema> & {
  model: string;
};
