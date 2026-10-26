#!/usr/bin/env python3
"""Search SR Legacy food descriptions (helper for curating tools/common_foods.txt).

Usage:
  python3 -I tools/find_foods.py --src DIR PATTERN [PATTERN ...]
Each PATTERN is a case-insensitive regex matched against the description; a food
is printed only if it matches ALL patterns.  Output: fdcId <TAB> group <TAB> description
"""
import argparse
import csv
import re
import sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="folder made by fetch_source.sh")
    ap.add_argument("patterns", nargs="+")
    a = ap.parse_args()
    cats = {r["id"]: r["code"][:2] for r in csv.DictReader(open(f"{a.src}/food_category.csv", encoding="utf-8"))}
    pats = [re.compile(p, re.I) for p in a.patterns]
    with open(f"{a.src}/food.csv", encoding="utf-8", newline="") as fh:
        for r in csv.DictReader(fh):
            d = r["description"]
            if all(p.search(d) for p in pats):
                print(f'{r["fdc_id"]}\t{cats.get(r["food_category_id"], "??")}\t{d}')


if __name__ == "__main__":
    sys.exit(main())
