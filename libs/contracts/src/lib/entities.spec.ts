import {
  cleanAliases,
  compareNames,
  matchName,
  streetKey,
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

describe('compareNames', () => {
  it('ignores case, accents, punctuation and legal form', () => {
    expect(compareNames('Arcoda', 'ARCODA')).toBe('same');
    expect(compareNames('arcoda', 'ARCODA S.R.L.')).toBe('same');
    expect(compareNames('Città di Verona', 'CITTA DI VERONA')).toBe('same');
  });

  it('ignores spacing', () => {
    expect(compareNames('Banca Widiba', 'BancaWidiba')).toBe('compact');
    expect(compareNames('EJ 560 PZ', 'ej560pz')).toBe('compact');
  });

  it('reads a street the same with or without its number', () => {
    expect(compareNames('via dei Bandi', 'Via dei Bandi, 9')).toBe('street');
    expect(compareNames('V. dei Bandi 10/a', 'Via dei Bandi')).toBe('street');
    expect(compareNames('Via Roma', 'Roma')).toBeNull();
  });

  it('forgives a typo in a long enough name, never in a number', () => {
    expect(compareNames('Elektrosistem', 'ELEKTROSYSTEM SNC')).toBe('similar');
    expect(compareNames('Enel', 'Enea')).toBeNull();
    expect(compareNames('Via Roma 5', 'Via Roma 6')).toBeNull();
    expect(compareNames('Idroterm', 'Termoidraulica')).toBeNull();
  });
});

describe('findEntity, tolerant', () => {
  it('finds a house from a street the document prints without the number', () => {
    expect(findEntity('via dei bandi, 9', ENTITIES)?.id).toBe('h2');
  });

  it('finds a company printed in another case or with a typo', () => {
    expect(findEntity('edilrenso', ENTITIES)?.id).toBe('o1');
    expect(findEntity('Edilrenzo s.n.c.', ENTITIES)?.id).toBe('o1');
  });

  it('prefers the strictest match over a looser one', () => {
    const list = [
      ref('organization', 'a', 'Arcoda'),
      ref('organization', 'b', 'Arcadia'),
    ];
    expect(findEntity('ARCODA', list)?.id).toBe('a');
  });
});

describe('matchName', () => {
  it('finds nothing when two candidates fit equally', () => {
    const list = [
      { id: 'a', name: 'Via Roma 1' },
      { id: 'b', name: 'Via Roma 3' },
    ];
    expect(matchName('Via Roma', list, (c) => [c.name])).toBeNull();
    expect(matchName('Via Roma 3', list, (c) => [c.name])?.found.id).toBe('b');
  });
});

describe('streetKey', () => {
  it('drops the number and writes street words out', () => {
    expect(streetKey('Via dei Bandi, 10')).toBe('via dei bandi');
    expect(streetKey('P.zza Bra 1')).toBe('piazza bra');
    expect(streetKey('Via Roma 5 a')).toBe('via roma');
  });
});
