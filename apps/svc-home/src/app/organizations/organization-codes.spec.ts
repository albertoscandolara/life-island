import { codesDiffer } from './organization-codes.js';

describe('codesDiffer', () => {
  const c = (taxCode: string | null, vatNumber: string | null = null) => ({
    taxCode,
    vatNumber,
  });

  it('needs codes on both sides to tell companies apart', () => {
    expect(codesDiffer(c(null), c('02038940223'))).toBe(false);
    expect(codesDiffer(c(null, null), c(null, null))).toBe(false);
  });

  it('reads a tax code and a VAT number with the same digits as one company', () => {
    expect(codesDiffer(c('02038940223'), c(null, '02038940223'))).toBe(false);
    expect(
      codesDiffer(c('RSSMRA80A01H501U', '02038940223'), c('02038940223')),
    ).toBe(false);
  });

  it('tells two companies apart by different codes', () => {
    expect(codesDiffer(c('02038940223'), c('01234567890'))).toBe(true);
    expect(codesDiffer(c(null, '02038940223'), c(null, '01234567890'))).toBe(
      true,
    );
  });
});
