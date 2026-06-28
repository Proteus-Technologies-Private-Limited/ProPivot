// Cache-busting stamper for the GitHub Pages site.
//
// GitHub Pages serves docs/assets/*.{js,css} with a long-lived cache and a
// STABLE filename, so a browser that fetched an older bundle keeps serving it
// after a redeploy — the user then sees pre-fix behaviour (e.g. filters that
// "don't work"). We append `?v=<content-hash>` to every asset reference in the
// deployed HTML; the hash changes whenever the bundle changes, so each deploy
// forces a fresh fetch while unchanged assets stay cached.
//
// Idempotent: re-running rewrites any existing `?v=...` to the current hash.
// Run after every `npm run build` + copy into docs/assets.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_DIR = resolve(ROOT, 'docs/assets');

const ASSETS = ['propivot.global.js', 'propivot.css', 'gallery.js', 'propivot.worker.js', 'site.css', 'site.js'];
const hashes = {};
for (const a of ASSETS) {
  const p = resolve(ASSET_DIR, a);
  if (existsSync(p)) hashes[a] = createHash('md5').update(readFileSync(p)).digest('hex').slice(0, 8);
}

const HTML = [
  'docs/index.html', 'docs/gallery.html', 'docs/demo.html', 'docs/features.html', 'docs/docs.html',
  'docs/upload.html', 'docs/starters.html', 'docs/whats-new.html',
];

// Build one regex per asset basename that matches the path with optional ?v=… .
function stamp(html) {
  let out = html;
  for (const [asset, hash] of Object.entries(hashes)) {
    const esc = asset.replace(/[.]/g, '\\.');
    // Matches: ./assets/<asset> or assets/<asset> optionally followed by ?v=hex,
    // inside href="…" / src="…" / new URL('…') .
    const re = new RegExp(`((?:\\./)?assets/${esc})(\\?v=[0-9a-f]+)?`, 'g');
    out = out.replace(re, `$1?v=${hash}`);
  }
  return out;
}

let changed = 0;
for (const rel of HTML) {
  const p = resolve(ROOT, rel);
  if (!existsSync(p)) continue;
  const before = readFileSync(p, 'utf8');
  const after = stamp(before);
  if (after !== before) { writeFileSync(p, after); changed++; console.log('stamped', rel); }
  else console.log('unchanged', rel);
}
console.log(`\nhashes:`, hashes);
console.log(`${changed} file(s) updated.`);
