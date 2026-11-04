import {
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
} from '@nestjs/common';
import { withTransaction, type ServiceDb } from '@life-island/be-common';
import type { ReclassificationStateDto } from '@life-island/contracts';
import {
  assertWritable,
  reclassificationState,
  tryStartRun,
} from '@life-island/ingestion-db';
import { CONFIG, SERVICE_DB, type IngestionConfig } from '../config.js';

/**
 * Historical reclassification: its state for the documents app, and
 * Reclassify now. The run itself happens in svc-parse-worker; the monthly
 * schedule starts it through the same `tryStartRun`.
 */
@Controller('reclassification')
export class ReclassificationController {
  constructor(
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
    @Inject(CONFIG) private readonly config: IngestionConfig,
  ) {}

  /** Lock, current and last run, whether a run could start now, documents waiting for review. */
  @Get()
  async state(): Promise<ReclassificationStateDto> {
    const client = await this.svc.pool.connect();
    try {
      return await reclassificationState(client);
    } finally {
      client.release();
    }
  }

  /**
   * Reclassify now: takes the lock at once (the app turns read-only for
   * everyone) and wakes the worker. 423 while a run holds the lock, 409 with
   * every reason when a prerequisite is not met (nothing is changed).
   */
  @Post('run')
  @HttpCode(202)
  async run(): Promise<ReclassificationStateDto> {
    await withTransaction(this.svc.pool, (client) => assertWritable(client));
    const result = await tryStartRun(
      this.svc.pool,
      'MANUAL',
      this.config.reclassifyLeaseMinutes,
      this.svc.schema,
    );
    if (!result.started)
      throw new ConflictException({
        statusCode: 409,
        message: `Reclassification cannot start: ${result.reasons.map((reason) => reason.message).join('; ')}.`,
        reasons: result.reasons,
      });
    return this.state();
  }
}
