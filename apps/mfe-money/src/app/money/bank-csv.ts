/*
 * Reads the movements out of a bank's CSV export. Italian and English
 * exports differ in separator (`;` or `,`), date format (`31/01/2026` or
 * `2026-01-31`), number format (`1.234,56` or `1,234.56`) and whether money
 * in and out share one column or have two (Dare/Avere, Uscite/Entrate).
 */

export interface BankRow {
  date: string;
  amount: number;
  description: string;
}

export interface BankCsv {
  rows: BankRow[];
  /** Lines that could not be read, with why. */
  skipped: number;
  /** What the columns were taken to be, for the person to check. */
  columns: string;
  error: string | null;
}

const DATE = /^(data|date|data operazione|data contabile|booking date|transaction date|data valuta)$/;
const AMOUNT = /^(importo|amount|importo eur|ammontare|valore|importo \(eur\))$/;
const OUT = /^(dare|uscite|addebiti|debit|money out|addebito)$/;
const IN = /^(avere|entrate|accrediti|credit|money in|accredito)$/;
const TEXT = /^(descrizione|description|causale|descrizione operazione|dettagli|details|payee|beneficiario|operazione)$/;

export function splitCsvLine(line: string, separator: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === separator && !quoted) {
      cells.push(cell.trim());
      cell = '';
    } else cell += c;
  }
  cells.push(cell.trim());
  return cells;
}

export function readAmount(text: string): number | null {
  let t = text.replace(/[€\s]|EUR/gi, '');
  if (!t) return null;
  const negative = /^-|^\(/.test(t) || t.endsWith('-');
  t = t.replace(/[-+()]/g, '');
  const comma = t.lastIndexOf(',');
  const dot = t.lastIndexOf('.');
  // The last separator is the decimal one; the other groups thousands.
  if (comma > dot) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/,/g, '');
  const value = Number(t);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

export function readDate(text: string): string | null {
  const t = text.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(t);
  if (!m) return null;
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  const month = Number(m[2]);
  const day = Number(m[1]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseBankCsv(text: string): BankCsv {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const fail = (error: string): BankCsv => ({ rows: [], skipped: 0, columns: '', error });
  if (lines.length < 2) return fail('The file has no movements.');
  // The header is the first line that names a date column (banks put a title above it).
  const separator = (lines.slice(0, 10).join('').match(/;/g)?.length ?? 0) > 2 ? ';' : ',';
  const headerAt = lines.findIndex((l) =>
    splitCsvLine(l, separator).some((c) => DATE.test(c.toLowerCase())),
  );
  if (headerAt < 0)
    return fail('Could not find the header: the file needs a "Data" or "Date" column.');
  const header = splitCsvLine(lines[headerAt], separator).map((c) => c.toLowerCase());
  const find = (pattern: RegExp) => header.findIndex((h) => pattern.test(h));
  const date = find(DATE);
  const amount = find(AMOUNT);
  const out = find(OUT);
  const income = find(IN);
  const description = find(TEXT);
  if (amount < 0 && out < 0 && income < 0)
    return fail('Could not find the amount: the file needs an "Importo"/"Amount" column, or "Dare" and "Avere".');
  const names = (i: number) => (i >= 0 ? `“${header[i]}”` : '');
  const columns = [
    `date from ${names(date)}`,
    amount >= 0
      ? `amount from ${names(amount)}`
      : `money out from ${names(out) || '—'}, in from ${names(income) || '—'}`,
    description >= 0 ? `description from ${names(description)}` : 'no description column',
  ].join(', ');
  const rows: BankRow[] = [];
  let skipped = 0;
  for (const line of lines.slice(headerAt + 1)) {
    const cells = splitCsvLine(line, separator);
    const day = readDate(cells[date] ?? '');
    let value: number | null;
    if (amount >= 0) value = readAmount(cells[amount] ?? '');
    else {
      const o = readAmount(cells[out] ?? '') ?? 0;
      const i = readAmount(cells[income] ?? '') ?? 0;
      value = i - Math.abs(o);
    }
    const text = (description >= 0 ? cells[description] : '')?.replace(/\s+/g, ' ').trim() || 'Movement';
    if (!day || value === null || value === 0) {
      skipped++;
      continue;
    }
    rows.push({ date: day, amount: Math.round(value * 100) / 100, description: text.slice(0, 200) });
  }
  if (!rows.length) return { rows, skipped, columns, error: 'No movement could be read from the file.' };
  return { rows, skipped, columns, error: null };
}
