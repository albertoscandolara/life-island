import { QUICK_ADD_KINDS } from './quick-add';

describe('QUICK_ADD_KINDS', () => {
  it('fills the field named by textKey with what you typed', () => {
    for (const kind of QUICK_ADD_KINDS.filter((k) => k.textKey)) {
      const key = kind.textKey as string;
      expect(kind.fields.some((f) => f.key === key)).toBe(true);
      expect(kind.defaults('Milk')[key]).toBe('Milk');
    }
  });

  it('gives every required field a default, except the one you type', () => {
    for (const kind of QUICK_ADD_KINDS) {
      const values = kind.defaults('x');
      for (const field of kind.fields.filter((f) => f.required))
        expect(values[field.key], `${kind.id}.${field.key}`).toBeDefined();
    }
  });

  it('has unique ids', () => {
    const ids = QUICK_ADD_KINDS.map((k) => k.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
