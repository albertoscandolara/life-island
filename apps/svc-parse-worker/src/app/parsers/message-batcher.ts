import Anthropic from '@anthropic-ai/sdk';
import { Logger } from '@nestjs/common';
import { StepInterruptedError } from './document-parser.js';

type Request = Anthropic.Beta.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.BetaMessage;

/** Sends one request and returns the model's message (or throws the API error). */
export type MessageSender = (request: Request) => Promise<Message>;

export interface BatcherOptions {
  /** How often to ask whether a submitted batch has ended. */
  pollMs: number;
  /**
   * Requests are collected until none has arrived for this long, so every
   * document of the run that reaches the same step lands in the same batch.
   */
  collectMs: number;
  /** Never wait longer than this after the first request before submitting. */
  maxCollectMs: number;
  /** Submit as soon as this many requests are waiting. */
  maxRequests: number;
}

export const DEFAULT_BATCHER_OPTIONS: BatcherOptions = {
  pollMs: 60_000,
  collectMs: 10_000,
  maxCollectMs: 60_000,
  maxRequests: 1_000,
};

interface Pending {
  customId: string;
  request: Request;
  resolve: (message: Message) => void;
  reject: (error: unknown) => void;
}

/** The status an errored batch result would have had as a direct request. */
const STATUS_OF_ERROR: Record<string, number> = {
  invalid_request_error: 400,
  authentication_error: 401,
  billing_error: 402,
  permission_error: 403,
  not_found_error: 404,
  request_too_large: 413,
  rate_limit_error: 429,
  api_error: 500,
  timeout_error: 504,
  overloaded_error: 529,
};

/**
 * Sends requests through the Message Batches API, at half the price of direct
 * requests, by collecting the requests that arrive close together into one
 * batch and resolving each caller when the batch ends (usually within the
 * hour, at most 24 h). Callers just await `send`, as with a direct request.
 *
 * - Server-side fallbacks are not accepted in a batch: they are left out, and
 *   a request the model refused is sent again directly, fallbacks included.
 * - An errored result becomes the same API error a direct request would throw,
 *   so quota, rate-limit and credential errors are handled as usual.
 * - `hurry()` (Parse now during a batch run) stops waiting: the requests still
 *   in a batch are sent directly, and so is everything that comes after.
 */
export class MessageBatcher {
  private readonly logger = new Logger(MessageBatcher.name);
  private queued: Pending[] = [];
  /** Submitted batches, by id, with the requests still waiting on each. */
  private readonly inFlight = new Map<string, Map<string, Pending>>();
  private collectTimer?: NodeJS.Timeout;
  private firstQueuedAt = 0;
  private sequence = 0;
  private direct = false;
  private closed = false;
  private readonly wake = new Set<() => void>();

  constructor(
    private readonly client: Anthropic,
    private readonly sendDirect: MessageSender,
    private readonly options: BatcherOptions = DEFAULT_BATCHER_OPTIONS,
  ) {}

  send: MessageSender = (request) => {
    if (this.closed)
      return Promise.reject(
        new StepInterruptedError('The batch run has stopped'),
      );
    if (this.direct) return this.sendDirect(request);
    return new Promise<Message>((resolve, reject) => {
      if (this.queued.length === 0) this.firstQueuedAt = Date.now();
      this.queued.push({
        customId: `r${++this.sequence}`,
        request,
        resolve,
        reject,
      });
      this.scheduleSubmit();
    });
  };

  /** Stop waiting on batches: send what is waiting, and everything later, directly. */
  hurry(): void {
    if (this.direct || this.closed) return;
    this.direct = true;
    clearTimeout(this.collectTimer);
    const waiting = [
      ...this.queued,
      ...[...this.inFlight.values()].flatMap((requests) => [
        ...requests.values(),
      ]),
    ];
    this.queued = [];
    for (const id of this.inFlight.keys()) void this.cancel(id);
    this.inFlight.clear();
    this.wakePollers();
    if (waiting.length)
      this.logger.log(
        `Parse now: sending ${waiting.length} request(s) directly instead of waiting for the batch`,
      );
    for (const pending of waiting)
      this.sendDirect(pending.request).then(pending.resolve, pending.reject);
  }

