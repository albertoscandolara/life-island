import {
  bankWords,
  bestPayeeFit,
  linkProblem,
  payeeFit,
  rejectionKey,
  remaining,
  suggestMatches,
  type MatchLink,
  type MatchMovement,
  type PayableDto,
} from './payables.js';

const bill = (over: Partial<PayableDto> = {}): PayableDto => ({
  key: 'home:bill:1',
  module: 'home',
  kind: 'bill',
  title: 'Enel Energia, electricity of oct 2026',
  payees: ['Enel Energia S.p.A.'],
  amount: 84.37,
  direction: 'out',
  date: '2026-11-10',
  window: { from: '2026-10-25', to: '2026-12-25' },
  path: '/home?tab=bills',
  ...over,
});

const move = (over: Partial<MatchMovement> = {}): MatchMovement => ({
  id: 'm1',
  date: '2026-11-10',
  amount: -84.37,
  description:
    'ADDEBITO SDD CORE ENEL ENERGIA SPA CID IT45ZZZ0000001 MANDATO 77',
  ...over,
});

describe('payee names in bank descriptions', () => {
  it('drops the bank words and codes', () => {
    expect(
      bankWords('ADDEBITO SDD CORE ENEL ENERGIA SPA CID IT45ZZZ0000001'),
    ).toEqual(['enel', 'energia', 'spa']);
    expect(bankWords('PAGAMENTO POS 12/11 ORE 18:32 CARTA *1234')).toEqual([
      'ore',
    ]);
  });

  it.each([
    ['ADDEBITO SDD ENEL ENERGIA SPA', 'Enel Energia S.p.A.', 'agree'],
    ['ADDEBITO SDD ENELENERGIA', 'Enel Energia', 'agree'],
    [
      'BONIFICO A FAVORE DI STUDIO DENTISTICO ROSSI MARIO',
      'Studio Dentistico Rossi',
      'agree',
    ],
    ['PAGAMENTO POS FARMACIA BIANCHI SNC', 'Farmacia Bianchi', 'agree'],
    // Another pharmacy: the generic word alone never agrees.
    ['PAGAMENTO POS FARMACIA BIANCHI SNC', 'Farmacia Comunale', 'differ'],
    ['ADDEBITO SDD A2A ENERGIA', 'Enel Energia S.p.A.', 'differ'],
    ['ADDEBITO SDD VODAFONE ITALIA', 'Vodafone Italia S.p.A.', 'agree'],
    ['NETFLIX.COM AMSTERDAM', 'Netflix International B.V.', 'partial'],
    // The bank printed nothing but codes: no opinion.
    [
      'ADDEBITO DIRETTO SDD CID IT45ZZZ0000001 MANDATO 77',
      'Enel Energia',
      'unknown',
    ],
  ] as const)('%s against %s: %s', (description, payee, fit) => {
    expect(payeeFit(description, payee)).toBe(fit);
  });

  it('takes the best of a payable’s names, unknown with none', () => {
    expect(
      bestPayeeFit('ADDEBITO SDD SERVIZIO ELETTRICO NAZIONALE', [
        'Enel Energia',
        'Servizio Elettrico Nazionale',
      ]),
    ).toBe('agree');
    expect(bestPayeeFit('ADDEBITO SDD ENEL', [])).toBe('unknown');
  });
});

