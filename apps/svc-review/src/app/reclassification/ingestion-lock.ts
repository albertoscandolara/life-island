import {
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  type CanActivate,
} from '@nestjs/common';
import {
  RECLASSIFICATION_LOCKED_CODE,
  type ReclassificationLockedError,
  type ReclassificationStateDto,
} from '@life-island/contracts';
import { CONFIG, type ReviewConfig } from '../config.js';

const LOCKED_MESSAGE =
  'Past documents are being checked against new categories. Uploads, parsing and changes to documents and categories are paused until it finishes.';

/**
 * Review writes are part of the document workflow, so they pause while a
 * historical reclassification holds the global lock in svc-ingestion. The
 * lock lives there; this asks for it before every write and refuses with the
 * same 423 the ingestion API gives. If ingestion cannot answer, the write is
 * refused too (503): a lock that cannot be checked is not assumed free.
 */
@Injectable()
export class IngestionLockGuard implements CanActivate {
  constructor(@Inject(CONFIG) private readonly config: ReviewConfig) {}

  async canActivate(): Promise<boolean> {
    if (!this.config.ingestionUrl) return true;
    let state: ReclassificationStateDto;
    try {
      const response = await fetch(
        `${this.config.ingestionUrl}/reclassification`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      state = (await response.json()) as ReclassificationStateDto;
    } catch (error) {
      throw new ServiceUnavailableException(
        `Could not check whether documents are being reclassified (${String(error)}); try again in a moment`,
      );
    }
    if (state.locked) {
      const body: ReclassificationLockedError = {
        statusCode: 423,
        code: RECLASSIFICATION_LOCKED_CODE,
        message: LOCKED_MESSAGE,
        runId: state.currentRun?.id ?? '',
        startedAt: state.currentRun?.startedAt ?? null,
      };
      throw new HttpException(body, 423);
    }
    return true;
  }
}
