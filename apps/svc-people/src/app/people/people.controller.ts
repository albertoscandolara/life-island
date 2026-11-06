import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { parseOrThrow } from '@life-island/be-nest';
import {
  approveReviewRequestSchema,
  markDocumentRequestSchema,
  updatePersonRequestSchema,
  type PeopleOverviewDto,
} from '@life-island/contracts';
import { PeopleService } from './people.service.js';

@Controller()
export class PeopleController {
  constructor(@Inject(PeopleService) private readonly people: PeopleService) {}

  /** Everyone, their ID documents version by version, what waits for review, and expiry warnings. */
  @Get('overview')
  overview(): Promise<PeopleOverviewDto> {
    return this.people.overview();
  }

  @Patch('people/:id')
  @HttpCode(204)
  updatePerson(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<void> {
    return this.people.updatePerson(
      id,
      parseOrThrow(updatePersonRequestSchema, body),
    );
  }

  @Post('reviews/:uploadId/approve')
  @HttpCode(204)
  async approve(
    @Param('uploadId', ParseUUIDPipe) uploadId: string,
    @Body() body: unknown,
  ): Promise<void> {
    await this.people.approve(
      uploadId,
      parseOrThrow(approveReviewRequestSchema, body),
    );
  }

  @Post('reviews/:uploadId/reject')
  @HttpCode(204)
  reject(@Param('uploadId', ParseUUIDPipe) uploadId: string): Promise<void> {
    return this.people.reject(uploadId);
  }

  @Post('reviews/:uploadId/reopen')
  @HttpCode(204)
  reopen(@Param('uploadId', ParseUUIDPipe) uploadId: string): Promise<void> {
    return this.people.reopen(uploadId);
  }

  @Patch('documents/:uploadId')
  @HttpCode(204)
  mark(
    @Param('uploadId', ParseUUIDPipe) uploadId: string,
    @Body() body: unknown,
  ): Promise<void> {
    return this.people.mark(
      uploadId,
      parseOrThrow(markDocumentRequestSchema, body),
    );
  }
}
