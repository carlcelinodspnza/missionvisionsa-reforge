/* ── src/scripts/base.js ── */
/* base.js: two site-wide behaviours (docs/BRAND-SYSTEM.md).
   1. Header shrink: .site-header gets .is-stuck once the page has scrolled; CSS owns the look.
   2. Disclosure navigation (the APG disclosure pattern): a button[data-disclosure][aria-controls]
      opens and closes the element it controls. One open at a time; Escape closes it and returns
      focus to its button; a click or focus outside closes it. The markup never uses `hidden`, so
      without JavaScript the submenus stay reachable through CSS.
   An Escape key this script consumes is marked with preventDefault(), so a dialog's own Escape
   handler can ignore it (check event.defaultPrevented). */
(function () {
  'use strict';
  var doc = document;

  // 1. header shrink
  var header = doc.querySelector('.site-header');
  if (header) {
    var stuck = false;
    var ticking = false;
    var update = function () {
      ticking = false;
      var y = window.scrollY || doc.documentElement.scrollTop || 0;
      // hysteresis: stick past 24px, release under 4px, so a shrinking header never flickers
      var next = stuck ? y > 4 : y > 24;
      if (next !== stuck) {
        stuck = next;
        header.classList.toggle('is-stuck', stuck);
      }
    };
    window.addEventListener('scroll', function () {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(update);
      }
    }, { passive: true });
    update();
  }

  // 2. disclosure navigation
  var toggles = Array.prototype.slice.call(doc.querySelectorAll('button[data-disclosure][aria-controls]'));
  if (!toggles.length) return;

  var panelOf = function (btn) { return doc.getElementById(btn.getAttribute('aria-controls')); };
  var scopeOf = function (btn) { return btn.closest('li') || btn.parentNode; };
  var isOpen = function (btn) { return btn.getAttribute('aria-expanded') === 'true'; };
  var setOpen = function (btn, open) {
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    var panel = panelOf(btn);
    if (panel) panel.classList.toggle('is-open', open);
    var scope = scopeOf(btn);
    if (scope && scope.classList) scope.classList.toggle('is-open', open);
  };
  var closeOthers = function (keep) {
    toggles.forEach(function (b) { if (b !== keep && isOpen(b)) setOpen(b, false); });
  };

  toggles.forEach(function (btn) {
    setOpen(btn, false);
    btn.addEventListener('click', function () {
      var open = !isOpen(btn);
      closeOthers(btn);
      setOpen(btn, open);
    });
  });

  doc.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' && e.key !== 'Esc') return;
    var active = doc.activeElement;
    for (var i = 0; i < toggles.length; i++) {
      var btn = toggles[i];
      if (isOpen(btn) && (active === btn || scopeOf(btn).contains(active))) {
        setOpen(btn, false);
        btn.focus();
        e.preventDefault();
        return;
      }
    }
  });

  var closeOutside = function (target) {
    toggles.forEach(function (btn) {
      if (isOpen(btn) && !scopeOf(btn).contains(target)) setOpen(btn, false);
    });
  };
  doc.addEventListener('click', function (e) { closeOutside(e.target); });
  doc.addEventListener('focusin', function (e) { closeOutside(e.target); });
})();
;
/* ── src/scripts/accordion.js ── */
/* accordion.js: questions and answers as disclosures (the APG disclosure pattern).
   The markup ships every answer open: each question is <hN><button aria-expanded="true" aria-controls>,
   each answer a panel with no `hidden` attribute, so without JavaScript everything is readable. This script
   collapses the answers on load and lets each button open and close its own answer. An answer holding the
   element the address bar points at (#id) stays open. Opening plays a short reveal, off under reduced motion. */
(function () {
  'use strict';
  var roots = document.querySelectorAll('[data-accordion]');
  if (!roots.length) return;

  var targetId = '';
  try { targetId = decodeURIComponent((window.location.hash || '').slice(1)); } catch (e) { targetId = ''; }

  var setOpen = function (btn, panel, open, animate) {
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    panel.hidden = !open;
    var item = btn.closest('.accordion__item');
    if (item) item.classList.toggle('is-open', open && !!animate);
  };

  Array.prototype.forEach.call(roots, function (root) {
    var buttons = root.querySelectorAll('button[aria-controls]');
    Array.prototype.forEach.call(buttons, function (btn) {
      var panel = document.getElementById(btn.getAttribute('aria-controls'));
      if (!panel) return;
      var target = targetId ? document.getElementById(targetId) : null;
      var keep = !!(target && (target === panel || panel.contains(target)));
      setOpen(btn, panel, keep, false);
      btn.addEventListener('click', function () {
        setOpen(btn, panel, btn.getAttribute('aria-expanded') !== 'true', true);
      });
    });
  });
})();
;
/* ── src/scripts/form.js ── */
/* form.js: the inert GF 10 form "Email Us" (plan §8.11; docs/DEPLOY.md).
   The submit button is already `disabled` in the markup, so no browser can send the form. This script:
   - cancels any submit event that still reaches a form[data-needs-backend] (a script, an extension, a future edit);
   - catches Enter in a single-line field, which would otherwise try an implicit submit;
   - and in both cases writes the form's notice ("Online submission is not connected yet") into the
     [data-form-status][aria-live=polite] region, so a screen reader hears why nothing was sent;
   - replays the source's own show/hide rule (Gravity Forms conditional logic, written by components/form.mjs into
     [data-form-cond] as {action, logic, rules[{name, op, value}]}): Email shows for "Yes, Email Me", Phone for
     "Yes, Call Me". Every field is visible until this runs (no content hidden before JavaScript, plan §5), and a
     rule that cannot be read leaves its field visible.
   The notice text is read from the visible notice in the page; this file carries no copy of its own. */
