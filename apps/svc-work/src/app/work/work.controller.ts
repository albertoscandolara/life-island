import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { parseOrThrow } from '@life-island/be-nest';
import {
  approveWorkReviewRequestSchema,
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
}
