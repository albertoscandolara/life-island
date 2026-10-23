import {
  DESCRIPTION_MAX_LENGTH,
  TITLE_MAX_LENGTH,
} from '@life-island/contracts/constants';
import { defaultTitle, UploadItem } from './upload-item';

describe('defaultTitle', () => {
  it('drops the extension and separators', () => {
    expect(defaultTitle('scontrino_esselunga-ottobre.jpg')).toBe(
      'scontrino esselunga ottobre',
    );
    expect(defaultTitle('report.final.pdf')).toBe('report.final');
  });
});

describe('UploadItem', () => {
  const item = () =>
    new UploadItem(new File(['x'], 'receipt.pdf', { type: 'application/pdf' }));

  it('starts ready, titled after the file, without a preview for non-images', () => {
    const upload = item();
    expect(upload.title()).toBe('receipt');
    expect(upload.state()).toBe('ready');
    expect(upload.previewUrl).toBeNull();
    expect(upload.invalidReason).toBe('');
  });

  it('requires a title and enforces the database limits', () => {
    const upload = item();
    upload.title.set('   ');
    expect(upload.invalidReason).toBe('Add a title');
    upload.title.set('x'.repeat(TITLE_MAX_LENGTH + 1));
    expect(upload.invalidReason).toContain(String(TITLE_MAX_LENGTH));
    upload.title.set('ok');
    upload.description.set('x'.repeat(DESCRIPTION_MAX_LENGTH + 1));
    expect(upload.invalidReason).toContain(String(DESCRIPTION_MAX_LENGTH));
  });
});