(function () {
  'use strict';
  var valuesOf = function (form, name) {
    var out = [];
    Array.prototype.forEach.call(form.elements, function (el) {
      if (el.name !== name) return;
      var type = String(el.type || '').toLowerCase();
      if ((type === 'radio' || type === 'checkbox') && !el.checked) return;
      out.push(String(el.value));
    });
    return out;
  };
  var applyRules = function (form) {
    Array.prototype.forEach.call(form.querySelectorAll('[data-form-cond]'), function (field) {
      var rule;
      try { rule = JSON.parse(field.getAttribute('data-form-cond')); } catch (err) { return; }
      if (!rule || !rule.rules || !rule.rules.length) return;
      var test = function (r) {
        var has = valuesOf(form, r.name).indexOf(String(r.value)) !== -1;
        return r.op === 'isnot' ? !has : has;
      };
      var met = rule.logic === 'any' ? rule.rules.some(test) : rule.rules.every(test);
      var show = rule.action === 'hide' ? !met : met;
      field.hidden = !show;
    });
  };
  var init = function () {
    var forms = document.querySelectorAll('form.form[data-needs-backend]');
    if (!forms.length) return;
    Array.prototype.forEach.call(forms, function (form) {
      var status = form.querySelector('[data-form-status]');
      var title = form.querySelector('.form__notice-title');
      var message = title ? title.textContent.replace(/\s+/g, ' ').trim() : '';
      var timer = 0;
      var announce = function () {
        if (!status || !message) return;
        // clear, then set: a live region announces a change, so a repeated attempt is heard again
        status.textContent = '';
        window.clearTimeout(timer);
        timer = window.setTimeout(function () { status.textContent = message; }, 60);
      };
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        announce();
      });
      form.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || e.defaultPrevented) return;
        var t = e.target;
        if (!t || t.tagName !== 'INPUT') return;
        var type = String(t.type || 'text').toLowerCase();
        if (type === 'checkbox' || type === 'radio' || type === 'submit' || type === 'button' || type === 'reset' || type === 'file') return;
        e.preventDefault();
        announce();
      });
      if (form.querySelector('[data-form-cond]')) {
        form.addEventListener('change', function () { applyRules(form); });
        applyRules(form);
      }
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
;
/* ── src/scripts/search.js ── */
/* search.js: the static site search on /search/ (plan §2.6, §10; docs/BRAND-SYSTEM.md).
   Reads the query from ?q=, fetches /search-index.json once (same origin), and lists the pages that contain
   every word of the query, ranked title > description > body (headings count with the body, a little above it);
   a whole word outweighs a prefix of a longer word; ties go to the page whose headings and text use the query
   words most, then to build order.
   Words match at the start of a word, ignoring case and accents. Matched words are marked in the result.
   A result is headed by the page's H1 (index headings[0]); the <title> (the source title, verbatim) only ranks.
   Its snippet is the meta description when that holds a query word, else ONE text block of the page (the index
   keeps one block per line): the first sentence-length block holding a query word, or failing that the first
   short one (a heading or a label), never the H1 already shown as the title; a long block is windowed from the
   start of the sentence holding the match.
   Status lines come from registered templates in data-* attributes; the no-results state is cloned from the
   page's own <template>. Without JavaScript the page's fallback sentence and Sitemap link remain. */
