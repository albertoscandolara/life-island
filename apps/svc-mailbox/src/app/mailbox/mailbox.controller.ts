import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { parseOrThrow } from '@life-island/be-nest';
import {
  deadlinesQuerySchema,
  type DeadlineDto,
  type LetterDto,
  type LifeAttentionDto,
  type MailboxOverviewDto,
} from '@life-island/contracts';
import { MailboxService } from './mailbox.service.js';

@Controller()
export class MailboxController {
  constructor(@Inject(MailboxService) private readonly mailbox: MailboxService) {}

  /** Every letter, open ones first by date, with the totals. */
  @Get('overview')
  overview(): Promise<MailboxOverviewDto> {
    return this.mailbox.overview();
  }

  /** The dates open letters ask you to act by, for the Agenda. */
  @Get('deadlines')
  deadlines(@Query() query: unknown): Promise<DeadlineDto[]> {
    return this.mailbox.deadlines(parseOrThrow(deadlinesQuerySchema, query));
  }

  @Get('attention')
  attention(): Promise<LifeAttentionDto> {
    return this.mailbox.attention();
  }

  /** The letter explainer (Claude, or Life Island's own reading). */
  @Post('letters/:id/explain')
  explain(@Param('id', ParseUUIDPipe) id: string): Promise<LetterDto> {
    return this.mailbox.explain(id);
  }

  /** Fills the letter's empty fields from its explanation. */
  @Post('letters/:id/apply-explanation')
  @HttpCode(204)
  applyExplanation(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.mailbox.applyExplanation(id);
  }
}