describe('suggestMatches', () => {
  it('is sure when amount, date window, name and uniqueness all agree', () => {
    const [s] = suggestMatches([move()], [bill()], []);
    expect(s).toMatchObject({
      movementId: 'm1',
      payableKeys: ['home:bill:1'],
      amounts: [84.37],
      confidence: 'sure',
    });
    expect(s.reasons).toContain('same amount, to the cent');
    expect(s.reasons).toContain('on the due date');
  });

  it('is only likely when the bank does not name anyone', () => {
    const [s] = suggestMatches(
      [move({ description: 'ADDEBITO DIRETTO SDD CID IT45ZZZ0000001' })],
      [bill()],
      [],
    );
    expect(s.confidence).toBe('likely');
  });

  it('never proposes when the bank names someone else', () => {
    expect(
      suggestMatches(
        [move({ description: 'ADDEBITO SDD A2A ENERGIA' })],
        [bill()],
        [],
      ),
    ).toEqual([]);
  });

  it('needs the amount to the cent for an invoice', () => {
    expect(suggestMatches([move({ amount: -84.36 })], [bill()], [])).toEqual(
      [],
    );
    expect(
      suggestMatches([move({ amount: -84.371 })], [bill()], []),
    ).toHaveLength(1);
  });

  it('never crosses directions', () => {
    expect(suggestMatches([move({ amount: 84.37 })], [bill()], [])).toEqual([]);
  });

  it('stays inside the window, both days included', () => {
    expect(
      suggestMatches([move({ date: '2026-10-24' })], [bill()], []),
    ).toEqual([]);
    expect(
      suggestMatches([move({ date: '2026-10-25' })], [bill()], []),
    ).toHaveLength(1);
    expect(
      suggestMatches([move({ date: '2026-12-25' })], [bill()], []),
    ).toHaveLength(1);
    expect(
      suggestMatches([move({ date: '2026-12-26' })], [bill()], []),
    ).toEqual([]);
  });

  it('asks you to pick when two bills of the same amount fit', () => {
    const [s] = suggestMatches(
      [move()],
      [bill(), bill({ key: 'home:bill:2', date: '2026-11-12' })],
      [],
    );
    expect(s.confidence).toBe('check');
    expect(s.payableKeys).toEqual(['home:bill:1']);
    expect(s.reasons.join(' ')).toMatch(/2 items fit/);
  });

  it('is not sure when two movements fit the same bill', () => {
    const suggestions = suggestMatches(
      [move(), move({ id: 'm2', date: '2026-11-11' })],
      [bill()],
      [],
    );
    expect(suggestions.map((s) => s.confidence)).toEqual(['check', 'check']);
  });

  it('leaves out what is already linked, and remembers "not this one"', () => {
    const links: MatchLink[] = [
      { movementId: 'm1', payableKey: 'home:bill:1', amount: 84.37 },
    ];
    expect(suggestMatches([move()], [bill()], links)).toEqual([]);
    expect(
      suggestMatches(
        [move()],
        [bill()],
        [],
        new Set([rejectionKey('m1', 'home:bill:1')]),
      ),
    ).toEqual([]);
  });

  it('matches what is left of a bill paid in two parts', () => {
    const links: MatchLink[] = [
      { movementId: 'm0', payableKey: 'home:bill:1', amount: 40 },
    ];
    const [s] = suggestMatches([move({ amount: -44.37 })], [bill()], links);
    expect(s).toMatchObject({ amounts: [44.37], confidence: 'sure' });
  });

  it('catches a subscription whose price went up, as a check', () => {
    const netflix = bill({
      key: 'subscriptions:renewal:n',
      module: 'subscriptions',
      kind: 'renewal',
      payees: ['Netflix'],
      amount: 12.99,
      tolerance: 0.1,
    });
    const [s] = suggestMatches(
      [move({ amount: -13.99, description: 'NETFLIX.COM' })],
      [netflix],
      [],
    );
    expect(s.confidence).toBe('check');
    expect(s.reasons[0]).toMatch(/\+1,00 € against the expected amount/);
    expect(s.amounts).toEqual([12.99]);
  });

  it('proposes one transfer that paid two invoices of one payee', () => {
    const invoice = (key: string, amount: number): PayableDto => ({
      ...bill(),
      key,
      module: 'taxes',
      kind: 'expense',
      payees: ['Studio Dentistico Rossi'],
      amount,
      date: '2026-03-01',
      window: { from: '2026-03-01', to: '2026-04-30' },
    });
    const [s] = suggestMatches(
      [
        move({
          amount: -350,
          date: '2026-03-05',
          description: 'BONIFICO A FAVORE DI STUDIO DENTISTICO ROSSI',
        }),
      ],
      [
        invoice('taxes:expense:a', 200),
        invoice('taxes:expense:b', 150),
        invoice('taxes:expense:c', 90),
      ],
      [],
    );
    expect(s).toMatchObject({
      payableKeys: ['taxes:expense:a', 'taxes:expense:b'],
      amounts: [200, 150],
      confidence: 'check',
    });
  });

  it('puts the sure pairs first', () => {
    const suggestions = suggestMatches(
      [
        move({ id: 'a', description: 'ADDEBITO DIRETTO' }),
        move({
          id: 'b',
          amount: -30,
          description: 'ADDEBITO SDD IREN MERCATO',
        }),
      ],
      [
        bill(),
        bill({
          key: 'home:bill:iren',
          payees: ['Iren Mercato S.p.A.'],
          amount: 30,
        }),
      ],
      [],
    );
    expect(suggestions.map((s) => [s.movementId, s.confidence])).toEqual([
      ['b', 'sure'],
      ['a', 'likely'],
    ]);
  });
});

describe('linkProblem', () => {
  const movements = new Map([['m1', move()]]);
  const payables = new Map([['home:bill:1', bill()]]);

  it('accepts links within both amounts', () => {
    expect(
      linkProblem(
        [{ movementId: 'm1', payableKey: 'home:bill:1', amount: 84.37 }],
        movements,
        payables,
      ),
    ).toBeNull();
  });

  it('refuses more than the movement moved', () => {
    expect(
      linkProblem(
        [
          { movementId: 'm1', payableKey: 'home:bill:1', amount: 50 },
          { movementId: 'm1', payableKey: 'home:bill:2', amount: 50 },
        ],
        movements,
        payables,
      ),
    ).toMatch(/more than the movement/);
  });

  it('refuses more than the item costs', () => {
    expect(
      linkProblem(
        [{ movementId: 'm1', payableKey: 'home:bill:1', amount: 84.37 }],
        new Map([...movements, ['m2', move({ id: 'm2' })]]),
        new Map([['home:bill:1', bill({ amount: 50 })]]),
      ),
    ).toMatch(/more than the item costs/);
  });

  it('refuses a link to a movement that is gone, or for nothing', () => {
    expect(
      linkProblem(
        [{ movementId: 'x', payableKey: 'home:bill:1', amount: 1 }],
        movements,
        payables,
      ),
    ).toMatch(/no longer exists/);
    expect(
      linkProblem(
        [{ movementId: 'm1', payableKey: 'home:bill:1', amount: 0 }],
        movements,
        payables,
      ),
    ).toMatch(/positive/);
  });

  it('works out what is left', () => {
    expect(
      remaining(
        -84.37,
        [{ movementId: 'm1', payableKey: 'k', amount: 40 }],
        (l) => l.movementId === 'm1',
      ),
    ).toBe(44.37);
  });
});
