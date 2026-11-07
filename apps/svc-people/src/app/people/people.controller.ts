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
} from '@nestjs/common';
import { parseOrThrow } from '@life-island/be-nest';
import {
  approveReviewRequestSchema,
  markDocumentRequestSchema,
  mergePeopleRequestSchema,
  updatePersonRequestSchema,
  type PeopleOverviewDto,
  type PersonSummaryDto,
  type ResidenceHousesDto,
} from '@life-island/contracts';
import { HomeHouses } from './home-houses.js';
import { PeopleService } from './people.service.js';

@Controller()
export class PeopleController {
  constructor(
    @Inject(PeopleService) private readonly people: PeopleService,
    @Inject(HomeHouses) private readonly houses: HomeHouses,
  ) {}

  /** The Home area's houses, to pick one as a person's residence. */
  @Get('houses')
  residenceHouses(): Promise<ResidenceHousesDto> {
    return this.houses.list();
  }

  /** Everyone, their ID documents version by version, what waits for review, and expiry warnings. */
  @Get('overview')
  overview(): Promise<PeopleOverviewDto> {
    return this.people.overview();
  }

  /** Everyone in short, for the Houses area to offer as owners. */
  @Get('people')
  list(): Promise<PersonSummaryDto[]> {
    return this.people.summaries();
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

  /** Removes the person; their ID documents go back to review. */
  @Delete('people/:id')
  @HttpCode(204)
  removePerson(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.people.removePerson(id);
  }

  /** Merges the duplicate `from` into this person. */
  @Post('people/:id/merge')
  @HttpCode(204)
  mergePeople(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<void> {
    return this.people.mergePeople(
      id,
      parseOrThrow(mergePeopleRequestSchema, body),
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
