import { Controller, Get, Inject } from '@nestjs/common';
import {
  isoAddDays,
  isoToday,
  type LifeAttentionDto,
} from '@life-island/contracts';
import { BillsService } from './bills/bills.service.js';
import { HouseSuggestionsService } from './houses/house-suggestions.service.js';

/**
 * What needs you in Home, for the hub badge (`GET /attention`): bills due in
 * the next 7 days that are not paid by direct debit, and the houses and house
 * data your documents suggest, waiting for review. A bill does not say when
 * it was paid, so a past due date is not counted as late.
 */
@Controller()
export class HomeAttentionController {
  constructor(
    @Inject(BillsService) private readonly bills: BillsService,
    @Inject(HouseSuggestionsService)
    private readonly suggestions: HouseSuggestionsService,
  ) {}

  @Get('attention')
  async attention(): Promise<LifeAttentionDto> {
    const today = isoToday(process.env['SETTINGS_TIMEZONE'] || 'Europe/Rome');
    const soon = isoAddDays(today, 7);
    const [bills, suggestions] = await Promise.all([
      this.bills.list({ utility: undefined }),
      this.suggestions.list(),
    ]);
    return {
      expired: 0,
      expiring: bills.filter(
        (b) =>
          !b.autoPaid &&
          b.dueDate !== null &&
          b.dueDate >= today &&
          b.dueDate <= soon,
      ).length,
      toReview: suggestions.length,
    };
  }
}
