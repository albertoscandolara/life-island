import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { RecordCollection } from '@life-island/be-nest';
import {
  checkupRequestSchema,
  medicineRequestSchema,
  testResultRequestSchema,
  vaccinationRequestSchema,
  visitRequestSchema,
} from '@life-island/contracts';
import {
  checkups,
  medicines,
  testResults,
  vaccinations,
  visits,
} from '../db/schema.js';

export const RECORDS = Symbol('HealthRecords');

/** Health's plain records. */
export function collections(_db: NodePgDatabase): RecordCollection[] {
  return [
    {
      name: 'visits',
      label: 'Visit',
      table: visits,
      request: visitRequestSchema,
    },
    {
      name: 'medicines',
      label: 'Medicine',
      table: medicines,
      request: medicineRequestSchema,
    },
    {
      name: 'results',
      label: 'Result',
      table: testResults,
      request: testResultRequestSchema,
    },
    {
      name: 'vaccinations',
      label: 'Vaccination',
      table: vaccinations,
      request: vaccinationRequestSchema,
    },
    {
      name: 'checkups',
      label: 'Checkup',
      table: checkups,
      request: checkupRequestSchema,
    },
  ];
}
