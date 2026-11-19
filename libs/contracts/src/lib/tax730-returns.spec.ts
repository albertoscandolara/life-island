import { taxYearOfFiling, telematicFilingOf } from './tax730-returns.js';

describe('telematicFilingOf', () => {
  it('reads the protocol, day and tax code of a filed return', () => {
    expect(
      telematicFilingOf('UNI T2311131450352240926 RSSMRA80A01H501U.pdf'),
    ).toEqual({
      protocol: 'T2311131450352240926',
      receivedOn: '2023-11-13',
      taxCode: 'RSSMRA80A01H501U',
    });
    expect(telematicFilingOf('uni_t260918153607692974')?.receivedOn).toBe(
      '2026-09-18',
    );
  });

  it('is null for any other file', () => {
    expect(telematicFilingOf('UNI cedolino giugno.pdf')).toBeNull();
    expect(telematicFilingOf('Busta paga T2311131450352240926')).toBeNull();
    expect(telematicFilingOf('UNI T2313401450352240926')).toBeNull();
    expect(telematicFilingOf(null)).toBeNull();
  });
});

describe('taxYearOfFiling', () => {
  it('is the year before, or two before for a late return', () => {
    expect(taxYearOfFiling('2026-09-18')).toBe(2025);
    expect(taxYearOfFiling('2025-01-20')).toBe(2023);
  });
});
