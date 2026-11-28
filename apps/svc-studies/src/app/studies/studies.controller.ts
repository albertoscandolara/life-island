import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { parseOrThrow } from '@life-island/be-nest';
import {
  certificationRequestSchema,
  deadlinesQuerySchema,
  type DeadlineDto,
  courseRequestSchema,
  outlineDecisionRequestSchema,
  scoutResourceRequestSchema,
  scoutScanRequestSchema,
  pathBuilderRequestSchema,
  pathCreateRequestSchema,
  pathOutlineRequestSchema,
  pathProgressRequestSchema,
  recallAnswerRequestSchema,
  teachBackRequestSchema,
  type TeachBackDto,
  stepProgressRequestSchema,
  studyPlanRequestSchema,
  studySessionRequestSchema,
  trainingPlatformRequestSchema,
  type PathOutlineRequest,
  type StudiesAttentionDto,
  type StudiesOverviewDto,
  type StudyPlanDto,
} from '@life-island/contracts';
import { ResourceScout } from './resource-scout.js';
import { StudiesService } from './studies.service.js';

@Controller()
export class StudiesController {
  constructor(
    @Inject(StudiesService) private readonly studies: StudiesService,
    @Inject(ResourceScout) private readonly scout: ResourceScout,
  ) {}

  /** Platforms, paths with your progress, courses, exams, sessions, statistics, reminders and plans. */
  @Get('overview')
  overview(): Promise<StudiesOverviewDto> {
    return this.studies.overview();
  }

  /** What needs you, for the island's badge. */
  @Get('attention')
  attention(): Promise<StudiesAttentionDto> {
    return this.studies.attention();
  }

  /** Renewals, exams and targets, for the Agenda. */
  @Get('deadlines')
  deadlines(@Query() query: unknown): Promise<DeadlineDto[]> {
    return this.studies.deadlines(parseOrThrow(deadlinesQuerySchema, query));
  }

  // ---- platforms
  @Post('platforms')
  addPlatform(@Body() body: unknown): Promise<{ id: string }> {
    return this.studies.addPlatform(
      parseOrThrow(trainingPlatformRequestSchema, body),
    );
  }

