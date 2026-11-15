/** The codes that identify a company: its tax code and VAT number. */
export interface CompanyCodes {
  taxCode: string | null;
  vatNumber: string | null;
}

/**
 * Whether two companies' codes say they are different companies: both
 * print codes, and no code of one is a code of the other. An Italian
 * company's tax code is usually its VAT number, so one stored as the tax code
 * and the other as the VAT number are the same company.
 */
export function codesDiffer(a: CompanyCodes, b: CompanyCodes): boolean {
  const codes = (c: CompanyCodes) =>
    [c.taxCode, c.vatNumber].filter((x): x is string => !!x);
  const [ca, cb] = [codes(a), codes(b)];
  if (!ca.length || !cb.length) return false;
  return !ca.some((code) => cb.includes(code));
}
