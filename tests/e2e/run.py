#!/usr/bin/env python3
"""Intake end-to-end run: serves the folder, drives Chromium at 390x844 (touch) and 1366x900, plus an offline/service-worker pass.
Usage: python3 tests/e2e/run.py            (needs Python Playwright + Chromium)
The app is served from a temporary copy of the deployable files (the folder minus tests/, tools/, scripts/, SPEC.md).
Screenshots land in tests/screenshots/<screen>-<mobile|desktop>.png"""
import sys
from pathlib import Path

sys.dont_write_bytecode = True

sys.path.insert(0, str(Path(__file__).resolve().parent))
from playwright.sync_api import sync_playwright  # noqa: E402

from helpers import Recorder, start_server  # noqa: E402
from cloud import run_cloud  # noqa: E402
from offline import run_offline  # noqa: E402
from scenario import Scenario  # noqa: E402


def main() -> int:
    server, base = start_server()
    rec = Recorder()
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            for kind in ("mobile", "desktop"):
                print(f"\n== {kind} ==")
                Scenario(browser, base, kind, rec).run()
            print("\n== cloud sync (fake SDK) ==")
            run_cloud(browser, base, rec)
            print("\n== offline ==")
            run_offline(browser, base, rec)
            browser.close()
    finally:
        server.kill()
    return 0 if rec.summary() else 1


if __name__ == "__main__":
    sys.exit(main())
