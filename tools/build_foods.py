#!/usr/bin/env python3
"""Build data/foods.json from the USDA FoodData Central "SR Legacy" CSV export.

Stdlib only.  Run with isolated mode so nothing is imported from the data folder:

    tools/fetch_source.sh .cache/sr_legacy          # one-time download (GitHub mirror)
    python3 -I tools/build_foods.py --src .cache/sr_legacy

Inputs (all in --src, as laid out by fetch_source.sh):
    food.csv  food_nutrient.csv  food_portion.csv  food_category.csv  nutrient.csv
And tools/common_foods.txt (hand-curated fdcIds flagged "common").

Output: data/foods.json  (minified, UTF-8).  Deterministic: same input -> same bytes.
"""
import argparse
import csv
import gzip
import hashlib
import json
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

SOURCE_LABEL = "USDA FoodData Central SR Legacy (April 2018)"

# (key, FDC nutrient id, SR nutrient number, expected FDC unit_name, output unit)
NUTRIENTS = [
    ("kcal",        1008, "208", "KCAL", "kcal"),
    ("protein",     1003, "203", "G",    "g"),
    ("carbs",       1005, "205", "G",    "g"),
    ("fat",         1004, "204", "G",    "g"),
    ("fiber",       1079, "291", "G",    "g"),
    ("sugar",       2000, "269", "G",    "g"),
    ("satFat",      1258, "606", "G",    "g"),
    ("transFat",    1257, "605", "G",    "g"),
    ("cholesterol", 1253, "601", "MG",   "mg"),
    ("sodium",      1093, "307", "MG",   "mg"),
    ("potassium",   1092, "306", "MG",   "mg"),
    ("calcium",     1087, "301", "MG",   "mg"),
    ("iron",        1089, "303", "MG",   "mg"),
    ("vitA",        1106, "320", "UG",   "µg"),
    ("vitC",        1162, "401", "MG",   "mg"),
    ("vitD",        1114, "328", "UG",   "µg"),
]
NUT_INDEX = {n[1]: i for i, n in enumerate(NUTRIENTS)}

# SHA-256 of the source CSVs this build was verified against (warn-only on mismatch).
EXPECTED_SHA256 = {
    "food.csv": "de8b0390058db4f102368c9fbdfde144790b480ff4cb0507c0e060ef99805dee",
    "food_nutrient.csv": "906a2d561462b30939465e5bb6be134282fd71f64f99366040b622848fa48411",
    "food_portion.csv": "6332e29da61e13f7bd950b759461af73303c76e8b0e64dc9df4e41d5347cf3d1",
    "food_category.csv": "a8e05c18cf010d44303f2a02765637a21f9ad621f90b4f811ab4a4a436cfedd9",
    "nutrient.csv": "c45f08439f732d6e8c8422de974c0ed1f38d78e33cd24c32917d456407f6fa39",
}

OZ_G = 28.35

# Exact-decimal fractions that appear in food_portion.csv "amount"
FRACTIONS = {
    0.5: "1/2", 0.25: "1/4", 0.75: "3/4", 0.33: "1/3", 0.67: "2/3", 0.66: "2/3",
    0.2: "1/5", 0.125: "1/8", 0.12: "1/8", 0.08: "1/12", 0.16: "1/6", 0.17: "1/6",
}

# Foods whose key nutrients we assert in --verify (matched by exact SR description).
# (description, {nutrient_key: (lo, hi)}, [(portion_label_prefix, grams)])
CHECKS = [
    ("Bananas, raw", {"kcal": (88, 90)}, [("1 medium", 118)]),
    ("Egg, whole, raw, fresh", {"kcal": (142, 144)}, [("1 large", 50)]),
    ("Chicken, broilers or fryers, breast, meat only, cooked, roasted",
     {"kcal": (164, 166), "protein": (30.5, 31.5)}, []),
    ("Rice, white, long-grain, regular, enriched, cooked", {"kcal": (128, 132)}, []),
    ("Milk, reduced fat, fluid, 2% milkfat, with added vitamin A and vitamin D",
     {"kcal": (49, 51)}, [("1 cup", 244)]),
    ("Peanut butter, smooth style, with salt (Includes foods for USDA's Food Distribution Program)",
     {"kcal": (587, 599)}, []),
    ("Peanut butter, smooth style, without salt", {"kcal": (587, 599)}, []),
    ("Oil, olive, salad or cooking", {"kcal": (884, 884)}, [("1 tbsp", 13.5)]),
]


# --------------------------------------------------------------------------- helpers
def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def read_csv(path):
    with open(path, encoding="utf-8", newline="") as fh:
        yield from csv.DictReader(fh)


def num(v):
    """Render a float compactly: ints stay ints, otherwise shortest repr."""
    if isinstance(v, float) and v == int(v):
        return int(v)
    return v


def round_half_up(x, digits=0):
    m = 10 ** digits
    return math.floor(x * m + 0.5) / m


