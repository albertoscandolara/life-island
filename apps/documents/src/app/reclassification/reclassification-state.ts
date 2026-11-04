import {
  HttpErrorResponse,
  type HttpInterceptorFn,
} from '@angular/common/http';
import {
  computed,
  DestroyRef,
  effect,
  inject,
  Injectable,
  signal,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import {
  RECLASSIFICATION_LOCKED_CODE,
  type ReclassificationStateDto,
} from '@life-island/contracts';
import { catchError, firstValueFrom, throwError } from 'rxjs';
import { IngestionApi } from '../api/ingestion-api';
import { errorMessage } from '../categories/category-store';

/** While a run holds the lock: how often the app checks whether it ended. */
export const LOCKED_POLL_MS = 5000;
/** Otherwise: how often it checks whether a run started (a schedule, another tab). */
export const IDLE_POLL_MS = 60_000;

/** True for the 423 the services answer while a reclassification holds the lock. */
export function isLockedError(error: unknown): boolean {
  return (
    error instanceof HttpErrorResponse &&
    error.status === 423 &&
    (error.error as { code?: string } | null)?.code ===
      RECLASSIFICATION_LOCKED_CODE
  );
}

/**
 * Historical reclassification as the whole app sees it: whether a run holds
 * the global lock (uploads, parsing and document or category changes wait),
 * whether one can start, and how many documents wait for a decision. The
 * services enforce the lock; this only keeps the screens in step with it.
 */
@Injectable({ providedIn: 'root' })
export class ReclassificationState {
  private readonly api = inject(IngestionApi);
  readonly state = rxResource({ stream: () => this.api.reclassification() });
  /** A 423 arrived before the next check: show the lock straight away. */
  private readonly lockSeen = signal(false);

  readonly locked = computed(
    () =>
      this.lockSeen() || (this.state.hasValue() && this.state.value().locked),
  );
  readonly value = computed<ReclassificationStateDto | null>(() =>
    this.state.hasValue() ? this.state.value() : null,
  );
  readonly pendingReview = computed(() => this.value()?.pendingReview ?? 0);
  readonly starting = signal(false);
  readonly notice = signal('');
  /** Bumped when a run ends, so pages can reload what it changed. */
  readonly finished = signal(0);

  private poll?: ReturnType<typeof setTimeout>;
  private wasLocked = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.poll));
    effect(() => {
      if (this.state.isLoading()) return;
      const locked = this.state.hasValue() && this.state.value().locked;
      if (this.state.hasValue()) this.lockSeen.set(false);
      if (this.wasLocked && !locked) {
        this.notice.set('');
        this.finished.update((n) => n + 1);
      }
      this.wasLocked = locked;
      clearTimeout(this.poll);
      this.poll = setTimeout(
        () => this.state.reload(),
        locked ? LOCKED_POLL_MS : IDLE_POLL_MS,
      );
    });
  }

  /** A write was refused with 423: the lock is on, check the details now. */
  markLocked(): void {
    this.lockSeen.set(true);
    this.state.reload();
  }

  reload(): void {
    this.state.reload();
  }

  /** Reclassify now. The run starts in the processing service within a moment. */
  async start(): Promise<boolean> {
    this.starting.set(true);
    this.notice.set('');
    try {
      await firstValueFrom(this.api.runReclassification());
      this.notice.set(
        'Started checking past documents against new categories.',
      );
      this.state.reload();
      return true;
    } catch (error) {
      this.notice.set(errorMessage(error));
      this.state.reload();
      return false;
    } finally {
      this.starting.set(false);
    }
  }
}

/** Every 423 from the lock turns the app's lock banner on right away. */
export const reclassificationLockInterceptor: HttpInterceptorFn = (
  request,
  next,
) => {
  const state = inject(ReclassificationState);
  return next(request).pipe(
    catchError((error: unknown) => {
      if (isLockedError(error)) state.markLocked();
      return throwError(() => error);
    }),
  );
};
