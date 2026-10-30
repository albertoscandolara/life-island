import type { TemplateField } from './categories.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

/** Reads `1.234,56`, `1,234.56`, `12,5` or `€ 7.47` as a number. */
export function parseNumber(raw: string): number | null {
  let text = raw.replace(/[^\d,.\-+]/g, '');
  if (!/\d/.test(text)) return null;
  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // The later separator is the decimal one.
    text =
      lastComma > lastDot
        ? text.replace(/\./g, '').replace(',', '.')
        : text.replace(/,/g, '');
  } else if (lastComma > -1) {
    const decimals = text.length - lastComma - 1;
    const commas = text.split(',').length - 1;
    text =
      commas === 1 && decimals !== 3
        ? text.replace(',', '.')
        : text.replace(/,/g, '');
  } else if ((text.match(/\./g) ?? []).length > 1) {
    text = text.replace(/\./g, '');
  }
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export type NormalizedFieldValue =
  | { ok: true; value: string | number | boolean }
  | { ok: false; reason: string };

/**
 * Checks a value the model read against the field's type and returns it in a
 * standard format (ISO dates, numbers, upper-case currency codes). A value
 * that does not fit is never coerced into something it does not say.
 */
export function normalizeFieldValue(
  field: {
    type: TemplateField['type'];
    options?: readonly string[];
    pattern?: string;
  },
  raw: string,
): NormalizedFieldValue {
  const text = raw.trim();
  if (!text) return { ok: false, reason: 'empty value' };
  let result: NormalizedFieldValue;
  switch (field.type) {
    case 'string':
    case 'text':
      result = { ok: true, value: text };
      break;
    case 'number':
    case 'amount':
    case 'integer': {
      const value = parseNumber(text);
      if (value === null) return { ok: false, reason: 'not a number' };
      if (field.type === 'integer' && !Number.isInteger(value))
        return { ok: false, reason: 'not a whole number' };
      if (field.type === 'amount' && Math.round(value * 100) !== value * 100)
        return { ok: false, reason: 'more than two decimals for an amount' };
      result = { ok: true, value };
      break;
    }
    case 'currency': {
      const code = text.toUpperCase();
      const symbols: Record<string, string> = {
        '€': 'EUR',
        $: 'USD',
        '£': 'GBP',
      };
      const value = symbols[code] ?? code;
      if (!/^[A-Z]{3}$/.test(value))
        return { ok: false, reason: 'not an ISO 4217 currency code' };
      result = { ok: true, value };
      break;
    }
    case 'date':
      if (!isRealDate(text))
        return { ok: false, reason: 'expected YYYY-MM-DD' };
      result = { ok: true, value: text };
      break;
    case 'datetime': {
      if (
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/.test(
          text,
        ) ||
        !isRealDate(text.slice(0, 10))
      )
        return { ok: false, reason: 'expected an ISO 8601 date and time' };
      result = { ok: true, value: text };
      break;
    }
    case 'period': {
      const [from, to, extra] = text.split('/');
      if (
        extra !== undefined ||
        !isRealDate(from ?? '') ||
        !isRealDate(to ?? '')
      )
        return { ok: false, reason: 'expected YYYY-MM-DD/YYYY-MM-DD' };
      if (from > to)
        return { ok: false, reason: 'the period ends before it starts' };
      result = { ok: true, value: text };
      break;
    }
    case 'boolean': {
      const lower = text.toLowerCase();
      if (['true', 'yes', 'si', 'sì'].includes(lower))
        result = { ok: true, value: true };
      else if (['false', 'no'].includes(lower))
        result = { ok: true, value: false };
      else return { ok: false, reason: 'expected true or false' };
      break;
    }
    case 'enum': {
      const option = field.options?.find(
        (candidate) => candidate.toLowerCase() === text.toLowerCase(),
      );
      if (!option)
        return {
          ok: false,
          reason: `not one of ${(field.options ?? []).join(', ')}`,
        };
      result = { ok: true, value: option };
      break;
    }
  }
  if (field.pattern && typeof result.value === 'string') {
    const compact = result.value.replace(/\s+/g, '');
    if (!new RegExp(field.pattern).test(compact))
      return { ok: false, reason: 'does not match the expected format' };
    result = { ok: true, value: compact };
  }
  return result;
}
