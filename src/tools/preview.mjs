// Builds a subfolder preview (a GitHub Pages project site) from clean/ or dist/ into _site/.
// usage: node src/tools/preview.mjs /<repo> [clean|dist]      (default: clean)
//   clean  the site-reforge CLONE lane build (carlcelinodspnza/missionvisionsa)
//   dist   the site-reforge REFORGE lane build (carlcelinodspnza/missionvisionsa-reforge)
//
// Same contract as the other site-reforge preview repos: the build
// is written for the domain root (every link and asset starts with "/"), and a project Pages site lives
// under /<repo>/. The build itself is never modified.
//
// Why this one does not simply prefix "/" with the base: a clone is a faithful WordPress copy, and it
// carries root paths in single-quoted attributes (WordPress core writes <link rel='canonical'>),
// lazy-load data-* attributes, meta content, inline <style>, CSS custom properties and harvested
// scripts. A prefixing regex over double-quoted href/src misses those and the preview 404s. So the
// copy is re-based by site-reforge's own sr-rebase (vendored byte-identical in
// src/tools/site-reforge/, from site-reforge 1.12.1 + 2026-09-29 and 2026-10-01 patches), which makes every root path
// relative to the page carrying it — correct under /<repo>/, at a domain root and from disk.
//
// dist only, three things sr-rebase cannot do for a Pages project site:
//   - the site search reads its index from <… data-search-index="/search-index.json"> and links each
//     result to the index entry's root "url"; sr-rebase rewrites neither (a data-* attribute it does not
//     know, and JSON), so both are prefixed with the base;
//   - GitHub Pages serves 404.html AT the missing URL, at any depth (/<repo>/dry-eye-treatment/ for the
//     moved URLs whose _redirects Pages ignores), so page-relative references in it would resolve
//     under the missing folder. 404.html is rebuilt from the build with every root path prefixed with
//     the base instead (absolute, correct at any depth);
//   - llms.txt lists root paths that do not exist under /<repo>/, so it is left out of the copy.
//
// The preview is a copy of a live practice site on another domain, so it must never be indexed. The
// control that works on a project site is the page meta: every page gets exactly one
// <meta name="robots" content="noindex, nofollow">. (A robots.txt is written too, but crawlers only read
// the host root's robots.txt, which a project site does not own.) Netlify/Cloudflare _redirects/_headers
// files are left out.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = (process.argv[2] || '').replace(/\/+$/, '');
const SRC = process.argv[3] || 'clean';
if (!/^\/[A-Za-z0-9._-]+$/.test(BASE) || !['clean', 'dist'].includes(SRC)) {
  console.error('usage: node src/tools/preview.mjs /<base-path> [clean|dist]   e.g. /missionvisionsa');
  process.exit(1);
}
const BUILD = path.join(ROOT, SRC);
const OUT = path.join(ROOT, '_site');
if (!fs.existsSync(path.join(BUILD, 'index.html'))) { console.error('no ' + SRC + '/index.html — nothing to preview'); process.exit(1); }

fs.rmSync(OUT, { recursive: true, force: true });
const SKIP = SRC === 'dist' ? /[\\/](?:_redirects|_headers|llms\.txt)$/ : /[\\/](?:_redirects|_headers)$/;
fs.cpSync(BUILD, OUT, { recursive: true, filter: (src) => !SKIP.test(src) });

// Re-base: every root-relative reference becomes relative to its own page / stylesheet.
const r = spawnSync(process.execPath, [path.join(ROOT, 'src', 'tools', 'site-reforge', 'sr-rebase.mjs'), '--dir', OUT], { encoding: 'utf8' });
process.stdout.write(r.stdout || '');
if (r.status !== 0) { process.stderr.write(r.stderr || ''); console.error('sr-rebase failed'); process.exit(1); }

// "/x" but not "//host" (protocol-relative) and not already under the base.
const baseRe = BASE.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rootPath = new RegExp('^/(?!/)(?!' + baseRe + '(?:/|$))');
const withBase = (p) => (rootPath.test(p) ? BASE + p : p);

// dist: the search index location and its result urls.
let searchFixed = 0;
if (SRC === 'dist') {
  const idx = path.join(OUT, 'search-index.json');
  if (fs.existsSync(idx)) {
    const entries = JSON.parse(fs.readFileSync(idx, 'utf8'));
    for (const e of entries) if (typeof e.url === 'string') { e.url = withBase(e.url); searchFixed++; }
    fs.writeFileSync(idx, JSON.stringify(entries));
  }
}

// dist: 404.html is served at any depth, so rebuild it from the build with base-absolute root paths
// (quoted attribute values, every srcset/imagesrcset candidate, CSS url()). Page-relative "./x", "#x" and
// absolute https URLs are left as they are. The noindex pass below then applies to it like any page.
let notFound = 0;
const nf = path.join(BUILD, '404.html');
if (SRC === 'dist' && fs.existsSync(nf)) {
  let s = fs.readFileSync(nf, 'utf8');
  s = s.replace(/\b(href|src|action|poster|content|data-src|data-video-src|data-search-index)=(["'])(\/[^"']*)\2/gi,
    (m, a, q, v) => { notFound++; return a + '=' + q + withBase(v) + q; });
  s = s.replace(/\b(srcset|imagesrcset)=(["'])([^"']*)\2/gi, (m, a, q, v) => a + '=' + q + v.split(',').map((c) => {
    const t = c.trim(); if (!t) return t; const [u, ...d] = t.split(/\s+/); if (u.startsWith('/')) notFound++; return [withBase(u), ...d].join(' ');
  }).join(', ') + q);
  s = s.replace(/url\((&quot;|["'])?(\/(?!\/)[^)"'&]*)(&quot;|["'])?\)/g, (m, q1, v, q2) => { notFound++; return 'url(' + (q1 || '') + withBase(v) + (q2 || '') + ')'; });
  fs.writeFileSync(path.join(OUT, '404.html'), s);
}

// noindex: one robots meta per page, replacing any the source carried.
let html = 0;
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!e.name.endsWith('.html')) continue;
    let s = fs.readFileSync(p, 'utf8');
    s = s.replace(/<meta\b[^>]*\bname=(["'])robots\1[^>]*>\s*/gi, '');
    s = s.replace(/<head\b[^>]*>/i, (m) => m + '\n<meta name="robots" content="noindex, nofollow">');
    if (SRC === 'dist') s = s.replace(/\bdata-search-index=(["'])(\/[^"']*)\1/g, (m, q, v) => 'data-search-index=' + q + withBase(v) + q);
    fs.writeFileSync(p, s);
    html++;
  }
};
walk(OUT);
fs.writeFileSync(path.join(OUT, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
console.log('_site/ preview of ' + SRC + '/ for base ' + BASE + ': ' + html + ' html re-based and marked noindex'
  + (SRC === 'dist' ? '; ' + searchFixed + ' search-index urls prefixed; 404.html rebuilt with ' + notFound + ' base-absolute refs' : ''));
