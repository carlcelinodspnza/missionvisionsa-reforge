#!/usr/bin/env node
// sr-rebase.mjs — make a build servable from ANY directory, not only a domain root.
//
//   node scripts/sr-rebase.mjs --dir <build> [--check]
//
// A clone writes root-relative references: `/assets/x.webp`, `/styles/y.css`, `/index.html`. Those
// are correct at a domain root and WRONG everywhere else. Measured 2026-09-18: the eyetrends clone
// published to GitHub Pages under `/skill-reforge/test/eye-trends/` rendered with 0 of 19 images
// and every stylesheet 404 — each reference had resolved to the domain root, where nothing of this
// build exists.
//
// ⚖ A PATH THAT ASSUMES THE ROOT IS AN ASSUMPTION ABOUT THE HOST, NOT A PROPERTY OF THE SITE.
//
// So every root-relative reference becomes relative to the page that carries it: `../assets/x.webp`
// from a page one directory down, `assets/x.webp` from the top. The result works at a domain root,
// in a subdirectory, and from a file:// path — nothing about the host is assumed any more.
//
// Not touched: absolute URLs to other hosts (an embed, a font CDN), protocol-relative urls, data:
// URIs, fragments and mailto/tel links. Inside CSS the same rule applies per stylesheet's own
// location. --check reports what would change and writes nothing.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, die, log } from './lib/util.mjs';

// The directories a build owns. A root-relative reference into one of these is ours to rewrite;
// `/` anything else (a form action, an anchor to a page) is handled by the page map below.
const OWNED = ['assets', 'styles', 'scripts', 'fonts', 'media', 'docs'];

