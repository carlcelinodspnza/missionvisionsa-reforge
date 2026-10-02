# Mission Vision San Antonio — redesign (preview)

A redesign of https://www.missionvisionsa.com as a static site (168 pages). The words, headings, links and
claims come from the live site; the design, layout and components are new.

- **Preview:** https://carlcelinodspnza.github.io/missionvisionsa-reforge/
- **Site:** `dist/` is written for a domain root (paths start with `/`). Canonicals and `sitemap.xml` use
  `https://www.missionvisionsa.com`. `_redirects` and `_headers` hold the moved URLs and the security headers
  for Netlify or Cloudflare Pages.
- **How the preview is built:** GitHub Actions (`.github/workflows/pages.yml`) runs
  `src/tools/preview.mjs … dist`. It copies `dist/` to `_site/` and makes every path relative with the
  vendored `sr-rebase` (`src/tools/site-reforge/`). It points the site search at the subfolder, rebuilds
  `404.html` so it works at any depth, and adds `<meta name="robots" content="noindex, nofollow">` to every
  page. `dist/` itself is not modified.
- **Not for search engines:** this is a preview of a redesign of a live practice site and must not be indexed.
- **Forms** are not connected to a backend: submit is disabled, with a notice and the call and booking links.
- **This copy:** developer comments are removed from `dist/styles/site.css`. The rendered pages are unchanged.
- **Clone of the current site:** https://github.com/carlcelinodspnza/missionvisionsa
  (preview: https://carlcelinodspnza.github.io/missionvisionsa/).
