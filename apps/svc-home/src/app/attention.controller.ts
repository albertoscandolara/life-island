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
 * data your documents suggest, waiting for review (listed for the Agenda). A bill paid by a
 * bank movement you matched in Money is not counted. A bill does not say when it was paid,
 * so a past due date is not counted as late.
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
          !b.bankPayment?.full &&
          b.dueDate !== null &&
          b.dueDate >= today &&
          b.dueDate <= soon,
      ).length,
      toReview: suggestions.length,
      items: suggestions.map((suggestion) => {
        const [first] = suggestion.documents.map((d) => d.uploadedAt).sort();
        const docs = suggestion.documents.length;
        return {
          id: `suggestion:${suggestion.key}`,
          kind: 'suggestion',
          title:
            suggestion.kind === 'new_house'
              ? `A new house: ${suggestion.name ?? 'from your documents'}`
              : 'New details for one of your houses',
          detail: `From ${docs} document${docs === 1 ? '' : 's'}: ${suggestion.documents
            .slice(0, 2)
            .map((d) => d.title)
            .join(', ')}${docs > 2 ? '…' : ''}`,
          since: first ? first.slice(0, 10) : null,
          path: '/home',
          action: 'Review',
        };
      }),
    };
  }
}
