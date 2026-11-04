import type { ReclassificationStateDto } from '@life-island/contracts';

export interface ReclassifyStartState {
  enabled: boolean;
  /** Why the button is off, or what it will do. */
  hint: string;
}

const formatTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

/** Whether Reclassify now can start, and the sentence that says why (not). */
export function reclassifyStartState(
  state: ReclassificationStateDto | null,
  format: (iso: string) => string = formatTime,
): ReclassifyStartState {
  if (!state) return { enabled: false, hint: 'Checking…' };
  if (state.locked)
    return { enabled: false, hint: 'Past documents are being checked now.' };
  const next = state.nextScheduledRunAt
    ? ` The next monthly check is on ${format(state.nextScheduledRunAt)}.`
    : '';
  if (!state.canStart)
    return {
      enabled: false,
      hint: `Not now: ${state.blockedReasons.map((reason) => reason.message).join('; ')}.${next}`,
    };
  return {
    enabled: true,
    hint: `Check past documents against categories confirmed after they were read, now instead of at the monthly check.${next}`,
  };
}
