import type { RecordDetailDto, RecordDto } from '@life-island/contracts';
import { reflects, statusFromParam, statusToParam } from './inbox-page';

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
