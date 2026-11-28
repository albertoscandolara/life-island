import type { StudyTopic } from '@life-island/contracts';
import { errorText as sharedErrorText } from '@life-island/records-ui';

/*
 * Numbers, dates and errors are written the same way in every area: they come
 * from records-ui (docs/guides/code-sharing.md). Only what is Studies' own is here.
 */
export {
  dateText,
  daysText,
  duration,
  euro,
  localToday as today,
  numberOrNull,
  textOrNull,
} from '@life-island/records-ui';

/** Hours with one decimal: "3,5 h". */
export function hours(minutes: number): string {
  return `${(Math.round((minutes / 60) * 10) / 10).toLocaleString('it-IT')} h`;
}

export function safeUrl(url: string | null): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** The chart colour of a topic: the categorical palette, one slot each. */
export const TOPIC_COLORS: Record<StudyTopic, string> = {
  ai: 'var(--viz-1)',
  'ai-internals': 'var(--viz-ai-internals)',
  frameworks: 'var(--viz-3)',
  infrastructure: 'var(--viz-2)',
  leadership: 'var(--viz-5)',
  '3d': 'var(--viz-6)',
  finance: 'var(--viz-4)',
  other: 'var(--viz-other)',
};

/** What the API said went wrong, or a sentence naming svc-studies. */
export function errorText(error: unknown, fallback: string): string {
  return sharedErrorText(error, fallback, 'svc-studies');
}
