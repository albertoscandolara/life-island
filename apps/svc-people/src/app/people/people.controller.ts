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
  setRelationRequestSchema,
  updatePersonRequestSchema,
  type PeopleAttentionDto,
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

  /** What needs you (expired, expiring, to review), for the island hub. */
  @Get('attention')
  attention(): Promise<PeopleAttentionDto> {
    return this.people.attention();
  }

  /** Everyone in short, with their driving licence, for the Houses and Cars areas. */
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

  /** Sets how another person is related to this one. */
  @Post('people/:id/relations')
  @HttpCode(204)
  setRelation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<void> {
    return this.people.setRelation(
      id,
      parseOrThrow(setRelationRequestSchema, body),
    );
  }

  @Delete('people/:id/relations/:otherId')
  @HttpCode(204)
  removeRelation(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('otherId', ParseUUIDPipe) otherId: string,
  ): Promise<void> {
    return this.people.removeRelation(id, otherId);
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
