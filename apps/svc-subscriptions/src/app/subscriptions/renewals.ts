import {
  BILLING_CYCLE_MONTHS,
  isoAddDays,
  isoAddMonths,
  isoDaysBetween,
  SUBSCRIPTION_KIND_LABELS,
  USAGE_LABELS,
  type RenewalAdvisorOutput,
  type SubscriptionDto,
} from '@life-island/contracts';

/*
 * Contracts as a pure computation: what each costs a month and a year, when
 * it renews next, and the last day to cancel before it does.
 */

const round = (v: number) => Math.round(v * 100) / 100;

export const isLive = (s: Pick<SubscriptionDto, 'status'>) =>
  s.status === 'active' || s.status === 'trial' || s.status === 'cancelling';

export function withRenewal(
  item: Omit<SubscriptionDto, 'yearly' | 'monthly' | 'nextRenewal' | 'cancelBy' | 'daysToCancelBy'>,
  today: string,
): SubscriptionDto {
  const months = BILLING_CYCLE_MONTHS[item.cycle];
  const monthly = round(item.cost / months);
  let next = item.renewsOn;
  if (next && item.autoRenew && item.status !== 'cancelled')
    for (let i = 1; next < today && i < 1200; i++) next = isoAddMonths(item.renewsOn!, months * i);
  if (item.status === 'cancelled' || (next && next < today)) next = null;
  const watch = next && item.autoRenew && (item.status === 'active' || item.status === 'trial');
  const cancelBy = watch ? isoAddDays(next!, -item.noticeDays) : null;
  return {
    ...item,
    monthly,
    yearly: round(monthly * 12),
    nextRenewal: next,
    cancelBy,
    daysToCancelBy: cancelBy ? isoDaysBetween(today, cancelBy) : null,
  };
}

const eur = (v: number) => `€${Math.round(v)}`;

export function offlineAdvice(items: readonly SubscriptionDto[]): RenewalAdvisorOutput {
  const live = items.filter(isLive);
  if (!live.length)
    return {
      summary: 'There are no contracts yet. Add your phone, internet, streaming and insurance to see what they cost a year.',
      verdicts: [],
      beforeYouCancel: [],
    };
  const yearly = live.reduce((s, i) => s + i.yearly, 0);
  const verdicts: RenewalAdvisorOutput['verdicts'] = [];
  for (const i of live) {
    const locked = i.lockedUntil && i.lockedUntil > (i.nextRenewal ?? '');
    if (i.usage === 'never' || i.usage === 'rarely')
      verdicts.push({
        name: i.name,
        verdict: locked ? 'renegotiate' : 'cancel',
        why: `You use it ${USAGE_LABELS[i.usage].toLowerCase()} and it costs ${eur(i.yearly)} a year.${locked ? ` It is locked until ${i.lockedUntil}.` : ''}`,
        yearlySaving: locked ? 0 : Math.round(i.yearly),
        script: locked
          ? ''
          : `I would like to cancel my ${i.name} contract at the end of the current period. Please confirm the cancellation and the last charge in writing.`,
      });
    else if (i.priceChanges.some((p) => p.to > p.from))
      verdicts.push({
        name: i.name,
        verdict: 'renegotiate',
        why: `The price went up (${i.priceChanges.map((p) => `${eur(p.from)} → ${eur(p.to)}`).join(', ')}). Providers often keep you with an offer.`,
        yearlySaving: Math.round(i.yearly * 0.15),
        script: `My ${i.name} price went up and I found cheaper offers. Can you give me a better price, or I will switch at the renewal?`,
      });
    else if ((i.kind === 'phone' || i.kind === 'internet') && i.monthly > (i.kind === 'phone' ? 12 : 30))
      verdicts.push({
        name: i.name,
        verdict: 'switch',
        why: `${eur(i.monthly)} a month is above the usual offers for ${SUBSCRIPTION_KIND_LABELS[i.kind].toLowerCase()} in Italy; compare before the renewal.`,
        yearlySaving: Math.round((i.monthly - (i.kind === 'phone' ? 8 : 25)) * 12),
        script: '',
      });
  }
  return {
    summary: `${live.length} contracts cost ${eur(yearly)} a year (${eur(yearly / 12)} a month).${verdicts.length ? ` ${verdicts.length} look worth acting on.` : ' Nothing stands out.'}`,
    verdicts: verdicts.sort((a, b) => b.yearlySaving - a.yearlySaving).slice(0, 8),
    beforeYouCancel: [
      'Check the minimum term (vincolo): leaving early can cost a fee or the rest of a device.',
      'Send the cancellation by PEC or registered letter when the contract asks for it, and keep the receipt.',
      'Remove the card or the direct debit only after the cancellation is confirmed.',
    ],
  };
}

export const ADVISOR_INSTRUCTIONS = `You help one person in Italy keep their contracts and subscriptions under control with Life Island.

You receive their contracts: kind, cost and billing cycle, yearly cost, next renewal and last day to cancel, minimum term (vincolo), how often they use it, and price changes. Write:
- summary: two or three sentences on what the contracts cost and where the money goes.
- verdicts: for each contract worth acting on (at most eight): keep, renegotiate, switch or cancel; why (cost, usage, price rises, dates); a realistic yearly saving in euro; and a short script to say or write to the provider (empty when keeping).
- beforeYouCancel: up to three things to check before cancelling (vincolo, notice, PEC, direct debit).

Rules: use only the data given, never invent a price or an offer by name. Mention the cancel-by date when it is near. Plain English, no emojis.`;

export function advisorDossier(today: string, items: readonly SubscriptionDto[]): string {
  const lines = [`Today is ${today}.`];
  for (const i of items.filter(isLive))
    lines.push(
      `- ${i.name} (${SUBSCRIPTION_KIND_LABELS[i.kind]}${i.provider ? `, ${i.provider}` : ''}, ${i.status}): €${i.cost} per ${i.cycle}, €${i.yearly} a year; ` +
        `usage ${i.usage ? USAGE_LABELS[i.usage].toLowerCase() : 'unknown'}; ` +
        `next renewal ${i.nextRenewal ?? 'unknown'}${i.cancelBy ? `, cancel by ${i.cancelBy}` : ''}${i.lockedUntil ? `, locked until ${i.lockedUntil}` : ''}` +
        (i.priceChanges.length ? `; price changes: ${i.priceChanges.map((p) => `${p.date} €${p.from}→€${p.to}`).join(', ')}` : ''),
    );
  return lines.join('\n');
}
