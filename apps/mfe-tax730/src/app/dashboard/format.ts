import { dateText, euro } from '@life-island/records-ui';
import {
  TAX730_EXPENSE_TYPE_LABELS,
  type Tax730AttachmentRole,
  type Tax730ExpenseType,
} from '@life-island/contracts';

/** Money and dates as every area writes them ("3.200,00 €", "5 nov 2026"). */
export const formatEuro = (value: number): string => euro(value);
export const formatDate = (iso: string): string => dateText(iso);
export const typeLabel = (type: string): string =>
  TAX730_EXPENSE_TYPE_LABELS[type as Tax730ExpenseType]?.en ?? type;

export const ROLE_LABELS: Record<Tax730AttachmentRole, string> = {
  INVOICE: 'Invoice',
  PAYMENT: 'Payment proof',
  CERTIFICATION: 'Certification',
  RETURN: 'Tax return',
  OTHER: 'Other document',
};
