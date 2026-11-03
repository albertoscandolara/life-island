import {
  TAX730_EXPENSE_TYPE_LABELS,
  type Tax730AttachmentRole,
  type Tax730ExpenseType,
} from '@life-island/contracts';

const euro = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
});
const day = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

export const formatEuro = (value: number): string => euro.format(value);
export const formatDate = (iso: string): string =>
  day.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
export const typeLabel = (type: string): string =>
  TAX730_EXPENSE_TYPE_LABELS[type as Tax730ExpenseType]?.en ?? type;

export const ROLE_LABELS: Record<Tax730AttachmentRole, string> = {
  INVOICE: 'Invoice',
  PAYMENT: 'Payment proof',
  CERTIFICATION: 'Certification',
  OTHER: 'Other document',
};
