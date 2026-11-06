import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  output,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { rxResource } from '@angular/core/rxjs-interop';
import type { ParseQueueDto } from '@life-island/contracts';
import { UiAlert, type UiTone } from '@life-island/design-system';
import { firstValueFrom } from 'rxjs';
import { IngestionApi } from '../api/ingestion-api';
import { errorMessage } from '../categories/category-store';

export interface QueueMessage {
  tone: UiTone;
  heading: string;
  lines: string[];
}

const formatTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

/** How old the worker's heartbeat may be before it counts as not running. */
export const WORKER_STALE_MS = 60_000;

/**
 * The parse worker is not running: it has not said it is alive within the
 * last minute (it writes `workerSeenAt` every few seconds while it runs).
 */
export function workerOffline(
  queue: Pick<ParseQueueDto, 'workerSeenAt'>,
  now = Date.now(),
): boolean {
  return (
    !queue.workerSeenAt ||
    now - Date.parse(queue.workerSeenAt) > WORKER_STALE_MS
  );
}

const WORKER_OFFLINE_HELP =
  'Start it with npm run dev (or npx nx serve svc-parse-worker) and look at its output in that terminal: an error there says why it stopped. It reads the waiting documents as soon as it starts.';

/**
 * What the banner says about the parse queue. A resume time is stated as a
 * fact only when it came from the provider; otherwise it is the worker's next
 * check, and the banner says the time is unknown.
 */
export function queueMessage(
  queue: ParseQueueDto,
  format: (iso: string) => string = formatTime,
): QueueMessage | null {
  const waiting = `${queue.pendingDocuments} document${queue.pendingDocuments === 1 ? '' : 's'} waiting.`;
  const provider = queue.providerError
    ? `Provider message: ${queue.providerError.message}`
    : null;
  if (workerOffline(queue))
    return {
      tone: 'danger',
      heading: 'Status: The parse worker is not running',
      lines: [
        `Nothing is read until it runs: Parse now and the daily run both need it. ${WORKER_OFFLINE_HELP}`,
        ...(queue.pendingDocuments > 0 ? [waiting] : []),
      ],
    };
  switch (queue.status) {
    case 'PAUSED_QUOTA':
      return {
        tone: 'warning',
        heading: 'Status: Paused — AI usage quota exhausted',
        lines: [
          'The AI provider’s available usage quota has been exhausted. Completed work has been saved, and further AI processing is paused until additional quota becomes available. Processing will resume automatically when the quota is replenished.',
          queue.resumeAt && queue.resumeAtReliable
            ? `The provider reports the quota is available again on ${format(queue.resumeAt)}; processing resumes then.`
            : `The resumption time is currently unknown.${queue.resumeAt ? ` The service will next check whether quota is available on ${format(queue.resumeAt)}.` : ''}`,
          waiting,
          ...(provider ? [provider] : []),
        ],
      };
    case 'PAUSED_RATE_LIMIT':
      return {
        tone: 'warning',
        heading: 'Status: Paused — AI rate limit reached',
        lines: [
          'The AI provider asked the service to slow down. Completed work has been saved; processing continues automatically after the provider’s retry time.',
          queue.resumeAt && queue.resumeAtReliable
            ? `Resumes on ${format(queue.resumeAt)}.`
            : `The provider gave no retry time; the service will try again on ${queue.resumeAt ? format(queue.resumeAt) : 'its next run'}.`,
          waiting,
        ],
      };
    case 'BLOCKED_CREDENTIALS':
      return {
        tone: 'danger',
        heading: 'Status: Stopped — the AI provider refused the request',
        lines: [
          'The API key, its permissions or the configured model were refused, so no document can be processed. Completed work is saved. Fix the configuration (ANTHROPIC_API_KEY, PARSE_*_MODEL) and restart the worker; it also tries again at the next scheduled run.',
          waiting,
          ...(provider ? [provider] : []),
        ],
      };
    case 'RUNNING':
      return {
        tone: 'progress',
        heading: 'Status: Processing documents',
        lines: [waiting],
      };
    case 'IDLE':
      return queue.pendingDocuments > 0
        ? {
            tone: 'neutral',
            heading: 'Status: Waiting for the next run',
            lines: [
              `${waiting}${queue.nextScheduledRunAt ? ` The next scheduled run is on ${format(queue.nextScheduledRunAt)}.` : ''}`,
            ],
          }
        : null;
  }
}

const OUTCOME_LABELS: Record<string, string> = {
  parsed: 'processed',
  retried: 'to retry',
  failed: 'failed',
  paused: 'paused',
  blocked: 'blocked',
  lost: 'handed over',
};

/** When the processing service last ran, what it did, and when it runs next. */
export function lastRunText(
  queue: ParseQueueDto,
  format: (iso: string) => string = formatTime,
): string {
  const parts: string[] = [];
  if (queue.status === 'RUNNING' && queue.runStartedAt)
    parts.push(`Running since ${format(queue.runStartedAt)}.`);
  else if (queue.runStartedAt) {
    const counts = Object.entries(queue.lastRunSummary ?? {})
      .filter(([, count]) => count > 0)
      .map(
        ([outcome, count]) => `${count} ${OUTCOME_LABELS[outcome] ?? outcome}`,
      );
    parts.push(
      `Last run ${format(queue.runStartedAt)}${queue.runFinishedAt ? `, finished ${format(queue.runFinishedAt)}` : ''}: ${counts.length ? counts.join(', ') : 'nothing to process'}.`,
    );
  } else parts.push('The processing service has not run yet.');
  if (queue.nextScheduledRunAt)
    parts.push(`Next scheduled run ${format(queue.nextScheduledRunAt)}.`);
  return parts.join(' ');
}

