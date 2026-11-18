import { Controller, Get, Inject } from '@nestjs/common';
import {
  isoAddDays,
  isoToday,
  unitPriceText,
  UTILITIES,
  type BillDto,
  type LifeAttentionDto,
  type LifeAttentionItemDto,
} from '@life-island/contracts';
import { BillsService } from './bills/bills.service.js';
import {
  contractPrices,
  PRICE_RISE_ATTENTION_DAYS,
  priceUnit,
} from './bills/prices.js';
import { HouseSuggestionsService } from './houses/house-suggestions.service.js';

/**
 * What needs you in Home, for the hub badge (`GET /attention`): bills due in
 * the next 7 days that are not paid by direct debit, a price (an internet
 * fee, a price per kWh or Smc) that just went up, and the houses and house data your documents suggest,
 * waiting for review (listed for the Agenda). A bill paid by a
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
    const rises = priceRises(bills, today);
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
      toReview: suggestions.length + rises.length,
      items: [
        ...rises,
        ...suggestions.map((suggestion) => {
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
      ],
    };
  }
}

/**
 * Prices that went up in the last weeks, one item per contract: an internet
 * fee, or a price per kWh, Smc or m³ that rose against the bills before. A
 * price rise or a promo that ended, worth a look while you can still leave
 * without penalties. Only the contract each supply point is billed under now.
 */
export function priceRises(
  bills: readonly BillDto[],
  today: string,
): LifeAttentionItemDto[] {
  const latest = new Map<string, { day: string; contractId: string }>();
  for (const bill of bills) {
    const point = bill.supplyPointId ?? bill.contractId;
    const day = bill.periodStart ?? bill.issueDate ?? '';
    if (!point || !bill.contractId) continue;
    const seen = latest.get(point);
    if (!seen || day > seen.day)
      latest.set(point, { day, contractId: bill.contractId });
  }
  const current = new Set([...latest.values()].map((v) => v.contractId));
  const from = isoAddDays(today, -PRICE_RISE_ATTENTION_DAYS);
  return [...contractPrices(bills)].flatMap(([id, { change }]) => {
    if (
      !current.has(id) ||
      !change ||
      change.to <= change.from ||
      change.since < from
    )
      return [];
    const bill = bills.find((b) => b.uploadId === change.uploadId);
    if (!bill) return [];
    const unit = priceUnit(bill.utility);
    const label = UTILITIES[bill.utility].label;
    const percent = Math.round(((change.to - change.from) / change.from) * 100);
    return [
      {
        id: `price-rise:${id}:${change.since}`,
        kind: 'price-rise',
        title: `${label} price went up${bill.provider ? `: ${bill.provider}` : ''}`,
        detail: `${unitPriceText(change.from, unit)} → ${unitPriceText(change.to, unit)} (+${percent}%) since ${change.since}. A supplier that changes the terms lets you leave without penalties: compare offers before the deadline in its notice.`,
        since: change.since <= today ? change.since : today,
        path: '/home/bills',
        action: 'Compare offers',
      },
    ];
  });
}
