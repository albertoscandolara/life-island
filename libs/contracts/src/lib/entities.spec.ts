import {
  cleanAliases,
  entityKey,
  entityPath,
  findEntity,
  type EntityRefDto,
} from './entities.js';

const ref = (
  kind: EntityRefDto['kind'],
  id: string,
  name: string,
  aliases: string[] = [],
  status: EntityRefDto['status'] = 'confirmed',
): EntityRefDto => ({ kind, id, name, status, detail: null, aliases });

const ENTITIES: EntityRefDto[] = [
  ref('house', 'h1', 'Ronco all’Adige', [
    'Via Ponzilovo 9',
    'Via Ponzilovo',
    'VIA_PONZILOVO',
  ]),
  ref('house', 'h2', 'Tregnago', ['Via dei Bandi 10', 'Via dei Bandi']),
  ref('organization', 'o1', 'EDILRENSO SNC DI RENSO MASSIMO E C.'),
  ref('organization', 'o2', 'Banca Widiba S.p.A.', ['BANCA WIDIBA SPA']),
  ref('vehicle', 'v1', 'Fiat Punto · EJ560PZ', ['EJ560PZ']),
  ref('person', 'p1', 'Alberto Scandolara', ['SCNLRT92A01L781X']),
];

describe('entityKey', () => {
  it('reads names without case, accents, punctuation and legal form', () => {
    expect(entityKey('EDILRENSO SNC DI RENSO MASSIMO E C.')).toBe('edilrenso');
    expect(entityKey('Banca Widiba S.p.A.')).toBe('banca widiba');
    expect(entityKey('LESO ELETTRODOMESTICI S.R.L.')).toBe(
      'leso elettrodomestici',
    );
    expect(entityKey('Città  di Verona')).toBe('citta di verona');
    expect(entityKey('VIA_DEI_BANDI_10')).toBe('via dei bandi 10');
  });

  it('keeps a name that is only a legal form', () => {
    expect(entityKey('SPA')).toBe('spa');
  });
});

describe('findEntity', () => {
  it('finds a company however the document prints it', () => {
    expect(findEntity('Edilrenso', ENTITIES)?.id).toBe('o1');
    expect(findEntity('Banca Widiba', ENTITIES)?.id).toBe('o2');
  });

  it('finds a house by its address, street or category', () => {
    expect(findEntity('Via Ponzilovo 9', ENTITIES)?.id).toBe('h1');
    expect(findEntity('Via Ponzilovo', ENTITIES)?.id).toBe('h1');
    expect(findEntity('Via dei Bandi, 10', ENTITIES)?.id).toBe('h2');
    expect(findEntity('VIA_PONZILOVO', ENTITIES, 'house')?.id).toBe('h1');
  });

  it('finds a car by the plate inside a longer text', () => {
    expect(findEntity('Fiat Punto EJ560PZ', ENTITIES)?.id).toBe('v1');
    expect(findEntity('Fiat Punto EJ560PZ', ENTITIES, 'house')).toBeNull();
  });

  it('finds a person by tax code', () => {
    expect(findEntity('scnlrt92a01l781x', ENTITIES)?.id).toBe('p1');
  });

  it('finds nothing for an unknown or ambiguous name', () => {
    expect(findEntity('Idroterm', ENTITIES)).toBeNull();
    expect(findEntity('', ENTITIES)).toBeNull();
    const twice = [
      ref('organization', 'a', 'Rossi'),
      ref('organization', 'b', 'Rossi S.r.l.'),
    ];
    expect(findEntity('Rossi', twice)).toBeNull();
  });

  it('prefers the confirmed entity over a pending suggestion', () => {
    const list = [
      ref('organization', 'a', 'Idroterm', [], 'pending'),
      ref('organization', 'b', 'IDROTERM SRL'),
    ];
    expect(findEntity('Idroterm', list)?.id).toBe('b');
  });
});

describe('entityPath', () => {
  it('opens a confirmed entity on its page', () => {
    expect(entityPath(ref('house', 'h1', 'x'))).toBe('/home?houses=h1');
    expect(entityPath(ref('organization', 'o1', 'x'))).toBe(
      '/home/companies?company=o1',
    );
    expect(entityPath(ref('person', 'p1', 'x'))).toBe('/people?person=p1');
    expect(entityPath(ref('vehicle', 'v1', 'x'))).toBe('/cars?car=v1');
  });

  it('sends a pending one where it is confirmed', () => {
    expect(entityPath(ref('organization', 'o1', 'x', [], 'pending'))).toBe(
      '/home/companies?review=entities',
    );
  });
});

describe('cleanAliases', () => {
  it('drops empty ones, repeats and the name itself', () => {
    expect(
      cleanAliases('Tregnago', [
        null,
        'TREGNAGO',
        'Via dei Bandi 10',
        'via dei bandi, 10',
        '',
      ]),
    ).toEqual(['Via dei Bandi 10']);
  });
});
