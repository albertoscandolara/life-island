import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { parseOrThrow } from '@life-island/be-nest';
import {
  approveWorkReviewRequestSchema,
  deadlinesQuerySchema,
  pensionConfirmStatementRequestSchema,
  pensionFundRequestSchema,
  pensionNoticeRequestSchema,
  pensionPaymentRequestSchema,
  pensionStatementRequestSchema,
  type DeadlineDto,
  type LifeAttentionDto,
  careerEventRequestSchema,
  careerFeedbackRequestSchema,
  createWorkplaceRequestSchema,
  goalStatusRequestSchema,
  jobApplicationRequestSchema,
  marketCheckRequestSchema,
  hiringPlatformRequestSchema,
  updateWorkplaceRequestSchema,
  type CareerFeedbackDto,
  type MarketCheckDto,
  type WorkOverviewDto,
  type EntityRefDto,
} from '@life-island/contracts';
import { workEntities } from './entities.js';
import { WorkService } from './work.service.js';

@Controller()
export class WorkController {
  constructor(@Inject(WorkService) private readonly work: WorkService) {}

  /** Every workplace with its documents, what waits for review, the timeline, statistics, platforms and feedback. */
  @Get('overview')
  overview(): Promise<WorkOverviewDto> {
    return this.work.overview();
  }

  /** Every workplace, and the new ones documents suggest, as every area links them. */
  @Get('entities')
  async entities(): Promise<EntityRefDto[]> {
    return workEntities(await this.work.overview());
  }

  /** A workplace added by hand, by its employer. */
  @Post('workplaces')
  createWorkplace(@Body() body: unknown): Promise<{ id: string }> {
    return this.work.createWorkplace(
      parseOrThrow(createWorkplaceRequestSchema, body),
    );
  }

