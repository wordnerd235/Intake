import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const list = (dir, ext) => readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(ext)).map((f) => `${dir}/${f}`);

test('sw.js precache list matches the files on disk', () => {
  const sw = read('sw.js');
  const block = /const PRECACHE = \[([\s\S]*?)\n\];/.exec(sw);
  assert.ok(block, 'PRECACHE block present');
  const cached = new Set([...block[1].matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean));
  const expected = ['index.html', 'manifest.webmanifest', 'data/exercises.json', ...list('icons', '.svg'), ...list('icons', '.png'), ...list('css', '.css'), ...list('js', '.js'), ...list('js/views', '.js')];
  for (const f of expected) assert.ok(cached.has(f), `${f} missing from sw.js PRECACHE (run: python scripts/update-precache.py)`);
  for (const f of cached) assert.ok(existsSync(join(ROOT, f)), `${f} is in PRECACHE but does not exist`);
  assert.match(sw, /const CACHE_VERSION = '[\w.-]+';/);
});

test('update-precache.py: --help, -h and a wrong option print usage and leave sw.js alone; --check only reports', () => {
  const script = join(ROOT, 'scripts/update-precache.py');
  const before = readFileSync(join(ROOT, 'sw.js'));
  const run = (...args) => spawnSync('python3', ['-B', script, ...args], { encoding: 'utf8' });
  for (const flag of ['--help', '-h']) {
    const r = run(flag);
    assert.equal(r.status, 0, flag);
    assert.match(r.stdout, /usage: update-precache\.py/i, flag);
    assert.match(r.stdout, /--check/, flag);
  }
  const bad = run('--bogus');
  assert.notEqual(bad.status, 0, 'an unknown option is refused');
  assert.match(bad.stderr, /usage: update-precache\.py/i);
  const check = run('--check');
  assert.match(check.stdout, /up to date|OUT OF DATE/);
  assert.ok(readFileSync(join(ROOT, 'sw.js')).equals(before), 'none of these may rewrite sw.js');
});

test('manifest is installable', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.name, 'Intake');
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  const sizes = m.icons.map((i) => `${i.sizes}/${i.purpose}`);
  assert.ok(sizes.includes('192x192/any') && sizes.includes('512x512/any') && sizes.includes('512x512/maskable'));
  for (const i of m.icons) assert.ok(existsSync(join(ROOT, i.src)), `${i.src} exists`);
});

test('index.html references only files that exist, with relative URLs', () => {
  const html = read('index.html');
  const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  for (const r of refs) {
    assert.ok(!r.startsWith('/') && !/^https?:/.test(r), `${r} must be relative`);
    assert.ok(existsSync(join(ROOT, r.replace(/^\.\//, ''))), `${r} exists`);
  }
});

// ---- static import graph: every relative import resolves and every named import is exported ----
const files = [...list('js', '.js'), ...list('js/views', '.js')];
const exportsOf = (src) => {
  const out = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) for (const part of m[1].split(',')) { const n = part.trim().split(/\s+as\s+/).pop(); if (n) out.add(n); }
  if (/export\s+default/.test(src)) out.add('default');
  return out;
};

test('module imports resolve and named imports exist', () => {
  const problems = [];
  for (const f of files) {
    const src = read(f);
    for (const m of src.matchAll(/import\s*(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\})?\s*(?:\*\s*as\s+[\w$]+)?\s*from\s*'(\.[^']+)'/g)) {
      const target = relative(ROOT, resolve(ROOT, dirname(f), m[3])).split('\\').join('/');
      if (!existsSync(join(ROOT, target)) || !statSync(join(ROOT, target)).isFile()) { problems.push(`${f}: cannot resolve ${m[3]}`); continue; }
      const ex = exportsOf(read(target));
      for (const part of (m[2] || '').split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0];
        if (name && !ex.has(name)) problems.push(`${f}: ${m[3]} does not export ${name}`);
      }
    }
    for (const m of src.matchAll(/import\(\s*'(\.[^']+)'\s*\)/g)) {
      if (!existsSync(join(ROOT, relative(ROOT, resolve(ROOT, dirname(f), m[1]))))) problems.push(`${f}: cannot resolve dynamic ${m[1]}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('no source file is much longer than 500 lines', () => {
  const long = [...files, ...list('css', '.css')].filter((f) => read(f).split('\n').length > 520);
  assert.deepEqual(long, []);
});

test('every module parses (duplicate bindings, syntax errors)', () => {
  const bad = [];
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', join(ROOT, f)], { encoding: 'utf8' });
    if (r.status !== 0) bad.push(`${f}: ${(r.stderr || '').split('\n').find((l) => /Error/.test(l)) || 'syntax error'}`);
  }
  assert.deepEqual(bad, []);
});

test('the deployable app never references test-only files', () => {
  const TEST_ONLY = /(^|\/)(tests|tools|scripts|__pycache__)\/|SPEC\.md|\.pyc\b/;
  const sw = read('sw.js');
  const block = /const PRECACHE = \[([\s\S]*?)\n\];/.exec(sw)[1];
  assert.ok(!TEST_ONLY.test(block), 'sw.js PRECACHE must not list tests/, tools/, scripts/ or SPEC.md');
  assert.ok(!TEST_ONLY.test(read('index.html')), 'index.html must not reference test-only files');
  for (const f of [...list('js', '.js'), ...list('js/views', '.js')]) {
    assert.ok(!/from '\.\.?\/\.\.\/(tests|tools|scripts)\//.test(read(f)) && !/import\(['"][^'"]*\/(tests|tools|scripts)\//.test(read(f)), `${f} must not import from test-only folders`);
  }
});
