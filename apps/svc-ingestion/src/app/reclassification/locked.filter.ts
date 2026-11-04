import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { ReclassificationLockedError as LockedBody } from '@life-island/contracts';
import { ReclassificationLockedError } from '@life-island/ingestion-db';

/**
 * A write refused because a historical reclassification holds the global
 * lock answers 423 Locked, with a code the documents app recognizes.
 */
@Catch(ReclassificationLockedError)
export class ReclassificationLockedFilter implements ExceptionFilter {
  catch(error: ReclassificationLockedError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<{
      status(code: number): { json(body: unknown): void };
    }>();
    const body: LockedBody = {
      statusCode: 423,
      code: error.code,
      message: error.message,
      runId: error.runId,
      startedAt: error.startedAt?.toISOString() ?? null,
    };
    response.status(423).json(body);
  }
}
