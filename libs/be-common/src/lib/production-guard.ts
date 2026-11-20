/*
 * Fail closed in production (docs/security.md). The services ship with local
 * defaults (dev database passwords, the SeaweedFS dev keys) so `npm start`
 * works with no setup; those defaults must never reach a published instance.
 * Each service passes its resolved config here at startup: in production any
 * value that still carries a dev secret stops the service with a clear error.
 */

/** NODE_ENV=production, as the service image sets it. */
export function isProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['NODE_ENV']?.trim().toLowerCase() === 'production';
}

/** Values that only ever belong to a local stack. */
const DEV_SECRET_PATTERNS: readonly RegExp[] = [
  // The per-service database passwords of infra/postgres/init (dev_<service>).
  /:\/\/[^:/@]+:dev_[a-z0-9_]*@/i,
  // The Postgres superuser with its default password.
  /:\/\/postgres:postgres@/i,
  // The SeaweedFS dev keys (the default of S3_ACCESS_KEY / S3_SECRET_KEY).
  /^dev_(access|secret)_key$/,
];

/** Whether a value is one of the local stack's well-known secrets. */
export function isDevSecret(value: string): boolean {
  return DEV_SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

/** The paths (e.g. `storage.secretAccessKey`) of every dev secret in a config. */
export function findDevSecrets(config: unknown, path = ''): string[] {
  if (typeof config === 'string') return isDevSecret(config) ? [path] : [];
  if (Array.isArray(config))
    return config.flatMap((item, index) =>
      findDevSecrets(item, `${path}[${index}]`),
    );
  if (config && typeof config === 'object')
    return Object.entries(config).flatMap(([key, value]) =>
      findDevSecrets(value, path ? `${path}.${key}` : key),
    );
  return [];
}

/**
 * Stops a service that would run in production with a dev secret: a missing
 * env var that fell back to its local default, or a copied `.env`.
 */
export function refuseDevSecretsInProduction(
  service: string,
  config: unknown,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isProduction(env)) return;
  const found = findDevSecrets(config);
  if (found.length)
    throw new Error(
      `${service} refuses to start in production with local development secrets in ${found.join(', ')}. ` +
        'Set real values in the environment (see docs/security.md).',
    );
}
