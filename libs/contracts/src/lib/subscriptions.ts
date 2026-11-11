import { z } from 'zod';
import {
  lifeAmount,
  lifeName,
  lifeNote,
  lifeOptionalDate,
  lifeUrl,
  type LifeAiAnswerDto,
  type LifeRecord,
} from './life-schemas.js';

/*
 * Contracts & subscriptions (Allo, svc-subscriptions, mfe-subscriptions):
 * phone, internet, streaming, gym, insurances and every other contract that
 * renews on its own, with what it costs a year, when it renews, the last day
 * to cancel it and how its price changed, plus an AI renewal advisor.
 * (Electricity and gas live in Houses → Bills; car insurance in Cars.)
 */

export const SUBSCRIPTION_KINDS = [
  'phone',
  'internet',
  'streaming',
  'software',
  'gym',
  'insurance-home',
  'insurance-life',
  'insurance-health',
  'insurance-other',
  'bank',
  'rent',
  'membership',
  'other',
] as const;
export type SubscriptionKind = (typeof SUBSCRIPTION_KINDS)[number];
export const SUBSCRIPTION_KIND_LABELS: Record<SubscriptionKind, string> = {
  phone: 'Mobile phone',
  internet: 'Home internet',
  streaming: 'Streaming and music',
  software: 'Apps and cloud',
  gym: 'Gym and sport',
  'insurance-home': 'Home insurance',
  'insurance-life': 'Life insurance',
  'insurance-health': 'Health insurance',
  'insurance-other': 'Other insurance',
  bank: 'Bank and cards',
  rent: 'Rent or lease',
  membership: 'Membership',
  other: 'Other',
};

export const BILLING_CYCLES = [
  'monthly',
  'bimonthly',
  'quarterly',
  'half-yearly',
  'yearly',
] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];
export const BILLING_CYCLE_LABELS: Record<BillingCycle, string> = {
  monthly: 'Every month',
  bimonthly: 'Every 2 months',
  quarterly: 'Every 3 months',
  'half-yearly': 'Every 6 months',
  yearly: 'Every year',
};
export const BILLING_CYCLE_MONTHS: Record<BillingCycle, number> = {
  monthly: 1,
  bimonthly: 2,
  quarterly: 3,
  'half-yearly': 6,
  yearly: 12,
};

export const SUBSCRIPTION_STATUSES = [
  'active',
  'trial',
  'cancelling',
  'cancelled',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  active: 'Active',
  trial: 'Free trial',
  cancelling: 'Cancellation sent',
  cancelled: 'Cancelled',
};

export const USAGE_LEVELS = ['daily', 'weekly', 'rarely', 'never'] as const;
export type UsageLevel = (typeof USAGE_LEVELS)[number];
export const USAGE_LABELS: Record<UsageLevel, string> = {
  daily: 'Every day',
  weekly: 'Every week',
  rarely: 'Rarely',
  never: 'Never',
};

export const subscriptionRequestSchema = z.object({
  name: lifeName(120),
  provider: lifeNote(120),
  kind: z.enum(SUBSCRIPTION_KINDS).optional(),
  /** What one billing period costs. */
  cost: lifeAmount,
  cycle: z.enum(BILLING_CYCLES).optional(),
  startOn: lifeOptionalDate,
  /** The next renewal (or the trial's end). */
  renewsOn: lifeOptionalDate,
  autoRenew: z.boolean().optional(),
  /** Days of notice the contract asks before a renewal. */
  noticeDays: z.number().int().min(0).max(365).optional(),
  /** The end of a minimum term (vincolo), when cancelling costs a fee. */
  lockedUntil: lifeOptionalDate,
  status: z.enum(SUBSCRIPTION_STATUSES).optional(),
  usage: z.enum(USAGE_LEVELS).nullable().optional(),
  paidWith: lifeNote(80),
  cancelUrl: lifeUrl,
  notes: lifeNote(),
});
export type SubscriptionRequest = z.input<typeof subscriptionRequestSchema>;

export interface PriceChangeDto {
  date: string;
  from: number;
  to: number;
}

export type SubscriptionDto = LifeRecord<{
  name: string;
  provider: string | null;
  kind: SubscriptionKind;
  cost: number;
  cycle: BillingCycle;
  startOn: string | null;
  renewsOn: string | null;
  autoRenew: boolean;
  noticeDays: number;
  lockedUntil: string | null;
  status: SubscriptionStatus;
  usage: UsageLevel | null;
  paidWith: string | null;
  cancelUrl: string | null;
  notes: string | null;
}> & {
  yearly: number;
  monthly: number;
  /** The next renewal from today, rolled forward when it renews on its own. */
  nextRenewal: string | null;
  /** The last day to send the cancellation before that renewal. */
  cancelBy: string | null;
  daysToCancelBy: number | null;
  priceChanges: PriceChangeDto[];
};

export const renewalAdvisorOutputSchema = z.object({
  summary: z
    .string()
    .describe(
      'Two or three sentences: what the contracts cost and where the money goes',
    ),
  verdicts: z
    .array(
      z.object({
        name: z.string().describe('The contract name, as written'),
        verdict: z.enum(['keep', 'renegotiate', 'switch', 'cancel']),
        why: z
          .string()
          .describe('Why, from cost, usage, price changes and dates'),
        yearlySaving: z
          .number()
          .describe('A realistic saving per year in euro, 0 when keeping'),
        script: z
          .string()
          .describe(
            'What to say or write to the provider, two or three sentences, or empty',
          ),
      }),
    )
    .describe('One verdict per contract worth acting on, at most eight'),
  beforeYouCancel: z
    .array(z.string())
    .describe('Up to three things to check before cancelling anything'),
});
export type RenewalAdvisorOutput = z.infer<typeof renewalAdvisorOutputSchema>;
export type RenewalAdviceDto = LifeAiAnswerDto<RenewalAdvisorOutput>;

export interface SubscriptionsOverviewDto {
  today: string;
  items: SubscriptionDto[];
  totals: {
    monthly: number;
    yearly: number;
    active: number;
    /** Yearly cost of what you use rarely or never. */
    unused: number;
  };
  byKind: { kind: SubscriptionKind; yearly: number }[];
  advice: RenewalAdviceDto[];
  aiAdvisor: boolean;
}

/** Settings → Reminders: how early the cancel-by warning starts. */
export const SUBSCRIPTIONS_WARN_DAYS_SETTING = 'subscriptions.warn-days';
export const SUBSCRIPTIONS_WARN_DAYS_DEFAULT = 14;