(function () {
  'use strict';
  /* tier weights [prefix of a longer word, whole word]. A whole word may carry up to 2 more letters ("eye" ->
     "eyes"); a bare prefix ("eye" -> "eyecare") still counts, at a lower weight that keeps every title hit above
     every description hit, and every description hit above body text. */
  var W_TITLE = [30, 100];
  var W_DESC = [3, 10];
  var W_HEAD = [1, 2];
  var W_BODY = [0.5, 1];
  var SLACK = 2;

  var fold = function (s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"');
  };
  var isWordChar = function (c) { return /[a-z0-9]/.test(c); };
  /* index of the first occurrence of term at the start of a word in folded text, or -1 */
  var findWord = function (text, term, from) {
    var i = text.indexOf(term, from || 0);
    while (i !== -1) {
      if (i === 0 || !isWordChar(text.charAt(i - 1)) || !isWordChar(term.charAt(0))) return i;
      i = text.indexOf(term, i + 1);
    }
    return -1;
  };
  /* letters that follow a match inside the same word */
  var tailLen = function (text, at) { var n = 0; while (at + n < text.length && isWordChar(text.charAt(at + n))) n++; return n; };
  /* 2 = a whole-word match somewhere (up to SLACK extra letters), 1 = only as a prefix of longer words, 0 = none */
  var matchKind = function (text, term) {
    var best = 0;
    var i = findWord(text, term, 0);
    while (i !== -1) {
      if (tailLen(text, i + term.length) <= SLACK) return 2;
      best = 1;
      i = findWord(text, term, i + term.length);
    }
    return best;
  };
  /* how many times term starts a word in folded text (the last tie-break: body frequency) */
  var countWord = function (text, term) {
    var n = 0;
    var i = findWord(text, term, 0);
    while (i !== -1 && n < 99) { n++; i = findWord(text, term, i + term.length); }
    return n;
  };
  var termsOf = function (q) {
    var seen = {};
    return fold(q).split(/\s+/).map(function (t) { return t.replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, ''); })
      .filter(function (t) { if (!t || seen[t]) return false; seen[t] = true; return true; });
  };

  var init = function () {
    var results = document.querySelector('[data-search-results]');
    if (!results) return;
    var root = results.closest('.search') || document.body;
    var form = root.querySelector('form.search-form');
    var input = form ? form.querySelector('input[name="q"]') : null;
    var status = root.querySelector('[data-search-status]');
    var emptyTpl = root.querySelector('template[data-search-empty]');
    if (!form || !input || !status) return;
    var indexUrl = results.getAttribute('data-search-index') || '/search-index.json';
    var tMany = status.getAttribute('data-t-results') || '';
    var tOne = status.getAttribute('data-t-one') || '';
    var index = null;
    var loading = null;
    var debounce = 0;
    var lastQ = null;

    var load = function () {
      if (index) return Promise.resolve(index);
      if (!loading) {
        loading = fetch(indexUrl, { credentials: 'same-origin' }).then(function (r) {
          if (!r.ok) throw new Error('search index ' + r.status);
          return r.json();
        }).then(function (data) {
          var list = Array.isArray(data) ? data : (data && data.pages) || [];
          index = list.map(function (e, n) {
            var heads = Array.isArray(e.headings) ? e.headings : [];
            var text = String(e.text || '');
            return {
              n: n, url: String(e.url || ''), title: String(e.title || ''), description: String(e.description || ''),
              head: String(heads[0] || e.title || ''),
              text: text,
              lines: text.split('\n').map(function (t) { return { t: t, f: fold(t) }; }),
              fTitle: fold(e.title), fDesc: fold(e.description), fHead: fold(heads.join(' • ')), fText: fold(text),
            };
          });
          return index;
        });
      }
      return loading;
    };

    var score = function (e, terms) {
      var s = 0;
      for (var i = 0; i < terms.length; i++) {
        var t = terms[i];
        var hit = 0;
        var k;
        if ((k = matchKind(e.fTitle, t))) hit += W_TITLE[k - 1];
        if ((k = matchKind(e.fDesc, t))) hit += W_DESC[k - 1];
        if ((k = matchKind(e.fHead, t))) hit += W_HEAD[k - 1];
        if ((k = matchKind(e.fText, t))) hit += W_BODY[k - 1];
        if (!hit) return 0;                 /* every word must appear somewhere */
        s += hit;
      }
      return s;
    };

    /* text with every whole-word match wrapped in <mark> (prefixes of longer words are not marked), built as DOM
     nodes (never innerHTML) */
    var marked = function (text, terms) {
      var frag = document.createDocumentFragment();
      var f = fold(text);
      var ranges = [];
      terms.forEach(function (t) {
        var i = findWord(f, t, 0);
        while (i !== -1) {
          var tl = tailLen(f, i + t.length);
          if (tl <= SLACK) ranges.push([i, i + t.length + tl]);
          i = findWord(f, t, i + t.length);
        }
      });
      ranges.sort(function (a, b) { return a[0] - b[0]; });
      var at = 0;
      ranges.forEach(function (r) {
        if (r[0] < at) return;
        if (r[0] > at) frag.appendChild(document.createTextNode(text.slice(at, r[0])));
        var m = document.createElement('mark');
        m.textContent = text.slice(r[0], r[1]);
        frag.appendChild(m);
        at = r[1];
      });
      if (at < text.length) frag.appendChild(document.createTextNode(text.slice(at)));
      return frag;
    };

    /* the snippet: the description when it holds a query word, else one text block (see the header) */
    var SENTENCE = 60;
    var snippetOf = function (e, terms) {
      for (var i = 0; i < terms.length; i++) if (findWord(e.fDesc, terms[i]) !== -1) return e.description;
      var best = null;
      for (var li = 0; li < e.lines.length; li++) {
        var line = e.lines[li];
        if (li === 0 && line.t === e.head) continue;          /* the H1 is the result's title already */
        var pos = -1;
        for (var j = 0; j < terms.length; j++) {
          var p = findWord(line.f, terms[j]);
          if (p !== -1 && (pos === -1 || p < pos)) pos = p;
        }
        if (pos === -1) continue;
        if (line.t.length >= SENTENCE) { best = { t: line.t, pos: pos }; break; }
        if (!best) best = { t: line.t, pos: pos };
      }
      if (!best) {
        if (e.description) return e.description;
        for (var k = 0; k < e.lines.length; k++) if (e.lines[k].t !== e.head && e.lines[k].t.length >= SENTENCE) return e.lines[k].t.slice(0, 240);
        return '';
      }
      var t = best.t;
      if (t.length <= 240) return t;
      /* a long block: from the start of the sentence holding the match (just past the last ". ", "? " or "! "
         before it; all three are -1 when there is none, so the start is 0, not -1 + 2) */
      var brk = Math.max(t.lastIndexOf('. ', best.pos), t.lastIndexOf('? ', best.pos), t.lastIndexOf('! ', best.pos));
      var start = brk < 0 ? 0 : brk + 2;
      if (best.pos - start > 160) start = t.lastIndexOf(' ', best.pos - 60) + 1;
      var end = t.indexOf(' ', Math.min(t.length, Math.max(best.pos, start) + 200));
      return t.slice(start, end === -1 ? t.length : end);
    };

    /* function replacers: the query is user text, so "$&", "$1" or "$$" in it must stay literal */
    var fill = function (tpl, n, q) {
      return tpl.replace('{n}', function () { return String(n); }).replace('{q}', function () { return q; });
    };

    var render = function (q, list, terms) {
      while (results.firstChild) results.removeChild(results.firstChild);
      var old = root.querySelector('.search__empty');
      if (old) old.parentNode.removeChild(old);
      if (!q) { status.textContent = ''; return; }
      if (!list.length) {
        status.textContent = '';
        if (emptyTpl && emptyTpl.content) {
          var node = emptyTpl.content.firstElementChild.cloneNode(true);
          status.appendChild(node);
        }
        return;
      }
      status.textContent = fill(list.length === 1 ? tOne : tMany, list.length, q);
      list.forEach(function (e) {
        var li = document.createElement('li');
        li.className = 'search__result';
        var h = document.createElement('h2');
        h.className = 'search__result-title';
        var a = document.createElement('a');
        a.className = 'search__result-link';
        a.href = e.url;
        a.appendChild(marked(e.head, terms));
        h.appendChild(a);
        var u = document.createElement('p');
        u.className = 'search__result-url';
        u.textContent = e.url;
        var s = document.createElement('p');
        s.className = 'search__result-snippet';
        s.appendChild(marked(snippetOf(e, terms), terms));
        li.appendChild(h);
        li.appendChild(u);
        li.appendChild(s);
        results.appendChild(li);
      });
    };

    var run = function (raw) {
      var q = String(raw || '').replace(/\s+/g, ' ').trim();
      if (q === lastQ) return Promise.resolve();
      lastQ = q;
      var terms = termsOf(q);
      if (!q || !terms.length) { render('', [], []); return Promise.resolve(); }
      return load().then(function (idx) {
        if (q !== lastQ) return;
        var list = idx.map(function (e) { return { e: e, s: score(e, terms) }; })
          .filter(function (x) { return x.s > 0; })
          .map(function (x) {
            x.f = terms.reduce(function (sum, t) { return sum + countWord(x.e.fHead, t) + countWord(x.e.fText, t); }, 0);
            return x;
          })
          .sort(function (a, b) { return b.s - a.s || b.f - a.f || a.e.n - b.e.n; })
          .map(function (x) { return x.e; });
        render(q, list, terms);
      }).catch(function () {
        root.classList.add('is-failed');
        status.textContent = '';
      });
    };

    var syncUrl = function (q) {
      if (!window.history || !window.history.replaceState) return;
      var url = window.location.pathname + (q ? '?q=' + encodeURIComponent(q).replace(/%20/g, '+') : '');
      window.history.replaceState(null, '', url);
    };

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      window.clearTimeout(debounce);
      syncUrl(input.value.trim());
      run(input.value);
    });
    input.addEventListener('input', function () {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(function () { syncUrl(input.value.trim()); run(input.value); }, 250);
    });

    var q0 = '';
    try { q0 = new URLSearchParams(window.location.search).get('q') || ''; } catch (err) { q0 = ''; }
    if (q0) { input.value = q0; run(q0); }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
