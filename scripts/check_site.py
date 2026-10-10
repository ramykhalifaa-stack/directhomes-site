#!/usr/bin/env python3
"""Sanity checks for the published site in docs/."""
import re
import sys
from pathlib import Path
from urllib.parse import urlparse, unquote

DOCS = Path(__file__).resolve().parent.parent / "docs"
errors = []


def resolve(path: str):
    """Map a URL path to a file in docs/, or None."""
    p = unquote(path).lstrip("/")
    for cand in (p, p + ".html", p.rstrip("/") + "/index.html" if p else "index.html"):
        f = DOCS / cand
        if f.is_file():
            return f
    return None


# 1. sitemap URLs must resolve to files
sitemap = DOCS / "sitemap.xml"
for loc in re.findall(r"<loc>([^<]+)</loc>", sitemap.read_text()):
    if resolve(urlparse(loc).path) is None:
        errors.append(f"sitemap.xml: no file for {loc}")

# 2. local references in HTML must exist
ref = re.compile(r'(?:href|src)="(/[^"#?]*)')
for html in DOCS.rglob("*.html"):
    for path in ref.findall(html.read_text(errors="ignore")):
        if path.startswith("//"):
            continue
        if resolve(path) is None:
            errors.append(f"{html.relative_to(DOCS)}: missing {path}")

# 3. files that must never be published
for pattern in ("*.map", ".env*"):
    for f in DOCS.rglob(pattern):
        errors.append(f"forbidden file: {f.relative_to(DOCS)}")

if errors:
    print("\n".join(sorted(set(errors))))
    sys.exit(1)
print("site checks passed")
