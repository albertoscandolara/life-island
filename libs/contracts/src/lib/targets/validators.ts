const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  return (
    ISO_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  );
}

export function isIsoDateTime(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}
