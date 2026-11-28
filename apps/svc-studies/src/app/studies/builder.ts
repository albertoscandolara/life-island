import {
  PATH_LEVEL_HINTS,
  PATH_LEVEL_LABELS,
  PATH_LEVELS,
  PATH_START_LABELS,
  STUDY_TOPIC_LABELS,
  STUDY_TOPICS,
  type PathBuilderOutput,
  type PathBuilderRequest,
  type PathOutlineRequest,
} from '@life-island/contracts';

/*
 * The path builder's prompts and what it does with the answer: the request
 * it writes from your topic, and the draft outline it keeps (only resources
 * whose address the search actually saw, every field within the editor's
 * limits).
 */

const LEVELS = PATH_LEVELS.map(
  (l) => `- ${PATH_LEVEL_LABELS[l]} (${l}): ${PATH_LEVEL_HINTS[l]}`,
).join('\n');

export const BUILDER_RESEARCH = `You design learning paths for a personal study app. One person, a software developer who studies on their own after work, wants to grow in the topic below. Draft the road for them, using the web to find the best current material.

The path climbs four levels; give it one or two stages per level, in order, and skip the levels below where the person starts:
${LEVELS}

For each stage: a title, its goal in one line, its level, a checkpoint (a concrete proof the person can show that they reached the level: something built, done at work, or explained to others, never "read X"), and 2 to 4 steps. A step is learn, build or practice, with a beginner-honest estimate of hours, two or three sentences of detail, and what the person can do once it is done. Most stages need at least one build or practice step.

Resources, 1 to 3 per step:
- Prefer official documentation, the maintainers' or authors' own material, well-known courses and talks by the people who build the tool. Avoid content farms, SEO listicles and paywalled news.
- For a fast-moving topic (tools, frameworks, cloud, AI) prefer material updated in the last 12 months for the current major version; for an evergreen one (leadership, foundations), a classic book is fine and needs no URL.
- Use only addresses you saw in your search results. Never build or guess a URL.

Write your findings as notes: the path's name, a one-line summary, why it matters for this person, a capstone project built along the way, certifications that fit (if any), then each stage with its steps and resources (title, URL, free or paid).`;

export const BUILDER_FORMAT = `Turn the path builder's notes into the structured path. Use only what the notes say.
- name: short, in the person's words. emblem: one emoji. topic: one of ${STUDY_TOPICS.join(', ')} (${STUDY_TOPICS.map((t) => STUDY_TOPIC_LABELS[t]).join(', ')}), "other" when none fits.
- stages in order, each with level one of ${PATH_LEVELS.join(', ')} and a checkpoint.
- steps: kind learn, build or practice; hours a number; resources with the URL copied exactly, or null for a book; free true or false.`;

/** The request, as the research step receives it. */
export function builderRequest(
  request: PathBuilderRequest,
  today: string,
): string {
  const start = PATH_START_LABELS[request.start ?? 'some'];
  return [
    `Today: ${today}`,
    `Topic: ${request.subject}`,
    `Where I start: ${start}`,
    request.goal ? `Where I want to get: ${request.goal}` : null,
    request.hoursPerWeek
      ? `Time I can give it: about ${request.hoursPerWeek} hours a week`
      : null,
  ]
    .filter(Boolean)
    .join('\n');
}

const clip = (text: string, max: number) => text.trim().slice(0, max);

/** The addresses in the search notes, normalised the way they are compared. */
export function seenUrls(notes: string): Set<string> {
  return new Set((notes.match(/https:\/\/[^\s)\]>"'`]+/g) ?? []).map(sameUrl));
}

function sameUrl(url: string): string {
  return url
    .replace(/[.,;:]+$/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

/**
 * The draft as the path editor opens it: resources the search did not see
 * lose their address (kept as a name to look up), and every field fits the
 * editor's limits, so saving it never fails on length.
 */
export function builderOutline(
  output: PathBuilderOutput,
  notes: string,
): PathOutlineRequest {
  const seen = seenUrls(notes);
  return {
    name: clip(output.name, 80) || 'New path',
    emblem: [...output.emblem.trim()].slice(0, 2).join('') || '📘',
    topic: output.topic,
    summary: clip(output.summary, 300),
    why: clip(output.why, 1000),
    capstone: clip(output.capstone, 1000),
    certifications: output.certifications
      .map((c) => clip(c, 200))
      .filter(Boolean)
      .slice(0, 10),
    stages: output.stages
      .filter((s) => s.title.trim() && s.steps.length)
      .slice(0, 12)
      .map((stage) => ({
        title: clip(stage.title, 120),
        goal: clip(stage.goal, 500),
        level: stage.level,
        checkpoint: clip(stage.checkpoint, 500) || null,
        steps: stage.steps
          .filter((s) => s.title.trim())
          .slice(0, 20)
          .map((step) => ({
            title: clip(step.title, 160),
            kind: step.kind,
            hours: Math.min(200, Math.max(0.5, Math.round(step.hours * 2) / 2)),
            detail: clip(step.detail, 2000),
            outcome: clip(step.outcome, 500),
            resources: step.resources
              .filter((r) => r.label.trim())
              .slice(0, 12)
              .map((r) => ({
                label: clip(r.label, 200),
                url:
                  r.url?.startsWith('https://') && seen.has(sameUrl(r.url))
                    ? r.url
                    : null,
                free: r.free,
              })),
          })),
      })),
  };
}
