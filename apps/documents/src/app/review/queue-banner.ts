import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import type { ParseQueueDto } from '@life-island/contracts';
import { UiAlert, type UiTone } from '@life-island/design-system';
import { IngestionApi } from '../api/ingestion-api';

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

/** The parse queue's state above the inbox: when it last ran, and whether it is paused, running or waiting, and why. */
@Component({
  selector: 'app-queue-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiAlert],
  template: `
    @if (lastRun(); as line) {
      <p class="last-run">{{ line }}</p>
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

  reload(): void {
    this.queue.reload();
  }
}
