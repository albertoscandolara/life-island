import type { RecordDetailDto, RecordDto } from '@life-island/contracts';
import {
  canReparse,
  reflects,
  reparseNotice,
  statusFromParam,
  statusToParam,
} from './inbox-page';

describe('inbox status filter in the URL', () => {
  it('opens on the review queue, and keeps "any status" explicit', () => {
    expect(statusFromParam(null)).toBe('PARSED');
    expect(statusFromParam('all')).toBeNull();
    expect(statusFromParam('REJECTED')).toBe('REJECTED');
    expect(statusFromParam('nonsense')).toBe('PARSED');
    expect(statusToParam('PARSED')).toBeUndefined();
    expect(statusToParam(null)).toBe('all');
    expect(statusToParam('LOADED')).toBe('LOADED');
  });
});

describe('reflects', () => {
  const record = {
    id: 'r1',
    uploadId: 'u1',
    title: 'Bolletta',
    description: null,
    categories: ['BILL'],
    status: 'PARSED',
  } as RecordDto;
  const changes = {
    uploadId: 'u1',
    title: 'Bolletta acqua',
    description: null,
    categories: ['BILL'],
  };

  it('waits until the inbox shows your edits', () => {
    expect(reflects(record, { kind: 'saved', changes })).toBe(false);
    expect(
      reflects(
        { ...record, title: 'Bolletta acqua' },
        { kind: 'saved', changes },
      ),
    ).toBe(true);
  });

  it('checks the status of a decision, and the edits that came with it', () => {
    const confirmed = { id: 'r1', status: 'CONFIRMED' } as RecordDetailDto;
    expect(reflects(record, { kind: 'status', record: confirmed })).toBe(false);
    expect(
      reflects(
        { ...record, status: 'CONFIRMED' },
        { kind: 'status', record: confirmed, changes },
      ),
    ).toBe(false);
    expect(
      reflects(
        { ...record, status: 'CONFIRMED', title: 'Bolletta acqua' },
        { kind: 'status', record: confirmed, changes },
      ),
    ).toBe(true);
  });
});

describe('parse again', () => {
  it('offers only records waiting for review', () => {
    expect(canReparse({ status: 'PARSED' })).toBe(true);
    expect(canReparse({ status: 'PARSE_FAILED' })).toBe(true);
    for (const status of [
      'UPLOADED',
      'PARSING',
      'CONFIRMED',
      'LOADED',
      'REJECTED',
    ] as const)
      expect(canReparse({ status })).toBe(false);
  });

  it('says how many documents go back to the parser, and how many stayed', () => {
    expect(reparseNotice({ requeued: ['a'], skipped: [] })).toBe(
      '1 document sent back to the AI: reading starts now.',
    );
    expect(reparseNotice({ requeued: ['a', 'b'], skipped: ['c'] })).toBe(
      '2 documents sent back to the AI: reading starts now. 1 was left as it was: not waiting for review or failed.',
    );
    expect(reparseNotice({ requeued: [], skipped: ['c', 'd'] })).toBe(
      '2 were left as they were: not waiting for review or failed.',
    );
  });
});
