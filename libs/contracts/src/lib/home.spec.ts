import { updateOrganizationRequestSchema } from './home.js';

describe('updateOrganizationRequestSchema', () => {
  const website = (value: string | null) =>
    updateOrganizationRequestSchema.safeParse({ website: value });

  it('reads a bare domain as an https website, and empty as none', () => {
    expect(website('acme.it').data?.website).toBe('https://acme.it');
    expect(website(' https://www.acme.it/contatti ').data?.website).toBe(
      'https://www.acme.it/contatti',
    );
    expect(website('http://acme.it').data?.website).toBe('http://acme.it');
    expect(website('').data?.website).toBeNull();
    expect(website(null).data?.website).toBeNull();
  });

  it('refuses links that are not websites', () => {
    expect(website('javascript:alert(1)').success).toBe(false);
    expect(website('ftp://files.acme.it').success).toBe(false);
    expect(website('not a site').success).toBe(false);
    expect(website('localhost').success).toBe(false);
  });

  it('clears empty notes', () => {
    expect(
      updateOrganizationRequestSchema.parse({ description: '  ' }).description,
    ).toBeNull();
  });
});
