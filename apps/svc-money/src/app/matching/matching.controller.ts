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
  matchLinkRequestSchema,
  matchRejectRequestSchema,
  type MatchesDto,
  type MovementLinkDto,
} from '@life-island/contracts';
import { MatchingService } from './matching.service.js';

/**
 * Money matching (docs/guides/money-matching.md), and the movement and
 * account routes that must undo links first. Mounted before the records
 * controller, so these win over its generic `/:collection/:id` routes.
 */
@Controller()
export class MatchingController {
  constructor(
    @Inject(MatchingService) private readonly matching: MatchingService,
  ) {}

  /** What Money proposes, the items you can pick by hand, and the links. */
  @Get('matches')
  matches(): Promise<MatchesDto> {
    return this.matching.matches();
  }

  @Post('matches/links')
  link(@Body() body: unknown): Promise<MovementLinkDto[]> {
    return this.matching.link(parseOrThrow(matchLinkRequestSchema, body));
  }

  @Delete('matches/links/:id')
  @HttpCode(204)
  unlink(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.matching.unlink(id);
  }

  @Post('matches/rejections')
  @HttpCode(204)
  reject(@Body() body: unknown): Promise<void> {
    return this.matching.reject(parseOrThrow(matchRejectRequestSchema, body));
  }

  @Put('transactions/:id')
  @HttpCode(204)
  updateMovement(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<void> {
    return this.matching.updateMovement(id, body);
  }

  @Delete('transactions/:id')
  @HttpCode(204)
  removeMovement(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.matching.removeMovement(id);
  }

  @Delete('accounts/:id')
  @HttpCode(204)
  removeAccount(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.matching.removeAccount(id);
  }
}
