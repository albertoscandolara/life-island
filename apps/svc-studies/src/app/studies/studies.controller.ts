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
} from '@nestjs/common';
import { parseOrThrow } from '@life-island/be-nest';
import {
  certificationRequestSchema,
  courseRequestSchema,
  pathProgressRequestSchema,
  stepProgressRequestSchema,
  studyPlanRequestSchema,
  studySessionRequestSchema,
  trainingPlatformRequestSchema,
  type StudiesAttentionDto,
  type StudiesOverviewDto,
  type StudyPlanDto,
} from '@life-island/contracts';
import { StudiesService } from './studies.service.js';

@Controller()
export class StudiesController {
  constructor(
    @Inject(StudiesService) private readonly studies: StudiesService,
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
}
