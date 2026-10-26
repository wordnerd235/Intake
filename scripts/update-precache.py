#!/usr/bin/env python3
"""Refresh the offline file list and version stamp in sw.js.

Run this after changing any app file, before you commit:    python scripts/update-precache.py
(--check only reports whether sw.js is current; -h shows this help. Neither writes anything.)
It rewrites the PRECACHE list (every file the app needs offline) and sets CACHE_VERSION to a hash of those files,
so phones that installed the app notice the update and show the "Update available" bar."""
import argparse
import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SW = ROOT / "sw.js"
STATIC = ["index.html", "manifest.webmanifest", "data/exercises.json"]
GLOBS = ["icons/*.svg", "icons/*.png", "css/*.css", "js/*.js", "js/views/*.js"]


def shell_files() -> list[str]:
    files = set(STATIC)
    for g in GLOBS:
        files.update(p.relative_to(ROOT).as_posix() for p in ROOT.glob(g))
    return sorted(files)


def build(files: list[str]) -> tuple[str, str]:
    """The new text of sw.js and its version hash; nothing is written."""
    digest = hashlib.sha1()
    for f in files:
        digest.update(f.encode())
        digest.update((ROOT / f).read_bytes())
    version = digest.hexdigest()[:8]
    text = SW.read_text(encoding="utf-8")
    listing = "const PRECACHE = [\n  './',\n" + ",\n".join(f"  './{f}'" for f in files) + ",\n];"
    text = re.sub(r"const PRECACHE = \[.*?\n\];", lambda _: listing, text, flags=re.S)
    text = re.sub(r"const CACHE_VERSION = '?[\w.-]+'?;", f"const CACHE_VERSION = '{version}';", text)
    return text, version


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        prog="update-precache.py",
        description="Rewrite the PRECACHE list and CACHE_VERSION in sw.js from the files on disk. Run it after changing any app file.",
        epilog="With no options it rewrites sw.js in place. Nothing is written for --help or --check.",
    )
    ap.add_argument("--check", action="store_true", help="only report whether sw.js is up to date (exit 1 if not); writes nothing")
    args = ap.parse_args(argv)
    files = shell_files()
    text, version = build(files)
    if args.check:
        current = SW.read_text(encoding="utf-8")
        print(f"sw.js is {'up to date' if current == text else 'OUT OF DATE'}: {len(files) + 1} files, version {version}")
        return 0 if current == text else 1
    SW.write_text(text, encoding="utf-8")
    print(f"sw.js updated: {len(files) + 1} files, version {version}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
