#!/usr/bin/env python3
"""Render icons/icon.svg and the PNG icons from one dial design (needs Python Playwright + Chromium).
Usage: python3 scripts/make-icons.py"""
import math
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "icons"
BLUE, PAPER = "#3559E0", "#F7F6F2"


def svg(rounded: bool, size: int = 512) -> str:
    c = 256
    ticks = []
    for i in range(60):
        a = i / 60 * 2 * math.pi - math.pi / 2
        major = i % 5 == 0
        r1, r2 = 176, 176 - (30 if major else 16)
        on = i <= 42
        op = 1 if on else 0.28
        w = 9 if major else 6
        ticks.append(
            f'<line x1="{c + math.cos(a) * r1:.1f}" y1="{c + math.sin(a) * r1:.1f}" '
            f'x2="{c + math.cos(a) * r2:.1f}" y2="{c + math.sin(a) * r2:.1f}" stroke="{PAPER}" '
            f'stroke-opacity="{op}" stroke-width="{w}" stroke-linecap="round"/>'
        )
    rad, frac = 100, 0.7
    circ = 2 * math.pi * rad
    end = frac * 2 * math.pi - math.pi / 2
    kx, ky = c + math.cos(end) * rad, c + math.sin(end) * rad
    rx = 112 if rounded else 0
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 512 512">'
        f'<rect width="512" height="512" rx="{rx}" fill="{BLUE}"/>'
        + "".join(ticks)
        + f'<circle cx="{c}" cy="{c}" r="{rad}" fill="none" stroke="{PAPER}" stroke-opacity="0.22" stroke-width="26"/>'
        f'<circle cx="{c}" cy="{c}" r="{rad}" fill="none" stroke="{PAPER}" stroke-width="26" stroke-linecap="round" '
        f'stroke-dasharray="{frac * circ:.1f} {circ:.1f}" transform="rotate(-90 {c} {c})"/>'
        f'<circle cx="{kx:.1f}" cy="{ky:.1f}" r="21" fill="{BLUE}" stroke="{PAPER}" stroke-width="10"/>'
        "</svg>"
    )


def main() -> None:
    OUT.mkdir(exist_ok=True)
    (OUT / "icon.svg").write_text(svg(True), encoding="utf-8")
    jobs = [("icon-192.png", True, 192, True), ("icon-512.png", True, 512, True), ("maskable-512.png", False, 512, False), ("apple-touch-icon.png", False, 180, False)]
    with sync_playwright() as p:
        b = p.chromium.launch()
        for name, rounded, size, transparent in jobs:
            page = b.new_page(viewport={"width": size, "height": size})
            page.set_content(f'<body style="margin:0;background:transparent">{svg(rounded, size)}</body>')
            page.screenshot(path=str(OUT / name), omit_background=transparent)
            page.close()
        b.close()
    print("wrote", ", ".join(["icon.svg"] + [j[0] for j in jobs]))


if __name__ == "__main__":
    main()
