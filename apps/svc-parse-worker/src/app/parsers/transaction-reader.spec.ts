import { proposeLinks } from '@life-island/ingestion-db';
import { describe, expect, it } from 'vitest';
import {
  NOTARY_QUOTE as QUOTE,
  NOTARY_TRANSFER as TRANSFER,
} from '../testing/notary-sample.js';
import { parseAmount, readTransactionText } from './transaction-reader.js';

describe('parseAmount', () => {
  it('reads Italian and English amounts', () => {
    expect(parseAmount('€ 6.500,00')).toBe(6500);
    expect(parseAmount('0,00')).toBe(0);
    expect(parseAmount('6,500.00')).toBe(6500);
    expect(parseAmount('12.50 EUR')).toBe(12.5);
  });
});

describe('readTransactionText', () => {
  it('reads the sample transfer from its content', () => {
    const facts = readTransactionText(TRANSFER);
    expect(facts).toMatchObject({
      role: 'PAYMENT',
      documentNumber: 'A100000000000000000000000001IT',
      issueDate: '2025-07-14',
      paymentDate: '2025-07-15',
      amount: 6500,
      fees: 0,
      currency: 'EUR',
      counterparty: {
        name: 'Notaio Bianchi Avvocato Paolo',
        iban: 'IT11B0760111700000000777888',
      },
      customer: {
        name: 'ROSSI MARIO',
        iban: 'IT02A0300203280000000001234',
      },
      paymentKind: 'BALANCE',
    });
    expect(facts.description).toBe(
      'Saldo atto notarile prima casa in via Verdi 9 a Verona del 2 Luglio 2025 come da preventivo del 27 Giugno 2025',
    );
    expect(facts.references).toContainEqual({
      kind: 'quote',
      number: null,
      date: '2025-06-27',
    });
  });

  it('reads the sample quote, IBAN from the stamp included', () => {
    expect(readTransactionText(QUOTE)).toMatchObject({
      role: 'QUOTE',
      documentNumber: '0',
      issueDate: '2025-06-27',
      amount: 6500,
      counterparty: {
        name: 'Notaio Bianchi Avv. Paolo',
        vatNumber: '00999888777',
        taxCode: 'BNC PLA 51A22 F839G',
        iban: 'IT11B0760111700000000777888',
      },
      customer: { name: 'ROSSI MARIO', taxCode: 'RSSMRA80A01L781X' },
      description: 'Compravendita 218.000',
    });
  });

  it('links the two on their content alone, in either order', () => {
    const quote = { uploadId: 'quote', facts: readTransactionText(QUOTE) };
    const transfer = {
      uploadId: 'transfer',
      facts: readTransactionText(TRANSFER),
    };
    const links = proposeLinks([transfer, quote]);
    expect(proposeLinks([quote, transfer])).toEqual(links);
    expect(links).toEqual([
      expect.objectContaining({
        invoiceUploadId: 'quote',
        paymentUploadId: 'transfer',
        status: 'AUTO',
      }),
    ]);
  });

  it('leaves documents that are not about money alone', () => {
    expect(readTransactionText('Carta di identità\nCognome ROSSI').role).toBe(
      'NONE',
    );
  });
});
