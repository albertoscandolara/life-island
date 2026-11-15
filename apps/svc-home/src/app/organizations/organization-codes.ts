/** The codes that identify a company: its tax code and VAT number. */
export interface CompanyCodes {
  taxCode: string | null;
  vatNumber: string | null;
  /** The codes of the duplicates merged into it. */
  mergedCodes?: readonly string[];
}

/** Every code a company is known by: its own, and those of the duplicates merged into it. */
export function codesOf(c: CompanyCodes): string[] {
  return [
    ...new Set(
      [c.taxCode, c.vatNumber, ...(c.mergedCodes ?? [])].filter(
        (x): x is string => !!x,
      ),
    ),
  ];
}

/**
 * Whether two companies' codes say they are different companies: both
 * print codes, and no code of one is a code of the other. An Italian
 * company's tax code is usually its VAT number, so one stored as the tax code
 * and the other as the VAT number are the same company. A code of a
 * duplicate merged into it counts as its own.
 */
export function codesDiffer(a: CompanyCodes, b: CompanyCodes): boolean {
  const [ca, cb] = [codesOf(a), codesOf(b)];
  if (!ca.length || !cb.length) return false;
  return !ca.some((code) => cb.includes(code));
}