def fmt_nutrient(value, unit):
    """Rounding policy: kcal -> integer; g -> 1 dp if >=10 else 2 dp;
    mg/µg -> integer if >=100, 1 dp if >=10, else 2 dp."""
    if value is None:
        return None
    if unit == "kcal":
        return int(round_half_up(value))
    a = abs(value)
    if unit == "g":
        d = 1 if a >= 10 else 2
    else:
        d = 0 if a >= 100 else (1 if a >= 10 else 2)
    r = round_half_up(value, d)
    if r == 0:
        return 0
    return num(r) if d else int(r)


def fmt_amount(a):
    """1 -> '1', 0.5 -> '1/2', 1.5 -> '1 1/2', 5.3 -> '5.3'.  Non-positive -> '1'."""
    if a <= 0:
        a = 1.0
    whole = int(a)
    frac = round(a - whole, 3)
    if frac == 0:
        return str(whole)
    f = FRACTIONS.get(frac) or FRACTIONS.get(round(frac, 2))
    if f:
        return f"{whole} {f}" if whole else f
    s = f"{a:.3f}".rstrip("0").rstrip(".")
    return s


def fmt_grams(g):
    r = round_half_up(g, 2)
    return num(float(r))


def clean(s):
    return re.sub(r"\s+", " ", (s or "").strip())


# --------------------------------------------------------------------------- load
def load_common(path):
    ids, names = [], {}
    if not os.path.exists(path):
        return ids, names
    with open(path, encoding="utf-8") as fh:
        for ln, line in enumerate(fh, 1):
            line = line.rstrip("\n")
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            m = re.match(r"^(\d+)\s+(.*)$", line.strip())
            if not m:
                sys.exit(f"{path}:{ln}: expected '<fdcId> <name>', got {line!r}")
            fid = int(m.group(1))
            if fid in names:
                sys.exit(f"{path}:{ln}: duplicate fdcId {fid}")
            ids.append(fid)
            names[fid] = m.group(2).strip()
    return ids, names


def build(src, common_path):
    for fn, want in EXPECTED_SHA256.items():
        p = os.path.join(src, fn)
        if not os.path.exists(p):
            sys.exit(f"missing source file: {p} (run tools/fetch_source.sh)")
        if sha256(p) != want:
            print(f"WARNING: {fn} checksum differs from the verified source", file=sys.stderr)

    # nutrient unit sanity check
    units = {int(r["id"]): (r["name"], r["unit_name"], r["nutrient_nbr"]) for r in read_csv(os.path.join(src, "nutrient.csv"))}
    for key, nid, nbr, fdc_unit, _ in NUTRIENTS:
        name, u, n = units[nid]
        if u != fdc_unit or n != nbr:
            sys.exit(f"nutrient {key}: id {nid} is {name!r} {u} #{n}, expected {fdc_unit} #{nbr}")

    # groups
    # FDC category ids -> 2-digit SR food-group code (first two digits of the 4-digit FDC code).
    # NOTE: FDC also lists "Alcoholic Beverages" (1410) next to "Beverages" (1400); SR Legacy foods only
    # use category id 14 ("Beverages", which includes the alcoholic drinks), so group names are taken
    # from the categories actually referenced by foods rather than from every row of the table.
    cat_code = {}
    cat_desc = {}
    for r in read_csv(os.path.join(src, "food_category.csv")):
        cat_code[r["id"]] = r["code"][:2]
        cat_desc[r["id"]] = r["description"]
    cat_name = {}

    # foods
    foods = {}
    for r in read_csv(os.path.join(src, "food.csv")):
        if r["data_type"] != "sr_legacy_food":
            continue
        fid = int(r["fdc_id"])
        code = cat_code[r["food_category_id"]]
        if cat_name.setdefault(code, cat_desc[r["food_category_id"]]) != cat_desc[r["food_category_id"]]:
            sys.exit(f"group {code} maps to two category names: {cat_name[code]!r} / {cat_desc[r['food_category_id']]!r}")
        foods[fid] = {
            "name": clean(r["description"]),
            "group": cat_code[r["food_category_id"]],
            "nut": [None] * len(NUTRIENTS),
            "por": [],
        }

    # nutrients (per 100 g)
    for r in read_csv(os.path.join(src, "food_nutrient.csv")):
        idx = NUT_INDEX.get(int(r["nutrient_id"]))
        if idx is None:
            continue
        f = foods.get(int(r["fdc_id"]))
        if f is None or r["amount"] == "":
            continue
        f["nut"][idx] = float(r["amount"])

    # portions
    mu = {r["id"]: r["name"] for r in read_csv(os.path.join(src, "measure_unit.csv"))}
    rows = []
    for r in read_csv(os.path.join(src, "food_portion.csv")):
        rows.append((int(r["fdc_id"]), int(r["seq_num"] or 0), int(r["id"]), r))
    rows.sort(key=lambda t: (t[0], t[1], t[2]))
    skipped = 0
    zero_amount = 0
    for fid, _, _, r in rows:
        f = foods.get(fid)
        if f is None:
            continue
        try:
            grams = float(r["gram_weight"])
        except ValueError:
            grams = 0.0
        if grams <= 0:
            skipped += 1
            continue
        amount = float(r["amount"] or 0)
        if amount <= 0:
            zero_amount += 1
        text = clean(r["modifier"]) or clean(r["portion_description"])
        unit = mu.get(r["measure_unit_id"], "")
        if unit and unit != "undetermined":
            text = f"{unit}, {text}" if text else unit
        if not text:
            text = "serving"
        text = re.sub(r"^tablespoons?\b", "tbsp", text)
        text = re.sub(r"^teaspoons?\b", "tsp", text)
        label = f"{fmt_amount(amount)} {text}"
        f["por"].append([label, grams])

    out_foods = []
    common_ids, common_names = load_common(common_path)
    common = set(common_ids)
    missing = [i for i in common_ids if i not in foods]
    if missing:
        sys.exit(f"common_foods.txt references unknown fdcIds: {missing}")
    for i in common_ids:
        if common_names[i] != foods[i]["name"]:
            print(f"WARNING: common_foods.txt name differs for {i}: {common_names[i]!r} vs {foods[i]['name']!r}", file=sys.stderr)

    for fid in sorted(foods):
        f = foods[fid]
        seen = set()
        portions = []
        for label, g in f["por"]:
            k = label.lower()
            if k in seen:
                continue
            seen.add(k)
            if k == "1 oz" and abs(g - OZ_G) <= 1.0:
                g = OZ_G
            portions.append([label, fmt_grams(g)])
        if "1 oz" not in seen:
            portions.append(["1 oz", OZ_G])
        nut = [fmt_nutrient(v, NUTRIENTS[i][4]) for i, v in enumerate(f["nut"])]
        out_foods.append([fid, f["name"], f["group"], 1 if fid in common else 0, nut, portions])

    used = sorted({f[2] for f in out_foods})
    doc = {
        "source": SOURCE_LABEL,
        "idType": "fdcId",
        "nutrients": [n[0] for n in NUTRIENTS],
        "units": [n[4] for n in NUTRIENTS],
        "groups": {g: cat_name[g] for g in used},
        "foods": out_foods,
    }
    stats = {"portions_skipped_no_grams": skipped, "portions_zero_amount_treated_as_1": zero_amount,
             "common": len(common_ids)}
    return doc, stats


