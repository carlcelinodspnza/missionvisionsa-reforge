// util.mjs — shared helpers. Node builtins only. No dependencies, ever.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const nowISO = () => new Date().toISOString();

export function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); return p; }

export function readJSON(p, fallback = null) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

export function writeJSON(p, obj) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  return p;
}

export function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function slugifyUrl(u) {
  try {
    const url = new URL(u);
    let s = (url.pathname + url.search).replace(/^\/+|\/+$/g, '');
    if (!s) s = 'index';
    s = s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (s.length > 120) s = s.slice(0, 100) + '-' + sha256(Buffer.from(u)).slice(0, 8);
    return s || 'index';
  } catch {
    return 'url-' + sha256(Buffer.from(String(u))).slice(0, 12);
  }
}

const TRACKING = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'gclid', 'fbclid', 'msclkid', 'mc_cid', 'mc_eid', '_ga',
]);

export function normalizeUrl(input, base) {
  let url;
  try { url = base ? new URL(input, base) : new URL(input); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  for (const k of [...url.searchParams.keys()]) {
    if (TRACKING.has(k.toLowerCase())) url.searchParams.delete(k);
  }
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }
  return url.toString();
}

// ORIGIN comparison, not hostname comparison. host:8080 and host:9090 are two
// different sites, and a crawler that conflates them wanders onto a neighbouring
// service and reports its pages as part of the target. (Caught 2026-09-03: a
// fixture on :8731 and one on :8917 were crawled as one site, doubling the count.)
export function sameSite(a, b, includeSubdomains = false) {
  try {
    const ua = new URL(a), ub = new URL(b);
    if (ua.host === ub.host) return true;            // host includes the port
    if (!includeSubdomains) return false;
    if (ua.port !== ub.port) return false;
    const reg = (h) => h.split('.').slice(-2).join('.');
    return reg(ua.hostname) === reg(ub.hostname);
  } catch { return false; }
}

// A repeated flag ACCUMULATES into an array. Overwriting silently discarded two
// of three --src libraries on 2026-09-03 and reported success for the one that
// survived; a dropped input must never look like a completed run.
export function argv(list = process.argv.slice(2)) {
  const out = { _: [] };
  const seen = new Set();
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    const next = list[i + 1];
    const val = (next === undefined || next.startsWith('--')) ? true : (i++, next);
    if (seen.has(key)) out[key] = [].concat(out[key], val);
    else { out[key] = val; seen.add(key); }
  }
  return out;
}

/** Read a flag that may legitimately appear more than once, always as an array. */
export function multi(a, key) {
  const v = a[key];
  if (v === undefined) return [];
  return (Array.isArray(v) ? v : [v]).filter((x) => typeof x === 'string');
}

// "Name: value" -> { name: value }, folded onto whatever is already pinned.
//
// Split on the FIRST colon only. A Cookie value carries its own colons and an ISO time is
// nothing but colons; splitting on every one of them keeps the part before the second and
// throws the rest away, which is a truncated header that still looks like a header. An
// entry with no colon is refused rather than stored under a name made of the whole string.
export function parseHeaders(list, base = {}) {
  const out = { ...base };
  for (const raw of list || []) {
    const s = String(raw);
    const i = s.indexOf(':');
    if (i < 1) die('--header needs "Name: value", got: ' + s);
    out[s.slice(0, i).trim()] = s.slice(i + 1).trim();
  }
  return out;
}

export function die(msg, code = 1) {
  process.stderr.write('site-reforge: ' + msg + '\n');
  process.exit(code);
}

export function log(...a) { process.stdout.write(a.join(' ') + '\n'); }