  @Put('platforms/:id')
  @HttpCode(204)
  updatePlatform(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<void> {
    return this.studies.updatePlatform(
      id,
      parseOrThrow(trainingPlatformRequestSchema, body),
    );
  }

  @Post('platforms/:id/opened')
  @HttpCode(204)
  platformOpened(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.studies.platformOpened(id);
  }

  @Delete('platforms/:id')
  @HttpCode(204)
  removePlatform(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.studies.removePlatform(id);
  }

  // ---- courses
  @Post('courses')
  addCourse(@Body() body: unknown): Promise<{ id: string }> {
    return this.studies.addCourse(parseOrThrow(courseRequestSchema, body));
  }

  @Put('courses/:id')
  @HttpCode(204)
  updateCourse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<void> {
    return this.studies.updateCourse(
      id,
      parseOrThrow(courseRequestSchema, body),
    );
  }

  @Delete('courses/:id')
  @HttpCode(204)
  removeCourse(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.studies.removeCourse(id);
  }

  // ---- certifications
  @Post('certifications')
  addCertification(@Body() body: unknown): Promise<{ id: string }> {
    return this.studies.addCertification(
      parseOrThrow(certificationRequestSchema, body),
    );
  }

  @Put('certifications/:id')
  @HttpCode(204)
  updateCertification(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<void> {
    return this.studies.updateCertification(
      id,
      parseOrThrow(certificationRequestSchema, body),
    );
  }

  @Delete('certifications/:id')
  @HttpCode(204)
  removeCertification(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.studies.removeCertification(id);
  }

  // ---- sessions
  @Post('sessions')
  addSession(@Body() body: unknown): Promise<{ id: string }> {
    return this.studies.addSession(
      parseOrThrow(studySessionRequestSchema, body),
    );
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  removeSession(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.studies.removeSession(id);
  }

  // ---- paths
  /** Add a topic: a curated template or a path of your own, followed from today. */
  @Post('paths')
  addPath(@Body() body: unknown): Promise<{ id: string }> {
    return this.studies.addPath(parseOrThrow(pathCreateRequestSchema, body));
  }

  /** The path builder (AI tool): a draft path for a topic, for the editor; nothing is saved. */
  @Post('paths/draft')
  @HttpCode(200)
  draftPath(
    @Body() body: unknown,
  ): Promise<{ outline: PathOutlineRequest; model: string }> {
    return this.studies.draftPath(parseOrThrow(pathBuilderRequestSchema, body));
  }

  /** Changes a path's card, stages and steps; your progress on kept steps stays. */
  @Put('paths/:pathId/outline')
  @HttpCode(204)
  editPath(
    @Param('pathId') pathId: string,
    @Body() body: unknown,
  ): Promise<void> {
    return this.studies.editPath(
      pathId,
      parseOrThrow(pathOutlineRequestSchema, body),
    );
  }

  /** Removes a path from yours, with its step progress; sessions stay logged. */
  @Delete('paths/:pathId')
  @HttpCode(204)
  removePath(@Param('pathId') pathId: string): Promise<void> {
    return this.studies.removePath(pathId);
  }

  @Put('paths/:pathId')
  @HttpCode(204)
  setPath(
    @Param('pathId') pathId: string,
    @Body() body: unknown,
  ): Promise<void> {
    return this.studies.setPath(
      pathId,
      parseOrThrow(pathProgressRequestSchema, body),
    );
  }

  @Put('steps/:stepId')
  @HttpCode(204)
  setStep(
    @Param('stepId') stepId: string,
    @Body() body: unknown,
  ): Promise<void> {
    return this.studies.setStep(
      stepId,
      parseOrThrow(stepProgressRequestSchema, body),
    );
  }

  /** Teach-back (AI tool): reviews a step you explained in your own words. */
  @Post('steps/:stepId/teach-back')
  @HttpCode(200)
  teachBack(
    @Param('stepId') stepId: string,
    @Body() body: unknown,
  ): Promise<TeachBackDto> {
    return this.studies.teachBack(
      stepId,
      parseOrThrow(teachBackRequestSchema, body),
    );
  }

  /** Your answer to a recall question: it comes back later, or starts again. */
  @Post('recall/:id')
  @HttpCode(204)
  answerRecall(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<void> {
    return this.studies.answerRecall(
      id,
      parseOrThrow(recallAnswerRequestSchema, body),
    );
  }

  // ---- coach
  /** Plans your week (Claude API, or Life Island's own rules). */
  @Post('plans')
  writePlan(@Body() body: unknown): Promise<StudyPlanDto> {
    return this.studies.writePlan(parseOrThrow(studyPlanRequestSchema, body));
  }

  @Delete('plans/:id')
  @HttpCode(204)
  removePlan(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.studies.removePlan(id);
  }

  // ---- resource scout
  /** Refresh now: scans one path you follow in the background. */
  @Post('scout/scans')
  @HttpCode(202)
  scan(@Body() body: unknown): Promise<{ id: string }> {
    return this.scout.refresh(
      parseOrThrow(scoutScanRequestSchema, body).pathId,
    );
  }

  /** Pin a resource the scout found (or keep a flagged one), or dismiss it. */
  @Put('scout/resources/:id')
  @HttpCode(204)
  decideResource(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<void> {
    return this.scout.decideResource(
      id,
      parseOrThrow(scoutResourceRequestSchema, body).status,
    );
  }

  /** Accept or decline a change to a path's outline. */
  @Put('scout/changes/:id')
  @HttpCode(204)
  decideChange(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<void> {
    return this.scout.decideChange(
      id,
      parseOrThrow(outlineDecisionRequestSchema, body).decision,
    );
  }
}
