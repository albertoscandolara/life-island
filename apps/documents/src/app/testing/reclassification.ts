import type { HttpTestingController } from '@angular/common/http/testing';
import type { ReclassificationStateDto } from '@life-island/contracts';

/** Reclassification idle, nothing blocking a start: the usual state in tests. */
export function reclassificationState(
  changes: Partial<ReclassificationStateDto> = {},
): ReclassificationStateDto {
  return {
    locked: false,
    taxonomyVersion: 3,
    currentRun: null,
    lastRun: null,
    canStart: true,
    blockedReasons: [],
    pendingReview: 0,
    nextScheduledRunAt: null,
    ...changes,
  };
}

/** Answers the app-wide reclassification check, if it was made. */
export function flushReclassification(
  http: HttpTestingController,
  state: ReclassificationStateDto = reclassificationState(),
): void {
  for (const request of http.match('/api/ingestion/reclassification'))
    request.flush(state);
}
