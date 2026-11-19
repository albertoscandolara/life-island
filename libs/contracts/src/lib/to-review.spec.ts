import { proofUploadUrl } from './agenda';
import { documentToReview, toReviewPath } from './life-schemas';

describe('the "To review" tab and the proof of a date', () => {
  it('sends every document review to the area\'s "To review" tab', () => {
    expect(toReviewPath('/work')).toBe('/work?tab=review');
    expect(
      documentToReview(
        {
          uploadId: 'u1',
          title: 'UNI T23111314.pdf',
          uploadedAt: '2026-11-10T09:00:00Z',
        },
        '/work',
        'Payslip',
      ),
    ).toMatchObject({ path: '/work?tab=review', action: 'Review' });
  });

  it('opens the loader set for the proof of one date', () => {
    const url = new URL(
      proofUploadUrl('http://localhost:4201', {
        module: 'cars',
        title: 'Insurance · Panda',
        proof: 'the new insurance certificate',
      }),
    );
    expect(url.pathname).toBe('/upload');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      area: 'cars',
      for: 'Insurance · Panda',
      proof: 'the new insurance certificate',
    });
  });
});
