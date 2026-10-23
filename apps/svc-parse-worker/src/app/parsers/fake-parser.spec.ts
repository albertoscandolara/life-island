import { findTarget } from '@life-island/contracts';
import { FakeParser } from './fake-parser.js';

describe('FakeParser', () => {
  const parser = new FakeParser();
  const parse = (
    filename: string,
    text = '',
    description: string | null = null,
  ) =>
    parser.parse({
      document: { kind: 'text', text },
      filename,
      title: filename,
      description,
    });

  it.each([
    ['scontrino-esselunga.jpg', 'grocery.receipt@1', 'groceries'],
    ['farmacia.pdf', 'tax730.expense@1', 'tax730'],
    ['contract.pdf', 'general.document@1', 'other'],
  ])(
    'classifies %s as %s with details valid for that target',
    async (filename, targetKey, category) => {
      const result = await parse(filename);
      expect(result).toMatchObject({
        targetKey,
        category,
        flags: ['fake_parser'],
      });
      expect(
        findTarget(targetKey)?.schema.safeParse(result.details).success,
      ).toBe(true);
    },
  );

  it('reads keywords from the text too', async () => {
    expect(
      (await parse('scan.txt', 'CONAD superstore TOTALE 12,00')).targetKey,
    ).toBe('grocery.receipt@1');
  });

  it('suggests a description only when the uploader left it empty', async () => {
    expect((await parse('a.txt')).description).toBeTruthy();
    expect((await parse('a.txt', '', 'mine')).description).toBeUndefined();
  });
});
