import {
  REGISTRATION_CODES,
  VEHICLE_FIELD_DEFINITIONS,
  approveCarReviewRequestSchema,
  updateVehicleRequestSchema,
} from './cars.js';
import { categoryTemplateSchema } from './categories.js';

describe('car contracts', () => {
  it('reads the card with a valid template of at most 40 fields', () => {
    const template = categoryTemplateSchema.parse({
      fields: [
        ...VEHICLE_FIELD_DEFINITIONS.map((d) => ({
          key: d.key,
          label: d.label,
          type: d.type,
          description: d.description,
          ...('options' in d ? { options: [...d.options] } : {}),
          ...('unit' in d ? { unit: d.unit } : {}),
        })),
        { key: 'document_number', label: 'Document number', type: 'string' },
        { key: 'issue_date', label: 'Issue date', type: 'date' },
      ],
    });
    expect(template.fields).toHaveLength(40);
  });

  it('gives every field a code printed on the card, or none', () => {
    const codes = new Set<string>(REGISTRATION_CODES.map((c) => c.code));
    expect(codes.size).toBe(REGISTRATION_CODES.length);
    for (const d of VEHICLE_FIELD_DEFINITIONS)
      if (d.code) expect(codes.has(d.code)).toBe(true);
    expect(REGISTRATION_CODES.find((c) => c.code === 'P.3')?.meaning).toBe(
      'Type of fuel or power source',
    );
  });

  it('accepts only fields of the card in a review or an edit', () => {
    expect(
      approveCarReviewRequestSchema.parse({
        vehicleId: null,
        accept: ['engine.fuelKey'],
      }).accept,
    ).toEqual(['engine.fuelKey']);
    expect(() =>
      approveCarReviewRequestSchema.parse({ vehicleId: null, accept: ['x'] }),
    ).toThrow();
    expect(
      updateVehicleRequestSchema.parse({ values: { seatCount: 4 } }).values,
    ).toEqual({ seatCount: 4 });
  });
});
