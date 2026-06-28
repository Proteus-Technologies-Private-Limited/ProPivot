// Guard against the package.json version drifting from ProPivot.version (the value
// shipped in the bundle and shown by `pivot.version`). Run in CI and before publish.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const src = readFileSync(resolve(root, 'src/facade/ProPivot.ts'), 'utf8');
const m = src.match(/static\s+version\s*=\s*['"]([^'"]+)['"]/);

if (!m) {
  console.error('check-version: could not find `static version` in src/facade/ProPivot.ts');
  process.exit(1);
}
if (m[1] !== pkg.version) {
  console.error(
    `check-version: version mismatch — package.json is ${pkg.version} but ` +
      `ProPivot.version is ${m[1]}. Update both to the same value.`,
  );
  process.exit(1);
}
console.log(`check-version: OK (${pkg.version})`);