;
/* ── src/scripts/site-aside.js ── */
/* site-aside.js: the click-to-load map of the practice-information band (aside.site-aside; JS hook 10, plan §8.13).
   Each .site-aside button[data-map-open][aria-controls] swaps its [data-map] box for the map iframe, whose URL the box
   carries in data-map-src (the keyless https://www.google.com/maps?q=…&output=embed form only). Nothing loads from
   Google until the visitor asks for the map; the address stays visible as text beside it. Idempotent: a box that
   already holds its iframe is left alone, so another handler on the same button (visit.js) cannot add a second one.
   Without JavaScript the button does nothing and no iframe is ever created. */
(function () {
  'use strict';
  var doc = document;
  var openers = doc.querySelectorAll('.site-aside button[data-map-open][aria-controls]');
  if (!openers.length) return;

  Array.prototype.forEach.call(openers, function (btn) {
    btn.addEventListener('click', function () {
      var box = doc.getElementById(btn.getAttribute('aria-controls'));
      if (!box || !box.hasAttribute('data-map') || box.querySelector('iframe')) return;
      var src = box.getAttribute('data-map-src') || '';
      if (src.indexOf('https://www.google.com/maps?') !== 0 || /[?&]key=/.test(src)) return;   // the keyless embed URL only
      var frame = doc.createElement('iframe');
      frame.className = 'site-aside__iframe';
      frame.src = src;
      frame.title = box.getAttribute('data-map-title') || '';
      frame.setAttribute('loading', 'lazy');
      frame.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
      frame.setAttribute('allowfullscreen', '');
      while (box.firstChild) box.removeChild(box.firstChild);
      box.appendChild(frame);
      box.classList.add('is-open');
      frame.focus();
    });
  });
})();
;
/* ── src/scripts/site-header.js ── */
/* site-header.js: the navigation drawer of .site-header (JS hook 2, X/README.md §4; MVSA: the two-row header, WP4a).
   button[data-drawer-open][aria-controls="site-drawer"] opens #site-drawer, a modal dialog
   (role=dialog, aria-modal=true). While it is open: focus moves into it and is trapped there
   (Tab and Shift+Tab wrap), the rest of the page is inert, and the page does not scroll (CSS).
   Escape, the close button or the scrim ([data-drawer-close]) close it, and focus returns to the
   button that opened it; growing past 1100px closes it and moves focus to the desktop twin of the
   focused control (else the logo link), because the opener is hidden there. site-header.css keeps an
   open drawer laid out at any width until this happens, so the focused control cannot lose its box
   (and the browser drop focus to <body>) before the change event runs; should focus be on <body>
   anyway, the last control focused inside the drawer stands in for it.
   Every other breakpoint change that hides the focused chrome control (shrinking across 1100px or 834px, zoom,
   or growing across 834px from the mobile bar) moves focus to its stand-in instead of letting it drop to <body>.
   base.js owns the header shrink and every button[data-disclosure] (the drawer's sub-menus too); an
   Escape it has already used to close a sub-menu arrives here with defaultPrevented and is ignored,
   so the first Escape closes the sub-menu and the second closes the drawer. */
