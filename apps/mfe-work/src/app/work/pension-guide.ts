/*
 * How a pension fund works, in plain words: the explainer of the Pension
 * fund tab. Rules as of the 2026 budget law (L. 199/2025); amounts that
 * depend on the year come from libs/contracts (pensionDeductionLimit).
 */

export interface PensionGuideSection {
  id: string;
  title: string;
  /** Paragraphs; `{limit}` and `{oldLimit}` are filled in by the page. */
  body: string[];
  /** Short lines shown as a list after the paragraphs. */
  points?: string[];
}

export const PENSION_GUIDE: PensionGuideSection[] = [
  {
    id: 'what',
    title: 'What a pension fund is',
    body: [
      'A pension fund (fondo pensione, or "previdenza complementare") is a savings account for when you retire, on top of the public pension from INPS. Money goes in while you work, the fund invests it, and you get it back when you retire, or earlier in a few cases.',
      'The public pension will be a smaller share of your last salary than it was for your parents, so the fund is there to fill part of that gap, with tax advantages that a normal savings account does not have.',
    ],
  },
  {
    id: 'who',
    title: 'Who pays in: you, your employer, your TFR',
    body: [
      'Three amounts can go into the fund, and your payslip shows each of them:',
    ],
    points: [
      'Your contribution: a small percentage of your pay, taken from the payslip (for the metalworkers in Cometa, 1.2% of the minimum pay).',
      'The employer contribution: a percentage the company adds on top, set by your contract (about 2% in Cometa). You get it only if you pay yours: without the fund, that money is simply not paid to you.',
      'Your TFR: the severance pay set aside every month (about your pay divided by 13.5). Once you join, it goes to the fund instead of staying with the company.',
    ],
  },
  {
    id: 'tax',
    title: 'The tax advantage: what you pay in lowers your taxes',
    body: [
      'Your contributions and the employer’s (not the TFR) come off your taxable income, up to {limit} a year ({oldLimit} until 2025). Each euro deducted saves you your top IRPEF rate: 23 to 43 cents.',
      'Through the payslip this happens by itself: the employer deducts the contributions before computing IRPEF, so your net is higher than it would be. If you pay the fund yourself, with a bank transfer, you deduct it in the 730 the following year.',
      'If there is room left under the limit near the end of the year, a transfer to the fund before 31 December still counts for that year.',
    ],
  },
  {
    id: 'cu730',
    title: 'Where it shows: CU and 730',
    body: [
      'In the Certificazione Unica the employer writes what it already deducted (punto 412) and what it did not, for example because it was over the limit (punto 413).',
      'In the 730 the pension fund goes in rigo E27 (contributi a deducibilità ordinaria): column 1 is the CU’s punto 412, column 2 the punto 413 plus what you paid yourself. The 730 checks the limit for the whole year, across every employer.',
      'What you could not deduct is not lost: tell the fund by 31 December of the following year (the "comunicazione dei contributi non dedotti"). Then it is not taxed a second time when the fund pays it back.',
    ],
  },
  {
    id: 'invest',
    title: 'How the money grows: investment lines and costs',
    body: [
      'You choose an investment line (comparto): guaranteed, bonds, balanced or shares. With many years to go, lines with more shares usually grow more but go up and down on the way; close to retirement, steadier lines protect what you have. You can usually switch once a year.',
      'Returns are taxed inside the fund every year (20%, 12.5% on government bonds), so the returns the fund shows are already net. Compare the funds’ costs with their ISC (indicatore sintetico dei costi): contract funds such as Cometa are usually the cheapest.',
    ],
  },
  {
    id: 'early',
    title: 'Taking money out before you retire',
    body: [
      'The money is meant for retirement, but you can take part of it earlier (anticipazione):',
    ],
    points: [
      'Any time, up to 75%, for serious health costs for you or your family: taxed 15%, down to 9% with the years.',
      'After 8 years in a fund, up to 75% to buy or renovate your first home or your children’s: taxed 23%.',
      'After 8 years, up to 30% for any other need: taxed 23%.',
      'If you lose your job: 50% after 12 to 48 months without work, all of it after 48 months or for a serious disability (taxed 15% to 9%). Leaving for other reasons, you can redeem it at 23%.',
      'Changing job, you keep your position: leave it where it is, or move it to the new employer’s fund to get its contribution.',
    ],
  },
  {
    id: 'retire',
    title: 'When you retire',
    body: [
      'You can collect it when you reach the public pension, after at least 5 years in a fund. Part comes as a lump sum and the rest as a monthly income for life (rendita); a small position can be taken all at once.',
      'It is taxed at 15%, less 0.3 points for every year in a fund after the 15th, down to 9% after 35 years: lower than the tax on a TFR paid by the company. The years count from the first day in any fund, so joining early helps even with small amounts.',
      'The 2026 budget law raises the lump sum to 60% and adds payments over a fixed number of years: ask your fund which rules apply to you when you get there.',
    ],
  },
  {
    id: 'new',
    title: 'What changed in 2026',
    body: [],
    points: [
      'The deduction limit rose to {limit} a year.',
      'From 1 July 2026 a new hire in the private sector joins the fund of their contract automatically, with the TFR and the minimum contributions, unless they choose otherwise within 60 days.',
      'After 2 years in a fund you can move your position to another fund and keep the employer contribution.',
      'If your first job started after 1 January 2007, from the 6th year in a fund you can deduct up to 2,582.29 € a year more, for 20 years, to recover the room you did not use in the first five.',
    ],
  },
  {
    id: 'worth',
    title: 'Is it worth it?',
    body: [
      'For most employees, yes: the employer contribution is money you only get by joining, the deduction gives back a part of what you pay, and the tax at the end is lower than on the TFR. The costs: the money is tied up until you retire (apart from the cases above), and the investment can lose value in a bad year.',
      'The TFR tab compares, with your own figures, leaving the TFR with the company against sending it to a fund.',
    ],
  },
];

/** A guide paragraph with the year's limits written in. */
export function guideText(
  text: string,
  limits: { limit: string; oldLimit: string },
): string {
  return text
    .replaceAll('{limit}', limits.limit)
    .replaceAll('{oldLimit}', limits.oldLimit);
}