# --------------------------------------------------------------------------- verify
def verify(doc):
    by_name = {f[1]: f for f in doc["foods"]}
    keys = doc["nutrients"]
    ok_all = True
    rows = []
    for desc, exp, ports in CHECKS:
        f = by_name.get(desc)
        if f is None:
            rows.append((desc, "-", "-", "MISSING"))
            ok_all = False
            continue
        for k, (lo, hi) in exp.items():
            v = f[4][keys.index(k)]
            ok = v is not None and lo <= v <= hi
            ok_all &= ok
            rows.append((f"{desc} [{f[0]}]", k, f"{v} (expect {lo}-{hi})" if lo != hi else f"{v} (expect {lo})", "ok" if ok else "FAIL"))
        for prefix, g in ports:
            hit = [p for p in f[5] if p[0].lower().startswith(prefix) and abs(p[1] - g) < 0.51]
            ok = bool(hit)
            ok_all &= ok
            rows.append((f"{desc} [{f[0]}]", "portion", f"{prefix} = {g} g -> {hit[0] if hit else 'not found'}", "ok" if ok else "FAIL"))
    w0 = max(len(r[0]) for r in rows)
    for r in rows:
        print(f"{r[0]:<{w0}}  {r[1]:<8} {r[2]:<52} {r[3]}")
    return ok_all


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", default=os.path.join(ROOT, ".cache", "sr_legacy"))
    ap.add_argument("--common", default=os.path.join(HERE, "common_foods.txt"))
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "foods.json"))
    ap.add_argument("--no-verify", action="store_true")
    a = ap.parse_args()

    doc, stats = build(a.src, a.common)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    blob = json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with open(a.out, "wb") as fh:
        fh.write(blob)
    gz = gzip.compress(blob, 9, mtime=0)
    print(f"foods: {len(doc['foods'])}  common: {stats['common']}  groups: {len(doc['groups'])}")
    print(f"portions: {sum(len(f[5]) for f in doc['foods'])}  "
          f"(skipped no-gram rows: {stats['portions_skipped_no_grams']}, zero-amount rows treated as 1: {stats['portions_zero_amount_treated_as_1']})")
    print(f"wrote {a.out}: {len(blob):,} bytes ({len(blob)/1e6:.2f} MB), gzip -9: {len(gz):,} bytes ({len(gz)/1e6:.2f} MB)")
    miss = {k: sum(1 for f in doc["foods"] if f[4][i] is None) for i, k in enumerate(doc["nutrients"])}
    print("null counts:", miss)
    if not a.no_verify:
        print()
        if not verify(doc):
            sys.exit("VERIFICATION FAILED")
        print("\nall verification checks passed")


if __name__ == "__main__":
    main()
