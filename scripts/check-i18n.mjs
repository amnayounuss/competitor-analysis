#!/usr/bin/env node
/**
 * Fails when a user-facing string has no Arabic translation.
 *
 * Every visible string goes through t(), <Bi> or <BiInline>, all of which look
 * the English text up in lib/translations.ts and fall back to English when it is
 * missing. That fallback is silent: an untranslated label just renders in
 * English inside an otherwise Arabic page, and nobody notices until a customer
 * does. This turns that silence into a build error.
 *
 *   node scripts/check-i18n.mjs           report gaps, exit 1 if any
 *   node scripts/check-i18n.mjs --list    print the missing keys only, one per line
 *
 * It reads literals, so a string assembled at runtime — t(row.label) — is
 * invisible here. Keep those label constants as plain literals in the same file
 * and add them to the dictionary by hand.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SCAN = ['app', 'components', 'lib'];

const files = [];
for (const dir of SCAN) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) continue;
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!/node_modules|\.next/.test(p)) walk(p); }
      else if (/\.tsx?$/.test(e.name)) files.push(p);
    }
  })(abs);
}

const used = new Map();
const add = (s, f) => {
  if (!s || !s.trim()) return;
  if (!used.has(s)) used.set(s, new Set());
  used.get(s).add(path.relative(ROOT, f));
};

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'\s*\)/g))   add(m[1].replace(/\\'/g, "'"), f);
  for (const m of src.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g))   add(m[1].replace(/\\"/g, '"'), f);
  for (const m of src.matchAll(/<Bi(?:Inline)?\b[^>]*?\ben=\{?"((?:[^"\\]|\\.)*)"/g)) add(m[1], f);
  for (const m of src.matchAll(/<Bi(?:Inline)?\b[^>]*?\ben=\{?'((?:[^'\\]|\\.)*)'/g)) add(m[1], f);
  for (const m of src.matchAll(/\bar\(\s*'((?:[^'\\]|\\.)*)'\s*\)/g))  add(m[1].replace(/\\'/g, "'"), f);
}

const dict = fs.readFileSync(path.join(ROOT, 'lib/translations.ts'), 'utf8');
const have = new Set();
for (const m of dict.matchAll(/^\s*'((?:[^'\\]|\\.)*)'\s*:/gm)) have.add(m[1].replace(/\\'/g, "'"));
for (const m of dict.matchAll(/^\s*"((?:[^"\\]|\\.)*)"\s*:/gm)) have.add(m[1].replace(/\\"/g, '"'));

// A pipebar literal carries both languages inline, so it needs no dictionary row.
const missing = [...used.keys()].filter(k => !have.has(k) && !k.includes('|'));

if (process.argv.includes('--list')) {
  console.log(missing.join('\n'));
  process.exit(missing.length ? 1 : 0);
}

if (missing.length === 0) {
  console.log(`i18n OK — ${used.size} strings, all present in lib/translations.ts`);
  process.exit(0);
}

const byFile = new Map();
for (const k of missing) for (const f of used.get(k)) {
  if (!byFile.has(f)) byFile.set(f, []);
  byFile.get(f).push(k);
}
console.error(`\n${missing.length} string(s) have no Arabic translation:\n`);
for (const [f, keys] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
  console.error(`  ${f}`);
  for (const k of keys.sort()) console.error(`      '${k}': '',`);
}
console.error(`\nAdd them to lib/translations.ts, then re-run: node scripts/check-i18n.mjs\n`);
process.exit(1);
