import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { currentUser } from '@life-island/be-common';
import { parseOrThrow } from '@life-island/be-nest';
import {
  aiReserveRequestSchema,
  aiSettleRequestSchema,
  type AiGuardStatusDto,
  type AiReservationDto,
} from '@life-island/contracts';
import { AiGuardService } from './ai-guard.service.js';

/** The spending guard: reserve and settle are for the services only, never a browser. */
@Controller('ai-guard')
export class AiGuardController {
  constructor(@Inject(AiGuardService) private readonly guard: AiGuardService) {}

  /** The limits and what you used of them today. */
  @Get()
  status(): Promise<AiGuardStatusDto> {
    const user = currentUser();
    return this.guard.status(user && !user.internal ? user.id : null);
  }

  @Post('reserve')
  @HttpCode(200)
  async reserve(@Body() body: unknown): Promise<AiReservationDto> {
    internalOnly();
    return {
      reservationId: await this.guard.reserve(
        parseOrThrow(aiReserveRequestSchema, body),
      ),
    };
  }

  @Post('reservations/:id/settle')
  @HttpCode(204)
  async settle(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<void> {
    internalOnly();
    await this.guard.settle(
      id,
      parseOrThrow(aiSettleRequestSchema, body).actualUsd,
    );
  }
}

function internalOnly(): void {
  if (!currentUser()?.internal)
    throw new ForbiddenException(
      'Only the island services can reserve AI spending.',
    );
}
