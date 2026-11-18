import { houseSupply } from './house-supply-points.js';

describe('houseSupply', () => {
  it('takes the point billed last of each utility', () => {
    const supply = houseSupply(
      [],
      [
        {
          propertyId: 'h',
          utility: 'ELECTRICITY',
          code: 'IT001E11111111',
          lastDay: '2025-12-31',
          createdAt: '2025-01-01T00:00:00.000Z',
        },
        {
          propertyId: 'h',
          utility: 'ELECTRICITY',
          code: 'IT001E22222222',
          lastDay: '2026-09-30',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          propertyId: 'h',
          utility: 'GAS',
          code: '01680102015791',
          lastDay: '2026-08-31',
          createdAt: '2025-01-01T00:00:00.000Z',
        },
      ],
    );
    expect(supply.points).toEqual({
      ELECTRICITY: 'IT001E22222222',
      GAS: '01680102015791',
      WATER: null,
      INTERNET: null,
    });
    expect(supply.codes).toHaveLength(3);
  });

  it('lets a point with no bill yet take over from the old one', () => {
    const supply = houseSupply(
      [],
      [
        {
          propertyId: 'h',
          utility: 'ELECTRICITY',
          code: 'IT001E11111111',
          lastDay: '2026-09-30',
          createdAt: '2025-01-01T00:00:00.000Z',
        },
        {
          propertyId: 'h',
          utility: 'ELECTRICITY',
          code: 'IT001E22222222',
          lastDay: null,
          createdAt: '2026-11-15T00:00:00.000Z',
        },
      ],
    );
    expect(supply.points.ELECTRICITY).toBe('IT001E22222222');
  });

  it('files typed codes under their utility by shape', () => {
    expect(
      houseSupply(
        ['IT001E36435004', '0168 0102 0157 91', 'ACQ-778', '045 1234567'],
        [],
      ).points,
    ).toEqual({
      ELECTRICITY: 'IT001E36435004',
      GAS: '01680102015791',
      WATER: 'ACQ778',
      INTERNET: '0451234567',
    });
  });
});
