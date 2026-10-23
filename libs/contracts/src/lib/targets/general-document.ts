import { z } from 'zod';
import { isIsoDate } from './validators.js';

/**
 * general.document@1: anything no domain module handles yet (a bill, a
 * contract, a letter). It still gets a category and structured key facts, so
 * it can be reclassified when a module for it exists.
 */
export const GeneralDocumentV1 = z.object({
  documentType: z
    .string()
    .describe('What the document is, in a few words, e.g. "electricity bill"'),
  issuer: z.string().optional(),
  date: z
    .string()
    .optional()
    .describe('Main date on the document, YYYY-MM-DD')
    .refine(
      (value) => value === undefined || isIsoDate(value),
      'expected YYYY-MM-DD',
    ),
  amount: z
    .number()
    .optional()
    .describe('Main amount, if the document has one'),
  currency: z.string().optional(),
  summary: z
    .string()
    .describe('Two or three sentences on what the document says'),
  keyFacts: z
    .array(z.object({ label: z.string(), value: z.string() }))
    .describe('Other useful facts, e.g. contract number, due date'),
});
export type GeneralDocumentV1 = z.infer<typeof GeneralDocumentV1>;