  /** The run is over or the worker is stopping: give up on anything still waiting. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.collectTimer);
    const error = new StepInterruptedError(
      'The worker stopped while the batch was running; the step will be sent again',
    );
    for (const pending of this.queued) pending.reject(error);
    this.queued = [];
    for (const [id, requests] of this.inFlight) {
      void this.cancel(id);
      for (const pending of requests.values()) pending.reject(error);
    }
    this.inFlight.clear();
    this.wakePollers();
  }

  private scheduleSubmit(): void {
    clearTimeout(this.collectTimer);
    const sinceFirst = Date.now() - this.firstQueuedAt;
    const delay =
      this.queued.length >= this.options.maxRequests
        ? 0
        : Math.max(
            0,
            Math.min(
              this.options.collectMs,
              this.options.maxCollectMs - sinceFirst,
            ),
          );
    this.collectTimer = setTimeout(() => void this.submit(), delay);
  }

  private async submit(): Promise<void> {
    const requests = this.queued.splice(0, this.options.maxRequests);
    if (this.queued.length) this.scheduleSubmit();
    if (!requests.length) return;
    let batchId: string;
    try {
      const batch = await this.client.beta.messages.batches.create({
        requests: requests.map((pending) => ({
          custom_id: pending.customId,
          params: batchParams(pending.request),
        })),
      });
      batchId = batch.id;
    } catch (error) {
      // Quota, credentials...: every caller gets the error a direct request would have.
      for (const pending of requests) pending.reject(error);
      return;
    }
    if (this.direct || this.closed) {
      // hurry() or close() came while the batch was being created.
      void this.cancel(batchId);
      for (const pending of requests)
        if (this.closed)
          pending.reject(new StepInterruptedError('The batch run has stopped'));
        else
          this.sendDirect(pending.request).then(
            pending.resolve,
            pending.reject,
          );
      return;
    }
    this.inFlight.set(
      batchId,
      new Map(requests.map((pending) => [pending.customId, pending])),
    );
    this.logger.log(
      `Batch ${batchId}: ${requests.length} request(s) submitted`,
    );
    await this.waitAndDeliver(batchId);
  }

  private async waitAndDeliver(batchId: string): Promise<void> {
    let failures = 0;
    for (;;) {
      await this.sleep(this.options.pollMs);
      const waiting = this.inFlight.get(batchId);
      if (!waiting) return; // hurried or closed
      try {
        const batch = await this.client.beta.messages.batches.retrieve(batchId);
        failures = 0;
        if (batch.processing_status !== 'ended') continue;
        await this.deliver(batchId, waiting);
        return;
      } catch (error) {
        // A network blip should not lose a batch that is still running.
        if (++failures < 5) continue;
        this.inFlight.delete(batchId);
        for (const pending of waiting.values()) pending.reject(error);
        return;
      }
    }
  }

  private async deliver(
    batchId: string,
    waiting: Map<string, Pending>,
  ): Promise<void> {
    const results = await this.client.beta.messages.batches.results(batchId);
    for await (const entry of results) {
      const pending = waiting.get(entry.custom_id);
      if (!pending) continue;
      waiting.delete(entry.custom_id);
      const { result } = entry;
      if (result.type === 'succeeded') {
        if (
          result.message.stop_reason === 'refusal' &&
          pending.request.fallbacks
        ) {
          // Fallbacks are not available in batches: retry directly with them.
          this.sendDirect(pending.request).then(
            pending.resolve,
            pending.reject,
          );
        } else pending.resolve(result.message);
      } else if (result.type === 'errored') {
        const { error } = result.error;
        pending.reject(
          Anthropic.APIError.generate(
            STATUS_OF_ERROR[error.type] ?? 500,
            result.error,
            error.message,
            new Headers(),
          ),
        );
      } else {
        pending.reject(
          new Error(
            `The batch request was ${result.type} before it was processed`,
          ),
        );
      }
    }
    this.inFlight.delete(batchId);
    for (const pending of waiting.values())
      pending.reject(
        new Error('The batch ended without a result for the request'),
      );
    this.logger.log(`Batch ${batchId} ended`);
  }

  private async cancel(batchId: string): Promise<void> {
    await this.client.beta.messages.batches
      .cancel(batchId)
      .catch((error: unknown) =>
        this.logger.warn(`Could not cancel batch ${batchId}: ${String(error)}`),
      );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.wake.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.wake.add(done);
    });
  }

  private wakePollers(): void {
    for (const done of [...this.wake]) done();
  }
}

/** A direct request as batch params: the header-only and fallback fields are left out. */
function batchParams(
  request: Request,
): Anthropic.Beta.Messages.BatchCreateParams.Request['params'] {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { betas, fallbacks, ...params } = request as Request & {
    fallbacks?: unknown;
  };
  return params as Anthropic.Beta.Messages.BatchCreateParams.Request['params'];
}
