/** Reads a required environment variable or fails at startup with a clear message. */
export function requiredEnv(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const value = env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export function numberEnv(
  name: string,
  fallback: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value))
    throw new Error(`${name} must be a number, got "${raw}"`);
  return value;
}

export function booleanEnv(
  name: string,
  fallback: boolean,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

export function listEnv(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return (env[name] ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
