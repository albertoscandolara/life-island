/** One word of the tax return, in plain language. */
export interface GlossaryTerm {
  term: string;
  /** The Italian name, as it is printed on the forms. */
  italian: string;
  explain: string;
  /** Where to find it on a Redditi PF or a 730, when it has a row. */
  where?: string;
}

/** The words of the 730 and of Redditi PF, from the basics to the forms' own jargon. */
export const GLOSSARY: GlossaryTerm[] = [
  {
    term: 'IRPEF',
    italian: 'Imposta sul reddito delle persone fisiche',
    explain:
      'The national income tax every person pays on what they earn. Your employer withholds it from each payslip; the return settles the year.',
  },
  {
    term: 'Regional and municipal surtax',
    italian: 'Addizionale regionale e comunale',
    explain:
      'Two small extra income taxes, about 1–3% together, that go to your region and your town. They are computed on the same taxable income as IRPEF.',
    where: 'Quadro RV; result in RX2 and RX3',
  },
  {
    term: 'Tax year',
    italian: "Periodo d'imposta",
    explain:
      'The year the income is about. The return is always filed the year after: Redditi 2025 and the 730/2025 declare the income of 2024.',
  },
  {
    term: '730',
    italian: 'Modello 730',
    explain:
      'The simple return for employees and pensioners. Your employer settles it in the July payslip: a refund is added, tax due is withheld. Due by 30 September.',
  },
  {
    term: 'Redditi PF',
    italian: 'Modello Redditi Persone Fisiche (once Unico)',
    explain:
      'The full return, needed for example with self-employed (partita IVA) income. You settle it yourself with F24: tax due by 30 June, a credit to use or claim back. Due by 31 October.',
  },
  {
    term: 'Certificazione Unica (CU)',
    italian: 'Certificazione Unica',
    explain:
      'The yearly statement your employer sends by March: what it paid you, the IRPEF it withheld and the credits it applied. The return starts from it.',
  },
  {
    term: 'Withholding agent',
    italian: "Sostituto d'imposta",
    explain:
      'Whoever pays you and pays your taxes for you along the way: your employer. With a 730, it also pays you the refund.',
  },
  {
    term: 'Total income',
    italian: 'Reddito complessivo',
    explain:
      'Everything IRPEF counts, added up: salary, buildings, other income. Your gross pay minus the INPS contributions is roughly your employment income.',
    where: 'RN1',
  },
  {
    term: 'Deduction',
    italian: 'Deduzione (onere deducibile)',
    explain:
      'An amount taken off your income before the tax is computed, e.g. pension fund contributions. It saves you your top bracket rate on each euro.',
    where: 'RN3 · quadro RP section II (730: quadro E section II)',
  },
  {
    term: 'Taxable income',
    italian: 'Reddito imponibile',
    explain: 'Total income minus deductions: what the brackets are applied to.',
    where: 'RN4',
  },
  {
    term: 'Tax brackets',
    italian: 'Scaglioni IRPEF',
    explain:
      'Income is cut into slices, each taxed at its own rate (23%, 35% or 33%, 43%). Earning more never lowers what you keep: only the slice above a limit pays the higher rate.',
  },
  {
    term: 'Marginal rate',
    italian: 'Aliquota marginale',
    explain:
      'The rate of your last (or next) euro of income: the top bracket you reach. It is what a deduction saves and what a raise is taxed at.',
  },
  {
    term: 'Effective rate',
    italian: 'Aliquota media effettiva',
    explain:
      'The IRPEF you really pay divided by your income. Always lower than the marginal rate, thanks to the lower brackets and the credits.',
  },
  {
    term: 'Gross tax',
    italian: 'Imposta lorda',
    explain: 'The tax the brackets give, before any credit.',
    where: 'RN5',
  },
  {
    term: 'Tax credit',
    italian: 'Detrazione',
    explain:
      'A discount on the tax itself: 19% of a health expense, 50% or 36% of renovation works over 10 years, the employment credit. It can lower the tax to zero, not below.',
    where: 'RN8 (work and family), RN13–RN21 (expenses), total RN22',
  },
  {
    term: 'Incapienza',
    italian: 'Incapienza',
    explain:
      'When your credits are more than your gross tax. The part that does not fit is lost: not paid to you, not carried to next year. Building-bonus instalments lost this way are gone for good.',
  },
  {
    term: 'Net tax',
    italian: 'Imposta netta',
    explain: 'Gross tax minus credits: the IRPEF you really owe for the year.',
    where: 'RN26',
  },
  {
    term: 'Withholdings',
    italian: 'Ritenute',
    explain:
      'IRPEF your employer already kept from your pay during the year. If it is more than the net tax, the difference comes back to you.',
    where: 'RN33',
  },
  {
    term: 'Advance',
    italian: 'Acconto',
    explain:
      'With Redditi PF you pay part of next year’s tax in advance, with F24: 40% by 30 June, 60% by 30 November (other shares apply to some years). Employees whose employer withholds everything usually owe none.',
    where: 'RN62 (next year) · RN38 (paid this year)',
  },
  {
    term: 'Balance',
    italian: 'Saldo',
    explain:
      'What is left to pay for the year once withholdings and advances are taken off. Paid with F24 by 30 June (30 July with 0.4% more).',
  },
  {
    term: 'Debit',
    italian: 'A debito',
    explain:
      'You owe this amount: it is paid with F24 (Redditi PF) or withheld from pay (730).',
    where: 'RX col. 1',
  },
  {
    term: 'Credit',
    italian: 'A credito',
    explain:
      'You paid more than you owed. With a 730 it comes back in your payslip. With Redditi PF you choose: use it to pay other taxes in F24 (compensazione), carry it to next year, or ask for a refund (rimborso, slower).',
    where: 'RX col. 2; how you use it in col. 3 (refund) and col. 4 (offset)',
  },
  {
    term: 'F24',
    italian: 'Modello F24',
    explain:
      'The form every tax is paid with in Italy, at your bank or online. Each line is a tax code (e.g. 4001 IRPEF balance, 4033 and 4034 the advances) and an amount; credits go in their own column and pay the debits.',
  },
  {
    term: 'Offsetting',
    italian: 'Compensazione',
    explain:
      'Paying a tax with a credit instead of money, in the same F24: the credit column cancels the debit column. With a credit to use, an F24 can total zero, and must still be sent (online).',
  },
  {
    term: 'Refund',
    italian: 'Rimborso',
    explain:
      'Asking the Agenzia delle Entrate to pay a Redditi PF credit into your bank account. It can take months; offsetting is usually quicker.',
  },
  {
    term: 'Building bonus',
    italian: 'Bonus ristrutturazioni',
    explain:
      'A credit for renovation works on a home: 50% on your main home (36% on others) of up to €96,000, spread over 10 yearly instalments. Each instalment fits only in that year’s tax.',
    where: 'Quadro RP section III-A · RN14 (730: quadro E section III)',
  },
  {
    term: 'Flat-rate regime',
    italian: 'Regime forfettario',
    explain:
      'A simple regime for small self-employed incomes: a flat 15% (5% for the first five years) replaces IRPEF and the surtaxes on that income. It is filed in quadro LM of Redditi PF, apart from the IRPEF figures here.',
    where: 'Quadro LM',
  },
  {
    term: 'Pre-filled return',
    italian: 'Dichiarazione precompilata',
    explain:
      'The return the Agenzia delle Entrate fills in for you from the CU and the data of doctors, banks and insurers, ready at the end of April. Accept it as it is and the expenses in it are not checked.',
  },
  {
    term: 'Correction',
    italian: 'Correttiva / integrativa',
    explain:
      'A new return that fixes a mistake: correttiva before the deadline, integrativa after it. The latest one counts.',
  },
  {
    term: 'Late filing',
    italian: 'Ravvedimento operoso',
    explain:
      'Paying a little penalty of your own accord to fix a late payment or a late return (up to 90 days late). Much cheaper than waiting for the Agenzia to notice.',
  },
  {
    term: 'Quadro',
    italian: 'Quadro',
    explain:
      'A section of the return, named by letters: RC employment income, RP expenses, RN the IRPEF computation, RV the surtaxes, RX the credits and debits, LM flat-rate income.',
  },
];
