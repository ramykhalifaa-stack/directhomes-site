# directhomes.ae (published site)

This repo holds only the built output of the directhomes.ae site, served from `docs/` (GitHub Pages, domain in `docs/CNAME`). The source code lives in a private repository.

## Rules

- Do not hand-edit hashed bundles in `docs/assets/` or `docs/app/_expo/`. They are generated; real changes belong in the private source repo and get republished here.
- Page HTML lives in `docs/*.html`. Keep `docs/sitemap.xml`, `docs/robots.txt` and `docs/llms.txt` consistent with the pages that exist.
- `docs/app/`, `docs/preview/` and `docs/email-preview.html` are intentionally disallowed in `robots.txt`.
- Never commit source maps, `.env` files or secrets. This repo is public.

## Checks

Run `python3 scripts/check_site.py` before committing. It verifies that sitemap URLs map to files, that local `href`/`src` references in HTML exist, and that no source maps or env files are present. CI runs the same script.