export function rebaseRef(ref, fileRelDir) {
  if (!ref.startsWith('/') || ref.startsWith('//')) return null;     // foreign or protocol-relative
  const depth = fileRelDir === '.' ? 0 : fileRelDir.split('/').filter(Boolean).length;
  const prefix = depth === 0 ? '' : '../'.repeat(depth);
  const out = prefix + ref.replace(/^\//, '');
  return out === '' ? './' : out;
}

// A PATH BUILT AT RUNTIME CANNOT BE REWRITTEN AT BUILD TIME — so the page tells the script where it is.
//
// Measured 2026-09-18 on the published preview: one image still 404'd at
// `https://<host>/assets/…-exam-room.webp`, because a shipped script builds that path from a string
// literal (`var MOB='/assets/…'`). Rewriting that literal relative to the SCRIPT is wrong — the
// browser resolves it against the PAGE, and one script serves pages at several depths.
//
// So each page declares its own depth in one line, and the literals are rewritten to read it:
//   page:   <script>window.__SR_BASE__="../";</script>
//   script: '/assets/x.webp'  ->  (window.__SR_BASE__||'')+'assets/x.webp'
// At a domain root the base is "" and the result is identical to what the build always shipped.
const BASE_TAG = (prefix) => '<script>window.__SR_BASE__=' + JSON.stringify(prefix) + ';' + RUNTIME + '</script>';
const OWNED_LITERAL = new RegExp("(['\"])\\/(" + OWNED.join('|') + ")\\/", 'g');

export function rebaseJsLiterals(js) {
  let n = 0;
  const out = js.replace(OWNED_LITERAL, (m, q, dir) => { n++; return '(window.__SR_BASE__||"")+' + q + dir + '/'; });
  return { js: out, count: n };
}

// A url() INSIDE A CUSTOM PROPERTY IS NOT RESOLVED AGAINST THE PAGE.
//
// Measured 2026-09-18 on the published preview: `style="--banner-background:url('assets/x.webp')"`
// on a depth-0 page was fetched from `<site>/styles/assets/x.webp` and 404'd — Chrome resolved it
// against the stylesheet that consumes the var, not against the document. Firefox and Safari
// resolve it against the declaring sheet, which for a style attribute IS the document.
//
// ⚖ A REFERENCE TWO ENGINES RESOLVE AGAINST DIFFERENT BASES CANNOT BE FIXED BY CHOOSING A BETTER
//   RELATIVE PATH — it has to stop being relative.
//
// So the value is made absolute at runtime against `document.baseURI`, which is the same string
// under either rule. Direct properties are left alone: they already resolve against the page, and
// rewriting them would be a change with no defect behind it.
//
// This function is shipped into every page by `String(...)` (see RUNTIME below) so the copy that
// runs in the browser and the copy the suite tests are one source.
export function fixCustomPropUrls(style, baseURI) {
  return String(style).split(';').map(function (decl) {
    if (!/^\s*--[A-Za-z0-9_-]+\s*:/.test(decl)) return decl;
    return decl.replace(/url\((\s*['"]?)([^)'"]+)(['"]?\s*)\)/g, function (m, q1, ref, q2) {
      if (/^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/|#)/.test(ref)) return m;
      try {
        var u = new URL(ref, baseURI);
        return 'url(' + q1 + u.pathname + u.search + u.hash + q2 + ')';
      } catch (e) { return m; }
    });
  }).join(';');
}

export const RUNTIME = String(fixCustomPropUrls)
  + ';(function(){function run(){var n=document.querySelectorAll(\'[style*="url("]\');'
  + 'for(var i=0;i<n.length;i++){var s=n[i].getAttribute("style"),o=fixCustomPropUrls(s,document.baseURI);'
  + 'if(o!==s)n[i].setAttribute("style",o);}}'
  + 'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",run);else run();})();';

// THE RUNTIME FIX ARRIVES AFTER THE FETCH — so the declaration is moved somewhere both engines
// resolve the same way, and the fetch is right the first time.
//
// Measured on the published onyx preview: the absolutiser above corrects the attribute and the
// images then load 200, but Chrome has already asked for `<site>/styles/assets/...` and logged
// three 404s before DOMContentLoaded. ⚖ A FIX THAT RUNS AFTER THE FETCH CORRECTS THE PAGE, NOT
// THE REQUEST LOG.
//
// Chrome resolves against the sheet that CONSUMES the var; other engines against the sheet that
// DECLARES it. Put the declaration in a stylesheet that sits beside the consuming ones — every
// stylesheet a clone writes lives in `styles/` — and the two rules name the same directory, so
// the disagreement has nothing left to disagree about.
//
// Only a declaration that is BOTH a custom property AND carries a root-relative url moves; the
// rest of the attribute stays exactly where the author put it. `!important` preserves the
// precedence the value had as an inline style.
const CP_SHEET = 'styles/sr-custom-props.css';
const CP_DECL = /^\s*(--[A-Za-z0-9_-]+)\s*:/;

export function hoistCustomPropUrls(html, startId) {
  let id = startId; const rules = []; let count = 0;
  const out = html.replace(/\sstyle\s*=\s*"([^"]*)"/gi, (m, css) => {
    const keep = []; const move = [];
    for (const decl of css.split(';')) {
      if (!decl.trim()) continue;
      const owned = CP_DECL.test(decl) && /url\(\s*['"]?\/(?!\/)/.test(decl);
      (owned ? move : keep).push(decl);
    }
    if (!move.length) return m;
    id++; count += move.length;
    const body = move
      .map((d) => d.replace(/url\((\s*['"]?)(\/[^)'"]+)(['"]?\s*)\)/g,
        (mm, q1, ref, q2) => 'url(' + q1 + rebaseRef(ref, 'styles') + q2 + ')'))
      .map((d) => d.trim() + ' !important')
      .join(';');
    rules.push('[data-sr-cp="' + id + '"]{' + body + '}');
    const rest = keep.join(';').trim();
    return ' data-sr-cp="' + id + '"' + (rest ? ' style="' + rest + '"' : '');
  });
  return { html: out, rules, count, next: id };
}

function main() {
  const a = argv();
  const dir = path.resolve(a.dir || a._[0] || '.');
  if (!fs.existsSync(dir)) die('no such directory: ' + dir);
  const check = !!a.check;

  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(html?|css|js|json|xml|txt|webmanifest)$/i.test(e.name)) files.push(p);
    }
  }(dir));

  let changedFiles = 0, changedRefs = 0;
  let cpId = 0; const cpRules = [];
  for (const f of files) {
    const relDir = path.dirname(path.relative(dir, f)).split(path.sep).join('/') || '.';
    const before = fs.readFileSync(f, 'utf8');
    let after = before;
    // The hoist runs FIRST, while the urls are still root-relative: a rule in styles/ is written
    // relative to styles/, which is not the same prefix the page below would give it.
    if (/\.html?$/i.test(f)) {
      const h = hoistCustomPropUrls(after, cpId);
      if (h.count) {
        after = h.html; cpId = h.next; cpRules.push(...h.rules); changedRefs += h.count;
        if (!after.includes(CP_SHEET)) {
          const link = '<link rel="stylesheet" href="/' + CP_SHEET + '">';
          after = /<\/head>/i.test(after)
            ? after.replace(/<\/head>/i, link + '</head>')
            : after.replace(/<head\b[^>]*>/i, (m2) => m2 + link);
        }
      }
    }

    // href/src/action/content/poster/data-* in markup, and every candidate of srcset AND
    // imagesrcset. `\bsrcset` does not match inside `imagesrcset`, and a <link rel=preload> that
    // kept its root-relative candidates was a measured 404 on the published preview.
    //
    // BOTH quote styles, double first and single as a purely additive second pass. WordPress
    // enqueues every stylesheet as <link rel='stylesheet' href='/…'> and writes its canonical the
    // same way; a double-quote-only pass left 4-5 stylesheets per page root-relative, and on a
    // Pages project site each one 404s and the page renders unstyled (measured 2026-09-29, a
    // 55-page WordPress clone, before publishing). A value that merely CONTAINS a double-quoted
    // link inside single quotes (data-content='<a href="/x">') is untouched by the second pass:
    // its value does not start with "/".
    for (const q of ['"', "'"]) {
      const attrRe = new RegExp('(\\b(?:href|src|action|poster|content|data-src|data-video-src)\\s*=\\s*' + q + ')(\\/[^' + q + ']*)' + q, 'gi');
      after = after.replace(attrRe, (m, head, ref) => { const r = rebaseRef(ref, relDir); if (!r) return m; changedRefs++; return head + r + q; });
      const setRe = new RegExp('(\\b(?:image)?srcset\\s*=\\s*' + q + ')([^' + q + ']+)' + q, 'gi');
      after = after.replace(setRe, (m, head, list) => {
        const parts = list.split(',').map((p0) => {
          const t = p0.trim(); const sp = t.indexOf(' ');
          const url = sp === -1 ? t : t.slice(0, sp); const rest = sp === -1 ? '' : t.slice(sp);
          const r = rebaseRef(url, relDir);
          if (!r) return t;
          changedRefs++; return r + rest;
        });
        return head + parts.join(', ') + q;
      });
    }
    // CSS url(...) — relative to the stylesheet's own directory, which is this file's.
    after = after.replace(/url\((\s*['"]?)(\/[^)'"]+)(['"]?\s*)\)/gi,
      (m, q1, ref, q2) => { const r = rebaseRef(ref, relDir); if (!r) return m; changedRefs++; return 'url(' + q1 + r + q2 + ')'; });

    // A page declares its own depth once, at the top of <head>, before any script can read it.
    if (/\.html?$/i.test(f)) {
      const prefix = relDir === '.' ? '' : '../'.repeat(relDir.split('/').filter(Boolean).length);
      if (!after.includes('window.__SR_BASE__=')) {
        after = after.replace(/<head\b[^>]*>/i, (m) => m + BASE_TAG(prefix));
        changedRefs++;
      }
      // An INLINE script builds paths at runtime exactly as a shipped file does — and this is where
      // the measured 404 actually lived: `var MOB='/assets/…-mobile-lockup.webp'` inside the page.
      // Only the contents of <script> blocks are touched; attributes were handled above.
      after = after.replace(/(<script\b(?![^>]*\bsrc=)[^>]*>)([\s\S]*?)(<\/script>)/gi, (m, open, body, close) => {
        if (body.includes('__SR_BASE__')) return m;
        const r = rebaseJsLiterals(body);
        if (!r.count) return m;
        changedRefs += r.count;
        return open + r.js + close;
      });
    }
    // A shipped script's own string literals, resolved against the page at runtime.
    if (/\.(js|mjs)$/i.test(f)) {
      const r = rebaseJsLiterals(after);
      if (r.count) { after = r.js; changedRefs += r.count; }
    }

    if (after !== before) {
      changedFiles++;
      if (!check) fs.writeFileSync(f, after, 'utf8');
    }
  }
  if (cpRules.length && !check) {
    const sp = path.join(dir, CP_SHEET);
    fs.mkdirSync(path.dirname(sp), { recursive: true });
    fs.writeFileSync(sp, '/* site-reforge: custom-property urls, resolved against THIS sheet so every'
      + ' engine reads the same base. See sr-rebase.mjs. */' + '\n' + cpRules.join('\n') + '\n', 'utf8');
    log('  ' + cpRules.length + ' custom-property declaration(s) hoisted into ' + CP_SHEET);
  }
  log('rebase: ' + changedRefs + ' reference(s) in ' + changedFiles + ' of ' + files.length + ' file(s)'
    + (check ? ' — CHECK ONLY, nothing written' : ' rewritten relative to their own page'));
  log('  the build now serves from a domain root, a subdirectory or file:// alike');
}

const IS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (IS_MAIN) main();