(function () {
  'use strict';
  var doc = document;
  var header = doc.querySelector('.site-header');
  if (!header) return;
  var drawer = doc.getElementById('site-drawer');
  var opener = doc.querySelector('button[data-drawer-open][aria-controls="site-drawer"]');
  if (!drawer || !opener) return;

  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  // the drawer layout: the exact query site-header.css uses, so script and CSS never disagree about which layout is on
  var compact = window.matchMedia ? window.matchMedia('(max-width: 1100px)') : null;
  var inerted = [];
  var returnTo = null;
  var lastInside = null;   // the control that last took focus inside the open drawer (see onChange)

  var isOpen = function () { return drawer.classList.contains('is-open'); };

  var visible = function (el) {
    if (!el.getClientRects().length) return false;
    var s = window.getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
  };
  var focusables = function () {
    return Array.prototype.slice.call(drawer.querySelectorAll(FOCUSABLE)).filter(visible);
  };

  // Everything outside the dialog becomes inert while it is open: every sibling of the drawer and of each of
  // its ancestors up to <body> (the header's own bar and nav, the skip link, main, footer, the mobile bar),
  // whatever wrappers the page template adds.
  var setInert = function (on) {
    if (on) {
      inerted = [];
      var node = drawer;
      while (node && node !== doc.body && node.parentElement) {
        var parent = node.parentElement;
        Array.prototype.forEach.call(parent.children, function (sib) {
          if (sib !== node && !sib.inert && !/^(SCRIPT|STYLE|TEMPLATE)$/.test(sib.tagName)) { sib.inert = true; inerted.push(sib); }
        });
        node = parent;
      }
    } else {
      inerted.forEach(function (el) { el.inert = false; });
      inerted = [];
    }
  };

  var open = function () {
    if (isOpen()) return;
    returnTo = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : opener;
    drawer.classList.add('is-open');
    opener.setAttribute('aria-expanded', 'true');
    setInert(true);
    focusInto(3);
  };

  // Move focus to the close button (else the first control). A control whose inherited visibility has
  // not caught up with the dialog yet refuses focus, so a miss is retried on the next frames.
  var focusInto = function (tries) {
    if (!isOpen()) return;
    var first = drawer.querySelector('button[data-drawer-close]') || focusables()[0];
    if (first) first.focus();
    if (drawer.contains(doc.activeElement) || tries <= 0) return;
    window.requestAnimationFrame(function () { focusInto(tries - 1); });
  };

  var close = function (restore) {
    if (!isOpen()) return;
    drawer.classList.remove('is-open');
    opener.setAttribute('aria-expanded', 'false');
    setInert(false);
    lastInside = null;
    if (restore !== false) {
      var back = returnTo && doc.contains(returnTo) && visible(returnTo) ? returnTo : opener;
      if (visible(back)) back.focus();
    }
    returnTo = null;
  };

  opener.addEventListener('click', function () {
    if (isOpen()) close(); else open();
  });
  Array.prototype.forEach.call(drawer.querySelectorAll('[data-drawer-close]'), function (el) {
    el.addEventListener('click', function () { close(); });
  });

  // focus trap: Tab and Shift+Tab wrap inside the dialog
  drawer.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab' || !isOpen()) return;
    var list = focusables();
    if (!list.length) { e.preventDefault(); return; }
    var first = list[0];
    var last = list[list.length - 1];
    var active = doc.activeElement;
    if (e.shiftKey && (active === first || !drawer.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !drawer.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  });
  // a focus that escapes anyway (a browser without inert) is pulled back in
  doc.addEventListener('focusin', function (e) {
    if (isOpen() && !drawer.contains(e.target)) {
      var list = focusables();
      if (list.length) list[0].focus();
    }
  });
  drawer.addEventListener('focusin', function (e) {
    if (isOpen()) lastInside = e.target;
  });

  // Escape: listened for on window, so base.js (document) has handled sub-menus first
  window.addEventListener('keydown', function (e) {
    if ((e.key === 'Escape' || e.key === 'Esc') && isOpen() && !e.defaultPrevented) {
      e.preventDefault();
      close();
    }
  });

  // Growing to the desktop layout closes the drawer (its nav is hidden there). The opener is hidden too, so a
  // focus that was inside the drawer moves to the same control in the desktop header (the link with the same
  // href, or the matching sub-menu button), else to the logo link; it never drops to <body>.
  var desktopTwin = function (el) {
    if (!el || !drawer.contains(el)) return null;
    var pool = Array.prototype.filter.call(header.querySelectorAll('a[href], button[aria-controls]'), function (x) {
      return !drawer.contains(x) && visible(x);
    });
    var sub = /^site-drawer-sub-(\d+)$/.exec(el.getAttribute('aria-controls') || '');
    for (var i = 0; i < pool.length; i++) {
      if (sub ? pool[i].getAttribute('aria-controls') === 'site-nav-sub-' + sub[1]
        : el.tagName === 'A' && pool[i].tagName === 'A' && pool[i].getAttribute('href') === el.getAttribute('href')) return pool[i];
    }
    return null;
  };
  // Any other breakpoint change can hide the focused control too: shrinking across 1100px hides the nav row and its
  // sub-menus (the menu button takes their place), crossing 834px swaps the header's calls to
  // action and the mobile bar. The browser then drops focus to <body>, often before the change event runs and
  // without a focusout. So the last control focused in the chrome is remembered, and after every change a stranded
  // focus moves to what now stands in for it: the same link still shown in the header (a mobile-bar action -> the
  // header's own button), else the menu button (<=1100px), else the first nav link (>1100px), else the logo link.
  var mobileBar = doc.querySelector('.mobile-bar');
  var narrow = window.matchMedia ? window.matchMedia('(max-width: 834px)') : null;   // site-header.css, mobile-bar.css
  var inChrome = function (el) { return !!el && el.nodeType === 1 && (header.contains(el) || (!!mobileBar && mobileBar.contains(el))); };
  var lastChrome = null;
  doc.addEventListener('focusin', function (e) { lastChrome = inChrome(e.target) ? e.target : null; });
  doc.addEventListener('focusout', function (e) {
    // focus left on purpose (a click on the page, another window) while the control is still shown: forget it.
    // A control that has just lost its box is kept: that is the stranded case.
    if (e.target === lastChrome && !e.relatedTarget && visible(e.target)) lastChrome = null;
  });
  var stranded = function () {
    var a = doc.activeElement;
    if (a && a !== doc.body && a !== doc.documentElement) return inChrome(a) && !visible(a) ? a : null;
    return lastChrome && doc.contains(lastChrome) && !visible(lastChrome) ? lastChrome : null;
  };
  var standIn = function (el) {
    var href = el.tagName === 'A' ? el.getAttribute('href') : null;
    var pool = href ? Array.prototype.filter.call(header.querySelectorAll('a[href]'), function (x) {
      return x !== el && !drawer.contains(x) && x.getAttribute('href') === href && visible(x);
    }) : [];
    if (pool.length) return pool[0];
    if (compact && compact.matches && visible(opener)) return opener;
    var first = header.querySelector('.site-header__nav .site-header__link');
    if (first && visible(first)) return first;
    var logo = header.querySelector('.site-header__logo');
    return logo && visible(logo) ? logo : null;
  };
  var rescue = function () {
    if (isOpen()) return;
    var el = stranded();
    if (!el) return;
    var to = standIn(el);
    if (to) to.focus();
  };
  // run now, and once more on the next frame in case the layout had not caught up with the new width yet
  var rescueSoon = function () { rescue(); window.requestAnimationFrame(rescue); };
  var listen = function (mq, fn) {
    if (mq.addEventListener) mq.addEventListener('change', fn);
    else if (mq.addListener) mq.addListener(fn);
  };

  if (compact) {
    var onChange = function () {
      if (compact.matches || !isOpen()) { rescueSoon(); return; }
      // The CSS keeps the open drawer laid out, so the focused control is normally still inside it here. Fallback:
      // if the browser has dropped focus to <body> anyway (it does so without a focusout when a focused control
      // loses its box), the last control that took focus inside the drawer stands in for it; the rest of the page
      // is inert while the drawer is open, so nothing else can have taken it. (That record needs focus events,
      // which a browser only sends to a page that has focus.)
      var active = doc.activeElement;
      var from = drawer.contains(active) ? active
        : ((!active || active === doc.body || active === doc.documentElement) && lastInside && drawer.contains(lastInside) ? lastInside : null);
      close(false);
      if (!from) { rescueSoon(); return; }
      var target = desktopTwin(from) || header.querySelector('.site-header__logo');
      if (target && visible(target)) target.focus();
      window.requestAnimationFrame(rescue);
    };
    listen(compact, onChange);
  }
  if (narrow) listen(narrow, rescueSoon);
})();
;
/* ── src/scripts/testimonials.js ── */
/* testimonials.js: prev/next for the home reviews carousel (JS hook 6; plan §8.4, §11.3 check 6).
   The track [data-carousel][id] is a native scroll-snap scroller; it works without this script (touch,
   trackpad, keyboard). This script adds the two buttons' behaviour:
   - Next brings the first card that is not fully in view to the view's start, so each press moves a whole
     view of cards, whatever the card widths (the longest review is double width). Where the track cannot
     scroll that far, Next scrolls to the track's end, and that last view overlaps the one before it (3-up:
     the 7 home reviews fill 8 card slots, so the last view repeats a card of the view before it).
   - Previous undoes the latest Next press: it scrolls back to where that press started. Paging back with the
     buttons therefore shows the forward views in reverse order (3-up: 6th-7th, 4th-6th, 1st-3rd).
     It does this only while the track still sits where that press left it. After the track was scrolled
     some other way (touch, trackpad, keyboard) or its width changed, Previous instead ends the new view with
     the card just before the first card that starts in view, and starts it at the earliest card from which
     that run still fits; that view can overlap an earlier one.
   Paging with the buttons alone never skips a card. Each button is disabled at its end (the `disabled`
   property, JS hook 6). A button never drops keyboard focus when it disables itself: focus moves to the
   other button first (Next at the end hands focus to Previous, Previous at the start to Next), or to the
   track when both are disabled. The buttons show (via .is-scrollable on the section) only while the track
   overflows. Reduced motion: the move is instant. */
