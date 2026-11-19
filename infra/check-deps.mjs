// Runs before `npm run dev` (and so `npm start`): if a package that
// package.json lists is missing from node_modules, typically because a pull
// added a dependency and `npm install` was not run since, install it first.
// Without this, the service that needs it fails to build, `nx serve` never
// starts it, and its page only says "svc-<area> is not reachable".
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const wanted = Object.keys({
  ...manifest.dependencies,
  ...manifest.devDependencies,
});

const missing = wanted.filter(
  (name) => !existsSync(join(root, 'node_modules', name, 'package.json')),
);

if (missing.length > 0) {
  console.log(
    `Not installed yet: ${missing.join(', ')}. Running npm install first.`,
  );
  const result = spawnSync('npm', ['install'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    console.error('npm install failed: fix it, then run npm run dev again.');
    process.exit(result.status ?? 1);
  }
}
