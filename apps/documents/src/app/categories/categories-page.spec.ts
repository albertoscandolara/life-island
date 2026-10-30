import { editsOf } from './categories-page';

const original = {
  id: 'ENEL',
  title: 'Enel',
  description: 'Documents issued by Enel',
  template: {
    fields: [
      {
        key: 'total_amount',
        label: 'Total',
        type: 'amount' as const,
        description: '',
        required: true,
      },
    ],
  },
};
const draftOf = (changes: Partial<Record<string, string>> = {}) => ({
  id: original.id,
  title: original.title,
  description: original.description,
  template: JSON.stringify(original.template, null, 2),
  ...changes,
});

describe('editsOf', () => {
  it('sends only what you changed', () => {
    expect(editsOf(original, draftOf())).toEqual({});
    expect(
      editsOf(
        original,
        draftOf({ id: ' ENEL_ENERGIA ', title: 'Enel Energia' }),
      ),
    ).toEqual({ id: 'ENEL_ENERGIA', title: 'Enel Energia' });
  });

  it('sends the template when its JSON changed, and throws on invalid JSON', () => {
    expect(
      editsOf(original, draftOf({ template: '{"fields": []}' })).template,
    ).toEqual({ fields: [] });
    expect(() => editsOf(original, draftOf({ template: '{' }))).toThrow();
  });
});