export async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const n = Math.max(1, Math.min(limit, items.length || 1));
  const workers = new Array(n).fill(0).map(async () => {
    for (;;) {
      const idx = i++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

// Recall is counted as a MULTISET, not a vocabulary.
//
// This used to build `new Set(tok(targetText))` and ask `tgt.has(w)` once per source word.
// A Set answers "does this word appear anywhere on the page", which is not the question.
// Under that rule a page saying "Las Vegas" forty times and a rebuild saying it once both
// score 40/40: thirty-nine deletions are free, because the fortieth occurrence vouches for
// all of them. Whole sections built from words used elsewhere on the page cost nothing at
// all. A 95% floor over a vocabulary test cannot see a deleted block.
//
// Each TARGET occurrence may now satisfy at most one SOURCE occurrence, so the count has to
// match, not just the spelling.
//
// `longestMissingRun` is the other half. A dropped 40-word testimonial on a 5,000-word page
// costs 0.8% recall \u2014 invisible under any percentage floor \u2014 but it is a run of 40
// consecutive source words that matched nothing. A contiguous run is what a missing ELEMENT
// looks like in a word stream, and a percentage is what hides it.
export function tokenRecall(sourceText, targetText) {
  const tok = (s) => (String(s || '').toLowerCase().match(/[a-z0-9\u00c0-\u024f']+/g) || []);
  const src = tok(sourceText);
  if (!src.length) {
    return { recall: 1, missing: [], srcCount: 0, missingCount: 0, longestMissingRun: 0, longestMissingText: '' };
  }
  const bag = new Map();
  for (const w of tok(targetText)) bag.set(w, (bag.get(w) || 0) + 1);
  const missing = [];
  let hit = 0, run = 0, bestRun = 0, bestEnd = -1;
  for (let i = 0; i < src.length; i++) {
    const w = src[i];
    const n = bag.get(w) || 0;
    if (n > 0) { bag.set(w, n - 1); hit++; run = 0; continue; }
    missing.push(w);
    run++;
    if (run > bestRun) { bestRun = run; bestEnd = i; }
  }
  return {
    recall: hit / src.length,
    missing: [...new Set(missing)].slice(0, 60),
    srcCount: src.length,
    missingCount: missing.length,
    longestMissingRun: bestRun,
    longestMissingText: bestRun ? src.slice(bestEnd - bestRun + 1, bestEnd + 1).join(' ').slice(0, 200) : '',
  };
}

export function walk(dir, filterFn) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        stack.push(full);
      } else if (!filterFn || filterFn(full)) out.push(full);
    }
  }
  return out.sort();
}

export function relTime(ms) {
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  return Math.floor(ms / 60000) + 'm' + Math.round((ms % 60000) / 1000) + 's';
}

// Which files in a build can hold a reference to another file.
//
// ONE definition, because it was two and they disagreed. sr-clone-verify's reference check
// read .html/.css/.js/.json; its ORPHAN check, forty lines further down, built its own list
// and read .html/.css/.js. So every asset whose only referrer was a JSON data file resolved
// correctly under one check and was reported unreferenced by the other — 452 of them on a
// 536-image build, each one a real, correctly-rewritten reference the second list could not
// see. The builder's three sweeps held a third copy of the same list.
//
// A data file is reference-bearing for the same reason a stylesheet is: something in it
// names a file this build has to keep.
export const REFERENCE_BEARING = /\.(?:html?|css|js|mjs|json)$/i;
export const isReferenceBearing = (p) => REFERENCE_BEARING.test(String(p || ''));

// ── phones ─────────────────────────────────────────────────────────────────
// ONE SHAPE AND ONE KEY, SHARED BY THE HARVEST AND THE COMPARISON.
//
// Measured 2026-09-17 on a real clone: the harvest and parity each had their own idea of a
// phone. The harvest took JSON-LD coordinates, record ids, SVG path data and dates; parity then
// concatenated EVERY digit in the rebuilt document and substring-matched against that, so the
// `1` in an `<h1>` tag glued onto 2814880066 and "found" +1 281 488 0066 in a page that did not
// carry it. A concatenated digit stream lets unrelated numbers join into a false match.
// ⚖ TWO COPIES OF ONE RULE ARE TWO RULES, AND THEY WILL DISAGREE.
//
// PHONE_RE — three shapes, each ending on a word boundary:
//   · NANP, optionally +1:        (281) 488-0066 · 281-488-0066 · +1 281.488.0066
//   · international with groups:  +44 20 7946 0958
//   · bare runs (tel: hrefs):     +12814880066 · 2814880066
// Known limit, stated: a non-NANP number written WITHOUT a leading + is not recognised.
export const PHONE_RE = /(?:\+1[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]\d{4}\b|\+\d{1,3}(?:[ .-]\d{1,4}){2,4}\b|\+\d{8,15}\b|\b\d{10,11}\b/g;

/** Comparison key for one number: digits only, NANP country code folded. */
export function phoneKey(s) {
  let d = String(s || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  return d;
}

/** Every phone-shaped number in a string, as keys. Never a concatenation of the document. */
export function phoneKeys(text) {
  return new Set((String(text || '').match(PHONE_RE) || []).map(phoneKey).filter((k) => k.length >= 9 && k.length <= 15));
}
