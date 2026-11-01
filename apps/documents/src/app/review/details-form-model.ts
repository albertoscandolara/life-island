/**
 * The model behind the details form: a JSON Schema (as the target catalog
 * serves it) turned into editable fields, and the edited value turned back
 * into details the review service accepts.
 */

export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: (string | number)[];
  description?: string;
}

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type Path = (string | number)[];

/** How one primitive value is edited. */
export type InputKind =
  'text' | 'textarea' | 'number' | 'date' | 'datetime' | 'select' | 'boolean';

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The input for a primitive schema, from its type, enum and description. */
export function inputKind(schema: JsonSchema, key = ''): InputKind {
  if (schema.enum) return 'select';
  if (schema.type === 'boolean') return 'boolean';
  if (schema.type === 'number' || schema.type === 'integer') return 'number';
  const description = schema.description ?? '';
  if (/YYYY-MM-DD(?!T)/.test(description) && !/time/i.test(description))
    return 'date';
  if (/ISO 8601|date-time/i.test(description)) return 'datetime';
  if (/summary|description|notes?/i.test(key)) return 'textarea';
  return 'text';
}

/** A new, empty value for a schema: what "Add row" or a missing object starts from. */
export function emptyValue(schema: JsonSchema): JsonValue {
  if (schema.type === 'object')
    return Object.fromEntries(
      (schema.required ?? [])
        .filter((key) => schema.properties?.[key])
        .map((key) => [key, emptyValue(schema.properties![key])]),
    );
  if (schema.type === 'array') return [];
  if (schema.type === 'boolean') return null;
  if (schema.type === 'number' || schema.type === 'integer') return null;
  return '';
}

/** The value at `path`, or undefined. */
export function getAt(
  value: JsonValue | undefined,
  path: Path,
): JsonValue | undefined {
  let current: JsonValue | undefined = value;
  for (const key of path) {
    if (Array.isArray(current) && typeof key === 'number')
      current = current[key];
    else if (isObject(current) && typeof key === 'string')
      current = current[key];
    else return undefined;
  }
  return current;
}

/** A copy of `value` with `next` at `path`; missing objects and arrays are created. */
export function setAt(
  value: JsonValue | undefined,
  path: Path,
  next: JsonValue | undefined,
): JsonValue {
  if (!path.length) return next ?? null;
  const [key, ...rest] = path;
  if (typeof key === 'number') {
    const list = Array.isArray(value) ? [...value] : [];
    list[key] = setAt(list[key], rest, next);
    return list;
  }
  const object: JsonObject = isObject(value) ? { ...value } : {};
  const child = setAt(object[key], rest, next);
  if (next === undefined && !rest.length) delete object[key];
  else object[key] = child;
  return object;
}

/** A copy of `value` without the array item at `path`. */
export function removeAt(value: JsonValue | undefined, path: Path): JsonValue {
  const index = path[path.length - 1] as number;
  const list = getAt(value, path.slice(0, -1));
  if (!Array.isArray(list)) return value ?? null;
  return setAt(
    value,
    path.slice(0, -1),
    list.filter((_, i) => i !== index),
  );
}

/** What an input's text means for its schema: undefined clears the value. */
export function parseInput(
  text: string,
  schema: JsonSchema,
): JsonValue | undefined {
  const kind = inputKind(schema);
  if (text.trim() === '') return undefined;
  if (kind === 'boolean') return text === 'true';
  if (kind === 'number') {
    const number = Number(text.replace(',', '.'));
    // Not a number: keep the text, so the server explains what is wrong.
    return Number.isFinite(number) ? number : text;
  }
  if (kind === 'datetime' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text))
    return new Date(text).toISOString();
  return text;
}

/** The text an input shows for a value. */
export function inputText(
  value: JsonValue | undefined,
  schema: JsonSchema,
): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (inputKind(schema) === 'datetime' && typeof value === 'string') {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    // datetime-local wants local time without a zone.
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/**
 * The details to send: optional values left empty are dropped (so an empty
 * VAT number is "not on the receipt", not an empty string), required ones are
 * kept, so the server can say they are missing.
 */
export function cleanDetails(
  value: JsonValue | undefined,
  schema: JsonSchema,
): JsonValue | undefined {
  if (schema.type === 'object' && isObject(value)) {
    const required = schema.required ?? [];
    const entries = Object.entries(value).flatMap(([key, item]) => {
      const itemSchema = schema.properties?.[key] ?? {};
      const cleaned = cleanDetails(item, itemSchema);
      const empty = cleaned === undefined || cleaned === null || cleaned === '';
      return empty && !required.includes(key) ? [] : [[key, cleaned ?? null]];
    });
    return Object.fromEntries(entries);
  }
  if (schema.type === 'array' && Array.isArray(value))
    return value.map((item) => cleanDetails(item, schema.items ?? {}) ?? null);
  return value;
}

/** Keys in schema order, then any the schema does not declare. */
export function orderedProperties(
  schema: JsonSchema,
  value: JsonValue | undefined,
): string[] {
  const declared = Object.keys(schema.properties ?? {});
  const extra = isObject(value)
    ? Object.keys(value).filter((key) => !declared.includes(key))
    : [];
  return [...declared, ...extra];
}