  @Patch('workplaces/:id')
  @HttpCode(204)
  updateWorkplace(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<void> {
    return this.work.updateWorkplace(
      id,
      parseOrThrow(updateWorkplaceRequestSchema, body),
    );
  }

  /** Removes the workplace; its documents go back to review. */
  @Delete('workplaces/:id')
  @HttpCode(204)
  removeWorkplace(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.work.removeWorkplace(id);
  }

  @Post('reviews/:uploadId/approve')
  @HttpCode(204)
  async approve(
    @Param('uploadId', ParseUUIDPipe) uploadId: string,
    @Body() body: unknown,
  ): Promise<void> {
    await this.work.approve(
      uploadId,
      parseOrThrow(approveWorkReviewRequestSchema, body),
    );
  }

  @Post('reviews/:uploadId/reject')
  @HttpCode(204)
  reject(@Param('uploadId', ParseUUIDPipe) uploadId: string): Promise<void> {
    return this.work.reject(uploadId);
  }

  @Post('reviews/:uploadId/reopen')
  @HttpCode(204)
  reopen(@Param('uploadId', ParseUUIDPipe) uploadId: string): Promise<void> {
    return this.work.reopen(uploadId);
  }

  /** A career event no document shows: a course, an award, a project. */
  @Post('events')
  addEvent(@Body() body: unknown): Promise<{ id: string }> {
    return this.work.addEvent(parseOrThrow(careerEventRequestSchema, body));
  }

  @Delete('events/:id')
  @HttpCode(204)
  removeEvent(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.work.removeEvent(id);
  }

  @Post('platforms')
  addPlatform(@Body() body: unknown): Promise<{ id: string }> {
    return this.work.addPlatform(
      parseOrThrow(hiringPlatformRequestSchema, body),
    );
  }

  @Put('platforms/:id')
  @HttpCode(204)
  updatePlatform(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<void> {
    return this.work.updatePlatform(
      id,
      parseOrThrow(hiringPlatformRequestSchema, body),
    );
  }

  @Delete('platforms/:id')
  @HttpCode(204)
  removePlatform(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.work.removePlatform(id);
  }

  /** Writes a feedback on your career from what you approved (Claude API, or offline rules). */
  @Post('feedback')
  askFeedback(@Body() body: unknown): Promise<CareerFeedbackDto> {
    const request = parseOrThrow(careerFeedbackRequestSchema, body ?? {});
    return this.work.askFeedback(request.question ?? null);
  }

  /** Where a goal of an evaluation stands: met, partly met, missed, dropped or open. */
  @Put('goals')
  @HttpCode(204)
  setGoalStatus(@Body() body: unknown): Promise<void> {
    return this.work.setGoalStatus(parseOrThrow(goalStatusRequestSchema, body));
  }

  /** Public salary ranges for your role, found on the web by Claude (needs ANTHROPIC_API_KEY). */
  @Post('market-checks')
  runMarketCheck(@Body() body: unknown): Promise<MarketCheckDto> {
    return this.work.runMarketCheck(
      parseOrThrow(marketCheckRequestSchema, body ?? {}),
    );
  }

  @Delete('market-checks/:id')
  @HttpCode(204)
  removeMarketCheck(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.work.removeMarketCheck(id);
  }

  /** A job application you track. */
  @Post('applications')
  addApplication(@Body() body: unknown): Promise<{ id: string }> {
    return this.work.addApplication(
      parseOrThrow(jobApplicationRequestSchema, body),
    );
  }

  @Put('applications/:id')
  @HttpCode(204)
  updateApplication(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<void> {
    return this.work.updateApplication(
      id,
      parseOrThrow(jobApplicationRequestSchema, body),
    );
  }

  @Delete('applications/:id')
  @HttpCode(204)
  removeApplication(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.work.removeApplication(id);
  }

  @Delete('feedback/:id')
  @HttpCode(204)
  removeFeedback(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.work.removeFeedback(id);
  }

  // ---- pension fund ----------------------------------------------------------

  /** What needs you, for the hub badge: pension dates and documents to review. */
  @Get('attention')
  attention(): Promise<LifeAttentionDto> {
    return this.work.attention();
  }

  /** The pension fund's dates (last day to top up, the non-deducted notice), for the Agenda. */
  @Get('deadlines')
  deadlines(@Query() query: unknown): Promise<DeadlineDto[]> {
    return this.work.deadlines(parseOrThrow(deadlinesQuerySchema, query));
  }

  @Post('pension/funds')
  addFund(@Body() body: unknown): Promise<{ id: string }> {
    return this.work.addFund(parseOrThrow(pensionFundRequestSchema, body));
  }

  @Put('pension/funds/:id')
  @HttpCode(204)
  updateFund(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<void> {
    return this.work.updateFund(
      id,
      parseOrThrow(pensionFundRequestSchema, body),
    );
  }

  /** Removes the fund with its statements and payments. */
  @Delete('pension/funds/:id')
  @HttpCode(204)
  removeFund(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.work.removeFund(id);
  }

  @Post('pension/statements')
  addStatement(@Body() body: unknown): Promise<{ id: string }> {
    return this.work.addStatement(
      parseOrThrow(pensionStatementRequestSchema, body),
    );
  }

  @Delete('pension/statements/:id')
  @HttpCode(204)
  removeStatement(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.work.removeStatement(id);
  }

  @Post('pension/payments')
  addPayment(@Body() body: unknown): Promise<{ id: string }> {
    return this.work.addPayment(
      parseOrThrow(pensionPaymentRequestSchema, body),
    );
  }

  @Delete('pension/payments/:id')
  @HttpCode(204)
  removePayment(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.work.removePayment(id);
  }

  /** The day you told the fund what you did not deduct in a year (null clears it). */
  @Put('pension/notices/:year')
  @HttpCode(204)
  setNotice(
    @Param('year', ParseIntPipe) year: number,
    @Body() body: unknown,
  ): Promise<void> {
    return this.work.setNotice(
      year,
      parseOrThrow(pensionNoticeRequestSchema, body ?? {}),
    );
  }

  /** Takes the figures of a fund statement you uploaded. */
  @Post('pension/documents/:uploadId/confirm')
  confirmStatement(
    @Param('uploadId', ParseUUIDPipe) uploadId: string,
    @Body() body: unknown,
  ): Promise<{ id: string; fundId: string }> {
    return this.work.confirmStatement(
      uploadId,
      parseOrThrow(pensionConfirmStatementRequestSchema, body ?? {}),
    );
  }

  @Post('pension/documents/:uploadId/dismiss')
  @HttpCode(204)
  dismissStatement(
    @Param('uploadId', ParseUUIDPipe) uploadId: string,
  ): Promise<void> {
    return this.work.dismissStatement(uploadId);
  }
}
