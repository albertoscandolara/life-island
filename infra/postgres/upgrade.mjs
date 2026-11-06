// npm run db:upgrade: applies every infra/postgres/upgrades/*.sql, in order,
// to the running postgres container. Each file goes to psql on stdin, so it
// works from any shell (PowerShell included) and does not depend on the
// container having the upgrades folder mounted.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, 'upgrades');
const files = readdirSync(dir)
  .filter((name) => name.endsWith('.sql'))
  .sort();

for (const name of files) {
  console.log(`Applying ${name}`);
  const result = spawnSync(
    'docker',
    [
      'compose',
      '--project-directory',
      '.',
      '-f',
      'infra/docker-compose.yml',
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'postgres',
      '-d',
      'life_island',
      '-v',
      'ON_ERROR_STOP=1',
      '-q',
    ],
    {
      input: readFileSync(join(dir, name)),
      stdio: ['pipe', 'inherit', 'inherit'],
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('Database is up to date.');
