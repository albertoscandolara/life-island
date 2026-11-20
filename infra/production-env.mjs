// Writes .env.production: .env.example with every secret replaced by a new random
// value and the settings a published island needs (docs/guides/publishing.md).
//
//   npm run env:production -- https://island.tail1234.ts.net
//
// It never overwrites a file: rename .env.production to .env on the server, keep a
// copy somewhere safe (a password manager), and never commit it.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const OUT = '.env.production';
const ROLES = [
  'ingestion',
  'review',
  'grocery',
  'tax730',
  'home',
  'people',
  'cars',
  'work',
  'settings',
  'studies',
  'agenda',
  'money',
  'goals',
  'health',
  'subscriptions',
  'travel',
  'fitness',
  'dreams',
  'auth',
];

const address = (process.argv[2] ?? '').replace(/\/+$/, '');
if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(address)) {
  console.error(
    'Give the address the island will have, with https, for example:\n' +
      '  npm run env:production -- https://island.tail1234.ts.net',
  );
  process.exit(1);
}
if (existsSync(OUT)) {
  console.error(
    `${OUT} already exists; move it away first. Nothing was written.`,
  );
  process.exit(1);
}

/** Letters and digits only, so a value is safe in a URL, JSON and the shell. */
function token(length = 32) {
  let value = '';
  while (value.length < length)
    value += randomBytes(length)
      .toString('base64')
      .replace(/[^A-Za-z0-9]/g, '');
  return value.slice(0, length);
}
const passwords = Object.fromEntries(ROLES.map((role) => [role, token()]));

const set = {
  NODE_ENV: 'production',
  POSTGRES_PASSWORD: token(),
  ...Object.fromEntries(
    ROLES.map((role) => [`DB_PASSWORD_${role.toUpperCase()}`, passwords[role]]),
  ),
  S3_ACCESS_KEY: token(20),
  S3_SECRET_KEY: token(40),
  INTERNAL_TOKEN: token(48),
  AUTH_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  AUTH_SETUP_TOKEN: token(32),
  BACKUP_PASSPHRASE: token(40),
  GATEWAY_AUTH: 'session',
  APP_URL: address,
  S3_PUBLIC_ENDPOINT: address,
  STORAGE_CORS_ORIGINS: address,
  PARSE_RUN_ON_START: 'false',
  // Back up by themselves after a reboot or a crash.
  RESTART_POLICY: 'unless-stopped',
};
const remove = new Set(['AUTH_DEV_BYPASS']);

const lines = readFileSync('.env.example', 'utf8').split('\n');
const seen = new Set();
const out = lines.map((line) => {
  // A setting, or a commented one (`# KEY=value`); prose in comments is left alone.
  const match =
    /^([A-Z0-9_]+)=(.*)$/.exec(line) ?? /^# ([A-Z0-9_]+)=(\S*)$/.exec(line);
  if (!match) return line;
  const [, key, value] = match;
  if (remove.has(key)) return `# ${key}= (never on a published island)`;
  if (key in set) {
    if (seen.has(key)) return line.startsWith('#') ? line : `# ${line}`;
    seen.add(key);
    return `${key}=${set[key]}`;
  }
  // The localhost database URLs (for running a service by hand on this machine) get
  // the new role passwords too, so no dev password is left in the file.
  const role = /^postgres:\/\/([a-z0-9]+)_svc:dev_[a-z0-9]+@/.exec(value);
  if (role && !line.startsWith('#'))
    return `${key}=${value.replace(/:dev_[a-z0-9]+@/, `:${passwords[role[1]]}@`)}`;
  return line;
});
const missing = Object.keys(set).filter((key) => !seen.has(key));
out.push('', '# Published island (npm run env:production)');
for (const key of missing) out.push(`${key}=${set[key]}`);

writeFileSync(OUT, `${out.join('\n').trimEnd()}\n`, { mode: 0o600 });
console.log(
  `${OUT} written with new secrets for ${address}.\n` +
    'Still to fill in yourself: ANTHROPIC_API_KEY, and SMTP_URL / MAIL_FROM for the email digest.\n' +
    'Keep a copy in a password manager: BACKUP_PASSPHRASE is the only way to open the backups.',
);
