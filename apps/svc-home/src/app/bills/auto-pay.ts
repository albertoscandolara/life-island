/*
 * Bills paid on their own. A supply contract whose bills are charged to
 * your bank account (domiciliazione bancaria, SDD) needs nothing from you on
 * the due date, so its bills never show as due or late in the agenda.
 *
 * What decides it, first match wins:
 * 1. your choice on the supply contract (`autoPay`), for every bill of it,
 *    past and future;
 * 2. what the bill itself prints as its payment method;
 * 3. what the latest bill of the same contract printed, so a new bill that
 *    prints nothing inherits it.
 */

export interface AutoPayBill {
  contractId: string | null;
  directDebit: boolean | null;
  issueDate: string | null;
  periodEnd: string | null;
  dueDate: string | null;
}

const dayOf = (bill: AutoPayBill) =>
  bill.issueDate ?? bill.periodEnd ?? bill.dueDate ?? '';

/** Per contract, what its latest bill that prints a payment method says. */
export function contractDirectDebit(
  bills: readonly AutoPayBill[],
): Map<string, boolean> {
  const latest = new Map<string, { day: string; directDebit: boolean }>();
  for (const bill of bills) {
    if (!bill.contractId || bill.directDebit === null) continue;
    const day = dayOf(bill);
    const seen = latest.get(bill.contractId);
    if (!seen || day >= seen.day)
      latest.set(bill.contractId, { day, directDebit: bill.directDebit });
  }
  return new Map([...latest].map(([id, v]) => [id, v.directDebit]));
}

/** Whether a bill is paid on its own. */
export function isAutoPaid(
  bill: Pick<AutoPayBill, 'directDebit'>,
  contractAutoPay: boolean | null | undefined,
  contractDetected: boolean | undefined,
): boolean {
  return contractAutoPay ?? bill.directDebit ?? contractDetected ?? false;
}