(function () {
  'use strict';
  var tracks = document.querySelectorAll('[data-carousel][id]');
  if (!tracks.length) return;
  var still = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  Array.prototype.forEach.call(tracks, function (track) {
    var id = track.id;
    var prev = document.querySelector('button[data-carousel-prev][aria-controls="' + id + '"]');
    var next = document.querySelector('button[data-carousel-next][aria-controls="' + id + '"]');
    if (!prev || !next) return;
    var root = track.closest('.testimonials');
    var EDGE = 2;
    var frame = 0;
    var trail = [];      // one {from, to} per Next press, newest last
    var goal = null;     // where the current button move is heading, until it arrives or settles
    var settle = 0;
    var width = track.clientWidth;

    var update = function () {
      frame = 0;
      var max = track.scrollWidth - track.clientWidth;
      var x = track.scrollLeft;
      var scrollable = max > EDGE;
      var offPrev = !scrollable || x <= EDGE;
      var offNext = !scrollable || x >= max - EDGE;
      if (goal !== null && Math.abs(x - goal) <= EDGE) goal = null;
      if (root) root.classList.toggle('is-scrollable', scrollable);
      // Focus hand-off (WCAG 2.4.3/2.4.7): a button that is about to be disabled while it holds focus would
      // drop focus to <body>. Enable what becomes enabled first, move focus to the other button (or, when
      // both end up disabled, to the track, a focusable region), and only then disable.
      if (!offPrev) prev.disabled = false;
      if (!offNext) next.disabled = false;
      var active = document.activeElement;
      if (offNext && active === next) (offPrev ? track : prev).focus({ preventScroll: true });
      else if (offPrev && active === prev) (offNext ? track : next).focus({ preventScroll: true });
      prev.disabled = offPrev;
      next.disabled = offNext;
    };
    var schedule = function () { if (!frame) frame = window.requestAnimationFrame(update); };
    // the position a press starts from: the pending target while a move is under way, else the scroll offset
    var here = function () { return goal === null ? track.scrollLeft : goal; };

    // each card's start and end in the track's scroll coordinates (its snap position is its start)
    var boxes = function () {
      var t = track.getBoundingClientRect();
      var origin = t.left + track.clientLeft - track.scrollLeft;
      return Array.prototype.map.call(track.querySelectorAll('.testimonials__item'), function (li) {
        var r = li.getBoundingClientRect();
        return { start: r.left - origin, end: r.right - origin };
      });
    };
    var targetOf = function (dir, x) {
      var items = boxes();
      var w = track.clientWidth;
      var max = track.scrollWidth - w;
      var i, j;
      if (!items.length) return Math.max(0, Math.min(max, x + dir * w));
      if (dir > 0) {
        // the first card that ends past the view's right edge, unless it already starts at the left edge
        for (i = 0; i < items.length; i++) {
          if (items[i].end > x + w + EDGE && items[i].start > x + EDGE) return Math.min(max, items[i].start);
        }
        return max;
      }
      // the first card that starts in view; then the earliest card from which the cards before it all fit
      for (i = 0; i < items.length && items[i].start < x - EDGE; i++) { /* find it */ }
      if (i === 0) return 0;
      var end = items[i - 1].end;
      for (j = i - 1; j > 0 && end - items[j - 1].start <= w + EDGE; j--) { /* widen the view leftwards */ }
      return Math.max(0, items[j].start);
    };
    var go = function (left) {
      var smooth = !(still && still.matches);
      goal = left;
      track.scrollTo({ left: left, behavior: smooth ? 'smooth' : 'auto' });
      window.clearTimeout(settle);
      settle = window.setTimeout(function () { goal = null; update(); }, smooth ? 900 : 50);
    };

    next.addEventListener('click', function () {
      var from = here();
      var to = targetOf(1, from);
      if (to <= from + EDGE) return;
      trail.push({ from: from, to: to });
      go(to);
    });
    prev.addEventListener('click', function () {
      var x = here();
      var last = trail.length ? trail[trail.length - 1] : null;
      if (last && Math.abs(x - last.to) <= EDGE) {
        trail.pop();
        go(last.from);
        return;
      }
      trail.length = 0;
      go(targetOf(-1, x));
    });
    track.addEventListener('scroll', schedule, { passive: true });
    if ('onscrollend' in window) track.addEventListener('scrollend', update);
    window.addEventListener('resize', function () {
      if (track.clientWidth !== width) { width = track.clientWidth; trail.length = 0; }
      schedule();
    });
    update();
  });
})();
;
/* ── src/scripts/visit.js ── */
/* visit.js: the click-to-load map (JS hook 10; plan §8.13).
   button[data-map-open][aria-controls] swaps the contents of its [data-map] box for the map iframe, whose URL
   the box carries in data-map-src (the keyless https://www.google.com/maps?q=<NAP>&output=embed form). The
   initial HTML holds no iframe: nothing loads from Google until the visitor asks for the map. The address
   is printed outside the box (the location card, the footer), so it stays visible before and after the
   swap. Without JavaScript the box is hidden (visit.css); MVSA has no Google Maps short link to fall back to. */
(function () {
  'use strict';
  var openers = document.querySelectorAll('button[data-map-open][aria-controls]');
  if (!openers.length) return;

  Array.prototype.forEach.call(openers, function (btn) {
    btn.addEventListener('click', function () {
      var box = document.getElementById(btn.getAttribute('aria-controls'));
      if (!box || !box.hasAttribute('data-map') || box.querySelector('iframe')) return;
      var src = box.getAttribute('data-map-src') || '';
      if (src.indexOf('https://www.google.com/maps?') !== 0) return;   // only the keyless embed URL
      var frame = document.createElement('iframe');
      frame.className = 'visit__iframe';
      frame.src = src;
      frame.title = box.getAttribute('data-map-title') || '';
      frame.setAttribute('loading', 'lazy');
      frame.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
      frame.setAttribute('allowfullscreen', '');
      while (box.firstChild) box.removeChild(box.firstChild);
      box.appendChild(frame);
      box.classList.add('is-open');
      frame.focus();
    });
  });
})();
