// Puts the built pages where the gateway serves them (infra/caddy/Caddyfile):
//   <out>/shell      the shell, at /
//   <out>/documents  the documents app, at /documents/
//   <out>/mfe/<name> each area, at /mfe/<name>/
// and gives the shell a federation manifest that loads every area from this
// same origin instead of the dev servers on localhost.
//
//   node infra/site/assemble.mjs [dist] [out]     (defaults: dist/apps dist/site)
import {
  cpSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const dist = process.argv[2] ?? 'dist/apps';
const out = process.argv[3] ?? 'dist/site';
const devManifest = JSON.parse(
  readFileSync('apps/shell/public/federation.manifest.json', 'utf8'),
);

function copyApp(name, target) {
  const from = join(dist, name, 'browser');
  if (
    !existsSync(join(from, 'index.html')) &&
    !existsSync(join(from, 'remoteEntry.json'))
  )
    throw new Error(
      `${from} has no build: run the production build of ${name} first.`,
    );
  cpSync(from, join(out, target), { recursive: true });
}

rmSync(out, { recursive: true, force: true });
copyApp('shell', 'shell');
copyApp('documents', 'documents');
const manifest = {};
for (const name of Object.keys(devManifest)) {
  copyApp(name, join('mfe', name));
  manifest[name] = `/mfe/${name}/remoteEntry.json`;
}
writeFileSync(
  join(out, 'shell', 'federation.manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(
  `site: shell, documents and ${Object.keys(manifest).length} areas in ${out}`,
);