export interface ParseNowState {
  enabled: boolean;
  /** Why the button is off, or what it will do. */
  hint: string;
}

/**
 * Whether Parse now can start a run: documents are waiting and nothing stops
 * the worker (a pause has its own resume time; a run is already going).
 */
export function parseNowState(
  queue: ParseQueueDto,
  format: (iso: string) => string = formatTime,
): ParseNowState {
  switch (queue.status) {
    case 'RUNNING':
      return { enabled: false, hint: 'The AI is already reading documents.' };
    case 'PAUSED_QUOTA':
    case 'PAUSED_RATE_LIMIT':
      return {
        enabled: false,
        hint: queue.resumeAt
          ? `Paused by the AI provider until ${format(queue.resumeAt)}.`
          : 'Paused by the AI provider.',
      };
  }
  if (queue.pendingDocuments === 0)
    return { enabled: false, hint: 'No document is waiting to be read.' };
  if (workerOffline(queue))
    return {
      enabled: false,
      hint: 'The parse worker is not running, so nothing would start. Start it first (see the status below).',
    };
  const n = queue.pendingDocuments;
  return {
    enabled: true,
    hint: `Start reading the ${n} waiting document${n === 1 ? '' : 's'} now instead of at the next scheduled run.`,
  };
}

/**
 * A 404 here means the ingestion service running is older than this page
 * (it has no Parse now route yet), not that something is missing.
 */
export function parseNowError(error: unknown): string {
  if (error instanceof HttpErrorResponse && error.status === 404)
    return 'The ingestion service running is older than this page and cannot start a run. Restart svc-ingestion and svc-parse-worker with the latest code, then try again.';
  return errorMessage(error);
}

/** How often the banner checks the queue while a run is going or was asked for. */
export const POLL_MS = 3000;
/** How long after Parse now the banner waits for the run to show up. */
const START_GRACE_MS = 20_000;

/** The parse queue's state above the inbox: when it last ran, and whether it is paused, running or waiting, and why. */
@Component({
  selector: 'app-queue-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiAlert],
  template: `
    @if (lastRun(); as line) {
      <div class="last-run">
        <p>{{ line }}</p>
      </div>
    }
    @if (parseNow(); as state) {
      <p class="hint" id="parse-now-hint">Parse now: {{ state.hint }}</p>
    }
    @if (notice(); as text) {
      <p class="notice" role="status">{{ text }}</p>
    }
    @if (message(); as m) {
      <ui-alert [tone]="m.tone">
        <strong class="heading">{{ m.heading }}</strong>
        @for (line of m.lines; track $index) {
          <p>{{ line }}</p>
        }
      </ui-alert>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    :host:empty {
      display: none;
    }
    .last-run {
      margin: 0 0 var(--space-2);
      color: var(--text-muted);
      font-size: var(--text-sm);
    }
    .last-run p {
      margin: 0;
    }
    .hint {
      margin: 0 0 var(--space-2);
      color: var(--text-muted);
      font-size: var(--text-sm);
    }
    .notice {
      color: var(--text-secondary);
      font-size: var(--text-sm);
    }
    .heading {
      display: block;
    }
    p {
      margin: var(--space-1) 0 0;
    }
  `,
})
export class QueueBanner {
  private readonly api = inject(IngestionApi);
  private readonly queue = rxResource({ stream: () => this.api.parseQueue() });
  protected readonly lastRun = computed(() =>
    this.queue.hasValue() ? lastRunText(this.queue.value()) : null,
  );
  protected readonly message = computed(() =>
    this.queue.hasValue() ? queueMessage(this.queue.value()) : null,
  );
  /** For the page's Parse now button: null until the queue has loaded. */
  readonly parseNow = computed(() =>
    this.queue.hasValue() ? parseNowState(this.queue.value()) : null,
  );
  readonly requesting = signal(false);
  protected readonly notice = signal('');
  /** A run finished (or a requested one ended): the inbox has new records. */
  readonly runFinished = output<void>();

  /** Until when a requested run counts as about to start. */
  private requestedUntil = 0;
  private wasRunning = false;
  private poll?: ReturnType<typeof setTimeout>;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.poll));
    // Checks the queue while a run is going or was just asked for, and says
    // when it ends so the inbox can show what the AI read.
    effect(() => {
      if (!this.queue.hasValue() || this.queue.isLoading()) return;
      const running = this.queue.value().status === 'RUNNING';
      if (this.wasRunning && !running) {
        this.requestedUntil = 0;
        this.notice.set('');
        this.runFinished.emit();
      }
      this.wasRunning = running;
      clearTimeout(this.poll);
      if (running || Date.now() < this.requestedUntil)
        this.poll = setTimeout(() => this.queue.reload(), POLL_MS);
      else if (this.requestedUntil) {
        this.requestedUntil = 0;
        this.notice.set(
          'The run has not started yet. Press Refresh in a moment to check again.',
        );
      }
    });
  }

  reload(): void {
    this.queue.reload();
  }

  /** Parse now: the worker starts within a moment; the banner follows the run. */
  async runNow(): Promise<void> {
    this.requesting.set(true);
    this.notice.set('');
    try {
      await firstValueFrom(this.api.runParseNow());
      this.notice.set('Asked the AI to start now.');
      this.requestedUntil = Date.now() + START_GRACE_MS;
      this.queue.reload();
    } catch (error) {
      this.notice.set(parseNowError(error));
    } finally {
      this.requesting.set(false);
    }
  }
}
