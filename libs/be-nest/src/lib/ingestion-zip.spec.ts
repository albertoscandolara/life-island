import JSZip from 'jszip';
import type { Readable } from 'node:stream';
import { unavailableFilesNote, zipFromIngestion } from './ingestion-zip.js';

async function unzip(stream: Readable): Promise<JSZip> {
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
  return JSZip.loadAsync(bytes);
}

describe('zipFromIngestion', () => {
  it('reads each file once, adds the extras and names what could not be read', async () => {
    const reads: string[] = [];
    const ingestion = {
      read: async (id: string) => {
        reads.push(id);
        if (id === 'broken') throw new Error('gone');
        return Buffer.from(`file ${id}`);
      },
    };
    const zip = await unzip(
      await zipFromIngestion(ingestion, {
        files: [
          { uploadId: 'a', path: 'Root/a.pdf' },
          { uploadId: 'a', path: 'Root/copy of a.pdf' },
          { uploadId: 'broken', path: 'Root/b.pdf' },
        ],
        extra: [{ path: 'Root/summary.txt', body: 'hello' }],
        missingNote: unavailableFilesNote('Root'),
      }),
    );
    expect(reads.sort()).toEqual(['a', 'broken']);
    expect(await zip.file('Root/a.pdf')?.async('string')).toBe('file a');
    expect(await zip.file('Root/copy of a.pdf')?.async('string')).toBe(
      'file a',
    );
    expect(await zip.file('Root/summary.txt')?.async('string')).toBe('hello');
    expect(zip.file('Root/b.pdf')).toBeNull();
    expect(
      await zip.file('Root/DOCUMENTI NON DISPONIBILI.txt')?.async('string'),
    ).toContain('- b.pdf');
  });

  it('adds no note when every file is read', async () => {
    const zip = await unzip(
      await zipFromIngestion(
        { read: async () => Buffer.from('x') },
        {
          files: [{ uploadId: 'a', path: 'Root/a.pdf' }],
          missingNote: unavailableFilesNote('Root'),
        },
      ),
    );
    expect(Object.keys(zip.files)).toEqual(['Root/', 'Root/a.pdf']);
  });
});
